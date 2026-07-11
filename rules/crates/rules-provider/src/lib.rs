//! Decision-provider federation (design section 11, DEC-7).
//!
//! The native engine is one provider among adapters. A per-tenant `Router`
//! binds each decision key to a provider, which is what makes the
//! strangler-fig migration possible: proxy an incumbent engine on day one,
//! shadow the native model against real traffic, flip the binding per
//! decision key, keep the adapter for rollback.
//!
//! Every provider answers the SAME contract (`DecisionRequest` in,
//! `DecisionResponse` out) so audit lineage is uniform regardless of which
//! engine decided. Adapters that cannot produce per-rule traces declare
//! reduced `trace_fidelity`, which surfaces in the tenant's compliance
//! posture.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use thiserror::Error;

use rules_compile::Plan;
use rules_core::{DecisionRequest, DecisionResponse};
use rules_eval::{decide, decide_with_guardrails, DecideConfig};

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("no provider bound for decision key: {0}")]
    NoBinding(String),
    #[error("remote provider {name} failed: {detail}")]
    Remote { name: String, detail: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceFidelity {
    /// Per-rule evaluation record, replayable (native engine).
    Full,
    /// Outcome and reasons only (typical legacy REST BRMS).
    OutcomeOnly,
}

#[derive(Debug, Clone)]
pub struct ProviderCapabilities {
    pub name: String,
    pub trace_fidelity: TraceFidelity,
    pub supports_version_pin: bool,
}

#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn evaluate(&self, request: DecisionRequest) -> Result<DecisionResponse, ProviderError>;
    fn capabilities(&self) -> ProviderCapabilities;
}

/// The first-party engine as a provider: a compiled tenant plan, optionally
/// wrapped by a platform guardrail plan (INV-4 applies here exactly as in
/// the instance path).
pub struct NativeProvider {
    pub plan: Plan,
    pub guardrail: Option<Plan>,
    pub config: DecideConfig,
}

#[async_trait]
impl DecisionProvider for NativeProvider {
    async fn evaluate(&self, request: DecisionRequest) -> Result<DecisionResponse, ProviderError> {
        // decide()/decide_with_guardrails are infallible fail-closed (INV-5).
        Ok(match &self.guardrail {
            Some(guardrail) => {
                decide_with_guardrails(&self.plan, guardrail, &request, &self.config)
            }
            None => decide(&self.plan, &request, &self.config),
        })
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            name: format!("native:{}", self.plan.model.key),
            trace_fidelity: TraceFidelity::Full,
            supports_version_pin: true,
        }
    }
}

/// Remote adapter for engines that speak the decision contract over HTTP —
/// an incumbent engine behind a translation shim, another rules-service, or
/// OPA/BRMS fronted by a thin mapper. Runs INSIDE the tenant's instance:
/// its endpoint and credentials are tenant data (INV-2).
pub struct RestProvider {
    pub name: String,
    pub endpoint: String,
    pub client: reqwest::Client,
    pub trace_fidelity: TraceFidelity,
}

impl RestProvider {
    pub fn new(name: &str, endpoint: &str) -> RestProvider {
        RestProvider {
            name: name.to_string(),
            endpoint: endpoint.to_string(),
            client: reqwest::Client::new(),
            trace_fidelity: TraceFidelity::OutcomeOnly,
        }
    }
}

#[async_trait]
impl DecisionProvider for RestProvider {
    async fn evaluate(&self, request: DecisionRequest) -> Result<DecisionResponse, ProviderError> {
        let remote = |detail: String| ProviderError::Remote {
            name: self.name.clone(),
            detail,
        };
        let response = self
            .client
            .post(&self.endpoint)
            .json(&request)
            .send()
            .await
            .map_err(|e| remote(e.to_string()))?;
        if !response.status().is_success() {
            return Err(remote(format!("HTTP {}", response.status())));
        }
        response
            .json::<DecisionResponse>()
            .await
            .map_err(|e| remote(format!("bad response body: {e}")))
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            name: self.name.clone(),
            trace_fidelity: self.trace_fidelity,
            supports_version_pin: false,
        }
    }
}

/// Per-tenant router: decision key -> provider. Rebinding a key is the
/// strangler-fig cutover; it is a data change, not a code change, and the
/// old binding stays constructed for rollback.
pub struct Router {
    bindings: BTreeMap<String, Arc<dyn DecisionProvider>>,
}

impl Router {
    pub fn new() -> Router {
        Router {
            bindings: BTreeMap::new(),
        }
    }

    pub fn bind(&mut self, decision_key: &str, provider: Arc<dyn DecisionProvider>) {
        self.bindings.insert(decision_key.to_string(), provider);
    }

    pub fn provider_for(&self, decision_key: &str) -> Option<&Arc<dyn DecisionProvider>> {
        self.bindings.get(decision_key)
    }

    /// Route a request to its bound provider. An unbound key is an error the
    /// caller maps to the family's fail-closed outcome (INV-5) — never a
    /// silent default provider.
    pub async fn route(&self, request: DecisionRequest) -> Result<DecisionResponse, ProviderError> {
        let provider = self
            .bindings
            .get(&request.decision_key)
            .ok_or_else(|| ProviderError::NoBinding(request.decision_key.clone()))?;
        provider.evaluate(request).await
    }

    /// Capability report for the tenant's compliance posture: which engines
    /// answer which decisions, and at what trace fidelity.
    pub fn posture(&self) -> BTreeMap<String, ProviderCapabilities> {
        self.bindings
            .iter()
            .map(|(key, provider)| (key.clone(), provider.capabilities()))
            .collect()
    }
}

impl Default for Router {
    fn default() -> Self {
        Self::new()
    }
}
