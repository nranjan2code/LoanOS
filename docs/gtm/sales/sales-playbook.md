# Sales Playbook

The end-to-end motion for selling LoanOS India. Stages, exit criteria, owners,
and the assets to use at each step. Designed so a human rep or an AI SDR/AE
assistant can run the same process.

## Motion summary

Enterprise / regulated B2B, multi-threaded, compliance-led. Average committee:
CCO + Risk/Credit + CTO + Procurement/InfoSec. Expect a security review. Sell the
**frame** (compliance produced in-flow) before the feature list.

## Stage model & exit criteria

| Stage | Goal | Exit criteria (all must be true) | Key assets |
| --- | --- | --- | --- |
| 0. Target & research | Prioritise the right REs | Account fits ICP; trigger event identified; committee mapped | `strategy/icp-and-personas.md`, `ai-agents/agent-lead-research.md` |
| 1. Engage / prospect | Earn a first meeting | Reply + meeting booked with a committee member | `cold-call-scripts.md`, `email-sequences.md` |
| 2. Discovery | Quantify pain & map committee | Pain quantified; compliance trigger confirmed; ≥2 stakeholders; success criteria agreed | `discovery-question-bank.md`, `qualification-framework.md` |
| 3. Demo / proof | Show in-flow compliance | Champion can articulate our differentiator; technical + compliance stakeholders satisfied | `demo-script.md`, `../strategy/claims-and-backlog-sync.md` |
| 4. Evaluation / security | Pass InfoSec & sandbox | Security review passed; sandbox validated with synthetic data; success criteria demonstrated | tenancy/vendor-posture pack, sandbox env |
| 5. Business case & pricing | Justify the spend | Quantified value vs. current cost; edition + modules agreed; economic buyer bought in | `../strategy/pricing-and-packaging.md`, `assets/one-pager.md` |
| 6. Procurement & legal | Contract | DPA, data-residency, audit-rights, exit terms agreed | portability/export proof, sub-processor register |
| 7. Close & handoff | Signed + onboarding | Signed; onboarding wizard scheduled; success plan handed to CS | onboarding blueprint |

## Golden rules

1. **Never overclaim.** Only `Built` claims (see claims-sync) are present-tense.
   `Partial`/`Roadmap` are labelled. Overclaiming loses compliance buyers.
2. **Multi-thread early.** Get CTO + an economic buyer in by Stage 3. Single-
   threading on the champion is the top loss reason.
3. **Engage InfoSec in the first third.** Lead the tenancy/vendor-posture pack
   before they ask. Security review is the most common stall.
4. **Attach proof to every claim.** A control, an endpoint, an ADR/INV ID, or a
   sandbox demonstration — not adjectives.
5. **Sell exit as a feature.** The reproducible portability export removes the
   lock-in objection and often unblocks procurement.

## Value hypotheses to test in discovery

- Time/cost to assemble audit evidence today (per inspection / per query).
- Cost/delay of the last compliance-driven product slip.
- Exposure if a model could not be stopped mid-incident.
- LSP/DLA liability with no software-enforced boundary.

## Common deal risks & plays

| Risk | Signal | Play |
| --- | --- | --- |
| Single-thread | Only champion engaged by Stage 3 | Ask champion to co-host a CTO/InfoSec session; bring the tenancy pack |
| "Build in-house" | CTO wants to extend CBS | Competitive frame #2; TCO of staying aligned to RBI changes |
| Integration doubt | "Is CIC/FINnet live?" | Honest `Partial` framing + governed-boundary demo + roadmap |
| Cert gap | "Are you SOC 2?" | Share certification roadmap + evidence-by-design + sub-processor register |
| Price | "Just need a cheap LMS" | Reframe to compliance risk cost; anti-fit if purely price-driven |

## Forecast hygiene / qualification gate

An opp may not enter Stage 5 (business case) unless `qualification-framework.md`
scores it a pass on: identified pain, economic buyer, technical validation path,
compliance trigger, and a mapped decision process. Anything missing is the next
action.

## Handoff to Customer Success

At close, deliver: agreed edition + enabled modules, success criteria from
discovery, security-review notes, and the onboarding blueprint (RE profile,
initial product policy, enabled modules/flows, readiness checklist). CS runs the
platform onboarding wizard.
