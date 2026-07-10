//! Decision outcomes, fixed per decision family (design section 7), and the
//! fail-closed vocabulary used by INV-5.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    // lending.* family — matches ELIGIBILITY_DECISIONS in packages/core.
    Eligible,
    Refer,
    Ineligible,
    // guardrail.* family.
    Allow,
    Deny,
    RequireHuman,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionFamily {
    Lending,
    Guardrail,
}

impl DecisionFamily {
    /// The family of a decision key, from its namespace prefix.
    pub fn of_key(decision_key: &str) -> Option<DecisionFamily> {
        match decision_key.split('.').next() {
            Some("lending" | "pricing" | "collections") => Some(DecisionFamily::Lending),
            Some("guardrail") => Some(DecisionFamily::Guardrail),
            _ => None,
        }
    }

    /// The restrictive outcome every evaluation error degrades to (INV-5).
    /// There is deliberately no permissive counterpart to this function.
    pub fn fail_closed_outcome(self) -> Outcome {
        match self {
            DecisionFamily::Lending => Outcome::Refer,
            DecisionFamily::Guardrail => Outcome::Deny,
        }
    }
}

impl Outcome {
    pub fn family(self) -> DecisionFamily {
        match self {
            Outcome::Eligible | Outcome::Refer | Outcome::Ineligible => DecisionFamily::Lending,
            Outcome::Allow | Outcome::Deny | Outcome::RequireHuman => DecisionFamily::Guardrail,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fail_closed_is_never_permissive() {
        assert_eq!(
            DecisionFamily::Lending.fail_closed_outcome(),
            Outcome::Refer
        );
        assert_eq!(
            DecisionFamily::Guardrail.fail_closed_outcome(),
            Outcome::Deny
        );
    }

    #[test]
    fn family_from_key_namespace() {
        assert_eq!(
            DecisionFamily::of_key("lending.eligibility"),
            Some(DecisionFamily::Lending)
        );
        assert_eq!(
            DecisionFamily::of_key("guardrail.collections_contact"),
            Some(DecisionFamily::Guardrail)
        );
        assert_eq!(DecisionFamily::of_key("unknown.thing"), None);
    }

    #[test]
    fn wire_format_is_snake_case() {
        assert_eq!(
            serde_json::to_string(&Outcome::RequireHuman).unwrap(),
            "\"require_human\""
        );
    }
}
