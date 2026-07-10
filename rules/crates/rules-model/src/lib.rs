//! Decision model types, JSON (de)serialization, canonicalization, and
//! content hashing (DEC-5, DEC-9).
//!
//! A v1 `DecisionModel` is: typed input bindings extracted from facts,
//! a sequence of named expressions, a `collect`-policy findings table, an
//! outcome fold, and named outputs. Richer node kinds (scorecards, switches,
//! subdecisions) arrive in later phases per the design document.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use rules_core::reason::{Audience, Severity};
pub use rules_expr::Type;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionModel {
    /// Namespaced decision key, e.g. `lending.eligibility`. Determines the
    /// decision family and therefore the fail-closed outcome (INV-5).
    pub key: String,
    /// Input bindings: how typed variables are extracted from request facts.
    pub bindings: Vec<Binding>,
    /// Named expressions, evaluated in order; each may reference bindings
    /// and previously defined expressions (no recursion — INV-7).
    pub expressions: Vec<NamedExpression>,
    /// Findings table with `collect` hit policy: every row whose conditions
    /// all hold emits its reason.
    pub findings: Vec<FindingRow>,
    /// The outcome fold over collected findings. v1: `severity_fold`
    /// (any error -> restrictive; any warn -> refer/require_human; else
    /// permissive), matching summarizeFindings in packages/core.
    pub outcome: OutcomeRule,
    /// Named outputs: response `outputs` field -> expression or binding name.
    pub outputs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Binding {
    /// Variable name visible to expressions.
    pub name: String,
    /// JSON Pointer into request facts.
    pub path: String,
    #[serde(rename = "type")]
    pub ty: BindingType,
    /// A missing required binding fails closed (INV-5); a missing optional
    /// binding is null.
    pub required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingType {
    Bool,
    Int,
    /// JSON string parseable as a decimal — a JSON number is a type error
    /// (INV-6).
    Decimal,
    String,
    /// JSON string `YYYY-MM-DD`.
    Date,
    /// Bool: whether anything exists at `path` (for optional fact groups).
    Present,
}

impl BindingType {
    pub fn expr_type(self) -> Type {
        match self {
            BindingType::Bool | BindingType::Present => Type::Bool,
            BindingType::Int => Type::Int,
            BindingType::Decimal => Type::Decimal,
            BindingType::String => Type::String,
            BindingType::Date => Type::Date,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NamedExpression {
    pub name: String,
    pub expr: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FindingRow {
    /// Row identifier, stable for traces and audit (INV-8, INV-10).
    pub id: String,
    /// Conjunction of boolean expressions; empty means always fires.
    pub when: Vec<String>,
    pub severity: Severity,
    pub code: String,
    pub regulation: String,
    pub message: String,
    pub path: String,
    pub audience: Audience,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeRule {
    SeverityFold,
}

/// Canonical JSON bytes of a model (DEC-9): serde_json with sorted object
/// keys (the default `Map` is a `BTreeMap`) and no insignificant whitespace.
pub fn canonical_bytes(model: &DecisionModel) -> Result<Vec<u8>, serde_json::Error> {
    let value = serde_json::to_value(model)?;
    serde_json::to_vec(&value)
}

/// Content hash of a model (DEC-5): `sha256:<hex>` over the canonical bytes.
pub fn content_hash(model: &DecisionModel) -> Result<String, serde_json::Error> {
    let bytes = canonical_bytes(model)?;
    let digest = Sha256::digest(&bytes);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("sha256:{hex}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_model() -> DecisionModel {
        DecisionModel {
            key: "lending.example".into(),
            bindings: vec![Binding {
                name: "income".into(),
                path: "/economic_profile/monthly_income".into(),
                ty: BindingType::Decimal,
                required: false,
            }],
            expressions: vec![NamedExpression {
                name: "low".into(),
                expr: "income != null and income < 10000.00".into(),
            }],
            findings: vec![FindingRow {
                id: "r_low_income".into(),
                when: vec!["low".into()],
                severity: Severity::Error,
                code: "INCOME_BELOW_MIN".into(),
                regulation: "RBI-DL-2025".into(),
                message: "income below minimum".into(),
                path: "economic_profile.monthlyIncome".into(),
                audience: Audience::Internal,
            }],
            outcome: OutcomeRule::SeverityFold,
            outputs: BTreeMap::new(),
        }
    }

    #[test]
    fn content_hash_is_stable_and_content_addressed() {
        let a = tiny_model();
        let b = tiny_model();
        // DEC-5: identical content, identical hash — repeatably.
        assert_eq!(content_hash(&a).unwrap(), content_hash(&b).unwrap());
        assert!(content_hash(&a).unwrap().starts_with("sha256:"));

        // Any semantic change changes the hash.
        let mut c = tiny_model();
        c.findings[0].severity = Severity::Warn;
        assert_ne!(content_hash(&a).unwrap(), content_hash(&c).unwrap());
    }

    #[test]
    fn model_round_trips_through_json() {
        let m = tiny_model();
        let json = serde_json::to_string(&m).unwrap();
        let back: DecisionModel = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
        assert_eq!(content_hash(&m).unwrap(), content_hash(&back).unwrap());
    }
}
