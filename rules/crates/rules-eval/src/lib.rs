//! Pure plan evaluator: fuel metering, trace emission, shadow mode, guardrail pre/post wrapping.
//!
//! Skeleton crate: implemented in PH-1 per docs/architecture/decision-engine-design.md.
//! Do not add functionality here outside the open phase (section 15).

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]
