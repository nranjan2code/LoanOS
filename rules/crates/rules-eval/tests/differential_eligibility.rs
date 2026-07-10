//! PH-1 differential harness: the ported `lending.eligibility` decision model
//! must reproduce the incumbent JS implementation's decision on every corpus
//! case (zero unexplained divergence). The corpus is generated from
//! `packages/core/src/eligibility.js` by `rules/tools/gen-eligibility-corpus.mjs`
//! and checked in for reproducibility.

use rules_compile::compile;
use rules_core::{DecisionRequest, EngineInfo, Outcome};
use rules_eval::{decide, DecideConfig, DEFAULT_FUEL};
use rules_model::DecisionModel;

fn fixture(name: &str) -> String {
    let path = format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(path).unwrap()
}

fn config() -> DecideConfig {
    DecideConfig {
        engine: EngineInfo {
            instance_id: "eng-test-differential".into(),
            build: "test".into(),
        },
        version_label: "ph1-port".into(),
        platform_pack: "sha256:ph1-no-guardrail-pack".into(),
        fuel: DEFAULT_FUEL,
    }
}

fn request(facts: serde_json::Value, id: &str) -> DecisionRequest {
    serde_json::from_value(serde_json::json!({
        "request_id": id,
        "tenant_id": "ten_test",
        "decision_key": "lending.eligibility",
        "effective_at": "2026-07-10T00:00:00+00:00",
        "facts": facts,
        "context": {
            "channel": "test",
            "caller": "differential-harness",
            "kill_switch": {
                "as_of": "2026-07-10T00:00:00+00:00",
                "global": { "active": false }
            }
        }
    }))
    .unwrap()
}

#[test]
fn ported_model_matches_js_on_full_corpus() {
    let model: DecisionModel = serde_json::from_str(&fixture("lending-eligibility.json")).unwrap();
    let plan = compile(model).unwrap();
    let corpus: serde_json::Value =
        serde_json::from_str(&fixture("eligibility-corpus.json")).unwrap();
    let cases = corpus["cases"].as_array().unwrap();
    assert!(cases.len() >= 500, "corpus unexpectedly small");

    let cfg = config();
    let mut divergences = Vec::new();
    for (i, case) in cases.iter().enumerate() {
        let response = decide(
            &plan,
            &request(case["facts"].clone(), &format!("req_case_{i}")),
            &cfg,
        );
        let got = match response.decision {
            Outcome::Eligible => "eligible",
            Outcome::Refer => "refer",
            Outcome::Ineligible => "ineligible",
            other => panic!("case {i}: non-lending outcome {other:?}"),
        };
        let expected = case["expected"].as_str().unwrap();
        if got != expected {
            divergences.push(format!(
                "case {i}: js={expected} rust={got} facts={}",
                case["facts"]
            ));
        }
    }
    assert!(
        divergences.is_empty(),
        "{} divergence(s) from the JS implementation:\n{}",
        divergences.len(),
        divergences.join("\n")
    );
}
