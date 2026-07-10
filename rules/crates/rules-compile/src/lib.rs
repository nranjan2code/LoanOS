//! Compiles a `DecisionModel` into an executable `Plan`: parses every
//! expression once, type-checks across node boundaries against the binding
//! environment, and rejects structural defects at compile time so evaluation
//! never meets an unparsed rule (INV-11: models are data, validated data).

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use std::collections::BTreeMap;

use rules_core::outcome::DecisionFamily;
use rules_expr::{parse, typecheck, Expr, Type, TypeEnv};
use rules_model::{content_hash, DecisionModel, FindingRow, OutcomeRule};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CompileError {
    #[error("unknown decision family for key: {0}")]
    UnknownFamily(String),
    #[error("duplicate name: {0}")]
    DuplicateName(String),
    #[error("in {context}: {source}")]
    Expr {
        context: String,
        source: rules_expr::ExprError,
    },
    #[error("condition {context} is not boolean")]
    NonBooleanCondition { context: String },
    #[error("output {name} references unknown value {reference}")]
    UnknownOutput { name: String, reference: String },
    #[error("model serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
}

/// A compiled, immutable, executable form of a decision model.
pub struct Plan {
    pub model: DecisionModel,
    pub family: DecisionFamily,
    /// `sha256:<hex>` of the model's canonical form (DEC-5).
    pub hash: String,
    pub expressions: Vec<(String, Expr)>,
    pub rows: Vec<CompiledRow>,
    pub outcome: OutcomeRule,
    pub outputs: BTreeMap<String, String>,
}

pub struct CompiledRow {
    pub row: FindingRow,
    pub when: Vec<Expr>,
}

/// The implicit environment every model receives (INV-12: time arrives as
/// data). `today` is the calendar date of the request's `effective_at`.
pub const BUILTIN_TODAY: &str = "today";

pub fn compile(model: DecisionModel) -> Result<Plan, CompileError> {
    let family = DecisionFamily::of_key(&model.key)
        .ok_or_else(|| CompileError::UnknownFamily(model.key.clone()))?;
    let hash = content_hash(&model)?;

    let mut env = TypeEnv::new();
    env.insert(BUILTIN_TODAY.to_string(), Type::Date);
    for binding in &model.bindings {
        if env
            .insert(binding.name.clone(), binding.ty.expr_type())
            .is_some()
        {
            return Err(CompileError::DuplicateName(binding.name.clone()));
        }
    }

    let mut expressions = Vec::with_capacity(model.expressions.len());
    for named in &model.expressions {
        if env.contains_key(&named.name) {
            return Err(CompileError::DuplicateName(named.name.clone()));
        }
        let ast = parse(&named.expr).map_err(|source| CompileError::Expr {
            context: format!("expression {}", named.name),
            source,
        })?;
        let ty = typecheck(&ast, &env).map_err(|source| CompileError::Expr {
            context: format!("expression {}", named.name),
            source,
        })?;
        env.insert(named.name.clone(), ty);
        expressions.push((named.name.clone(), ast));
    }

    let mut rows = Vec::with_capacity(model.findings.len());
    for row in &model.findings {
        let mut when = Vec::with_capacity(row.when.len());
        for (i, cond) in row.when.iter().enumerate() {
            let context = format!("row {} condition {}", row.id, i);
            let ast = parse(cond).map_err(|source| CompileError::Expr {
                context: context.clone(),
                source,
            })?;
            let ty = typecheck(&ast, &env).map_err(|source| CompileError::Expr {
                context: context.clone(),
                source,
            })?;
            if ty != Type::Bool {
                return Err(CompileError::NonBooleanCondition { context });
            }
            when.push(ast);
        }
        rows.push(CompiledRow {
            row: row.clone(),
            when,
        });
    }

    for (name, reference) in &model.outputs {
        if !env.contains_key(reference) {
            return Err(CompileError::UnknownOutput {
                name: name.clone(),
                reference: reference.clone(),
            });
        }
    }

    Ok(Plan {
        family,
        hash,
        expressions,
        outcome: model.outcome,
        outputs: model.outputs.clone(),
        rows,
        model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rules_core::reason::{Audience, Severity};
    use rules_model::{Binding, BindingType, NamedExpression};

    fn base_model() -> DecisionModel {
        DecisionModel {
            key: "lending.example".into(),
            bindings: vec![Binding {
                name: "income".into(),
                path: "/income".into(),
                ty: BindingType::Decimal,
                required: false,
            }],
            expressions: vec![NamedExpression {
                name: "low".into(),
                expr: "income != null and income < 10000.00".into(),
            }],
            findings: vec![FindingRow {
                id: "r1".into(),
                when: vec!["low".into()],
                severity: Severity::Error,
                code: "X".into(),
                regulation: "RBI-DL-2025".into(),
                message: "m".into(),
                path: "income".into(),
                audience: Audience::Internal,
            }],
            outcome: OutcomeRule::SeverityFold,
            outputs: BTreeMap::new(),
        }
    }

    #[test]
    fn compiles_a_valid_model() {
        let plan = compile(base_model()).unwrap();
        assert_eq!(plan.family, DecisionFamily::Lending);
        assert!(plan.hash.starts_with("sha256:"));
        assert_eq!(plan.expressions.len(), 1);
        assert_eq!(plan.rows.len(), 1);
    }

    #[test]
    fn rejects_type_errors_at_compile_time() {
        let mut m = base_model();
        m.expressions[0].expr = "income and true".into();
        assert!(matches!(compile(m), Err(CompileError::Expr { .. })));
    }

    #[test]
    fn rejects_non_boolean_conditions() {
        let mut m = base_model();
        m.findings[0].when = vec!["income + 1.00".into()];
        assert!(matches!(
            compile(m),
            Err(CompileError::NonBooleanCondition { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_and_unknown_names() {
        let mut m = base_model();
        m.expressions.push(NamedExpression {
            name: "low".into(),
            expr: "true".into(),
        });
        assert!(matches!(compile(m), Err(CompileError::DuplicateName(_))));

        let mut m = base_model();
        m.outputs.insert("foir".into(), "nonexistent".into());
        assert!(matches!(
            compile(m),
            Err(CompileError::UnknownOutput { .. })
        ));
    }

    #[test]
    fn rejects_unknown_decision_family() {
        let mut m = base_model();
        m.key = "mystery.thing".into();
        assert!(matches!(compile(m), Err(CompileError::UnknownFamily(_))));
    }
}
