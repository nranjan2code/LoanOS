//! Exact-arithmetic newtypes (INV-6).
//!
//! Money and ratios travel as JSON strings, never JSON numbers, and are backed
//! by `rust_decimal::Decimal`. Binary floating point is denied crate-wide.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// A monetary amount. INR for all current products; currency tagging is
/// carried at the schema level until multi-currency is in scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Money(#[serde(with = "rust_decimal::serde::str")] pub Decimal);

/// A dimensionless ratio such as FOIR, in the range conventions of the
/// decision model that produces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Ratio(#[serde(with = "rust_decimal::serde::str")] pub Decimal);

/// Basis points. Integer on the wire (e.g. `1850` = 18.50%).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Bps(pub i64);

impl Bps {
    /// The equivalent ratio, exact: `1850 bps -> 0.1850`.
    pub fn as_ratio(self) -> Ratio {
        Ratio(Decimal::new(self.0, 4))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_serializes_as_string() {
        let m = Money(Decimal::new(1503194, 2));
        assert_eq!(serde_json::to_string(&m).unwrap(), "\"15031.94\"");
    }

    #[test]
    fn money_rejects_json_numbers() {
        // INV-6: a JSON number is a contract violation, not a convenience.
        assert!(serde_json::from_str::<Money>("15031.94").is_err());
    }

    #[test]
    fn bps_to_ratio_is_exact() {
        assert_eq!(
            serde_json::to_string(&Bps(1850).as_ratio()).unwrap(),
            "\"0.1850\""
        );
    }
}
