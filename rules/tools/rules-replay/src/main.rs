//! Trace replay determinism canary (INV-8): every audit record must
//! reproduce byte-identically when re-evaluated against its models.
//!
//! Usage: rules-replay <tenant-model.json> [guardrail-model.json] < audit.jsonl
//!        rules-replay <tenant-model.json> [guardrail-model.json] --audit <audit.jsonl>
//!
//! Records that the service fail-closed WITHOUT evaluating (kill-switch
//! gates, unknown keys) are skipped — they have no evaluation to replay.
//! Exit 0: all replayed records identical. Exit 1: divergence (INV-1/INV-8
//! violation — page someone). Exit 2: usage/input error.

#![forbid(unsafe_code)]

use rules_compile::{compile, Plan};
use rules_core::{DecisionRequest, DecisionResponse, EngineInfo};
use rules_eval::{decide, decide_with_guardrails, DecideConfig, DEFAULT_FUEL};
use rules_model::DecisionModel;

const SERVICE_ONLY_CODES: [&str; 4] = [
    "KILL_SWITCH_STALE",
    "KILL_SWITCH_GLOBAL",
    "KILL_SWITCH_MODEL",
    "UNKNOWN_DECISION_KEY",
];

fn load_plan(path: &str) -> Result<Plan, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let model: DecisionModel = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    compile(model).map_err(|e| format!("{path}: compile: {e}"))
}

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut paths: Vec<String> = Vec::new();
    let mut audit_path: Option<String> = None;
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        if arg == "--audit" {
            audit_path = iter.next();
        } else {
            paths.push(arg);
        }
    }
    let (Some(tenant_path), guardrail_path) = (paths.first(), paths.get(1)) else {
        eprintln!(
            "usage: rules-replay <tenant-model.json> [guardrail-model.json] --audit <audit.jsonl>"
        );
        return 2;
    };

    let tenant = match load_plan(tenant_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("rules-replay: {e}");
            return 2;
        }
    };
    let guardrail = match guardrail_path.map(|p| load_plan(p)).transpose() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("rules-replay: {e}");
            return 2;
        }
    };

    let audit = match &audit_path {
        Some(path) => match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(e) => {
                eprintln!("rules-replay: {path}: {e}");
                return 2;
            }
        },
        None => {
            let mut buf = String::new();
            use std::io::Read;
            if std::io::stdin().read_to_string(&mut buf).is_err() {
                eprintln!("rules-replay: cannot read stdin");
                return 2;
            }
            buf
        }
    };

    let (mut replayed, mut skipped, mut divergences) = (0usize, 0usize, 0usize);
    for (lineno, line) in audit.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("rules-replay: line {}: bad record: {e}", lineno + 1);
                return 2;
            }
        };
        let request: DecisionRequest = match serde_json::from_value(record["request"].clone()) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("rules-replay: line {}: bad request: {e}", lineno + 1);
                return 2;
            }
        };
        let recorded: DecisionResponse = match serde_json::from_value(record["response"].clone()) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("rules-replay: line {}: bad response: {e}", lineno + 1);
                return 2;
            }
        };

        let service_only = recorded
            .reasons
            .first()
            .map(|r| SERVICE_ONLY_CODES.contains(&r.code.as_str()))
            .unwrap_or(false);
        if service_only || request.decision_key != tenant.model.key {
            skipped += 1;
            continue;
        }

        // Reconstruct the exact configuration the recorded decision used.
        let config = DecideConfig {
            engine: EngineInfo {
                instance_id: recorded.engine.instance_id.clone(),
                build: recorded.engine.build.clone(),
            },
            version_label: recorded.ruleset.version_label.clone(),
            tenant_pack: Some(recorded.ruleset.tenant_pack.clone()),
            platform_pack: recorded.ruleset.platform_pack.clone(),
            fuel: DEFAULT_FUEL,
        };
        let mut replay = match &guardrail {
            Some(g) => decide_with_guardrails(&tenant, g, &request, &config),
            None => decide(&tenant, &request, &config),
        };
        // trace_ref is a storage reference assigned by the service, not
        // decision content — normalize before the byte comparison.
        replay.trace_ref = recorded.trace_ref.clone();

        replayed += 1;
        let a = serde_json::to_vec(&recorded).expect("recorded serializes");
        let b = serde_json::to_vec(&replay).expect("replay serializes");
        if a != b {
            divergences += 1;
            println!(
                "DIVERGENCE line {}: request_id={} recorded={:?} replayed={:?}",
                lineno + 1,
                request.request_id,
                recorded.decision,
                replay.decision
            );
        }
    }

    println!(
        "rules-replay: {replayed} replayed, {skipped} skipped, {divergences} divergence(s); model={}",
        tenant.hash
    );
    if divergences > 0 {
        1
    } else {
        0
    }
}
