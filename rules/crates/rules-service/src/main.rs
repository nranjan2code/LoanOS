//! Instance entrypoint. All configuration is environment-driven so the fleet
//! controller can spawn instances declaratively:
//!
//! RULES_TENANT_ID        tenant binding (INV-2), immutable for process life
//! RULES_INSTANCE_ID      engine identity for traces
//! RULES_PORT             listen port (loopback binding for local/dev)
//! RULES_VERIFYING_KEY    hex ed25519 public key for bundle verification
//! RULES_TENANT_BUNDLE    path to the signed tenant pack (JSON)
//! RULES_PLATFORM_BUNDLE  path to the signed platform guardrail pack (JSON)
//! RULES_KILL_TTL_SECONDS kill-switch freshness TTL (default 60)
//! RULES_ADMIN_TOKEN      shared token for control-plane pushes (pre-mTLS)
//! RULES_AUDIT_PATH       append-only JSONL audit file

#![forbid(unsafe_code)]

use std::fs::OpenOptions;
use std::sync::Arc;
use std::time::Duration;

use ed25519_dalek::VerifyingKey;
use rules_bundle::{verify, SignedBundle};
use rules_service::{router, Instance};

fn env(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("missing env var {name}"))
}

fn load_signed(path: &str) -> Result<SignedBundle, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))
}

fn unhex32(s: &str) -> Result<[u8; 32], String> {
    if s.len() != 64 {
        return Err("verifying key must be 32 hex-encoded bytes".into());
    }
    let mut out = [0u8; 32];
    for (i, chunk) in out.iter_mut().enumerate() {
        *chunk = u8::from_str_radix(&s[2 * i..2 * i + 2], 16)
            .map_err(|_| "verifying key is not valid hex".to_string())?;
    }
    Ok(out)
}

fn build() -> Result<(Arc<Instance>, u16), String> {
    let tenant_id = env("RULES_TENANT_ID")?;
    let instance_id = env("RULES_INSTANCE_ID")?;
    let port: u16 = env("RULES_PORT")?
        .parse()
        .map_err(|_| "RULES_PORT must be a port number".to_string())?;
    let key = VerifyingKey::from_bytes(&unhex32(&env("RULES_VERIFYING_KEY")?)?)
        .map_err(|e| format!("bad verifying key: {e}"))?;

    // INV-3: verification is the only load path. A bad signature here is a
    // refusal to boot, not a degraded mode.
    let tenant_signed = load_signed(&env("RULES_TENANT_BUNDLE")?)?;
    let tenant_bundle = verify(&tenant_signed, &key).map_err(|e| format!("tenant bundle: {e}"))?;
    let platform_signed = load_signed(&env("RULES_PLATFORM_BUNDLE")?)?;
    let platform_bundle =
        verify(&platform_signed, &key).map_err(|e| format!("platform bundle: {e}"))?;

    let kill_ttl = Duration::from_secs(
        std::env::var("RULES_KILL_TTL_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(60),
    );
    let audit_path = env("RULES_AUDIT_PATH")?;
    let audit = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .map_err(|e| format!("{audit_path}: {e}"))?;

    let instance = Instance::new(
        &tenant_id,
        &instance_id,
        tenant_bundle,
        tenant_signed.hash,
        platform_bundle,
        platform_signed.hash,
        kill_ttl,
        env("RULES_ADMIN_TOKEN")?,
        Box::new(audit),
    )?;
    Ok((Arc::new(instance), port))
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let (instance, port) = match build() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("rules-service: refusing to boot: {e}");
            std::process::exit(1);
        }
    };
    eprintln!(
        "rules-service: tenant={} instance={} tenant_pack={} platform_pack={} port={}",
        instance.tenant_id,
        instance.engine.instance_id,
        instance.tenant_hash,
        instance.platform_hash,
        port
    );
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap_or_else(|e| {
            eprintln!("rules-service: cannot bind 127.0.0.1:{port}: {e}");
            std::process::exit(1);
        });
    axum::serve(listener, router(instance))
        .await
        .expect("server run");
}
