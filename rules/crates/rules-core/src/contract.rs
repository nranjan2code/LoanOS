//! The decision contract (design section 7): one request/response envelope
//! for every decision, every provider, every deployment shape.
//!
//! Contract rules enforced here at the type level:
//! - money/ratios travel as strings (INV-6, via `crate::decimal`);
//! - time is an input — `effective_at` / `evaluated_at` are request data,
//!   never read from a clock during evaluation (INV-12);
//! - the kill-switch snapshot is data stamped by the instance, so evaluation
//!   stays a pure function of the request (DEC-4, INV-1).

use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

use crate::outcome::Outcome;
use crate::reason::Reason;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionRequest {
    pub request_id: String,
    pub tenant_id: String,
    pub decision_key: String,
    /// Selects the ruleset version by effective window. IST for all
    /// tenant-facing effective dates (INV-12).
    pub effective_at: DateTime<FixedOffset>,
    /// Exact bundle hash override for replay/simulation. Callers outside
    /// audit/simulation roles may not pin (enforced by the gateway).
    #[serde(default)]
    pub version_pin: Option<String>,
    /// Validated against the decision model's declared input schema before
    /// evaluation; unknown required fields fail closed (INV-5).
    pub facts: serde_json::Value,
    /// Keys are JSON Pointers into `facts`. Model-derived facts must be
    /// tagged (DEC-4); untagged model-sourced paths are rejected by the
    /// guardrail pack.
    #[serde(default)]
    pub fact_provenance: BTreeMap<String, Provenance>,
    pub context: RequestContext,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Provenance {
    pub source: ProvenanceSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceSource {
    /// Output of an AI/statistical model; gated by the kill switch.
    Model,
    /// Forward-compatible catch-all; treated as untagged by guardrails.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RequestContext {
    pub channel: String,
    pub caller: String,
    /// Stamped by the instance from its local cache; a caller-supplied value
    /// is ignored and alarmed (design section 7).
    pub kill_switch: KillSwitchSnapshot,
    /// Caller audience level, set by the gateway (INV-10). When present the
    /// instance strips reasons above this level from the RESPONSE; the audit
    /// record always keeps the full set. Absent means internal (trusted
    /// platform caller).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<crate::reason::Audience>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KillSwitchSnapshot {
    /// Freshness anchor. Stale beyond TTL fails closed on model-tagged
    /// paths (INV-5).
    pub as_of: DateTime<FixedOffset>,
    pub global: GlobalSwitch,
    #[serde(default)]
    pub models: BTreeMap<String, ModelSwitchState>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GlobalSwitch {
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelSwitchState {
    Active,
    Suspended,
    Killed,
    #[serde(other)]
    Unknown,
}

impl ModelSwitchState {
    /// Whether facts from this model may be consumed. Anything other than an
    /// affirmative `active` is a no (INV-5): unknown states fail closed.
    pub fn consumable(self) -> bool {
        matches!(self, ModelSwitchState::Active)
    }
}

impl DecisionResponse {
    /// INV-10 audience filtering: retain only reasons visible to the caller.
    pub fn retain_reasons_for(&mut self, caller: crate::reason::Audience) {
        self.reasons.retain(|r| r.visible_to(caller));
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionResponse {
    pub request_id: String,
    pub decision: Outcome,
    pub outputs: serde_json::Value,
    pub reasons: Vec<Reason>,
    pub ruleset: RulesetInfo,
    /// Reference into the tenant's encrypted audit stream. Traces are never
    /// inlined to agent- or borrower-facing callers (INV-10).
    pub trace_ref: String,
    pub engine: EngineInfo,
    pub evaluated_at: DateTime<FixedOffset>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RulesetInfo {
    pub tenant_pack: String,
    pub platform_pack: String,
    pub version_label: String,
    pub effective_from: DateTime<FixedOffset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineInfo {
    pub instance_id: String,
    pub build: String,
}
