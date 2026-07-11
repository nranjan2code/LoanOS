//! Shadow-mode / migration trace diffing (design section 8 and DEC-7).
//!
//! Usage: rules-diff <active-model.json> <candidate-model.json> <corpus.json>
//!
//! Replays every corpus case through both models (the candidate in shadow —
//! it decides nothing) and reports outcome/output divergences. Exit code 0
//! means no divergence; 1 means divergence (activation review required);
//! 2 means usage or input error.

#![forbid(unsafe_code)]

use rules_compile::compile;
use rules_core::{DecisionRequest, EngineInfo};
use rules_eval::{shadow, DecideConfig, DEFAULT_FUEL};
use rules_model::DecisionModel;

fn load_model(path: &str) -> Result<DecisionModel, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))
}

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let args: Vec<String> = std::env::args().collect();
    let [_, active_path, candidate_path, corpus_path] = args.as_slice() else {
        eprintln!("usage: rules-diff <active-model.json> <candidate-model.json> <corpus.json>");
        return 2;
    };

    let (active, candidate, corpus) = match (|| -> Result<_, String> {
        let active = compile(load_model(active_path)?)
            .map_err(|e| format!("{active_path}: compile: {e}"))?;
        let candidate = compile(load_model(candidate_path)?)
            .map_err(|e| format!("{candidate_path}: compile: {e}"))?;
        let corpus: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(corpus_path).map_err(|e| format!("{corpus_path}: {e}"))?,
        )
        .map_err(|e| format!("{corpus_path}: {e}"))?;
        Ok((active, candidate, corpus))
    })() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("rules-diff: {e}");
            return 2;
        }
    };

    let Some(cases) = corpus["cases"].as_array() else {
        eprintln!("rules-diff: corpus has no cases[] array");
        return 2;
    };
    let effective_at = corpus["now"]
        .as_str()
        .unwrap_or("2026-07-10T00:00:00+00:00");

    let config = DecideConfig {
        engine: EngineInfo {
            instance_id: "eng-rules-diff".into(),
            build: env!("CARGO_PKG_VERSION").into(),
        },
        version_label: "shadow-diff".into(),
        tenant_pack: None,
        platform_pack: "sha256:shadow-diff-no-guardrail".into(),
        fuel: DEFAULT_FUEL,
    };

    let mut divergences = 0usize;
    for (i, case) in cases.iter().enumerate() {
        let request: DecisionRequest = match serde_json::from_value(serde_json::json!({
            "request_id": format!("req_diff_{i}"),
            "tenant_id": "ten_shadow_diff",
            "decision_key": active.model.key,
            "effective_at": effective_at,
            "facts": case["facts"],
            "context": {
                "channel": "shadow-diff",
                "caller": "tool:rules-diff",
                "kill_switch": { "as_of": effective_at, "global": { "active": false } }
            }
        })) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("rules-diff: case {i}: bad request: {e}");
                return 2;
            }
        };
        let report = shadow(&active, &candidate, &request, &config);
        if report.diverged {
            divergences += 1;
            println!(
                "DIVERGENCE case {i}: active={:?} candidate={:?}",
                report.active.decision, report.candidate_outcome
            );
        }
    }

    println!(
        "rules-diff: {} case(s), {} divergence(s); active={} candidate={}",
        cases.len(),
        divergences,
        active.hash,
        candidate.hash
    );
    if divergences > 0 {
        1
    } else {
        0
    }
}
