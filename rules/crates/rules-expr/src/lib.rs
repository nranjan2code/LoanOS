//! Total, typed expression language for the LoanOS decision engine.
//!
//! Specification: `SPEC.md` in this crate, under the authority of
//! `docs/architecture/decision-engine-design.md` section 8.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

mod eval;
mod lexer;
mod parser;
mod types;

pub use eval::{eval, Fuel, Value, ValueEnv};
pub use parser::{parse, BinOp, Expr};
pub use types::{typecheck, Type, TypeEnv};

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExprError {
    #[error("lex error: {0}")]
    Lex(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("type error: {0}")]
    Type(String),
    #[error("evaluation error: {0}")]
    Eval(String),
    #[error("ordering comparison with null (guard with `!= null`)")]
    NullComparison,
    #[error("fuel exhausted")]
    FuelExhausted,
}
