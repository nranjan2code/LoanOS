//! Invariant test suites for the evaluator: INV-1 (determinism), INV-5
//! (fail-closed), INV-6 (exact arithmetic at the fact boundary), INV-7
//! (fuel-bounded totality).

use std::collections::BTreeMap;

use rules_compile::compile;
use rules_core::reason::{Audience, Severity};
use rules_core::{DecisionRequest, EngineInfo, Outcome};
use rules_eval::{decide, evaluate, DecideConfig, DEFAULT_FUEL};
use rules_model::{Binding, BindingType, DecisionModel, FindingRow, NamedExpression, OutcomeRule};

fn config(fuel: u64) -> DecideConfig {
    DecideConfig {
        engine: EngineInfo {
            instance_id: "eng-test-invariants".into(),
            build: "test".into(),
        },
        version_label: "test".into(),
        platform_pack: "sha256:test".into(),
        fuel,
    }
}

fn request(facts: serde_json::Value) -> DecisionRequest {
    serde_json::from_value(serde_json::json!({
        "request_id": "req_invariants",
        "tenant_id": "ten_test",
        "decision_key": "lending.affordability_check",
        "effective_at": "2026-07-10T11:30:00+05:30",
        "facts": facts,
        "context": {
            "channel": "test",
            "caller": "invariant-suite",
            "kill_switch": {
                "as_of": "2026-07-10T11:29:41+05:30",
                "global": { "active": false }
            }
        }
    }))
    .unwrap()
}

/// A small model with one required decimal fact and an EMI computation —
/// enough surface to exercise every invariant.
fn model() -> DecisionModel {
    DecisionModel {
        key: "lending.affordability_check".into(),
        bindings: vec![
            Binding {
                name: "income".into(),
                path: "/income".into(),
                ty: BindingType::Decimal,
                required: true,
            },
            Binding {
                name: "amount".into(),
                path: "/amount".into(),
                ty: BindingType::Decimal,
                required: false,
            },
        ],
        expressions: vec![
            NamedExpression {
                name: "estimated_emi".into(),
                expr: "emi(amount, 1850, 24)".into(),
            },
            NamedExpression {
                name: "foir".into(),
                expr: "round(estimated_emi / income, 4)".into(),
            },
        ],
        findings: vec![FindingRow {
            id: "r_foir_high".into(),
            when: vec!["foir != null".into(), "foir > 0.5".into()],
            severity: Severity::Error,
            code: "FOIR_EXCEEDED".into(),
            regulation: "RBI-DL-2025".into(),
            message: "FOIR exceeds ceiling.".into(),
            path: "income".into(),
            audience: Audience::TenantOps,
        }],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::from([
            ("estimated_emi".into(), "estimated_emi".into()),
            ("foir".into(), "foir".into()),
        ]),
    }
}

#[test]
fn inv1_identical_input_yields_byte_identical_response() {
    let plan = compile(model()).unwrap();
    let req = request(serde_json::json!({ "income": "85000.00", "amount": "300000.00" }));
    let cfg = config(DEFAULT_FUEL);
    let first = serde_json::to_vec(&decide(&plan, &req, &cfg)).unwrap();
    for _ in 0..500 {
        let again = serde_json::to_vec(&decide(&plan, &req, &cfg)).unwrap();
        assert_eq!(first, again, "INV-1 violated: response bytes changed");
    }
}

#[test]
fn inv1_trace_is_deterministic_too() {
    let plan = compile(model()).unwrap();
    let req = request(serde_json::json!({ "income": "85000.00", "amount": "300000.00" }));
    let first = serde_json::to_vec(&evaluate(&plan, &req, DEFAULT_FUEL).unwrap().trace).unwrap();
    for _ in 0..100 {
        let again =
            serde_json::to_vec(&evaluate(&plan, &req, DEFAULT_FUEL).unwrap().trace).unwrap();
        assert_eq!(first, again, "INV-1 violated: trace bytes changed");
    }
}

#[test]
fn inv5_missing_required_fact_fails_closed() {
    let plan = compile(model()).unwrap();
    let response = decide(
        &plan,
        &request(serde_json::json!({ "amount": "300000.00" })),
        &config(DEFAULT_FUEL),
    );
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "EVALUATION_ERROR");
}

#[test]
fn inv5_and_inv6_json_number_for_decimal_fails_closed() {
    // INV-6: money as a JSON number is a contract violation and must land on
    // the restrictive outcome, not be helpfully coerced.
    let plan = compile(model()).unwrap();
    let response = decide(
        &plan,
        &request(serde_json::json!({ "income": 85000.0, "amount": "300000.00" })),
        &config(DEFAULT_FUEL),
    );
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "EVALUATION_ERROR");
}

#[test]
fn inv5_fuel_exhaustion_fails_closed_not_hangs() {
    // INV-7 totality delivered as INV-5 degradation: starve the evaluator.
    let plan = compile(model()).unwrap();
    let response = decide(
        &plan,
        &request(serde_json::json!({ "income": "85000.00", "amount": "300000.00" })),
        &config(10),
    );
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "EVALUATION_ERROR");
}

#[test]
fn inv5_wrong_decision_key_fails_closed() {
    let plan = compile(model()).unwrap();
    let mut req = request(serde_json::json!({ "income": "85000.00" }));
    req.decision_key = "lending.some_other_decision".into();
    let response = decide(&plan, &req, &config(DEFAULT_FUEL));
    assert_eq!(response.decision, Outcome::Refer);
}

#[test]
fn happy_path_decides_and_reports_exact_outputs() {
    let plan = compile(model()).unwrap();
    let response = decide(
        &plan,
        &request(serde_json::json!({ "income": "85000.00", "amount": "300000.00" })),
        &config(DEFAULT_FUEL),
    );
    assert_eq!(response.decision, Outcome::Eligible);
    // INV-6: decimal outputs leave as strings with exact values.
    assert_eq!(response.outputs["estimated_emi"], "15049.81");
    assert_eq!(response.outputs["foir"], "0.1771");
    assert_eq!(response.ruleset.tenant_pack, plan.hash);
}

#[test]
fn inv12_today_comes_from_the_request() {
    // Same plan, different effective_at, different age-sensitive result would
    // apply; here we assert the evaluator never needs a live clock: a request
    // dated far in the past evaluates identically today and tomorrow.
    let plan = compile(model()).unwrap();
    let req = request(serde_json::json!({ "income": "85000.00", "amount": "300000.00" }));
    let a = serde_json::to_vec(&decide(&plan, &req, &config(DEFAULT_FUEL))).unwrap();
    let b = serde_json::to_vec(&decide(&plan, &req, &config(DEFAULT_FUEL))).unwrap();
    assert_eq!(a, b);
    // And the response's evaluated_at is the request's effective_at, not now.
    let response = decide(&plan, &req, &config(DEFAULT_FUEL));
    assert_eq!(response.evaluated_at, req.effective_at);
}
