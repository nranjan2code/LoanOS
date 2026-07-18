# rules-expr v1 — Expression Language Specification

Authority: this file details section 8 of `docs/architecture/decision-engine-design.md`
and inherits its invariants (notably INV-5 fail-closed, INV-6 exact arithmetic,
INV-7 totality, INV-12 time-as-input).

## Types

`bool`, `int` (i64), `decimal` (rust_decimal, also used for money and ratios in v1),
`string`, `date` (calendar date, no timezone). `null` is the absence of a value;
every binding may be null unless declared required.

## Grammar

```
expr    := or
or      := and ( "or" and )*
and     := unary ( "and" unary )*
unary   := "not" unary | cmp
cmp     := add ( ("==" | "!=" | "<" | "<=" | ">" | ">=") add )?
add     := mul ( ("+" | "-") mul )*
mul     := neg ( ("*" | "/") neg )*
neg     := "-" neg | primary
primary := int | decimal | string | "true" | "false" | "null"
         | ident | ident "(" args? ")" | "(" expr ")"
args    := expr ( "," expr )*
```

Literals: `123` is `int`; `0.5000` is `decimal` (scale preserved); `"text"` is
`string`. There is no float syntax and no float type (INV-6).

## Semantics

- `and` / `or` short-circuit left to right. Operands must be `bool`.
- Arithmetic (`+ - *`): `int op int -> int`; any `decimal` operand makes the
  result `decimal` (exact int-to-decimal widening). `/` always yields `decimal`.
- Null propagation: arithmetic on `null` yields `null`. Division by zero yields
  `null` (undefined, poisons downstream like JS-style guarded code).
- Ordering comparisons (`< <= > >=`) on `null` are a runtime error — evaluation
  fails closed (INV-5). Guard with `x != null and x > y`.
- Equality: `x == null` / `x != null` test presence for any type;
  `null == null` is `true`. Otherwise operands must be comparable types
  (numeric with numeric, string with string, date with date, bool with bool).
- Integer overflow is a runtime error (fail-closed), never a wrap.

## Totality and fuel (INV-7)

No loops, no recursion, no user-defined functions. Every AST node evaluation
charges fuel; stdlib calls charge proportional fuel (`emi` charges its tenor).
Fuel exhaustion aborts evaluation with an error that the caller maps to the
family's fail-closed outcome.

## Standard library (v1)

All functions propagate `null`: if any argument is `null` the result is `null`,
except `coalesce`. Stdlib grows only via platform release (DEC-8).

| Function | Signature | Notes |
| --- | --- | --- |
| `coalesce(a, b)` | `(T?, T?) -> T?` | First non-null argument. |
| `round(x, places)` | `(decimal, int) -> decimal` | Half away from zero (matches JS `Math.round` for positives). |
| `emi(principal, rate_bps, months)` | `(decimal, int, int) -> decimal?` | Reducing-balance EMI matching the LMS amortization and `estimateEmi` in `packages/core/src/lending/eligibility.js`; rounded to 2 places. Returns `null` when principal or months are non-positive or rate is negative (domain nulls, mirroring the JS). |
| `age_years(dob, at)` | `(date, date) -> int` | Completed calendar years, matching `calculateAgeYears` in `packages/core/src/lending/loan-policy.js`. |
| `years_from_months(m)` | `(int) -> int` | `ceil(m / 12)`; used for age at maturity. |

## Static typing

The typechecker validates base types (operator/operand and call-signature
compatibility) against a declared environment. Nullability is not flow-typed
in v1: an unguarded `null` reaching an ordering comparison is a runtime
fail-closed error, not a static one. This is deliberate — the runtime guarantee
is the invariant; flow narrowing is future ergonomics.
