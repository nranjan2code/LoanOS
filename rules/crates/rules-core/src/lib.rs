//! Core types for the LoanOS decision engine.
//!
//! This crate defines the decision contract (`DecisionRequest` /
//! `DecisionResponse`), the exact-arithmetic newtypes, reasons, outcomes, and
//! errors shared by every other engine crate and every `DecisionProvider`.
//!
//! Specification: `docs/architecture/decision-engine-design.md` (sections 4
//! and 7). This crate must stay free of I/O, network, and async dependencies.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

pub mod contract;
pub mod decimal;
pub mod error;
pub mod outcome;
pub mod reason;

pub use contract::{
    DecisionRequest, DecisionResponse, EngineInfo, GlobalSwitch, KillSwitchSnapshot,
    ModelSwitchState, Provenance, ProvenanceSource, RequestContext, RulesetInfo,
};
pub use decimal::{Bps, Money, Ratio};
pub use error::DecisionError;
pub use outcome::{DecisionFamily, Outcome};
pub use reason::{Audience, Reason, Severity};
