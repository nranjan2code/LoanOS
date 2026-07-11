//! Ruleset version lifecycle (design section 8): draft → in_review →
//! approved → active(effective_from) → superseded, with four-eyes approval
//! (INV-9), a golden-corpus gate, IST effective dating (INV-12), and an
//! activation schedule that keeps every historical version replayable
//! (INV-8: activation is a pointer move, never a mutation).
//!
//! Storage note (documented deviation, see design section 16): v1 is an
//! in-memory store behind plain methods; the Postgres-backed control-plane
//! store lands in PH-3 with the fleet controller.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// IST offset: +05:30.
pub const IST_OFFSET_SECONDS: i32 = 5 * 3600 + 30 * 60;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GovernanceError {
    #[error("unknown version: {0}")]
    UnknownVersion(String),
    #[error("version is in state {actual}, operation requires {required}")]
    WrongState { actual: String, required: String },
    #[error("approver must differ from author (INV-9)")]
    ApproverIsAuthor,
    #[error("approval requires a golden-corpus report")]
    MissingGoldenReport,
    #[error("approval requires a passing golden-corpus report")]
    GoldenNotGreen,
    #[error("effective_from must be an IST timestamp (+05:30)")]
    NotIst,
    #[error("rollback requires two distinct operators (INV-9)")]
    RollbackNeedsTwoOperators,
    #[error("duplicate version hash: {0}")]
    DuplicateVersion(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionState {
    Draft,
    InReview,
    Approved,
    Rejected,
    Withdrawn,
}

/// Result of replaying the version's golden corpus (design section 14):
/// approval is gated on `passed` (green) reports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoldenReport {
    pub corpus_hash: String,
    pub case_count: u64,
    pub passed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VersionRecord {
    /// Content hash of the bundle (DEC-5); the version's identity.
    pub bundle_hash: String,
    pub version_label: String,
    pub author: String,
    pub state: VersionState,
    pub approver: Option<String>,
    pub golden: Option<GoldenReport>,
    pub rejection_reason: Option<String>,
}

/// One entry in the activation schedule. Entries are append-only (INV-8):
/// a rollback appends a new entry pointing at the old version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Activation {
    pub effective_from: DateTime<FixedOffset>,
    pub bundle_hash: String,
    /// Audit note: "scheduled" or "rollback:<operator_a>,<operator_b>".
    pub note: String,
}

/// In-memory control-plane version store for one (tenant, pack-kind) stream.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct VersionStore {
    versions: BTreeMap<String, VersionRecord>,
    schedule: Vec<Activation>,
}

fn require_ist(at: DateTime<FixedOffset>) -> Result<(), GovernanceError> {
    if at.offset().local_minus_utc() == IST_OFFSET_SECONDS {
        Ok(())
    } else {
        Err(GovernanceError::NotIst)
    }
}

impl VersionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, bundle_hash: &str) -> Option<&VersionRecord> {
        self.versions.get(bundle_hash)
    }

    pub fn schedule(&self) -> &[Activation] {
        &self.schedule
    }

    pub fn create_draft(
        &mut self,
        bundle_hash: &str,
        version_label: &str,
        author: &str,
    ) -> Result<(), GovernanceError> {
        if self.versions.contains_key(bundle_hash) {
            return Err(GovernanceError::DuplicateVersion(bundle_hash.into()));
        }
        self.versions.insert(
            bundle_hash.to_string(),
            VersionRecord {
                bundle_hash: bundle_hash.to_string(),
                version_label: version_label.to_string(),
                author: author.to_string(),
                state: VersionState::Draft,
                approver: None,
                golden: None,
                rejection_reason: None,
            },
        );
        Ok(())
    }

    fn record_mut(
        &mut self,
        hash: &str,
        required: VersionState,
    ) -> Result<&mut VersionRecord, GovernanceError> {
        let record = self
            .versions
            .get_mut(hash)
            .ok_or_else(|| GovernanceError::UnknownVersion(hash.into()))?;
        if record.state != required {
            return Err(GovernanceError::WrongState {
                actual: format!("{:?}", record.state),
                required: format!("{required:?}"),
            });
        }
        Ok(record)
    }

    pub fn submit_for_review(&mut self, hash: &str) -> Result<(), GovernanceError> {
        self.record_mut(hash, VersionState::Draft)?.state = VersionState::InReview;
        Ok(())
    }

    /// Attach the golden-corpus replay result. Allowed in draft or review —
    /// the gate is checked at approval.
    pub fn attach_golden(
        &mut self,
        hash: &str,
        report: GoldenReport,
    ) -> Result<(), GovernanceError> {
        let record = self
            .versions
            .get_mut(hash)
            .ok_or_else(|| GovernanceError::UnknownVersion(hash.into()))?;
        record.golden = Some(report);
        Ok(())
    }

    /// Four-eyes approval (INV-9) gated on a green golden report.
    pub fn approve(&mut self, hash: &str, approver: &str) -> Result<(), GovernanceError> {
        let record = self.record_mut(hash, VersionState::InReview)?;
        if record.author == approver {
            return Err(GovernanceError::ApproverIsAuthor);
        }
        match &record.golden {
            None => return Err(GovernanceError::MissingGoldenReport),
            Some(report) if !report.passed => return Err(GovernanceError::GoldenNotGreen),
            Some(_) => {}
        }
        record.approver = Some(approver.to_string());
        record.state = VersionState::Approved;
        Ok(())
    }

    pub fn reject(&mut self, hash: &str, reason: &str) -> Result<(), GovernanceError> {
        let record = self.record_mut(hash, VersionState::InReview)?;
        record.state = VersionState::Rejected;
        record.rejection_reason = Some(reason.to_string());
        Ok(())
    }

    /// Schedule an approved version to become active at an IST instant.
    /// Appends to the schedule; prior versions stay resolvable for replay.
    pub fn activate(
        &mut self,
        hash: &str,
        effective_from: DateTime<FixedOffset>,
    ) -> Result<(), GovernanceError> {
        require_ist(effective_from)?;
        self.record_mut(hash, VersionState::Approved)?;
        self.schedule.push(Activation {
            effective_from,
            bundle_hash: hash.to_string(),
            note: "scheduled".into(),
        });
        Ok(())
    }

    /// Emergency rollback: append an activation pointing at a previously
    /// approved version. Expedited but still two distinct humans (INV-9).
    pub fn emergency_rollback(
        &mut self,
        to_hash: &str,
        effective_from: DateTime<FixedOffset>,
        operator_a: &str,
        operator_b: &str,
    ) -> Result<(), GovernanceError> {
        if operator_a == operator_b {
            return Err(GovernanceError::RollbackNeedsTwoOperators);
        }
        require_ist(effective_from)?;
        self.record_mut(to_hash, VersionState::Approved)?;
        self.schedule.push(Activation {
            effective_from,
            bundle_hash: to_hash.to_string(),
            note: format!("rollback:{operator_a},{operator_b}"),
        });
        Ok(())
    }

    /// The version active at `at`: the schedule entry with the latest
    /// `effective_from` not after `at`, later entries winning ties (a
    /// rollback appended after a scheduled activation takes precedence).
    pub fn active_at(&self, at: DateTime<FixedOffset>) -> Option<&Activation> {
        // Forward iteration: max_by_key returns the LAST maximum, so among
        // equal effective_from instants the most recently appended entry
        // (e.g. a same-instant rollback) wins.
        self.schedule
            .iter()
            .filter(|a| a.effective_from <= at)
            .max_by_key(|a| a.effective_from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ist(s: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(s).unwrap()
    }

    fn green() -> GoldenReport {
        GoldenReport {
            corpus_hash: "sha256:corpus".into(),
            case_count: 542,
            passed: true,
        }
    }

    fn approved_store(hash: &str) -> VersionStore {
        let mut store = VersionStore::new();
        store.create_draft(hash, "2026.07-r1", "maker").unwrap();
        store.submit_for_review(hash).unwrap();
        store.attach_golden(hash, green()).unwrap();
        store.approve(hash, "checker").unwrap();
        store
    }

    #[test]
    fn full_lifecycle_happy_path() {
        let mut store = approved_store("sha256:v1");
        store
            .activate("sha256:v1", ist("2026-08-01T00:00:00+05:30"))
            .unwrap();
        let active = store.active_at(ist("2026-08-15T10:00:00+05:30")).unwrap();
        assert_eq!(active.bundle_hash, "sha256:v1");
        // Before the effective instant, nothing is active.
        assert!(store.active_at(ist("2026-07-31T23:59:59+05:30")).is_none());
    }

    #[test]
    fn inv9_author_cannot_approve_own_version() {
        let mut store = VersionStore::new();
        store.create_draft("sha256:v1", "r1", "maker").unwrap();
        store.submit_for_review("sha256:v1").unwrap();
        store.attach_golden("sha256:v1", green()).unwrap();
        assert_eq!(
            store.approve("sha256:v1", "maker").unwrap_err(),
            GovernanceError::ApproverIsAuthor
        );
    }

    #[test]
    fn approval_requires_a_green_golden_report() {
        let mut store = VersionStore::new();
        store.create_draft("sha256:v1", "r1", "maker").unwrap();
        store.submit_for_review("sha256:v1").unwrap();
        assert_eq!(
            store.approve("sha256:v1", "checker").unwrap_err(),
            GovernanceError::MissingGoldenReport
        );
        store
            .attach_golden(
                "sha256:v1",
                GoldenReport {
                    passed: false,
                    ..green()
                },
            )
            .unwrap();
        assert_eq!(
            store.approve("sha256:v1", "checker").unwrap_err(),
            GovernanceError::GoldenNotGreen
        );
    }

    #[test]
    fn only_approved_versions_can_activate_and_dates_must_be_ist() {
        let mut store = VersionStore::new();
        store.create_draft("sha256:v1", "r1", "maker").unwrap();
        assert!(matches!(
            store.activate("sha256:v1", ist("2026-08-01T00:00:00+05:30")),
            Err(GovernanceError::WrongState { .. })
        ));
        let mut store = approved_store("sha256:v1");
        assert_eq!(
            store
                .activate("sha256:v1", ist("2026-08-01T00:00:00+00:00"))
                .unwrap_err(),
            GovernanceError::NotIst
        );
    }

    #[test]
    fn effective_dating_resolves_across_versions() {
        let mut store = approved_store("sha256:v1");
        store
            .create_draft("sha256:v2", "2026.09-r1", "maker")
            .unwrap();
        store.submit_for_review("sha256:v2").unwrap();
        store.attach_golden("sha256:v2", green()).unwrap();
        store.approve("sha256:v2", "checker").unwrap();

        store
            .activate("sha256:v1", ist("2026-08-01T00:00:00+05:30"))
            .unwrap();
        store
            .activate("sha256:v2", ist("2026-09-01T00:00:00+05:30"))
            .unwrap();

        // RBI-circular style flip at IST midnight.
        assert_eq!(
            store
                .active_at(ist("2026-08-31T23:59:59+05:30"))
                .unwrap()
                .bundle_hash,
            "sha256:v1"
        );
        assert_eq!(
            store
                .active_at(ist("2026-09-01T00:00:00+05:30"))
                .unwrap()
                .bundle_hash,
            "sha256:v2"
        );
        // History stays replayable: August still resolves to v1 (INV-8).
        assert_eq!(
            store
                .active_at(ist("2026-08-15T12:00:00+05:30"))
                .unwrap()
                .bundle_hash,
            "sha256:v1"
        );
    }

    #[test]
    fn emergency_rollback_appends_and_wins_ties() {
        let mut store = approved_store("sha256:v1");
        store.create_draft("sha256:v2", "r2", "maker").unwrap();
        store.submit_for_review("sha256:v2").unwrap();
        store.attach_golden("sha256:v2", green()).unwrap();
        store.approve("sha256:v2", "checker").unwrap();

        store
            .activate("sha256:v1", ist("2026-08-01T00:00:00+05:30"))
            .unwrap();
        store
            .activate("sha256:v2", ist("2026-09-01T00:00:00+05:30"))
            .unwrap();

        // v2 misbehaves in production; roll back to v1 same-day.
        assert_eq!(
            store
                .emergency_rollback(
                    "sha256:v1",
                    ist("2026-09-02T14:00:00+05:30"),
                    "op_a",
                    "op_a"
                )
                .unwrap_err(),
            GovernanceError::RollbackNeedsTwoOperators
        );
        store
            .emergency_rollback(
                "sha256:v1",
                ist("2026-09-02T14:00:00+05:30"),
                "op_a",
                "op_b",
            )
            .unwrap();

        assert_eq!(
            store
                .active_at(ist("2026-09-02T15:00:00+05:30"))
                .unwrap()
                .bundle_hash,
            "sha256:v1"
        );
        // The rollback is audit-visible, and the original activation remains
        // in the schedule (append-only, INV-8).
        assert!(store
            .schedule()
            .iter()
            .any(|a| a.note.starts_with("rollback:")));
        assert_eq!(store.schedule().len(), 3);

        // A rollback stamped at the exact same instant as the activation it
        // reverts must still win: appended-later takes tie precedence.
        store
            .emergency_rollback(
                "sha256:v2",
                ist("2026-09-02T14:00:00+05:30"),
                "op_a",
                "op_b",
            )
            .unwrap();
        assert_eq!(
            store
                .active_at(ist("2026-09-02T14:00:00+05:30"))
                .unwrap()
                .bundle_hash,
            "sha256:v2"
        );
    }
}
