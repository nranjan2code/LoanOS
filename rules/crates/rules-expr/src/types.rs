//! Static typechecker. Validates base-type compatibility against a declared
//! environment; nullability is enforced at runtime, fail-closed (see SPEC.md).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::parser::{BinOp, Expr};
use crate::ExprError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Type {
    Bool,
    Int,
    Decimal,
    String,
    Date,
    /// The type of the `null` literal; assignable where any type is expected
    /// in equality and `coalesce` positions only.
    Null,
}

pub type TypeEnv = BTreeMap<String, Type>;

fn numeric(t: Type) -> bool {
    matches!(t, Type::Int | Type::Decimal)
}

/// Two types are equality-comparable if they share a base type, either is
/// `Null`, or both are numeric.
fn eq_comparable(a: Type, b: Type) -> bool {
    a == b || a == Type::Null || b == Type::Null || (numeric(a) && numeric(b))
}

pub fn typecheck(expr: &Expr, env: &TypeEnv) -> Result<Type, ExprError> {
    match expr {
        Expr::Bool(_) => Ok(Type::Bool),
        Expr::Int(_) => Ok(Type::Int),
        Expr::Dec(_) => Ok(Type::Decimal),
        Expr::Str(_) => Ok(Type::String),
        Expr::Null => Ok(Type::Null),
        Expr::Ident(name) => env
            .get(name)
            .copied()
            .ok_or_else(|| ExprError::Type(format!("unknown identifier: {name}"))),
        Expr::Not(inner) => {
            expect(inner, env, Type::Bool, "not")?;
            Ok(Type::Bool)
        }
        Expr::Neg(inner) => {
            let t = typecheck(inner, env)?;
            if numeric(t) {
                Ok(t)
            } else {
                Err(ExprError::Type(
                    "unary minus requires a numeric operand".into(),
                ))
            }
        }
        Expr::Binary(op, l, r) => {
            let lt = typecheck(l, env)?;
            let rt = typecheck(r, env)?;
            match op {
                BinOp::And | BinOp::Or => {
                    if lt == Type::Bool && rt == Type::Bool {
                        Ok(Type::Bool)
                    } else {
                        Err(ExprError::Type("and/or require bool operands".into()))
                    }
                }
                BinOp::Eq | BinOp::Ne => {
                    if eq_comparable(lt, rt) {
                        Ok(Type::Bool)
                    } else {
                        Err(ExprError::Type(format!(
                            "cannot compare {lt:?} with {rt:?} for equality"
                        )))
                    }
                }
                BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                    let ordered = (numeric(lt) && numeric(rt))
                        || (lt == rt && matches!(lt, Type::Date | Type::String));
                    if ordered {
                        Ok(Type::Bool)
                    } else {
                        Err(ExprError::Type(format!(
                            "cannot order {lt:?} against {rt:?}"
                        )))
                    }
                }
                BinOp::Add | BinOp::Sub | BinOp::Mul => {
                    if numeric(lt) && numeric(rt) {
                        if lt == Type::Int && rt == Type::Int {
                            Ok(Type::Int)
                        } else {
                            Ok(Type::Decimal)
                        }
                    } else {
                        Err(ExprError::Type(
                            "arithmetic requires numeric operands".into(),
                        ))
                    }
                }
                BinOp::Div => {
                    if numeric(lt) && numeric(rt) {
                        Ok(Type::Decimal)
                    } else {
                        Err(ExprError::Type("division requires numeric operands".into()))
                    }
                }
            }
        }
        Expr::Call(name, args) => check_call(name, args, env),
    }
}

fn expect(expr: &Expr, env: &TypeEnv, want: Type, ctx: &str) -> Result<(), ExprError> {
    let got = typecheck(expr, env)?;
    if got == want || got == Type::Null {
        Ok(())
    } else {
        Err(ExprError::Type(format!(
            "{ctx}: expected {want:?}, got {got:?}"
        )))
    }
}

fn check_call(name: &str, args: &[Expr], env: &TypeEnv) -> Result<Type, ExprError> {
    let arity = |n: usize| -> Result<(), ExprError> {
        if args.len() == n {
            Ok(())
        } else {
            Err(ExprError::Type(format!(
                "{name} expects {n} argument(s), got {}",
                args.len()
            )))
        }
    };
    match name {
        "coalesce" => {
            arity(2)?;
            let a = typecheck(&args[0], env)?;
            let b = typecheck(&args[1], env)?;
            match (a, b) {
                (Type::Null, t) | (t, Type::Null) => Ok(t),
                (a, b) if a == b => Ok(a),
                (a, b) if numeric(a) && numeric(b) => Ok(Type::Decimal),
                (a, b) => Err(ExprError::Type(format!(
                    "coalesce type mismatch: {a:?} vs {b:?}"
                ))),
            }
        }
        "round" => {
            arity(2)?;
            expect(&args[0], env, Type::Decimal, name)?;
            expect(&args[1], env, Type::Int, name)?;
            Ok(Type::Decimal)
        }
        "emi" => {
            arity(3)?;
            expect(&args[0], env, Type::Decimal, name)?;
            expect(&args[1], env, Type::Int, name)?;
            expect(&args[2], env, Type::Int, name)?;
            Ok(Type::Decimal)
        }
        "age_years" => {
            arity(2)?;
            expect(&args[0], env, Type::Date, name)?;
            expect(&args[1], env, Type::Date, name)?;
            Ok(Type::Int)
        }
        "years_from_months" => {
            arity(1)?;
            expect(&args[0], env, Type::Int, name)?;
            Ok(Type::Int)
        }
        other => Err(ExprError::Type(format!("unknown function: {other}"))),
    }
}
