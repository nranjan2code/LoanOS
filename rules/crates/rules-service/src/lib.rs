//! Per-tenant engine instance (design section 5): the PRIMARY deployment
//! shape. One process, one tenant, bound at boot (INV-2). Loads only verified
//! bundles (INV-3), stamps kill-switch state from its local TTL cache
//! (fail-closed, INV-5), and appends every decision to the tenant's audit
//! stream (INV-8).
//!
//! Documented deviations (design section 15 amendments): v1 transport is
//! plain HTTP for local/dev — mTLS identities (SEC-3) land with deployment
//! infrastructure; the audit stream is an append-only JSONL file — the
//! encrypted audit-service sink replaces it when the control-plane store
//! moves to Postgres.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use std::collections::BTreeMap;
use std::io::Write;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, FixedOffset};
use serde::Deserialize;

use rules_bundle::{Bundle, BundleKind};
use rules_compile::{compile, Plan};
use rules_core::outcome::DecisionFamily;
use rules_core::reason::{Audience, Severity};
use rules_core::{
    DecisionRequest, DecisionResponse, EngineInfo, GlobalSwitch, KillSwitchSnapshot,
    ModelSwitchState, ProvenanceSource, Reason, RulesetInfo,
};
use rules_eval::{decide, decide_with_guardrails, DecideConfig, DEFAULT_FUEL};

/// Kill-switch cache entry: control-plane state plus local receipt time for
/// TTL freshness (INV-5: stale state fails closed on model-tagged requests).
pub struct KillCache {
    pub as_of: DateTime<FixedOffset>,
    pub global: GlobalSwitch,
    pub models: BTreeMap<String, ModelSwitchState>,
    pub received_at: Instant,
}

pub struct Instance {
    pub tenant_id: String,
    pub engine: EngineInfo,
    pub version_label: String,
    pub tenant_hash: String,
    pub platform_hash: String,
    plans: BTreeMap<String, Plan>,
    guardrails: BTreeMap<String, Plan>,
    kill: RwLock<KillCache>,
    kill_ttl: Duration,
    admin_token: String,
    audit: Mutex<Box<dyn Write + Send>>,
}

pub type SharedInstance = Arc<Instance>;

impl Instance {
    /// Build an instance from ALREADY-VERIFIED bundles. Callers must obtain
    /// the `Bundle` values through `rules_bundle::verify` (INV-3) — `main.rs`
    /// does; tests may construct bundles directly.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant_id: &str,
        instance_id: &str,
        tenant_bundle: Bundle,
        tenant_hash: String,
        platform_bundle: Bundle,
        platform_hash: String,
        kill_ttl: Duration,
        admin_token: String,
        audit: Box<dyn Write + Send>,
    ) -> Result<Instance, String> {
        if tenant_bundle.manifest.kind != BundleKind::Tenant
            || tenant_bundle.manifest.tenant_id.as_deref() != Some(tenant_id)
        {
            // INV-2: an instance refuses a pack for any other tenant.
            return Err("tenant bundle does not match instance tenant binding".into());
        }
        if platform_bundle.manifest.kind != BundleKind::Platform {
            return Err("platform bundle has the wrong kind".into());
        }
        let mut plans = BTreeMap::new();
        for model in tenant_bundle.models {
            let key = model.key.clone();
            let plan = compile(model).map_err(|e| format!("tenant model {key}: {e}"))?;
            plans.insert(key, plan);
        }
        let mut guardrails = BTreeMap::new();
        for model in platform_bundle.models {
            let key = model.key.clone();
            let plan = compile(model).map_err(|e| format!("platform model {key}: {e}"))?;
            guardrails.insert(key, plan);
        }
        Ok(Instance {
            tenant_id: tenant_id.to_string(),
            engine: EngineInfo {
                instance_id: instance_id.to_string(),
                build: format!("{}+rules-service", env!("CARGO_PKG_VERSION")),
            },
            version_label: tenant_bundle.manifest.version_label,
            tenant_hash,
            platform_hash,
            plans,
            guardrails,
            // Boot state: no kill-switch data received yet. received_at is
            // backdated by the TTL so the cache starts STALE — the instance
            // fails closed on model-tagged requests until the control plane
            // pushes state (INV-5: absence of information is not permission).
            kill: RwLock::new(KillCache {
                as_of: DateTime::parse_from_rfc3339("1970-01-01T00:00:00+05:30")
                    .expect("epoch parses"),
                global: GlobalSwitch {
                    active: false,
                    reason: None,
                },
                models: BTreeMap::new(),
                received_at: Instant::now()
                    .checked_sub(kill_ttl)
                    .unwrap_or_else(Instant::now),
            }),
            kill_ttl,
            admin_token,
            audit: Mutex::new(audit),
        })
    }

    /// The guardrail plan paired with a decision key by naming convention:
    /// `lending.eligibility` -> `guardrail.eligibility` (documented in the
    /// design doc, section 9).
    fn guardrail_for(&self, decision_key: &str) -> Option<&Plan> {
        let suffix = decision_key.split_once('.').map(|(_, s)| s)?;
        self.guardrails.get(&format!("guardrail.{suffix}"))
    }

    fn fail_closed(
        &self,
        request: &DecisionRequest,
        code: &str,
        message: &str,
    ) -> DecisionResponse {
        let family =
            DecisionFamily::of_key(&request.decision_key).unwrap_or(DecisionFamily::Lending);
        DecisionResponse {
            request_id: request.request_id.clone(),
            decision: family.fail_closed_outcome(),
            outputs: serde_json::Value::Object(serde_json::Map::new()),
            reasons: vec![Reason {
                severity: Severity::Error,
                code: code.into(),
                regulation: "PLATFORM".into(),
                message: message.into(),
                path: String::new(),
                audience: Audience::Internal,
            }],
            ruleset: RulesetInfo {
                tenant_pack: self.tenant_hash.clone(),
                platform_pack: self.platform_hash.clone(),
                version_label: self.version_label.clone(),
                effective_from: request.effective_at,
            },
            trace_ref: format!(
                "audit://{}/decisions/{}",
                self.tenant_id, request.request_id
            ),
            engine: self.engine.clone(),
            evaluated_at: request.effective_at,
        }
    }

    /// The full instance decision path. Pure with respect to the request
    /// except for the kill-switch cache read and the audit append.
    pub fn handle(&self, mut request: DecisionRequest) -> Result<DecisionResponse, StatusCode> {
        // INV-2 defense in depth: the gateway routed here, but the instance
        // re-checks its own binding. Mismatches are alarmed with IDs only
        // (SEC-5).
        if request.tenant_id != self.tenant_id {
            eprintln!(
                "ALARM tenant_mismatch instance={} request_id={}",
                self.engine.instance_id, request.request_id
            );
            return Err(StatusCode::FORBIDDEN);
        }

        // Stamp kill-switch state from the local cache; a caller-supplied
        // value is ignored and alarmed (design section 7).
        let caller_supplied = request.context.kill_switch.global.active
            || !request.context.kill_switch.models.is_empty();
        if caller_supplied {
            eprintln!(
                "ALARM caller_supplied_kill_switch instance={} request_id={}",
                self.engine.instance_id, request.request_id
            );
        }
        let (stale, global_active, dead_models) = {
            let cache = self.kill.read().expect("kill cache lock");
            request.context.kill_switch = KillSwitchSnapshot {
                as_of: cache.as_of,
                global: cache.global.clone(),
                models: cache.models.clone(),
            };
            let dead: Vec<String> = request
                .fact_provenance
                .values()
                .filter(|p| p.source == ProvenanceSource::Model)
                .filter_map(|p| p.model_id.clone())
                .filter(|id| {
                    !cache
                        .models
                        .get(id)
                        .copied()
                        .unwrap_or(ModelSwitchState::Unknown)
                        .consumable()
                })
                .collect();
            (
                cache.received_at.elapsed() > self.kill_ttl,
                cache.global.active,
                dead,
            )
        };

        // Fail-closed kill-switch gate (INV-5): a request consuming model
        // output may proceed only on fresh, affirmative switch state.
        let consumes_model = request
            .fact_provenance
            .values()
            .any(|p| p.source == ProvenanceSource::Model);
        let response = if consumes_model && stale {
            self.fail_closed(
                &request,
                "KILL_SWITCH_STALE",
                "kill-switch state is stale; model-dependent decisions degrade to manual review",
            )
        } else if consumes_model && global_active {
            self.fail_closed(
                &request,
                "KILL_SWITCH_GLOBAL",
                "global AI kill switch is active; model-dependent decisions degrade to manual review",
            )
        } else if consumes_model && !dead_models.is_empty() {
            self.fail_closed(
                &request,
                "KILL_SWITCH_MODEL",
                "a consumed model is suspended or unknown to the kill-switch registry",
            )
        } else if request.decision_key == "guardrail.model_consumption" {
            // DEC-4 standalone gate: given provenance-tagged facts, may these
            // model outputs be consumed right now? The kill-switch checks
            // above already denied stale/global/dead states, so reaching
            // here means every tagged model is fresh and consumable.
            let mut response = self.fail_closed(&request, "MODEL_CONSUMPTION_OK", "");
            response.decision = rules_core::Outcome::Allow;
            response.reasons.clear();
            response
        } else if let Some(plan) = self
            .plans
            .get(&request.decision_key)
            .or_else(|| self.guardrails.get(&request.decision_key))
        {
            let config = DecideConfig {
                engine: self.engine.clone(),
                version_label: self.version_label.clone(),
                tenant_pack: Some(self.tenant_hash.clone()),
                platform_pack: self.platform_hash.clone(),
                fuel: DEFAULT_FUEL,
            };
            // A guardrail-family decision is never wrapped again: the
            // naming convention would pair it with itself and evaluate it
            // twice. Overlays apply to tenant decisions only.
            let guardrail = match plan.family {
                DecisionFamily::Guardrail => None,
                _ => self.guardrail_for(&request.decision_key),
            };
            let mut response = match guardrail {
                Some(guardrail) => decide_with_guardrails(plan, guardrail, &request, &config),
                None => decide(plan, &request, &config),
            };
            response.trace_ref = format!(
                "audit://{}/decisions/{}",
                self.tenant_id, request.request_id
            );
            response
        } else {
            self.fail_closed(
                &request,
                "UNKNOWN_DECISION_KEY",
                "no decision model for this key in the tenant pack",
            )
        };

        // INV-8: the audit record carries the full request and response so
        // rules-replay can reproduce the decision byte-for-byte.
        let record = serde_json::json!({
            "tenant_id": self.tenant_id,
            "request": request,
            "response": response,
        });
        {
            let mut audit = self.audit.lock().expect("audit lock");
            let line = serde_json::to_string(&record).expect("audit record serializes");
            let _ = writeln!(audit, "{line}");
            let _ = audit.flush();
        }

        // INV-10: the audit record above keeps every reason; the caller only
        // receives reasons at or below its audience level.
        let mut response = response;
        if let Some(audience) = request.context.audience {
            response.retain_reasons_for(audience);
        }
        Ok(response)
    }

    pub fn update_kill_switch(
        &self,
        as_of: DateTime<FixedOffset>,
        global: GlobalSwitch,
        models: BTreeMap<String, ModelSwitchState>,
    ) {
        let mut cache = self.kill.write().expect("kill cache lock");
        *cache = KillCache {
            as_of,
            global,
            models,
            received_at: Instant::now(),
        };
    }

    pub fn kill_switch_fresh(&self) -> bool {
        self.kill
            .read()
            .expect("kill cache lock")
            .received_at
            .elapsed()
            <= self.kill_ttl
    }
}

#[derive(Deserialize)]
pub struct KillSwitchUpdate {
    pub as_of: DateTime<FixedOffset>,
    pub global: GlobalSwitch,
    #[serde(default)]
    pub models: BTreeMap<String, ModelSwitchState>,
}

pub fn router(instance: SharedInstance) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/decide", post(decide_handler))
        .route("/v1/admin/kill-switch", post(kill_switch_handler))
        .with_state(instance)
}

async fn health(State(instance): State<SharedInstance>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "tenant_id": instance.tenant_id,
        "instance_id": instance.engine.instance_id,
        "tenant_pack": instance.tenant_hash,
        "platform_pack": instance.platform_hash,
        "version_label": instance.version_label,
        "kill_switch_fresh": instance.kill_switch_fresh(),
    }))
}

async fn decide_handler(
    State(instance): State<SharedInstance>,
    Json(request): Json<DecisionRequest>,
) -> Result<Json<DecisionResponse>, StatusCode> {
    instance.handle(request).map(Json)
}

async fn kill_switch_handler(
    State(instance): State<SharedInstance>,
    headers: axum::http::HeaderMap,
    Json(update): Json<KillSwitchUpdate>,
) -> StatusCode {
    // Control-plane authentication placeholder: shared token until mTLS
    // identities land (SEC-3 deviation noted in the crate docs).
    let authorized = headers
        .get("x-control-plane-token")
        .and_then(|v| v.to_str().ok())
        == Some(instance.admin_token.as_str());
    if !authorized {
        eprintln!(
            "ALARM unauthorized_kill_switch_push instance={}",
            instance.engine.instance_id
        );
        return StatusCode::FORBIDDEN;
    }
    instance.update_kill_switch(update.as_of, update.global, update.models);
    StatusCode::NO_CONTENT
}
