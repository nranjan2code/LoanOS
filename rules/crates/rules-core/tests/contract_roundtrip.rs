//! JSON round-trip tests for the decision contract (PH-0 acceptance).
//! The fixtures are the worked examples from design section 7; if the
//! contract changes, change the design document first.

use rules_core::{DecisionRequest, DecisionResponse, ModelSwitchState, Outcome, ProvenanceSource};

const REQUEST_JSON: &str = r#"{
  "request_id": "req_01JZX4Y8K2",
  "tenant_id": "ten_udaan_nbfc",
  "decision_key": "lending.eligibility",
  "effective_at": "2026-07-10T11:30:00+05:30",
  "version_pin": null,
  "facts": {
    "borrower": { "date_of_birth": "1991-04-02" },
    "economic_profile": {
      "monthly_income": "85000.00",
      "existing_monthly_obligations": "12000.00"
    },
    "product": {
      "requested_amount": "300000.00",
      "requested_tenor_months": 24,
      "annual_interest_rate_bps": 1850
    },
    "bureau": { "score": 742 }
  },
  "fact_provenance": {
    "/bureau/score": { "source": "model", "model_id": "cibil_gateway", "model_version": "2" }
  },
  "context": {
    "channel": "dla_app",
    "caller": "workflow:underwriting",
    "kill_switch": {
      "as_of": "2026-07-10T11:29:41+05:30",
      "global": { "active": false },
      "models": { "cibil_gateway": "active" }
    }
  }
}"#;

const RESPONSE_JSON: &str = r#"{
  "request_id": "req_01JZX4Y8K2",
  "decision": "refer",
  "outputs": {
    "foir": "0.4136",
    "estimated_emi": "15031.94",
    "max_eligible_amount": "250000.00"
  },
  "reasons": [
    {
      "severity": "info",
      "code": "FOIR_NEAR_CEILING",
      "regulation": "RBI-DL-2025",
      "message": "FOIR is within policy but above the straight-through threshold.",
      "path": "economic_profile",
      "audience": "internal"
    }
  ],
  "ruleset": {
    "tenant_pack": "sha256:9f2c41d0aa5510b3c4e2ffd8a1b6c7e0d9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4",
    "platform_pack": "sha256:77aa10b39f2c41d0c4e2ffd8a1b6c7e0d9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4",
    "version_label": "2026.07-r2",
    "effective_from": "2026-07-01T00:00:00+05:30"
  },
  "trace_ref": "audit://ten_udaan_nbfc/decisions/tr_01JZX4YA7Q",
  "engine": { "instance_id": "eng-ten_udaan_nbfc-2", "build": "0.1.0+sha.4be1" },
  "evaluated_at": "2026-07-10T11:30:00.412+05:30"
}"#;

#[test]
fn request_round_trips_losslessly() {
    let parsed: DecisionRequest = serde_json::from_str(REQUEST_JSON).unwrap();
    let reserialized = serde_json::to_value(&parsed).unwrap();
    let original: serde_json::Value = serde_json::from_str(REQUEST_JSON).unwrap();
    assert_eq!(reserialized, original);
}

#[test]
fn response_round_trips_losslessly() {
    let parsed: DecisionResponse = serde_json::from_str(RESPONSE_JSON).unwrap();
    let reserialized = serde_json::to_value(&parsed).unwrap();
    let original: serde_json::Value = serde_json::from_str(RESPONSE_JSON).unwrap();
    assert_eq!(reserialized, original);
}

#[test]
fn request_fields_parse_to_typed_values() {
    let req: DecisionRequest = serde_json::from_str(REQUEST_JSON).unwrap();
    assert_eq!(req.decision_key, "lending.eligibility");
    // INV-12: the IST offset survives parsing; time is request data.
    assert_eq!(req.effective_at.offset().local_minus_utc(), 5 * 3600 + 1800);
    let prov = &req.fact_provenance["/bureau/score"];
    assert_eq!(prov.source, ProvenanceSource::Model);
    assert_eq!(
        req.context.kill_switch.models["cibil_gateway"],
        ModelSwitchState::Active
    );
}

#[test]
fn response_outcome_is_typed() {
    let res: DecisionResponse = serde_json::from_str(RESPONSE_JSON).unwrap();
    assert_eq!(res.decision, Outcome::Refer);
}

#[test]
fn unknown_model_switch_state_fails_closed() {
    // A switch state this build does not recognize must never be consumable
    // (INV-5): forward compatibility may not become permissiveness.
    let state: ModelSwitchState = serde_json::from_str("\"quarantined\"").unwrap();
    assert_eq!(state, ModelSwitchState::Unknown);
    assert!(!state.consumable());
}
