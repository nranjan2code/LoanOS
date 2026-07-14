use rules_compile::compile;
use rules_core::{DecisionRequest, EngineInfo, Outcome};
use rules_eval::{decide, DecideConfig, DEFAULT_FUEL};
use rules_model::DecisionModel;

fn plan() -> rules_compile::Plan {
    let model: DecisionModel = serde_json::from_str(include_str!(
        "../../../fixtures/platform-control-staffing.json"
    ))
    .unwrap();
    compile(model).unwrap()
}

fn request(facts: serde_json::Value) -> DecisionRequest {
    serde_json::from_value(serde_json::json!({
        "request_id": "ctrl_staffing_1",
        "tenant_id": "tenant_control_test",
        "decision_key": "guardrail.platform_control.staffing",
        "effective_at": "2026-07-15T12:00:00+05:30",
        "facts": facts,
        "context": {
            "channel": "platform-control",
            "caller": "identity-governance",
            "kill_switch": { "as_of": "1970-01-01T00:00:00+05:30", "global": { "active": false } }
        }
    }))
    .unwrap()
}

fn config() -> DecideConfig {
    DecideConfig {
        engine: EngineInfo {
            instance_id: "ctrl-tenant-control-test-1".into(),
            build: "test".into(),
        },
        version_label: "platform-control-r1".into(),
        tenant_pack: Some("sha256:control-tenant-pack".into()),
        platform_pack: "sha256:control-platform-pack".into(),
        fuel: DEFAULT_FUEL,
    }
}

fn ready_facts() -> serde_json::Value {
    serde_json::json!({
        "staffing": {
            "feature_configured": true,
            "missing_role_sets": 0,
            "independence_failures": 0,
            "sod_violations": 0,
            "active_human_principals": 3,
            "minimum_distinct_principals": 3,
            "open_operational_pauses": 0
        },
        "action": {
            "actor_authorized": true,
            "agent_attempts_human_control": false,
            "agent_guardrail_allowed": true
        }
    })
}

#[test]
fn independently_staffed_human_action_is_allowed() {
    let response = decide(&plan(), &request(ready_facts()), &config());
    assert_eq!(response.decision, Outcome::Allow);
}

#[test]
fn missing_checker_and_insufficient_people_deny() {
    let mut facts = ready_facts();
    facts["staffing"]["missing_role_sets"] = serde_json::json!(1);
    facts["staffing"]["active_human_principals"] = serde_json::json!(1);
    let response = decide(&plan(), &request(facts), &config());
    assert_eq!(response.decision, Outcome::Deny);
    assert!(response
        .reasons
        .iter()
        .any(|reason| reason.code == "REQUIRED_ROLE_UNSTAFFED"));
    assert!(response
        .reasons
        .iter()
        .any(|reason| reason.code == "MINIMUM_DISTINCT_PEOPLE_NOT_MET"));
}

#[test]
fn agent_cannot_fill_human_control_role() {
    let mut facts = ready_facts();
    facts["action"]["agent_attempts_human_control"] = serde_json::json!(true);
    let response = decide(&plan(), &request(facts), &config());
    assert_eq!(response.decision, Outcome::Deny);
    assert!(response
        .reasons
        .iter()
        .any(|reason| reason.code == "AGENT_HUMAN_CONTROL_FORBIDDEN"));
}

#[test]
fn malformed_or_missing_facts_fail_closed() {
    let response = decide(&plan(), &request(serde_json::json!({})), &config());
    assert_eq!(response.decision, Outcome::Deny);
    assert_eq!(response.reasons[0].code, "EVALUATION_ERROR");
}
