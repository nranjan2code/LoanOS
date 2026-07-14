# Qualification Framework

MEDDICC, adapted for a compliance-led sale. Score each dimension 0–2
(0 = unknown, 1 = partial, 2 = confirmed). **A deal may not enter Stage 5
(business case) below 10/16, and never with a 0 on Champion or Compliance
Trigger.** Usable by a human AE or an AI qualification agent
(`../ai-agents/agent-qualification.md`).

| # | Dimension | What "confirmed (2)" means | Score |
| --- | --- | --- | --- |
| M | **Metrics** | Quantified pain: evidence-assembly cost, slip cost, FTE load, or risk exposure | ☐ |
| E | **Economic buyer** | Named person with budget authority engaged (CCO/CRO/CEO/CFO) | ☐ |
| D | **Decision criteria** | We know the compliance, security, and commercial bar to win | ☐ |
| D | **Decision process** | Steps + owners mapped: InfoSec review, procurement, board/committee sign-off | ☐ |
| I | **Identify pain** | Specific, owned pain tied to a persona (not generic "compliance") | ☐ |
| C | **Champion** | An internal seller with access and motive; can articulate our differentiator | ☐ |
| C | **Competition** | We know the alternative (build / point tools / do nothing / vendor) and our edge | ☐ |
| T | **Compliance Trigger** | A dated event forcing action: inspection, DLA filing, model-risk mandate, launch | ☐ |

**Total ___ / 16.** Gate to Stage 5: ≥ 10 and no 0 on Champion or Trigger.

## Fit screen (run before scoring — disqualify fast)

Hard anti-fit (stop unless it changes):

- Non-India / non-INR lending.
- Wants to store Aadhaar biometrics/OTP/PID.
- Wants LSP fund control / pass-through disbursement.
- No regulated-entity accountability in the model.
- Purely price-driven "cheap LMS" with no compliance driver.

## Green-light signals (raise priority)

- Recent RBI inspection or supervisory finding.
- New lending product on a compressed timeline.
- Board/RBI model-risk mandate.
- LSP-heavy distribution needing DLA/DLG/co-lending governance.
- Core/LOS migration underway (displacement window).
- Newly hired CCO/CRO auditing the compliance stack.

## Committee coverage check

Minimum to be "multi-threaded": Champion + one of {CTO/InfoSec} + Economic buyer.
Single-threaded on champion = top loss reason; treat filling this as the next
action, not a nice-to-have.

## Next-action logic

The lowest-scoring gating dimension **is** the next action. Examples:

- Trigger unknown → discovery call to find the dated forcing event.
- Economic buyer at 0 → ask champion for a warm intro; bring the CEO one-liner.
- Decision process unclear → map InfoSec + procurement steps explicitly.
- Competition unknown → run trap-setting questions from `battlecards.md`.

## Output format (for CRM / AI agent)

```
Account: <name>  |  Segment: <RE type>  |  Date: <ISO>
Fit screen: PASS | FAIL (reason)
Scores: M_ E_ D_ D_ I_ C_ C_ T_  Total _/16
Stage-5 gate: PASS | BLOCKED (missing dimension)
Multi-thread: YES | NO (missing role)
Next action: <single most-leveraged action = lowest gating dimension>
```
