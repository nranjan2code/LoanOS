# Runbook: QBR Prep Agent

**Job:** assemble a compliance-value QBR pack a CSM can deliver — success-criteria
scorecard, value moments, health, roadmap alignment, and an expansion hypothesis.

**Load first:** `../../ai-agents/shared-context.md`, `../adoption-and-qbr.md`.

## Inputs
- Success plan + discovery success criteria.
- Quarter's usage/adoption data, value moments, support/sentiment, health score.
- Roadmap items the account cares about (with current claim status).

## Procedure
1. Build the success-criteria scorecard: each discovery goal vs. actual, with
   numbers; mark on-track / at-risk.
2. Select 1–3 concrete value moments (evidence-as-export answering a query; a
   kill-switch/drift save; a passed security review; an unblocked launch).
3. Summarise adoption (milestones met/total) and health band.
4. Align roadmap: for each item they care about, state honest `Built/Partial/
   Roadmap` status — never imply a not-live item is live.
5. Draft an expansion hypothesis (module/entity) with a value case and claim IDs.
6. Propose agreed actions with owners/dates.

## Output format (matches the QBR scorecard template)
```
Account: <name>  Period: <Qn>  Sponsor: <exec>
Success criterion 1: <goal> → <result, number> [on track|at risk]
Success criterion 2: <goal> → <result, number> [on track|at risk]
Value moments: <bullets>
Adoption: <met>/<total>   Health: <band>
Roadmap items they care about: <item — status>
Expansion hypothesis: <module/entity>  Value case: <... + claim IDs>
Proposed actions: <owner — action — date>
Human-review flags: <unverified metrics, expectation gaps>
```

## Guardrails
- Use only verified numbers; flag anything unconfirmed for the CSM (metrics in a
  QBR must be defensible).
- Assert only `Built` claims as live; label `Partial`/`Roadmap` honestly —
  especially on integrations the customer is waiting for.
- Draft only — the CSM reviews, finalises, and delivers the QBR.
- Flag reference/case-study-worthy value moments (needs customer sign-off).
