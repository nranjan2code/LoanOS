# CS Playbook

The operating model for Customer Success. Defines segments, the post-sale
lifecycle, cadence, ownership, and how value is measured for a compliance-first
lending platform.

## Segmentation (coverage model)

| Tier | Who | Coverage | Cadence |
| --- | --- | --- | --- |
| Strategic | Large banks / multi-entity groups; dedicated data plane | Named CSM + exec sponsor | Weekly early, monthly steady, quarterly QBR + board-level review |
| Growth | Mid NBFC / SFB / HFC; multiple modules | Named CSM | Bi-weekly early, monthly steady, quarterly QBR |
| Scaled | Smaller REs / co-ops; Core edition | Pooled CS + digital/one-to-many | Milestone-triggered + quarterly digital QBR |

Match investment to ARR and to regulatory criticality — a small RE mid-inspection
may warrant strategic touch temporarily.

## Post-sale lifecycle stages & exit criteria

| Stage | Goal | Exit criteria |
| --- | --- | --- |
| 0. Handoff | Clean transfer from Sales | Blueprint, success criteria, security notes received; kickoff booked |
| 1. Onboard | Stand up the tenant | Tenant provisioned; RE profile + first product policy live; modules/flows enabled; readiness checklist green (`onboarding-playbook.md`) |
| 2. First value | Prove the core promise fast | First compliant loan traced end-to-end; first evidence pack exported |
| 3. Adopt | Embed in daily operations | Target teams active; key flows in production; usage steady |
| 4. Prove value (QBR) | Tie usage to their success criteria | QBR delivered; value evidenced against the metrics from discovery |
| 5. Renew | Secure the renewal | Renewal closed on time, no surprise |
| 6. Expand | Grow footprint | ≥1 module or entity/product-line added (`renewals-and-expansion.md`) |

## Success plan (per account)

Built from the Sales-discovered success criteria. One page, jointly owned:

```
Account: <name>   Segment: <tier>   Modules: <...>   Sponsor: <exec>
Their success criteria (from discovery):
  1. <e.g. cut audit-evidence assembly from weeks to hours>
  2. <e.g. pass InfoSec review with pooled data plane>
Value proof we will demonstrate (claim IDs):
  - Evidence-as-export (C-06/32)  - Kill switch (C-09)  - Isolation (C-07)
First-value milestone + date:
Adoption milestones + dates:
Risks / dependencies:
Renewal date:   Expansion hypothesis:
```

## Cadence & rituals

- **Kickoff** (Stage 0→1): align success plan, name the sponsor, book onboarding.
- **Onboarding standups**: through readiness-green.
- **Adoption check-ins**: usage vs. milestones; unblock.
- **QBR** (quarterly): value against success criteria; roadmap; expansion.
- **Renewal motion**: starts 90 days out (Strategic/Growth), 60 (Scaled).
- **Executive Business Review**: annual for Strategic — board/risk-committee level.

## RACI (within CS)

| Activity | Responsible | Accountable | Consulted | Informed |
| --- | --- | --- | --- | --- |
| Onboarding delivery | Onboarding/CSM | Head of CS | Implementation eng | Sales, customer |
| Adoption & value | CSM | Head of CS | Product | Sales |
| Health & risk | CSM (+ AI monitor) | Head of CS | Support, Product | Leadership |
| Renewal | CSM / Account mgr | Head of CS | Finance, Sales | Leadership |
| Expansion | CSM (+ Sales for large) | Head of CS/Sales | Product mktg | Leadership |
| Voice-of-customer → backlog | CSM | Head of CS | Product | GTM |

## How value is measured (compliance outcomes, not vanity metrics)

Tie every account to outcomes it bought, e.g.: evidence-pack export time
(before→after), audit-prep effort, loans traced end-to-end, model incidents safely
contained via kill switch, security review passed, product launches unblocked.
Usage matters only as a leading indicator of these.

## Interfaces

- **In:** Sales handoff (`../sales/sales-playbook.md` Stage 7).
- **Out:** expansion opportunities → Sales; voice-of-customer → product backlog
  (`../product/build-backlog.md`); reference/case-study candidates →
  `../assets/case-study-template.md`.
- **Guardrail:** capability expectations governed by
  `../strategy/claims-and-backlog-sync.md`.
