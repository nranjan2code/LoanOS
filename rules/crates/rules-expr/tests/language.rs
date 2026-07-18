//! Expression language conformance tests: SPEC.md semantics, INV-5 fail-closed
//! null handling, INV-6 exactness, INV-7 totality.

use chrono::NaiveDate;
use rules_expr::{eval, parse, typecheck, ExprError, Fuel, Type, TypeEnv, Value, ValueEnv};
use rust_decimal::Decimal;
use std::str::FromStr;

const FUEL: u64 = 10_000;

fn run(src: &str, env: &ValueEnv) -> Result<Value, ExprError> {
    let expr = parse(src)?;
    eval(&expr, env, &mut Fuel::new(FUEL))
}

fn dec(s: &str) -> Value {
    Value::Dec(Decimal::from_str(s).unwrap())
}

#[test]
fn arithmetic_is_exact_decimal() {
    let env = ValueEnv::new();
    // The canonical float trap: 0.1 + 0.2 must be exactly 0.3 (INV-6).
    assert_eq!(run("0.1 + 0.2", &env).unwrap(), dec("0.3"));
    assert_eq!(run("round(2.675, 2)", &env).unwrap(), dec("2.68"));
    assert_eq!(run("10 / 4", &env).unwrap(), dec("2.5"));
    assert_eq!(run("2 + 3 * 4", &env).unwrap(), Value::Int(14));
}

#[test]
fn null_semantics_match_spec() {
    let mut env = ValueEnv::new();
    env.insert("x".into(), Value::Null);
    env.insert("y".into(), dec("5.00"));
    // Arithmetic propagates null.
    assert_eq!(run("x + y", &env).unwrap(), Value::Null);
    // Division by zero poisons, not crashes.
    assert_eq!(run("y / 0.00", &env).unwrap(), Value::Null);
    // Equality with null is presence testing.
    assert_eq!(run("x == null", &env).unwrap(), Value::Bool(true));
    assert_eq!(run("y != null", &env).unwrap(), Value::Bool(true));
    // Ordering against null fails closed (INV-5), never silently false.
    assert_eq!(
        run("x > 1.00", &env).unwrap_err(),
        ExprError::NullComparison
    );
    // ...unless guarded, which short-circuits.
    assert_eq!(
        run("x != null and x > 1.00", &env).unwrap(),
        Value::Bool(false)
    );
    // coalesce consumes nulls.
    assert_eq!(run("coalesce(x, y)", &env).unwrap(), dec("5.00"));
    // Stdlib propagates nulls.
    assert_eq!(run("round(x, 2)", &env).unwrap(), Value::Null);
}

#[test]
fn emi_matches_lms_amortization() {
    let env = ValueEnv::new();
    // 300000 @ 18.50% for 24 months. Cross-checked against estimateEmi in
    // packages/core/src/lending/eligibility.js: 15049.81.
    assert_eq!(
        run("emi(300000.00, 1850, 24)", &env).unwrap(),
        dec("15049.81")
    );
    // Zero rate degenerates to flat division.
    assert_eq!(run("emi(1200.00, 0, 12)", &env).unwrap(), dec("100.00"));
    // Domain violations are nulls (requiredness is the rule table's job).
    assert_eq!(run("emi(0.00, 1850, 24)", &env).unwrap(), Value::Null);
    assert_eq!(run("emi(1000.00, 1850, 0)", &env).unwrap(), Value::Null);
}

#[test]
fn age_years_matches_calculate_age_years() {
    let mut env = ValueEnv::new();
    env.insert(
        "dob".into(),
        Value::Date(NaiveDate::from_ymd_opt(1991, 4, 2).unwrap()),
    );
    env.insert(
        "today".into(),
        Value::Date(NaiveDate::from_ymd_opt(2026, 7, 10).unwrap()),
    );
    assert_eq!(run("age_years(dob, today)", &env).unwrap(), Value::Int(35));
    // Birthday not yet reached this year.
    env.insert(
        "today".into(),
        Value::Date(NaiveDate::from_ymd_opt(2026, 4, 1).unwrap()),
    );
    assert_eq!(run("age_years(dob, today)", &env).unwrap(), Value::Int(34));
    // Exactly on the birthday counts the completed year.
    env.insert(
        "today".into(),
        Value::Date(NaiveDate::from_ymd_opt(2026, 4, 2).unwrap()),
    );
    assert_eq!(run("age_years(dob, today)", &env).unwrap(), Value::Int(35));
}

#[test]
fn years_from_months_is_ceiling() {
    let env = ValueEnv::new();
    assert_eq!(run("years_from_months(24)", &env).unwrap(), Value::Int(2));
    assert_eq!(run("years_from_months(25)", &env).unwrap(), Value::Int(3));
    assert_eq!(run("years_from_months(6)", &env).unwrap(), Value::Int(1));
}

#[test]
fn typechecker_accepts_the_valid_and_rejects_the_invalid() {
    let mut env = TypeEnv::new();
    env.insert("income".into(), Type::Decimal);
    env.insert("score".into(), Type::Int);
    env.insert("dob".into(), Type::Date);
    assert_eq!(
        typecheck(&parse("income > 0.00 and score >= 600").unwrap(), &env).unwrap(),
        Type::Bool
    );
    assert_eq!(
        typecheck(&parse("emi(income, score, 24)").unwrap(), &env).unwrap(),
        Type::Decimal
    );
    assert!(typecheck(&parse("income and true").unwrap(), &env).is_err());
    assert!(typecheck(&parse("dob + 1").unwrap(), &env).is_err());
    assert!(typecheck(&parse("unknown_fn(1)").unwrap(), &env).is_err());
    assert!(typecheck(&parse("missing_var > 1").unwrap(), &env).is_err());
}

#[test]
fn fuel_exhaustion_terminates_evaluation() {
    // INV-7: a large computation runs out of fuel instead of running long.
    let env = ValueEnv::new();
    let expr = parse("emi(300000.00, 1850, 600)").unwrap();
    assert_eq!(
        eval(&expr, &env, &mut Fuel::new(50)).unwrap_err(),
        ExprError::FuelExhausted
    );
    // With adequate fuel the same expression completes.
    assert!(eval(&expr, &env, &mut Fuel::new(10_000)).is_ok());
}

#[test]
fn deep_nesting_is_rejected_at_parse_time() {
    let src = format!("{}1{}", "(".repeat(500), ")".repeat(500));
    assert!(matches!(parse(&src), Err(ExprError::Parse(_))));
}

#[test]
fn integer_overflow_fails_closed() {
    let env = ValueEnv::new();
    assert!(matches!(
        run("9223372036854775807 + 1", &env),
        Err(ExprError::Eval(_))
    ));
}

// Deterministic pseudo-random generator (SplitMix64) for the robustness
// corpus: no external dependency, no wall-clock seed (INV-1 applies to
// tests too).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
}

#[test]
fn parser_never_panics_on_adversarial_input() {
    // INV-7 robustness corpus: 20k random byte strings over the token
    // alphabet must lex/parse/eval to Ok or Err — never panic, never hang.
    let alphabet: &[u8] = b"abz_019.+-*/()<>=!\" ,nulltruefalseandornotemi";
    let mut rng = Rng(0x5EED_2026_0710);
    let env = ValueEnv::new();
    for _ in 0..20_000 {
        let len = (rng.next() % 48) as usize;
        let src: String = (0..len)
            .map(|_| alphabet[(rng.next() as usize) % alphabet.len()] as char)
            .collect();
        if let Ok(expr) = parse(&src) {
            let _ = eval(&expr, &env, &mut Fuel::new(1_000));
        }
    }
}
