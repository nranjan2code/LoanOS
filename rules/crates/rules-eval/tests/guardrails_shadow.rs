//! INV-4 (guardrails always run, tighten-only override) and shadow-mode
//! test suites.

use std::collections::BTreeMap;

use rules_compile::compile;
use rules_core::reason::{Audience, Severity};
use rules_core::{DecisionRequest, EngineInfo, Outcome};
use rules_eval::{decide, decide_with_guardrails, shadow, DecideConfig, DEFAULT_FUEL};
use rules_model::{Binding, BindingType, DecisionModel, FindingRow, NamedExpression, OutcomeRule};

fn config() -> DecideConfig {
    DecideConfig {
        engine: EngineInfo {
            instance_id: "eng-test-guardrails".into(),
            build: "test".into(),
        },
        version_label: "test".into(),
        platform_pack: "sha256:placeholder".into(),
        fuel: DEFAULT_FUEL,
    }
}

fn request(facts: serde_json::Value) -> DecisionRequest {
    serde_json::from_value(serde_json::json!({
        "request_id": "req_guardrails",
        "tenant_id": "ten_test",
        "decision_key": "lending.limit_check",
        "effective_at": "2026-07-10T11:30:00+05:30",
        "facts": facts,
        "context": {
            "channel": "test",
            "caller": "guardrail-suite",
            "kill_switch": {
                "as_of": "2026-07-10T11:30:00+05:30",
                "global": { "active": false }
            }
        }
    }))
    .unwrap()
}

/// A permissive tenant model: computes a sanction amount and approves
/// everything — the kind of tenant policy the platform floor must catch.
fn tenant_model() -> DecisionModel {
    DecisionModel {
        key: "lending.limit_check".into(),
        bindings: vec![Binding {
            name: "requested".into(),
            path: "/requested".into(),
            ty: BindingType::Decimal,
            required: true,
        }],
        expressions: vec![NamedExpression {
            name: "sanctioned".into(),
            expr: "requested".into(),
        }],
        findings: vec![],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::from([("sanctioned".into(), "sanctioned".into())]),
    }
}

/// Platform guardrail: sanctioned amount above the regulatory cap is a hard
/// error (post-check reading `/tenant_outputs/sanctioned`).
fn guardrail_model() -> DecisionModel {
    DecisionModel {
        key: "guardrail.sanction_cap".into(),
        bindings: vec![Binding {
            name: "sanctioned".into(),
            path: "/tenant_outputs/sanctioned".into(),
            ty: BindingType::Decimal,
            required: true,
        }],
        expressions: vec![],
        findings: vec![FindingRow {
            id: "g_sanction_cap".into(),
            when: vec!["sanctioned > 1000000.00".into()],
            severity: Severity::Error,
            code: "SANCTION_CAP_EXCEEDED".into(),
            regulation: "RBI-DL-2025".into(),
            message: "Sanctioned amount exceeds the platform regulatory cap.".into(),
            path: "tenant_outputs.sanctioned".into(),
            audience: Audience::TenantOps,
        }],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::new(),
    }
}

#[test]
fn inv4_breaching_tenant_output_is_overridden_with_audit_reason() {
    let tenant = compile(tenant_model()).unwrap();
    let guardrail = compile(guardrail_model()).unwrap();
    let response = decide_with_guardrails(
        &tenant,
        &guardrail,
        &request(serde_json::json!({ "requested": "2500000.00" })),
        &config(),
    );
    // Tenant said eligible; the platform floor says no.
    assert_eq!(response.decision, Outcome::Ineligible);
    let codes: Vec<&str> = response.reasons.iter().map(|r| r.code.as_str()).collect();
    assert!(codes.contains(&"GUARDRAIL_OVERRIDE"));
    assert!(codes.contains(&"SANCTION_CAP_EXCEEDED"));
    // The response records which guardrail pack ran (INV-8 lineage).
    assert_eq!(response.ruleset.platform_pack, guardrail.hash);
}

#[test]
fn inv4_compliant_decision_passes_through_but_guardrail_still_ran() {
    let tenant = compile(tenant_model()).unwrap();
    let guardrail = compile(guardrail_model()).unwrap();
    let response = decide_with_guardrails(
        &tenant,
        &guardrail,
        &request(serde_json::json!({ "requested": "500000.00" })),
        &config(),
    );
    assert_eq!(response.decision, Outcome::Eligible);
    assert!(response.reasons.is_empty());
    // Proof the guardrail pack participated: its hash is in the lineage.
    assert_eq!(response.ruleset.platform_pack, guardrail.hash);
}

#[test]
fn inv4_unevaluable_guardrail_fails_the_decision_closed() {
    // The guardrail requires /tenant_outputs/sanctioned; give it a tenant
    // model that never produces that output. A guardrail that cannot run
    // must deny the decision, not be skipped (INV-4 + INV-5).
    let mut broken_tenant = tenant_model();
    broken_tenant.outputs = BTreeMap::new();
    let tenant = compile(broken_tenant).unwrap();
    let guardrail = compile(guardrail_model()).unwrap();
    let response = decide_with_guardrails(
        &tenant,
        &guardrail,
        &request(serde_json::json!({ "requested": "500000.00" })),
        &config(),
    );
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "EVALUATION_ERROR");
}

#[test]
fn guardrail_require_human_downgrades_but_never_upgrades() {
    // Guardrail with a warn row -> RequireHuman maps to Refer for lending.
    let mut soft = guardrail_model();
    soft.findings[0].severity = Severity::Warn;
    let tenant = compile(tenant_model()).unwrap();
    let guardrail = compile(soft).unwrap();

    let breaching = decide_with_guardrails(
        &tenant,
        &guardrail,
        &request(serde_json::json!({ "requested": "2500000.00" })),
        &config(),
    );
    assert_eq!(breaching.decision, Outcome::Refer);

    // A tenant outcome already MORE restrictive than the guardrail verdict
    // is never loosened (tighten-only is one-directional).
    let mut strict_tenant = tenant_model();
    strict_tenant.findings.push(FindingRow {
        id: "t_always_block".into(),
        when: vec![],
        severity: Severity::Error,
        code: "TENANT_BLOCK".into(),
        regulation: "TENANT-POLICY".into(),
        message: "Tenant policy blocks this case.".into(),
        path: String::new(),
        audience: Audience::Internal,
    });
    let strict = compile(strict_tenant).unwrap();
    let response = decide_with_guardrails(
        &strict,
        &guardrail,
        &request(serde_json::json!({ "requested": "2500000.00" })),
        &config(),
    );
    assert_eq!(response.decision, Outcome::Ineligible);
}

#[test]
fn shadow_candidate_decides_nothing_and_divergence_is_detected() {
    let active_plan = compile(tenant_model()).unwrap();

    // Candidate with a stricter rule: diverges on large amounts.
    let mut candidate_model = tenant_model();
    candidate_model.findings.push(FindingRow {
        id: "t_new_cap".into(),
        when: vec!["requested > 1000000.00".into()],
        severity: Severity::Error,
        code: "NEW_CAP".into(),
        regulation: "TENANT-POLICY".into(),
        message: "Candidate policy caps sanction at 10L.".into(),
        path: "requested".into(),
        audience: Audience::Internal,
    });
    let candidate_plan = compile(candidate_model).unwrap();

    let cfg = config();
    let req = request(serde_json::json!({ "requested": "2500000.00" }));
    let report = shadow(&active_plan, &candidate_plan, &req, &cfg);

    // The acting response is exactly what plain decide() would have produced:
    // the candidate changed nothing.
    assert_eq!(
        serde_json::to_vec(&report.active).unwrap(),
        serde_json::to_vec(&decide(&active_plan, &req, &cfg)).unwrap()
    );
    assert!(report.diverged);
    assert_eq!(report.candidate_outcome, Outcome::Ineligible);
    assert_eq!(report.active.decision, Outcome::Eligible);

    // Identical plans do not diverge.
    let same = shadow(&active_plan, &active_plan, &req, &cfg);
    assert!(!same.diverged);
}
