//! Instance test suite: INV-2 tenant binding, INV-5 kill-switch fail-closed
//! degradation (boot-stale, global trip, model trip, recovery), guardrail
//! pairing, and INV-8 audit records.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::DateTime;
use rules_bundle::{Bundle, BundleKind, Manifest};
use rules_core::reason::{Audience, Severity};
use rules_core::{DecisionRequest, GlobalSwitch, ModelSwitchState, Outcome};
use rules_model::{Binding, BindingType, DecisionModel, FindingRow, NamedExpression, OutcomeRule};
use rules_service::Instance;

/// Shared in-memory audit sink so tests can read back what was written.
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

fn guardrail_model() -> DecisionModel {
    DecisionModel {
        key: "guardrail.limit_check".into(),
        bindings: vec![Binding {
            name: "sanctioned".into(),
            path: "/tenant_outputs/sanctioned".into(),
            ty: BindingType::Decimal,
            required: true,
        }],
        expressions: vec![],
        findings: vec![FindingRow {
            id: "g_cap".into(),
            when: vec!["sanctioned > 1000000.00".into()],
            severity: Severity::Error,
            code: "SANCTION_CAP_EXCEEDED".into(),
            regulation: "RBI-DL-2025".into(),
            message: "Platform cap exceeded.".into(),
            path: "tenant_outputs.sanctioned".into(),
            audience: Audience::TenantOps,
        }],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::new(),
    }
}

fn instance_with(kill_ttl: Duration) -> (Arc<Instance>, MemAudit) {
    let tenant_bundle = Bundle {
        manifest: Manifest {
            kind: BundleKind::Tenant,
            tenant_id: Some("ten_test".into()),
            version_label: "test-r1".into(),
            effective_from: DateTime::parse_from_rfc3339("2026-07-01T00:00:00+05:30").unwrap(),
            author: "maker".into(),
            approver: "checker".into(),
        },
        models: vec![tenant_model()],
    };
    let platform_bundle = Bundle {
        manifest: Manifest {
            kind: BundleKind::Platform,
            tenant_id: None,
            version_label: "platform-r1".into(),
            effective_from: DateTime::parse_from_rfc3339("2026-07-01T00:00:00+05:30").unwrap(),
            author: "platform_maker".into(),
            approver: "platform_checker".into(),
        },
        models: vec![guardrail_model()],
    };
    let audit = MemAudit::default();
    let instance = Instance::new(
        "ten_test",
        "eng-ten_test-1",
        tenant_bundle,
        "sha256:tenantpack".into(),
        platform_bundle,
        "sha256:platformpack".into(),
        kill_ttl,
        "test-admin-token".into(),
        Box::new(audit.clone()),
    )
    .unwrap();
    (Arc::new(instance), audit)
}

fn fresh_kill(instance: &Instance) {
    instance.update_kill_switch(
        DateTime::parse_from_rfc3339("2026-07-10T11:29:00+05:30").unwrap(),
        GlobalSwitch {
            active: false,
            reason: None,
        },
        BTreeMap::from([("cibil_gateway".into(), ModelSwitchState::Active)]),
    );
}

fn request(tenant: &str, provenance: bool) -> DecisionRequest {
    let mut value = serde_json::json!({
        "request_id": "req_svc_test",
        "tenant_id": tenant,
        "decision_key": "lending.limit_check",
        "effective_at": "2026-07-10T11:30:00+05:30",
        "facts": { "requested": "500000.00" },
        "context": {
            "channel": "test",
            "caller": "svc-suite",
            "kill_switch": {
                "as_of": "1970-01-01T00:00:00+05:30",
                "global": { "active": false }
            }
        }
    });
    if provenance {
        value["fact_provenance"] = serde_json::json!({
            "/requested": { "source": "model", "model_id": "cibil_gateway", "model_version": "2" }
        });
    }
    serde_json::from_value(value).unwrap()
}

#[test]
fn inv2_tenant_mismatch_is_rejected() {
    let (instance, _) = instance_with(Duration::from_secs(60));
    fresh_kill(&instance);
    let err = instance.handle(request("ten_other", false)).unwrap_err();
    assert_eq!(err, axum::http::StatusCode::FORBIDDEN);
}

#[test]
fn boot_state_is_stale_and_fails_closed_for_model_requests() {
    // INV-5: before the control plane pushes anything, model-tagged requests
    // degrade to manual review. Deterministic requests still evaluate.
    let (instance, _) = instance_with(Duration::from_secs(60));

    let model_tagged = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(model_tagged.decision, Outcome::Refer);
    assert_eq!(model_tagged.reasons[0].code, "KILL_SWITCH_STALE");

    let deterministic = instance.handle(request("ten_test", false)).unwrap();
    assert_eq!(deterministic.decision, Outcome::Eligible);
}

#[test]
fn kill_switch_lifecycle_gates_model_requests() {
    let (instance, _) = instance_with(Duration::from_secs(60));

    // Fresh + inactive: model-tagged request evaluates normally.
    fresh_kill(&instance);
    let ok = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(ok.decision, Outcome::Eligible);

    // Global trip: degraded to refer with the switch named.
    instance.update_kill_switch(
        DateTime::parse_from_rfc3339("2026-07-10T11:31:00+05:30").unwrap(),
        GlobalSwitch {
            active: true,
            reason: Some("incident".into()),
        },
        BTreeMap::from([("cibil_gateway".into(), ModelSwitchState::Active)]),
    );
    let tripped = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(tripped.decision, Outcome::Refer);
    assert_eq!(tripped.reasons[0].code, "KILL_SWITCH_GLOBAL");

    // Model-level trip: same degradation without the global switch.
    instance.update_kill_switch(
        DateTime::parse_from_rfc3339("2026-07-10T11:32:00+05:30").unwrap(),
        GlobalSwitch {
            active: false,
            reason: None,
        },
        BTreeMap::from([("cibil_gateway".into(), ModelSwitchState::Killed)]),
    );
    let model_dead = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(model_dead.decision, Outcome::Refer);
    assert_eq!(model_dead.reasons[0].code, "KILL_SWITCH_MODEL");

    // A model the registry has never heard of is not consumable (INV-5).
    instance.update_kill_switch(
        DateTime::parse_from_rfc3339("2026-07-10T11:33:00+05:30").unwrap(),
        GlobalSwitch {
            active: false,
            reason: None,
        },
        BTreeMap::new(),
    );
    let unknown = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(unknown.decision, Outcome::Refer);
    assert_eq!(unknown.reasons[0].code, "KILL_SWITCH_MODEL");

    // Recovery: clearing restores normal evaluation.
    fresh_kill(&instance);
    let recovered = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(recovered.decision, Outcome::Eligible);
}

#[test]
fn ttl_expiry_degrades_after_freshness_lapses() {
    let (instance, _) = instance_with(Duration::from_millis(20));
    fresh_kill(&instance);
    assert!(instance.kill_switch_fresh());
    std::thread::sleep(Duration::from_millis(40));
    assert!(!instance.kill_switch_fresh());
    let response = instance.handle(request("ten_test", true)).unwrap();
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "KILL_SWITCH_STALE");
}

#[test]
fn guardrail_pairs_by_naming_convention_and_overrides() {
    let (instance, _) = instance_with(Duration::from_secs(60));
    fresh_kill(&instance);
    let mut req = request("ten_test", false);
    req.facts = serde_json::json!({ "requested": "2500000.00" });
    let response = instance.handle(req).unwrap();
    assert_eq!(response.decision, Outcome::Ineligible);
    assert!(response
        .reasons
        .iter()
        .any(|r| r.code == "GUARDRAIL_OVERRIDE"));
    assert_eq!(response.ruleset.platform_pack, "sha256:platformpack");
}

#[test]
fn unknown_decision_key_fails_closed() {
    let (instance, _) = instance_with(Duration::from_secs(60));
    fresh_kill(&instance);
    let mut req = request("ten_test", false);
    req.decision_key = "lending.nonexistent".into();
    let response = instance.handle(req).unwrap();
    assert_eq!(response.decision, Outcome::Refer);
    assert_eq!(response.reasons[0].code, "UNKNOWN_DECISION_KEY");
}

#[test]
fn inv8_audit_record_carries_request_and_response() {
    let (instance, audit) = instance_with(Duration::from_secs(60));
    fresh_kill(&instance);
    let response = instance.handle(request("ten_test", false)).unwrap();

    let bytes = audit.0.lock().unwrap().clone();
    let line = String::from_utf8(bytes).unwrap();
    let record: serde_json::Value = serde_json::from_str(line.lines().next().unwrap()).unwrap();
    assert_eq!(record["tenant_id"], "ten_test");
    assert_eq!(record["request"]["request_id"], "req_svc_test");
    // The stored response is byte-faithful to what the caller received.
    assert_eq!(record["response"], serde_json::to_value(&response).unwrap());
    // And the stored request carries the instance-stamped kill switch, not
    // the caller's placeholder.
    assert_eq!(
        record["request"]["context"]["kill_switch"]["as_of"],
        "2026-07-10T11:29:00+05:30"
    );
}

#[test]
fn inv2_instance_refuses_foreign_tenant_bundle_at_boot() {
    let tenant_bundle = Bundle {
        manifest: Manifest {
            kind: BundleKind::Tenant,
            tenant_id: Some("ten_someone_else".into()),
            version_label: "r1".into(),
            effective_from: DateTime::parse_from_rfc3339("2026-07-01T00:00:00+05:30").unwrap(),
            author: "maker".into(),
            approver: "checker".into(),
        },
        models: vec![tenant_model()],
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
        models: vec![],
    };
    let result = Instance::new(
        "ten_test",
        "eng-ten_test-1",
        tenant_bundle,
        "sha256:x".into(),
        platform_bundle,
        "sha256:y".into(),
        Duration::from_secs(60),
        "tok".into(),
        Box::new(MemAudit::default()),
    );
    assert!(result.is_err());
}
