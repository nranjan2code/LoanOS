//! Minimal fleet controller (design section 5): provision per-tenant
//! rules-service instances, push signed bundles and kill-switch state, and
//! health-check the fleet. v1 targets a single node for local/dev; the
//! cloud fleet controller (pods, KMS, mTLS) is deployment infrastructure.
//!
//! Commands:
//!   rules-fleet sign --kind tenant|platform [--tenant <id>] --label <l>
//!       --effective <rfc3339 IST> --author <a> --approver <b>
//!       --signing-key <hex32> --out <signed.json> <model.json>...
//!   rules-fleet up --config <fleet.json>       spawn instances (writes .pids)
//!   rules-fleet down --config <fleet.json>     stop instances
//!   rules-fleet health --config <fleet.json>   GET /health on every instance
//!   rules-fleet kill-switch --config <fleet.json> --global <true|false>
//!       [--reason <text>]                      broadcast switch state

#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpStream;

use chrono::{DateTime, Utc};
use ed25519_dalek::SigningKey;
use serde::Deserialize;

use rules_bundle::{sign, Bundle, BundleKind, Manifest};
use rules_model::DecisionModel;

#[derive(Deserialize)]
struct FleetConfig {
    service_bin: String,
    verifying_key: String,
    admin_token: String,
    platform_bundle: String,
    audit_dir: String,
    tenants: Vec<TenantEntry>,
}

#[derive(Deserialize)]
struct TenantEntry {
    tenant_id: String,
    port: u16,
    bundle: String,
}

/// Tiny HTTP/1.1 client over TcpStream — the fleet tool's only remote calls
/// are loopback GET/POST, not worth a client dependency.
fn http(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> Result<(u16, String), String> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("connect {port}: {e}"))?;
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\nconnection: close\r\ncontent-length: {}\r\ncontent-type: application/json\r\n",
        body.len()
    );
    for (k, v) in headers {
        request.push_str(&format!("{k}: {v}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("write {port}: {e}"))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("read {port}: {e}"))?;
    let status: u16 = response
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("bad response from {port}"))?;
    let payload = response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    Ok((status, payload))
}

fn load_config(path: &str) -> Result<FleetConfig, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn unhex32(s: &str) -> Result<[u8; 32], String> {
    if s.len() != 64 {
        return Err("signing key must be 32 hex bytes".into());
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).map_err(|_| "bad hex".to_string())?;
    }
    Ok(out)
}

fn cmd_sign(args: &[String]) -> Result<(), String> {
    let kind = match flag(args, "--kind").as_deref() {
        Some("tenant") => BundleKind::Tenant,
        Some("platform") => BundleKind::Platform,
        _ => return Err("--kind must be tenant or platform".into()),
    };
    let manifest = Manifest {
        kind,
        tenant_id: flag(args, "--tenant"),
        version_label: flag(args, "--label").ok_or("--label required")?,
        effective_from: DateTime::parse_from_rfc3339(
            &flag(args, "--effective").ok_or("--effective required")?,
        )
        .map_err(|e| format!("--effective: {e}"))?,
        author: flag(args, "--author").ok_or("--author required")?,
        approver: flag(args, "--approver").ok_or("--approver required")?,
    };
    let key = SigningKey::from_bytes(&unhex32(
        &flag(args, "--signing-key").ok_or("--signing-key required")?,
    )?);
    let out = flag(args, "--out").ok_or("--out required")?;

    let mut models = Vec::new();
    let mut iter = args.iter().peekable();
    while let Some(arg) = iter.next() {
        if arg.starts_with("--") {
            iter.next();
            continue;
        }
        let text = std::fs::read_to_string(arg).map_err(|e| format!("{arg}: {e}"))?;
        let model: DecisionModel =
            serde_json::from_str(&text).map_err(|e| format!("{arg}: {e}"))?;
        models.push(model);
    }
    if models.is_empty() {
        return Err("at least one model file required".into());
    }

    let signed = sign(Bundle { manifest, models }, &key).map_err(|e| e.to_string())?;
    std::fs::write(
        &out,
        serde_json::to_string_pretty(&signed).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("{out}: {e}"))?;
    println!("signed {} -> {}", signed.hash, out);
    println!(
        "verifying key: {}",
        key.verifying_key()
            .to_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    Ok(())
}

fn pidfile(config_path: &str) -> String {
    format!("{config_path}.pids")
}

fn cmd_up(config_path: &str) -> Result<(), String> {
    let config = load_config(config_path)?;
    std::fs::create_dir_all(&config.audit_dir).map_err(|e| e.to_string())?;
    let mut pids = Vec::new();
    for tenant in &config.tenants {
        let child = std::process::Command::new(&config.service_bin)
            .env("RULES_TENANT_ID", &tenant.tenant_id)
            .env("RULES_INSTANCE_ID", format!("eng-{}-1", tenant.tenant_id))
            .env("RULES_PORT", tenant.port.to_string())
            .env("RULES_VERIFYING_KEY", &config.verifying_key)
            .env("RULES_TENANT_BUNDLE", &tenant.bundle)
            .env("RULES_PLATFORM_BUNDLE", &config.platform_bundle)
            .env("RULES_ADMIN_TOKEN", &config.admin_token)
            .env(
                "RULES_AUDIT_PATH",
                format!("{}/{}.jsonl", config.audit_dir, tenant.tenant_id),
            )
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", tenant.tenant_id))?;
        println!(
            "up {} pid={} port={}",
            tenant.tenant_id,
            child.id(),
            tenant.port
        );
        pids.push(child.id().to_string());
    }
    std::fs::write(pidfile(config_path), pids.join("\n")).map_err(|e| e.to_string())?;
    Ok(())
}

fn cmd_down(config_path: &str) -> Result<(), String> {
    let path = pidfile(config_path);
    let pids = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    for pid in pids.lines().filter(|l| !l.is_empty()) {
        let _ = std::process::Command::new("kill").arg(pid).status();
        println!("down pid={pid}");
    }
    let _ = std::fs::remove_file(&path);
    Ok(())
}

fn cmd_health(config_path: &str) -> Result<(), String> {
    let config = load_config(config_path)?;
    let mut failures = 0;
    for tenant in &config.tenants {
        match http(tenant.port, "GET", "/health", &[], "") {
            Ok((200, body)) => println!("healthy {}: {}", tenant.tenant_id, body.trim()),
            Ok((status, _)) => {
                failures += 1;
                println!("unhealthy {}: status {status}", tenant.tenant_id);
            }
            Err(e) => {
                failures += 1;
                println!("unreachable {}: {e}", tenant.tenant_id);
            }
        }
    }
    if failures > 0 {
        Err(format!("{failures} instance(s) unhealthy"))
    } else {
        Ok(())
    }
}

fn cmd_kill_switch(config_path: &str, args: &[String]) -> Result<(), String> {
    let config = load_config(config_path)?;
    let active = flag(args, "--global").ok_or("--global true|false required")? == "true";
    let reason = flag(args, "--reason");
    // Repeated --model <id>=<state> flags, e.g. --model cibil_gateway=active
    let mut models: BTreeMap<String, String> = BTreeMap::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--model" {
            let spec = iter.next().ok_or("--model needs <id>=<state>")?;
            let (id, state) = spec.split_once('=').ok_or("--model needs <id>=<state>")?;
            models.insert(id.to_string(), state.to_string());
        }
    }
    let as_of =
        Utc::now().with_timezone(&chrono::FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("IST"));
    let body = serde_json::json!({
        "as_of": as_of.to_rfc3339(),
        "global": { "active": active, "reason": reason },
        "models": models,
    })
    .to_string();
    for tenant in &config.tenants {
        let result = http(
            tenant.port,
            "POST",
            "/v1/admin/kill-switch",
            &[("x-control-plane-token", config.admin_token.as_str())],
            &body,
        );
        match result {
            Ok((204, _)) => println!(
                "kill-switch pushed to {} (global={active})",
                tenant.tenant_id
            ),
            Ok((status, _)) => println!(
                "kill-switch REJECTED by {}: status {status}",
                tenant.tenant_id
            ),
            Err(e) => println!("kill-switch unreachable {}: {e}", tenant.tenant_id),
        }
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("sign") => cmd_sign(&args[1..]),
        Some("up") => flag(&args, "--config")
            .ok_or("--config required".to_string())
            .and_then(|c| cmd_up(&c)),
        Some("down") => flag(&args, "--config")
            .ok_or("--config required".to_string())
            .and_then(|c| cmd_down(&c)),
        Some("health") => flag(&args, "--config")
            .ok_or("--config required".to_string())
            .and_then(|c| cmd_health(&c)),
        Some("kill-switch") => flag(&args, "--config")
            .ok_or("--config required".to_string())
            .and_then(|c| cmd_kill_switch(&c, &args[1..])),
        _ => Err("usage: rules-fleet <sign|up|down|health|kill-switch> ...".to_string()),
    };
    if let Err(e) = result {
        eprintln!("rules-fleet: {e}");
        std::process::exit(2);
    }
}
