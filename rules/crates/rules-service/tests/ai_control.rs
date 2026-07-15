//! PH-4 AI control plane suite: DEC-4 provenance enforcement,
//! guardrail.model_consumption, agent guardrail decisions, and INV-10
//! audience filtering.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::DateTime;
use rules_bundle::{Bundle, BundleKind, Manifest};
use rules_core::reason::{Audience, Severity};
use rules_core::{DecisionRequest, GlobalSwitch, ModelSwitchState, Outcome};
use rules_model::{Binding, BindingType, DecisionModel, FindingRow, OutcomeRule};
use rules_service::Instance;

#[derive(Clone, Default)]
struct MemAudit(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for MemAudit {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Tenant model whose `score` fact is declared model-sourced (DEC-4).
fn scored_model() -> DecisionModel {
    DecisionModel {
        key: "lending.scored_check".into(),
        bindings: vec![Binding {
            name: "score".into(),
            path: "/score".into(),
            ty: BindingType::Int,
            required: true,
            requires_model_provenance: true,
        }],
        expressions: vec![],
        findings: vec![FindingRow {
            id: "r_low".into(),
            when: vec!["score < 600".into()],
            severity: Severity::Error,
            code: "SCORE_BELOW_MIN".into(),
            regulation: "RBI-DL-2025".into(),
            message: "Score below minimum.".into(),
            path: "score".into(),
            audience: Audience::Borrower,
        }],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::new(),
    }
}

fn collections_guardrail() -> DecisionModel {
    serde_json::from_str(include_str!(
        "../../../fixtures/guardrail-collections-contact.json"
    ))
    .unwrap()
}

fn agent_action_guardrail() -> DecisionModel {
    serde_json::from_str(include_str!(
        "../../../fixtures/guardrail-agent-action.json"
    ))
    .unwrap()
}

/// A model that emits reasons at every audience level, for INV-10 tests.
fn audience_model() -> DecisionModel {
    let row = |id: &str, audience: Audience| FindingRow {
        id: id.into(),
        when: vec![],
        severity: Severity::Warn,
        code: id.to_uppercase(),
        regulation: "RBI-DL-2025".into(),
        message: format!("{id} reason"),
        path: String::new(),
        audience,
    };
    DecisionModel {
        key: "lending.audience_check".into(),
        bindings: vec![],
        expressions: vec![],
        findings: vec![
            row("internal_only", Audience::Internal),
            row("ops_level", Audience::TenantOps),
            row("borrower_safe", Audience::Borrower),
        ],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::new(),
    }
}

fn instance() -> (Arc<Instance>, MemAudit) {
    let tenant_bundle = Bundle {
        manifest: Manifest {
            kind: BundleKind::Tenant,
            tenant_id: Some("ten_test".into()),
            version_label: "test-r1".into(),
            effective_from: DateTime::parse_from_rfc3339("2026-07-01T00:00:00+05:30").unwrap(),
            author: "maker".into(),
            approver: "checker".into(),
        },
        models: vec![scored_model(), audience_model()],
    };
    let platform_bundle = Bundle {
        manifest: Manifest {
            kind: BundleKind::Platform,
            tenant_id: None,
            version_label: "platform-r1".into(),
            effective_from: DateTime::parse_from_rfc3339("2026-07-01T00:00:00+05:30").unwrap(),
            author: "a".into(),
            approver: "b".into(),
        },
        models: vec![collections_guardrail(), agent_action_guardrail()],
    };
    let audit = MemAudit::default();
    let inst = Instance::new(
        "ten_test",
        "eng-ten_test-1",
        tenant_bundle,
        "sha256:tenantpack".into(),
        platform_bundle,
        "sha256:platformpack".into(),
        Duration::from_secs(60),
        "tok".into(),
        Box::new(audit.clone()),
    )
    .unwrap();
    inst.update_kill_switch(
        DateTime::parse_from_rfc3339("2026-07-10T11:29:00+05:30").unwrap(),
        GlobalSwitch {
            active: false,
            reason: None,
        },
        BTreeMap::from([("cibil_gateway".into(), ModelSwitchState::Active)]),
    );
    (Arc::new(inst), audit)
}

fn request(key: &str, facts: serde_json::Value, extras: serde_json::Value) -> DecisionRequest {
    let mut value = serde_json::json!({
        "request_id": "req_ai_control",
        "tenant_id": "ten_test",
        "decision_key": key,
        "effective_at": "2026-07-10T11:30:00+05:30",
        "facts": facts,
        "context": {
            "channel": "test",
            "caller": "ai-control-suite",
            "kill_switch": {
                "as_of": "1970-01-01T00:00:00+05:30",
                "global": { "active": false }
            }
        }
    });
    if let serde_json::Value::Object(map) = extras {
        for (k, v) in map {
            if k == "audience" {
                value["context"]["audience"] = v;
            } else {
                value[k] = v;
            }
        }
    }
    serde_json::from_value(value).unwrap()
}

#[test]
fn dec4_untagged_model_fact_fails_closed() {
    let (instance, _) = instance();
    // Fact present, no provenance tag: refuse to decide.
    let response = instance
        .handle(request(
            "lending.scored_check",
            serde_json::json!({ "score": 742 }),
            serde_json::json!({}),
        ))
        .unwrap();
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "EVALUATION_ERROR");
    assert!(response.reasons[0].message.contains("provenance"));
}

#[test]
fn dec4_tagged_model_fact_evaluates() {
    let (instance, _) = instance();
    let response = instance
        .handle(request(
            "lending.scored_check",
            serde_json::json!({ "score": 742 }),
            serde_json::json!({ "fact_provenance": {
                "/score": { "source": "model", "model_id": "cibil_gateway", "model_version": "2" }
            }}),
        ))
        .unwrap();
    assert_eq!(response.decision, Outcome::Eligible);
}

#[test]
fn model_consumption_gate_allows_fresh_and_denies_tripped() {
    let (instance, _) = instance();
    let provenance = serde_json::json!({ "fact_provenance": {
        "/anything": { "source": "model", "model_id": "cibil_gateway", "model_version": "2" }
    }});
    let allowed = instance
        .handle(request(
            "guardrail.model_consumption",
            serde_json::json!({}),
            provenance.clone(),
        ))
        .unwrap();
    assert_eq!(allowed.decision, Outcome::Allow);

    // Trip the model: same call now denies (fail-closed vocabulary of the
    // guardrail family).
    instance.update_kill_switch(
        DateTime::parse_from_rfc3339("2026-07-10T11:31:00+05:30").unwrap(),
        GlobalSwitch {
            active: false,
            reason: None,
        },
        BTreeMap::from([("cibil_gateway".into(), ModelSwitchState::Suspended)]),
    );
    let denied = instance
        .handle(request(
            "guardrail.model_consumption",
            serde_json::json!({}),
            provenance,
        ))
        .unwrap();
    assert_eq!(denied.decision, Outcome::Deny);
    assert_eq!(denied.reasons[0].code, "KILL_SWITCH_MODEL");
}

#[test]
fn collections_contact_guardrail_enforces_rbi_window_and_caps() {
    let (instance, _) = instance();
    let facts = |hour: i64, today: i64, week: i64, hardship: bool| {
        serde_json::json!({
            "action": { "proposed_hour_ist": hour },
            "borrower_state": {
                "contacts_today": today,
                "contacts_this_week": week,
                "hardship_flag": hardship,
                "grievance_open": false
            }
        })
    };
    let call = |facts: serde_json::Value| {
        instance
            .handle(request(
                "guardrail.collections_contact",
                facts,
                serde_json::json!({}),
            ))
            .unwrap()
    };

    // Clean daytime contact: allowed.
    assert_eq!(call(facts(11, 0, 2, false)).decision, Outcome::Allow);
    // 07:00 IST is outside the RBI window: denied, borrower-safe reason.
    let early = call(facts(7, 0, 0, false));
    assert_eq!(early.decision, Outcome::Deny);
    assert_eq!(early.reasons[0].code, "CONTACT_OUTSIDE_WINDOW");
    // Regression: a directly-called guardrail must evaluate exactly once —
    // the naming convention must not pair it with itself.
    assert_eq!(early.reasons.len(), 1);
    // 19:00 boundary is already outside.
    assert_eq!(call(facts(19, 0, 0, false)).decision, Outcome::Deny);
    // Daily cap reached: denied.
    assert_eq!(call(facts(11, 3, 5, false)).decision, Outcome::Deny);
    // Weekly frequency: human review required.
    assert_eq!(call(facts(11, 1, 8, false)).decision, Outcome::RequireHuman);
    // Hardship flag: human review required.
    assert_eq!(call(facts(11, 0, 1, true)).decision, Outcome::RequireHuman);
}

#[test]
fn agent_action_guardrail_denies_decision_authority_and_allows_bounded_proposals() {
    let (instance, _) = instance();
    let facts = |proposal_only: bool, approved: bool| {
        serde_json::json!({
            "installation": { "active": true, "tenant_match": true },
            "action": { "approved": approved, "proposal_only": proposal_only, "human_control_attempt": false },
            "data": { "india_region": true },
            "customer": { "customer_facing": false, "disclosure_present": false }
        })
    };
    assert_eq!(
        instance
            .handle(request(
                "guardrail.agent_action",
                facts(true, true),
                serde_json::json!({})
            ))
            .unwrap()
            .decision,
        Outcome::Allow
    );
    assert_eq!(
        instance
            .handle(request(
                "guardrail.agent_action",
                facts(false, true),
                serde_json::json!({})
            ))
            .unwrap()
            .decision,
        Outcome::Deny
    );
    assert_eq!(
        instance
            .handle(request(
                "guardrail.agent_action",
                facts(true, false),
                serde_json::json!({})
            ))
            .unwrap()
            .decision,
        Outcome::Deny
    );
}

#[test]
fn inv10_audience_filtering_strips_responses_but_not_audit() {
    let (instance, audit) = instance();

    // Borrower-facing caller (e.g. an agent talking to the borrower).
    let filtered = instance
        .handle(request(
            "lending.audience_check",
            serde_json::json!({}),
            serde_json::json!({ "audience": "borrower" }),
        ))
        .unwrap();
    let codes: Vec<&str> = filtered.reasons.iter().map(|r| r.code.as_str()).collect();
    assert_eq!(codes, vec!["BORROWER_SAFE"]);

    // Internal caller sees everything.
    let full = instance
        .handle(request(
            "lending.audience_check",
            serde_json::json!({}),
            serde_json::json!({ "audience": "internal" }),
        ))
        .unwrap();
    assert_eq!(full.reasons.len(), 3);

    // The audit records for BOTH calls keep all three reasons (INV-10:
    // filtering is presentation, never data loss).
    let bytes = audit.0.lock().unwrap().clone();
    let text = String::from_utf8(bytes).unwrap();
    for line in text.lines() {
        let record: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(record["response"]["reasons"].as_array().unwrap().len(), 3);
    }
}
