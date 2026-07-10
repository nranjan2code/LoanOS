//! Fuel-bounded evaluator (INV-7) with null propagation per SPEC.md.
//! Pure: no clock, no I/O, no randomness (INV-1). All arithmetic is exact
//! decimal or checked integer (INV-6); overflow fails closed (INV-5).

use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;

use crate::parser::{BinOp, Expr};
use crate::ExprError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Bool(bool),
    Int(i64),
    Dec(Decimal),
    Str(String),
    Date(NaiveDate),
    Null,
}

pub type ValueEnv = std::collections::BTreeMap<String, Value>;

pub struct Fuel {
    remaining: u64,
}

impl Fuel {
    pub fn new(budget: u64) -> Fuel {
        Fuel { remaining: budget }
    }

    fn charge(&mut self, amount: u64) -> Result<(), ExprError> {
        if self.remaining < amount {
            return Err(ExprError::FuelExhausted);
        }
        self.remaining -= amount;
        Ok(())
    }
}

fn as_dec(v: &Value) -> Option<Decimal> {
    match v {
        Value::Dec(d) => Some(*d),
        Value::Int(n) => Some(Decimal::from(*n)),
        _ => None,
    }
}

pub fn eval(expr: &Expr, env: &ValueEnv, fuel: &mut Fuel) -> Result<Value, ExprError> {
    fuel.charge(1)?;
    match expr {
        Expr::Bool(b) => Ok(Value::Bool(*b)),
        Expr::Int(n) => Ok(Value::Int(*n)),
        Expr::Dec(d) => Ok(Value::Dec(*d)),
        Expr::Str(s) => Ok(Value::Str(s.clone())),
        Expr::Null => Ok(Value::Null),
        Expr::Ident(name) => env
            .get(name)
            .cloned()
            .ok_or_else(|| ExprError::Eval(format!("unbound identifier: {name}"))),
        Expr::Not(inner) => match eval(inner, env, fuel)? {
            Value::Bool(b) => Ok(Value::Bool(!b)),
            _ => Err(ExprError::Eval("not requires a bool".into())),
        },
        Expr::Neg(inner) => match eval(inner, env, fuel)? {
            Value::Int(n) => n
                .checked_neg()
                .map(Value::Int)
                .ok_or_else(|| ExprError::Eval("integer overflow in negation".into())),
            Value::Dec(d) => Ok(Value::Dec(-d)),
            Value::Null => Ok(Value::Null),
            _ => Err(ExprError::Eval(
                "unary minus requires a numeric operand".into(),
            )),
        },
        Expr::Binary(op, l, r) => eval_binary(*op, l, r, env, fuel),
        Expr::Call(name, args) => eval_call(name, args, env, fuel),
    }
}

fn eval_binary(
    op: BinOp,
    l: &Expr,
    r: &Expr,
    env: &ValueEnv,
    fuel: &mut Fuel,
) -> Result<Value, ExprError> {
    // Short-circuit boolean operators first.
    if matches!(op, BinOp::And | BinOp::Or) {
        let lv = eval(l, env, fuel)?;
        let Value::Bool(lb) = lv else {
            return Err(ExprError::Eval("and/or require bool operands".into()));
        };
        if (op == BinOp::And && !lb) || (op == BinOp::Or && lb) {
            return Ok(Value::Bool(lb));
        }
        return match eval(r, env, fuel)? {
            Value::Bool(rb) => Ok(Value::Bool(rb)),
            _ => Err(ExprError::Eval("and/or require bool operands".into())),
        };
    }

    let lv = eval(l, env, fuel)?;
    let rv = eval(r, env, fuel)?;

    match op {
        BinOp::Eq | BinOp::Ne => {
            let equal = values_equal(&lv, &rv);
            Ok(Value::Bool(if op == BinOp::Eq { equal } else { !equal }))
        }
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            // Ordering a null is an error, never a silent false (INV-5).
            if lv == Value::Null || rv == Value::Null {
                return Err(ExprError::NullComparison);
            }
            let ord = match (&lv, &rv) {
                (Value::Str(a), Value::Str(b)) => a.cmp(b),
                (Value::Date(a), Value::Date(b)) => a.cmp(b),
                _ => match (as_dec(&lv), as_dec(&rv)) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    _ => return Err(ExprError::Eval("cannot order these operand types".into())),
                },
            };
            let result = match op {
                BinOp::Lt => ord.is_lt(),
                BinOp::Le => ord.is_le(),
                BinOp::Gt => ord.is_gt(),
                _ => ord.is_ge(),
            };
            Ok(Value::Bool(result))
        }
        BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div => {
            if lv == Value::Null || rv == Value::Null {
                return Ok(Value::Null);
            }
            // Exact int arithmetic when both sides are ints (except division).
            if let (Value::Int(a), Value::Int(b)) = (&lv, &rv) {
                if op != BinOp::Div {
                    let out = match op {
                        BinOp::Add => a.checked_add(*b),
                        BinOp::Sub => a.checked_sub(*b),
                        _ => a.checked_mul(*b),
                    };
                    return out
                        .map(Value::Int)
                        .ok_or_else(|| ExprError::Eval("integer overflow".into()));
                }
            }
            let (Some(a), Some(b)) = (as_dec(&lv), as_dec(&rv)) else {
                return Err(ExprError::Eval(
                    "arithmetic requires numeric operands".into(),
                ));
            };
            let out = match op {
                BinOp::Add => a.checked_add(b),
                BinOp::Sub => a.checked_sub(b),
                BinOp::Mul => a.checked_mul(b),
                BinOp::Div => {
                    if b.is_zero() {
                        // Division by zero is undefined: null-poison downstream.
                        return Ok(Value::Null);
                    }
                    a.checked_div(b)
                }
                _ => unreachable!(),
            };
            out.map(Value::Dec)
                .ok_or_else(|| ExprError::Eval("decimal overflow".into()))
        }
        BinOp::And | BinOp::Or => unreachable!("handled above"),
    }
}

fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Null, _) | (_, Value::Null) => false,
        _ => match (as_dec(a), as_dec(b)) {
            (Some(x), Some(y)) => x == y,
            _ => a == b,
        },
    }
}

fn eval_call(
    name: &str,
    args: &[Expr],
    env: &ValueEnv,
    fuel: &mut Fuel,
) -> Result<Value, ExprError> {
    let mut values = Vec::with_capacity(args.len());
    for arg in args {
        values.push(eval(arg, env, fuel)?);
    }

    // coalesce is the one function that consumes nulls instead of
    // propagating them.
    if name == "coalesce" {
        return Ok(values
            .iter()
            .find(|v| **v != Value::Null)
            .cloned()
            .unwrap_or(Value::Null));
    }
    if values.contains(&Value::Null) {
        return Ok(Value::Null);
    }

    match (name, values.as_slice()) {
        ("round", [x, Value::Int(places)]) => {
            let Some(d) = as_dec(x) else {
                return Err(ExprError::Eval("round requires a decimal".into()));
            };
            let places = u32::try_from(*places)
                .map_err(|_| ExprError::Eval("round places out of range".into()))?;
            Ok(Value::Dec(d.round_dp_with_strategy(
                places,
                rust_decimal::RoundingStrategy::MidpointAwayFromZero,
            )))
        }
        ("emi", [p, Value::Int(rate_bps), Value::Int(months)]) => {
            let Some(principal) = as_dec(p) else {
                return Err(ExprError::Eval("emi requires a decimal principal".into()));
            };
            emi(principal, *rate_bps, *months, fuel)
        }
        ("age_years", [Value::Date(dob), Value::Date(at)]) => {
            let mut age = i64::from(at.year()) - i64::from(dob.year());
            if (at.month(), at.day()) < (dob.month(), dob.day()) {
                age -= 1;
            }
            Ok(Value::Int(age))
        }
        ("years_from_months", [Value::Int(m)]) => Ok(Value::Int(
            m.div_euclid(12) + if m.rem_euclid(12) > 0 { 1 } else { 0 },
        )),
        _ => Err(ExprError::Eval(format!("bad call: {name}"))),
    }
}

/// Reducing-balance EMI matching `estimateEmi` in
/// `packages/core/src/eligibility.js`, computed exactly in decimal and
/// rounded half-away-from-zero to 2 places. Domain violations return null
/// (mirroring the JS), not an error: requiredness is the rule table's job.
fn emi(
    principal: Decimal,
    rate_bps: i64,
    months: i64,
    fuel: &mut Fuel,
) -> Result<Value, ExprError> {
    if principal <= Decimal::ZERO || months <= 0 || rate_bps < 0 {
        return Ok(Value::Null);
    }
    let months_u = u64::try_from(months).expect("months > 0 checked above");
    fuel.charge(months_u)?;

    let round2 = |d: Decimal| {
        d.round_dp_with_strategy(2, rust_decimal::RoundingStrategy::MidpointAwayFromZero)
    };
    // monthly_rate = bps / 10000 / 12
    let monthly_rate = Decimal::from(rate_bps)
        .checked_div(Decimal::from(120_000))
        .ok_or_else(|| ExprError::Eval("emi rate overflow".into()))?;
    if monthly_rate.is_zero() {
        let flat = principal
            .checked_div(Decimal::from(months))
            .ok_or_else(|| ExprError::Eval("emi division overflow".into()))?;
        return Ok(Value::Dec(round2(flat)));
    }
    // factor = (1 + r)^months by repeated multiplication (fuel-charged above).
    let base = Decimal::ONE + monthly_rate;
    let mut factor = Decimal::ONE;
    for _ in 0..months_u {
        factor = factor
            .checked_mul(base)
            .ok_or_else(|| ExprError::Eval("emi factor overflow".into()))?;
    }
    let numerator = principal
        .checked_mul(monthly_rate)
        .and_then(|x| x.checked_mul(factor))
        .ok_or_else(|| ExprError::Eval("emi numerator overflow".into()))?;
    let denominator = factor - Decimal::ONE;
    let emi = numerator
        .checked_div(denominator)
        .ok_or_else(|| ExprError::Eval("emi division overflow".into()))?;
    Ok(Value::Dec(round2(emi)))
}
