//! Decision reasons, aligned with `createFinding(severity, regulation,
//! message, path)` in `packages/core/src/compliance-controls.js`, extended
//! with `code` and `audience` per design section 7.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reason {
    pub severity: Severity,
    pub code: String,
    pub regulation: String,
    pub message: String,
    pub path: String,
    pub audience: Audience,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warn,
    Error,
}

/// Audience filtering level (INV-10). The gateway strips reasons above the
/// caller's level; traces and rule internals are never exposed at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Audience {
    /// Visible only inside the platform (most privileged).
    Internal,
    /// Visible to the tenant's operations staff.
    TenantOps,
    /// Safe to relay to the borrower or a borrower-facing agent.
    Borrower,
}

impl Reason {
    /// Whether a reason at this audience level may be shown to a caller
    /// operating at `caller_level`. `Internal` sees everything; `Borrower`
    /// callers see only borrower-safe reasons (INV-10).
    pub fn visible_to(&self, caller_level: Audience) -> bool {
        self.audience >= caller_level
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reason(audience: Audience) -> Reason {
        Reason {
            severity: Severity::Info,
            code: "X".into(),
            regulation: "RBI-DL-2025".into(),
            message: "m".into(),
            path: "p".into(),
            audience,
        }
    }

    #[test]
    fn audience_filtering_is_monotonic() {
        // A borrower-facing caller must never see internal reasons.
        assert!(!reason(Audience::Internal).visible_to(Audience::Borrower));
        assert!(reason(Audience::Borrower).visible_to(Audience::Borrower));
        // Internal callers see everything.
        assert!(reason(Audience::Internal).visible_to(Audience::Internal));
        assert!(reason(Audience::Borrower).visible_to(Audience::Internal));
    }
}
