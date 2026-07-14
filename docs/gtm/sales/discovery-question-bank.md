# Discovery Question Bank

Organised by theme and by persona. Aim to **quantify pain** and **confirm a
compliance trigger**. Use 5–8 per call, not all of them. Listen for the cost.

## Situation / current state

- Walk me through how a loan moves from onboarding to disbursement today — which
  systems own which steps?
- Where does origination data live vs. servicing data? Who reconciles them?
- How much of your lending is via LSP/DLA distribution today?
- Which RBI directions are driving your current roadmap — DLD 2025, model-risk,
  DPDP, FPC?

## Pain — compliance evidence (CCO / Audit)

- When your last audit or RBI query asked *why* a specific loan was approved, how
  long did assembling that answer take, and across how many systems?
- How do you currently prove KFS was disclosed before every contract?
- If I asked for a tamper-evident evidence pack for one product line right now,
  is that an export or a project?
- How do you evidence consent, data residency, and DLA compliance to a supervisor?

## Pain — credit & model risk (CRO / Credit)

- How is your credit policy encoded today — code, config, or a document plus
  human judgement?
- Can you replay exactly why a decision was made six months ago, byte-for-byte?
- If a model started drifting on a Friday, what stops it being used Saturday, and
  who approves turning it back on?
- Where does your model inventory live relative to the decisions that use models?

## Pain — engineering & security (CTO / InfoSec)

- How is tenant/data isolation enforced today, and how would you prove it to an
  auditor?
- Where is lending data hosted? How do you handle Aadhaar-artifact prohibition?
- What is your exit plan if a lending vendor relationship ends — can you get your
  data back in a re-loadable form?
- How much engineering time goes to staying aligned with RBI changes vs. product?

## Pain — collections & operations (Collections / Ops)

- How do you ensure recovery contacts stay within FPC contact-hours and use only
  empanelled agents?
- How is SMA/NPA classification produced today — automatic from ledger, or manual?
- How are grievances tracked against the 30-day RBI clock and CMS escalation?

## Pain — LSP / distribution

- Where is the boundary between your RE and your LSPs enforced in software?
- Who carries liability when an LSP touches a borrower, and how is that evidenced?
- How do you handle DLG caps and co-lending share reconciliation today?

## Impact / cost (quantify)

- What did the last compliance-driven product slip cost in time or revenue?
- What is the exposure — penalty, remediation, DLA delisting — if evidence is
  incomplete at inspection?
- How many FTEs touch audit-evidence assembly in a quarter?

## Decision process / buying

- Who signs off compliance-critical platforms — CCO, board risk committee, CEO?
- Does this require InfoSec/security review? Who owns it and what is the bar?
- What does procurement need on DPA, data residency, audit rights, and exit?
- What is the trigger date — a launch, an inspection, a filing — that anchors
  timing?

## Persona quick-pick (top 3 each)

| Persona | Ask these first |
| --- | --- |
| CCO | Evidence-assembly time; KFS proof; export-or-project |
| CRO/Credit | Policy encoding; decision replay; model-drift stop |
| CTO/InfoSec | Isolation proof; data hosting; exit/portability |
| Collections | FPC contact-hours; empanelled agents; NPA automation |
| CEO | Cost of last compliance slip; franchise risk; decision process |

## Listening for green lights

Quantified pain + named trigger date + economic buyer identified + willingness to
involve InfoSec early = advance to demo. Missing any = that is your next action.
