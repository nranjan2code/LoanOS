//! Pure plan evaluator. Evaluation is a function of (plan, request) only:
//! no clock, no I/O, no randomness (INV-1, INV-12). Every error path degrades
//! to the decision family's restrictive outcome (INV-5).

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use std::collections::BTreeMap;
use std::str::FromStr;

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use rules_compile::{Plan, BUILTIN_TODAY};
use rules_core::reason::{Audience, Severity};
use rules_core::{
    DecisionError, DecisionRequest, DecisionResponse, EngineInfo, Outcome, Reason, RulesetInfo,
};
use rules_expr::{eval as eval_expr, ExprError, Fuel, Value, ValueEnv};
use rules_model::{BindingType, OutcomeRule};

/// Default fuel budget per evaluation (INV-7). Generous for decision graphs,
/// hostile to runaways.
pub const DEFAULT_FUEL: u64 = 100_000;

#[derive(Debug, Clone)]
pub struct DecideConfig {
    pub engine: EngineInfo,
    pub version_label: String,
    /// Platform guardrail pack hash; a real pack arrives in PH-2. Until then
    /// callers pass the placeholder used in their bundle metadata.
    pub platform_pack: String,
    pub fuel: u64,
}

/// The evaluation record (INV-8). Serialized to the tenant's encrypted audit
/// stream in PH-3; contains fact values, so it must never travel to callers
/// (INV-10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvalTrace {
    pub model_hash: String,
    pub bindings: BTreeMap<String, String>,
    pub expressions: Vec<(String, String)>,
    pub rows_fired: Vec<String>,
}

pub struct Evaluation {
    pub outcome: Outcome,
    pub reasons: Vec<Reason>,
    pub outputs: serde_json::Value,
    pub trace: EvalTrace,
}

/// Infallible fail-closed wrapper (INV-5): any evaluation error becomes the
/// family's restrictive outcome with a sanitized reason (SEC-5: the message
/// carries identifiers and paths, never fact values or rule content).
pub fn decide(plan: &Plan, request: &DecisionRequest, config: &DecideConfig) -> DecisionResponse {
    let (decision, reasons, outputs) = match evaluate(plan, request, config.fuel) {
        Ok(eval) => (eval.outcome, eval.reasons, eval.outputs),
        Err(err) => (
            plan.family.fail_closed_outcome(),
            vec![Reason {
                severity: Severity::Error,
                code: "EVALUATION_ERROR".into(),
                regulation: "PLATFORM".into(),
                message: err.to_string(),
                path: String::new(),
                audience: Audience::Internal,
            }],
            serde_json::Value::Object(serde_json::Map::new()),
        ),
    };
    DecisionResponse {
        request_id: request.request_id.clone(),
        decision,
        outputs,
        reasons,
        ruleset: RulesetInfo {
            tenant_pack: plan.hash.clone(),
            platform_pack: config.platform_pack.clone(),
            version_label: config.version_label.clone(),
            effective_from: request.effective_at,
        },
        // PH-3 wires the audit stream; until then the reference is derived
        // from the request id.
        trace_ref: format!("trace:{}", request.request_id),
        engine: config.engine.clone(),
        evaluated_at: request.effective_at,
    }
}

pub fn evaluate(
    plan: &Plan,
    request: &DecisionRequest,
    fuel_budget: u64,
) -> Result<Evaluation, DecisionError> {
    if request.decision_key != plan.model.key {
        return Err(DecisionError::UnknownDecisionKey {
            key: request.decision_key.clone(),
        });
    }

    let mut env = ValueEnv::new();
    // INV-12: `today` is the calendar date of the request's own effective_at,
    // in the request's own offset. The system clock is never consulted.
    env.insert(
        BUILTIN_TODAY.to_string(),
        Value::Date(request.effective_at.date_naive()),
    );

    let mut trace = EvalTrace {
        model_hash: plan.hash.clone(),
        bindings: BTreeMap::new(),
        expressions: Vec::new(),
        rows_fired: Vec::new(),
    };

    for binding in &plan.model.bindings {
        let value = extract(&request.facts, &binding.path, binding.ty, binding.required)?;
        trace.bindings.insert(binding.name.clone(), render(&value));
        env.insert(binding.name.clone(), value);
    }

    let mut fuel = Fuel::new(fuel_budget);
    for (name, ast) in &plan.expressions {
        let value = eval_expr(ast, &env, &mut fuel).map_err(from_expr_error)?;
        trace.expressions.push((name.clone(), render(&value)));
        env.insert(name.clone(), value);
    }

    let mut reasons = Vec::new();
    for compiled in &plan.rows {
        let mut fired = true;
        for cond in &compiled.when {
            match eval_expr(cond, &env, &mut fuel).map_err(from_expr_error)? {
                Value::Bool(true) => {}
                Value::Bool(false) => {
                    fired = false;
                    break;
                }
                _ => {
                    return Err(DecisionError::Internal {
                        detail: format!("row {} condition was not boolean", compiled.row.id),
                    })
                }
            }
        }
        if fired {
            trace.rows_fired.push(compiled.row.id.clone());
            reasons.push(Reason {
                severity: compiled.row.severity,
                code: compiled.row.code.clone(),
                regulation: compiled.row.regulation.clone(),
                message: compiled.row.message.clone(),
                path: compiled.row.path.clone(),
                audience: compiled.row.audience,
            });
        }
    }

    let outcome = match plan.outcome {
        OutcomeRule::SeverityFold => severity_fold(plan, &reasons),
    };

    let mut outputs = serde_json::Map::new();
    for (name, reference) in &plan.outputs {
        let value = env.get(reference).ok_or_else(|| DecisionError::Internal {
            detail: format!("output {name} reference missing after evaluation"),
        })?;
        outputs.insert(name.clone(), to_json(value));
    }

    Ok(Evaluation {
        outcome,
        reasons,
        outputs: serde_json::Value::Object(outputs),
        trace,
    })
}

fn severity_fold(plan: &Plan, reasons: &[Reason]) -> Outcome {
    use rules_core::outcome::DecisionFamily;
    let has_error = reasons.iter().any(|r| r.severity == Severity::Error);
    let has_warn = reasons.iter().any(|r| r.severity == Severity::Warn);
    match plan.family {
        DecisionFamily::Lending => {
            if has_error {
                Outcome::Ineligible
            } else if has_warn {
                Outcome::Refer
            } else {
                Outcome::Eligible
            }
        }
        DecisionFamily::Guardrail => {
            if has_error {
                Outcome::Deny
            } else if has_warn {
                Outcome::RequireHuman
            } else {
                Outcome::Allow
            }
        }
    }
}

fn extract(
    facts: &serde_json::Value,
    path: &str,
    ty: BindingType,
    required: bool,
) -> Result<Value, DecisionError> {
    let node = facts.pointer(path);
    if ty == BindingType::Present {
        return Ok(Value::Bool(matches!(node, Some(v) if !v.is_null())));
    }
    let Some(node) = node.filter(|v| !v.is_null()) else {
        if required {
            return Err(DecisionError::MissingFact { path: path.into() });
        }
        return Ok(Value::Null);
    };
    let mismatch = |expected: &str| DecisionError::TypeMismatch {
        path: path.into(),
        expected: expected.into(),
    };
    match ty {
        BindingType::Bool => node
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| mismatch("bool")),
        BindingType::Int => node.as_i64().map(Value::Int).ok_or_else(|| mismatch("int")),
        BindingType::Decimal => {
            // INV-6: decimals arrive as strings; a JSON number is a
            // contract violation, not a convenience.
            let s = node.as_str().ok_or_else(|| mismatch("decimal string"))?;
            Decimal::from_str(s)
                .map(Value::Dec)
                .map_err(|_| mismatch("decimal string"))
        }
        BindingType::String => node
            .as_str()
            .map(|s| Value::Str(s.to_string()))
            .ok_or_else(|| mismatch("string")),
        BindingType::Date => {
            let s = node.as_str().ok_or_else(|| mismatch("date string"))?;
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map(Value::Date)
                .map_err(|_| mismatch("date string (YYYY-MM-DD)"))
        }
        BindingType::Present => unreachable!("handled above"),
    }
}

fn from_expr_error(err: ExprError) -> DecisionError {
    match err {
        ExprError::FuelExhausted => DecisionError::FuelExhausted,
        other => DecisionError::Internal {
            detail: other.to_string(),
        },
    }
}

fn render(v: &Value) -> String {
    match v {
        Value::Bool(b) => b.to_string(),
        Value::Int(n) => n.to_string(),
        Value::Dec(d) => d.to_string(),
        Value::Str(s) => s.clone(),
        Value::Date(d) => d.format("%Y-%m-%d").to_string(),
        Value::Null => "null".into(),
    }
}

fn to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::Bool(b) => serde_json::Value::Bool(*b),
        Value::Int(n) => serde_json::Value::from(*n),
        // INV-6: decimals leave as strings, exactly as they arrived.
        Value::Dec(d) => serde_json::Value::String(d.to_string()),
        Value::Str(s) => serde_json::Value::String(s.clone()),
        Value::Date(d) => serde_json::Value::String(d.format("%Y-%m-%d").to_string()),
        Value::Null => serde_json::Value::Null,
    }
}
