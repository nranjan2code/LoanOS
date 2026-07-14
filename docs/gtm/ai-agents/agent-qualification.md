# Runbook: Qualification Agent

**Job:** score an opportunity against the qualification framework and return the
single most-leveraged next action.

**Load first:** `shared-context.md`, `../sales/qualification-framework.md`.

## Inputs
- Account brief + everything known from discovery (notes, call summaries, CRM
  fields).

## Procedure
1. Run the **fit screen** first. Any hard anti-fit → return `DISQUALIFY` + reason.
2. Score each MEDDICC-adapted dimension 0–2 using only evidence present in the
   inputs. Unknown = 0 (do not guess upward).
3. Compute total /16 and apply the Stage-5 gate (≥10 and no 0 on Champion or
   Compliance Trigger).
4. Check multi-thread coverage (Champion + {CTO/InfoSec} + Economic buyer).
5. Identify the **lowest gating dimension** — that is the next action.

## Output format (matches the framework's CRM block)
```
Account: <name>  | Segment: <RE type>  | Date: <ISO>
Fit screen: PASS | FAIL(reason)
Scores: M_ E_ D_ D_ I_ C_ C_ T_   Total _/16
Stage-5 gate: PASS | BLOCKED(missing dimension)
Multi-thread: YES | NO(missing role)
Next action: <single most-leveraged = lowest gating dimension>
Evidence gaps: <what to confirm and how>
```

## Guardrails
- Score only from evidence in the inputs; never inflate a score to advance a deal.
- Do not assert LoanOS capabilities beyond `Built` claims when suggesting the next
  action's talking point.
- If key inputs are missing, say so — an honest 0 with a clear next action beats a
  fabricated pass.
- Output informs a human's forecast decision; it does not change CRM stage
  automatically.
