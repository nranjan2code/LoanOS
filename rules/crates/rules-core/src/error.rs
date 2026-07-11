//! Engine errors. Every variant maps to a fail-closed outcome (INV-5) —
//! callers translate errors via `DecisionFamily::fail_closed_outcome`, never
//! to a permissive default. Messages carry IDs and paths only, never fact
//! values or rule content (INV-10, SEC-5).

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DecisionError {
    /// INV-2: the request's tenant does not match the instance binding.
    /// Raising this must also raise a security alarm at the service layer.
    #[error("tenant mismatch: request tenant does not match instance binding")]
    TenantMismatch,

    #[error("unknown decision key: {key}")]
    UnknownDecisionKey { key: String },

    #[error("required fact missing at {path}")]
    MissingFact { path: String },

    #[error("fact type mismatch at {path}: expected {expected}")]
    TypeMismatch { path: String, expected: String },

    /// DEC-4: a model-sourced fact arrived without a model provenance tag.
    #[error("fact at {path} requires model provenance tagging")]
    UntaggedModelFact { path: String },

    /// INV-7: evaluation exceeded its fuel budget.
    #[error("fuel exhausted during evaluation")]
    FuelExhausted,

    /// INV-5: kill-switch state older than the freshness TTL on a
    /// model-tagged path.
    #[error("kill-switch state is stale")]
    StaleKillSwitch,

    /// INV-3: bundle failed signature or hash verification.
    #[error("bundle verification failed: {detail}")]
    BundleVerification { detail: String },

    #[error("invalid request: {detail}")]
    InvalidRequest { detail: String },

    #[error("internal evaluation error: {detail}")]
    Internal { detail: String },
}
