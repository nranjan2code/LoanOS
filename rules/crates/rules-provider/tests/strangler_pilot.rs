//! PH-5 pilot: the strangler-fig migration playbook (design section 11)
//! executed end-to-end against a mock incumbent engine.
//!
//! Phase 1 — proxy: the tenant's decision key is bound to the incumbent via
//!           RestProvider; traffic flows on day one.
//! Phase 2 — shadow: the native model evaluates the same traffic; divergences
//!           are counted and explained before cutover.
//! Phase 3 — flip: the router rebinds the key to the native provider — a
//!           data change, not a code change.
//! Phase 4 — rollback stays available: the incumbent binding still works.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::routing::post;
use axum::{Json, Router as AxumRouter};
use rules_compile::compile;
use rules_core::reason::{Audience, Severity};
use rules_core::{DecisionRequest, DecisionResponse, EngineInfo, Outcome};
use rules_eval::{DecideConfig, DEFAULT_FUEL};
use rules_model::{Binding, BindingType, DecisionModel, FindingRow, NamedExpression, OutcomeRule};
use rules_provider::{DecisionProvider, NativeProvider, RestProvider, Router, TraceFidelity};

/// The tenant's policy as ported to the native engine: cap at 10L.
fn native_model() -> DecisionModel {
    DecisionModel {
        key: "lending.limit_check".into(),
        bindings: vec![Binding {
            name: "requested".into(),
            path: "/requested".into(),
            ty: BindingType::Decimal,
            required: true,
            requires_model_provenance: false,
        }],
        expressions: vec![NamedExpression {
            name: "sanctioned".into(),
            expr: "requested".into(),
        }],
        findings: vec![FindingRow {
            id: "r_cap".into(),
            when: vec!["requested > 1000000.00".into()],
            severity: Severity::Error,
            code: "CAP_EXCEEDED".into(),
            regulation: "TENANT-POLICY".into(),
            message: "Requested amount exceeds the sanction cap.".into(),
            path: "requested".into(),
            audience: Audience::TenantOps,
        }],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::new(),
    }
}

/// Mock incumbent BRMS: same cap policy, but a legacy quirk — it also refers
/// everything above 9L for manual review (the kind of undocumented behavior
/// shadow mode exists to surface). Speaks the decision contract through a
/// thin shim, produces no traces (OutcomeOnly fidelity).
// The mock incumbent INTENTIONALLY uses float arithmetic: it simulates a
// legacy engine that does not honor INV-6. Real evaluation-path code stays
// under the deny gate; this is the adversary, not the engine.
#[allow(clippy::disallowed_types)]
async fn incumbent_decide(Json(request): Json<DecisionRequest>) -> Json<DecisionResponse> {
    let amount: f64 = request
        .facts
        .pointer("/requested")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);
    let decision = if amount > 1_000_000.0 {
        Outcome::Ineligible
    } else if amount > 900_000.0 {
        Outcome::Refer
    } else {
        Outcome::Eligible
    };
    Json(DecisionResponse {
        request_id: request.request_id.clone(),
        decision,
        outputs: serde_json::Value::Object(serde_json::Map::new()),
        reasons: vec![],
        ruleset: rules_core::RulesetInfo {
            tenant_pack: "legacy:drools-pack-7".into(),
            platform_pack: "legacy:none".into(),
            version_label: "incumbent-2019.4".into(),
            effective_from: request.effective_at,
        },
        trace_ref: "legacy:no-trace".into(),
        engine: EngineInfo {
            instance_id: "legacy-brms-1".into(),
            build: "drools-7.x-shim".into(),
        },
        evaluated_at: request.effective_at,
    })
}

async fn spawn_incumbent() -> String {
    let app = AxumRouter::new().route("/decide", post(incumbent_decide));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}/decide")
}

fn request(id: &str, amount: &str) -> DecisionRequest {
    serde_json::from_value(serde_json::json!({
        "request_id": id,
        "tenant_id": "ten_pilot",
        "decision_key": "lending.limit_check",
        "effective_at": "2026-07-10T11:30:00+05:30",
        "facts": { "requested": amount },
        "context": {
            "channel": "pilot",
            "caller": "strangler-pilot",
            "kill_switch": {
                "as_of": "2026-07-10T11:30:00+05:30",
                "global": { "active": false }
            }
        }
    }))
    .unwrap()
}

fn native_provider() -> Arc<NativeProvider> {
    Arc::new(NativeProvider {
        plan: compile(native_model()).unwrap(),
        guardrail: None,
        config: DecideConfig {
            engine: EngineInfo {
                instance_id: "eng-ten_pilot-1".into(),
                build: "pilot".into(),
            },
            version_label: "native-r1".into(),
            tenant_pack: None,
            platform_pack: "sha256:pilot-no-guardrail".into(),
            fuel: DEFAULT_FUEL,
        },
    })
}

#[tokio::test]
async fn strangler_playbook_proxy_shadow_flip_rollback() {
    let endpoint = spawn_incumbent().await;
    let incumbent: Arc<dyn DecisionProvider> =
        Arc::new(RestProvider::new("legacy-brms", &endpoint));
    let native: Arc<dyn DecisionProvider> = native_provider();

    // Phase 1 — proxy. The tenant is live on day one via the incumbent, and
    // the compliance posture records the reduced trace fidelity.
    let mut router = Router::new();
    router.bind("lending.limit_check", incumbent.clone());
    let proxied = router.route(request("req_p1", "500000.00")).await.unwrap();
    assert_eq!(proxied.decision, Outcome::Eligible);
    assert_eq!(proxied.engine.instance_id, "legacy-brms-1");
    assert_eq!(
        router.posture()["lending.limit_check"].trace_fidelity,
        TraceFidelity::OutcomeOnly
    );

    // Phase 2 — shadow. Replay traffic through both engines; divergences must
    // be explained before cutover. The incumbent's undocumented 9L referral
    // band is exactly what this surfaces.
    let corpus = [
        "100000.00",
        "500000.00",
        "899999.99",
        "950000.00",
        "1200000.00",
    ];
    let mut divergences = Vec::new();
    for (i, amount) in corpus.iter().enumerate() {
        let via_incumbent = incumbent
            .evaluate(request(&format!("req_s{i}"), amount))
            .await
            .unwrap();
        let via_native = native
            .evaluate(request(&format!("req_s{i}"), amount))
            .await
            .unwrap();
        if via_incumbent.decision != via_native.decision {
            divergences.push((
                amount.to_string(),
                via_incumbent.decision,
                via_native.decision,
            ));
        }
    }
    // Exactly the 9L-10L band diverges: incumbent refers, native (the
    // board-approved policy as written) approves. Divergence explained and
    // signed off: the referral band was an operator habit, not policy.
    assert_eq!(divergences.len(), 1);
    assert_eq!(divergences[0].0, "950000.00");
    assert_eq!(divergences[0].1, Outcome::Refer);
    assert_eq!(divergences[0].2, Outcome::Eligible);

    // Phase 3 — flip. Rebinding is a data change; same contract, full
    // fidelity lineage from the native engine.
    router.bind("lending.limit_check", native.clone());
    let cutover = router.route(request("req_p3", "500000.00")).await.unwrap();
    assert_eq!(cutover.decision, Outcome::Eligible);
    assert_eq!(cutover.engine.instance_id, "eng-ten_pilot-1");
    assert!(cutover.ruleset.tenant_pack.starts_with("sha256:"));
    assert_eq!(
        router.posture()["lending.limit_check"].trace_fidelity,
        TraceFidelity::Full
    );

    // Phase 4 — rollback stays available: rebind to the incumbent, it still
    // answers.
    router.bind("lending.limit_check", incumbent.clone());
    let rollback = router.route(request("req_p4", "500000.00")).await.unwrap();
    assert_eq!(rollback.engine.instance_id, "legacy-brms-1");

    // An unbound key is fail-closed at the caller, never silently defaulted.
    let mut fresh = Router::new();
    fresh.bind("lending.limit_check", native);
    assert!(fresh.route(request("req_unbound", "1.00")).await.is_ok());
    let err = fresh
        .route({
            let mut r = request("req_unbound2", "1.00");
            r.decision_key = "lending.unbound_key".into();
            r
        })
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no provider bound"));
}

#[tokio::test]
async fn remote_failure_is_an_error_not_a_permissive_default() {
    // A dead incumbent must surface as an error the instance maps to the
    // fail-closed outcome — never a fabricated approval.
    let dead: Arc<dyn DecisionProvider> =
        Arc::new(RestProvider::new("dead-brms", "http://127.0.0.1:9/decide"));
    let mut router = Router::new();
    router.bind("lending.limit_check", dead);
    let result = router.route(request("req_dead", "1.00")).await;
    assert!(result.is_err());
}
