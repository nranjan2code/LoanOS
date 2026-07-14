# GTM Operating Model — Human + AI Process

The process-of-processes. It shows **who does what, in what order, and where a
human must sign off**, for the whole go-to-market motion — so a human teammate and
an AI agent can operate the same system without stepping on each other. Every step
points to the doc that governs it.

> One rule sits above all others: **AI agents draft and analyse; humans approve
> anything that leaves the building** (an email to a prospect, a published asset, a
> forecast change, a price). See "Human-in-the-loop checkpoints" below.

## The end-to-end flow

```
        MARKETING LANE                 SALES LANE                  CUSTOMER SUCCESS LANE
 ┌────────────────────────┐  ┌──────────────────────────┐  ┌───────────────────────────────┐
 │ Plan → Message →        │  │ Target → Engage →         │  │ Onboard → Adopt → QBR/prove →  │
 │ Create → Publish →      │─▶│ Discover → Demo →         │─▶│ Renew → Expand                 │
 │ Nurture                 │  │ Evaluate → Business case →│  │                                │
 │                         │  │ Close → Handoff to CS ────┼─▶│  (health scoring runs always)  │
 └───────────┬────────────┘  └────────────┬─────────────┘  └───────────────┬───────────────┘
             │      shared spine (all three lanes obey)                     │
             ▼                             ▼                                ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────┐
 │  Messaging house  ·  Claims↔backlog matrix  ·  Brand guide  ·  Shared context           │
 │  (nothing ships or is said that isn't traceable to a Built/Partial/Roadmap claim,       │
 │   in the brand voice, in the house messaging)                                           │
 └───────────────────────────────────────────────────────────────────────────────────────┘
             ▲                                                             │
             └───────────── voice-of-customer / win-loss → product backlog ┘  (closes the cycle)
```

## Stage-by-stage: human vs AI, and the governing doc

| # | Stage | AI agent does | Human does | Human-in-loop? | Governing doc |
| --- | --- | --- | --- | --- | --- |
| M0 | Plan campaign | Draft brief from template; pull proof points | Approve objective, budget, target list | ✅ approve | `marketing/campaign-briefs.md`, `marketing/marketing-plan.md` |
| M1 | Message | Suggest pillar + persona angle | Choose angle | — | `marketing/messaging-house.md` |
| M2 | Create | Draft content + working-notes with claim IDs | Edit + approve voice/claims | ✅ before publish | `ai-agents/agent-content-generation.md`, `brand/brand-guide.md` |
| M3 | Publish | Assemble/schedule (draft state) | Click publish | ✅ publish | `marketing/content-calendar.md` |
| M4 | Nurture | Draft newsletter/segments | Approve send | ✅ send | `marketing/content-calendar.md` |
| S0 | Target & research | Build account brief, fit-screen, trigger hunt | Confirm targets | — | `ai-agents/agent-lead-research.md`, `automation/outreach-list-build.mjs` |
| S1 | Engage | Personalise outreach (draft) | Send / call | ✅ send | `ai-agents/agent-outreach-personalization.md`, `sales/cold-call-scripts.md`, `sales/email-sequences.md` |
| S2 | Discover | Summarise calls, extract pains, suggest questions | Run the conversation | — | `sales/discovery-question-bank.md` |
| S3 | Demo/proof | Prep demo beats to the buyer's pain; build proof sheet | Deliver the demo | — | `sales/demo-script.md`, `automation/build-proof-sheet.mjs` |
| S4 | Evaluate/security | Assemble vendor-posture answers (draft) | Own the InfoSec relationship | ✅ commitments | tenancy/vendor-posture pack |
| S5 | Business case | Score qualification; draft value framing | Decide forecast/stage; agree price | ✅ price & forecast | `sales/qualification-framework.md`, `strategy/pricing-and-packaging.md`, `ai-agents/agent-qualification.md` |
| S6 | Procurement/legal | Surface DPA/residency/exit facts | Negotiate & sign | ✅ contract | `strategy/positioning-and-messaging.md`, portability proof |
| S7 | Close & handoff | Draft the CS handoff summary | Confirm & introduce | ✅ handoff | `sales/sales-playbook.md` |
| C0 | Onboard | Sequence provisioning, track readiness, flag blockers | Provision + own the customer | ✅ security/scope | `customer-success/onboarding-playbook.md`, `ai-agents/agent-onboarding-orchestration.md` |
| C1 | Adopt | Track milestones, surface friction | Drive adoption, unblock | — | `customer-success/adoption-and-qbr.md` |
| C2 | Prove value (QBR) | Assemble the value scorecard (draft) | Deliver the QBR | ✅ metrics | `customer-success/adoption-and-qbr.md`, `ai-agents/agent-qbr-prep.md` |
| C3 | Health/retain | Score health, recommend save play | Decide & run the play | ✅ commercial | `customer-success/health-and-churn.md`, `ai-agents/agent-health-monitor.md`, `automation/cs-health-score.mjs` |
| C4 | Renew & expand | Spot signals, draft value case | Own renewal/expansion, agree price | ✅ price & renewal | `customer-success/renewals-and-expansion.md` |
| C5 | Close the loop | Draft voice-of-customer items | Route to product backlog | — | `../product/build-backlog.md` |

## AI agent orchestration (how agents chain)

Agents are composable. A typical outbound run:

```
outreach-list-build.mjs  →  agent-lead-research  →  agent-qualification
        (prioritise)          (brief per account)     (score, next action)
                                     │
                                     ▼
                         agent-outreach-personalization  →  [HUMAN APPROVES]  →  send
                                     ▲
        agent-content-generation ────┘ (supplies proof-backed talking points)
```

Rules for chaining:
- Every agent loads `ai-agents/shared-context.md` **first**, then its runbook.
- Output of one agent is the input of the next in the documented output format
  (each runbook defines a machine-readable block).
- No chain step sends externally; the chain always terminates at a human approval
  before anything reaches a prospect or the public.
- If any step can't verify a fact, it flags rather than guesses — the human
  resolves the flag.

## Human-in-the-loop checkpoints (mandatory)

An AI agent must stop and get explicit human approval before:

1. **Sending** anything to a prospect (email, message, call script used live).
2. **Publishing** anything public (post, page, ad, case study).
3. **Changing** a CRM stage, forecast, or qualification verdict of record.
4. **Committing** on price, security/architecture, contract, or roadmap dates.
5. **Naming** a customer, metric, or competitor fact that isn't verified.

Everything else (research, drafting, scoring, summarising, prioritising) an agent
may do autonomously — but always inside claims discipline and brand voice.

## RACI (summary)

| Activity | Responsible | Accountable | Consulted | Informed |
| --- | --- | --- | --- | --- |
| Positioning & messaging | Product marketing | Head of Marketing | Sales, Product | All GTM |
| Claims↔backlog accuracy | Product marketing | Product lead | Engineering | All GTM |
| Brand consistency | Design / Product mktg | Head of Marketing | Web/eng | All GTM |
| Campaign execution | Demand gen (+ AI) | Head of Marketing | Sales | Leadership |
| Outbound & pipeline | Sales / SDR (+ AI) | Head of Sales | Marketing | Leadership |
| Qualification & forecast | AE | Head of Sales | RevOps | Leadership |
| Onboarding & adoption | CSM | Head of CS | Implementation eng | Sales, customer |
| Health, renewal & expansion | CSM | Head of CS | Sales, Finance | Leadership |
| Voice-of-customer → backlog | CSM | Head of CS | Product | All GTM |
| AI-agent guardrails | RevOps | Head of RevOps | Eng, Legal | All GTM |
| Website ↔ GTM sync | Product mktg | Head of Marketing | Eng | All GTM |

## Definition of Done for a GTM asset

An asset (human- or AI-made) is "done" only when:

1. Every claim traces to a `Built`/`Partial`/`Roadmap` row in
   `strategy/claims-and-backlog-sync.md`, stated at the correct maturity.
2. It follows `brand/brand-guide.md` (voice + visual).
3. It inherits the `marketing/messaging-house.md` pillar/persona structure.
4. `node docs/gtm/automation/gtm-backlog-sync.mjs` passes.
5. A human owner has approved (per the checkpoints above) if it's outbound/public.

## Maintenance cadence (keeps everything in sync)

| When | Action | Owner |
| --- | --- | --- |
| On any product capability change | Update the claim row's Status/Evidence | Product marketing + Eng |
| Before any campaign/deck/page ships | Run the claims gate; human claim review | Asset owner |
| On any brand change in site CSS | Update `brand/brand-guide.md` (and vice-versa) | Design |
| Quarterly | Reconcile GTM vs `../product/build-backlog.md` + `roadmap.md`; refresh battlecards | Product marketing |
| On new RBI direction/finding | Reactive content within 48h; re-check touched claims | Marketing |

## Onboarding: start here

- **New human GTM hire:** `README.md` → `strategy/positioning-and-messaging.md` →
  `strategy/icp-and-personas.md` → your lane's playbook → this operating model →
  `glossary.md`.
- **New AI agent:** `ai-agents/shared-context.md` → your task runbook → this
  operating model's checkpoints → `glossary.md`.
