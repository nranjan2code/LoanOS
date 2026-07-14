# LoanOS India — Go-To-Market Asset Library

This folder is the single home for everything Sales and Marketing need to take
LoanOS India to market. It is written for **two kinds of operators**: humans on
the GTM team, and AI agents that research, personalise, qualify, and draft on
their behalf.

## Core principle: claims discipline

LoanOS is a **compliance product**. We may only say in market what the product
actually enforces today. Every externally-facing claim must trace to a built
capability in the product backlog, or be labelled `Roadmap`. The mapping lives
in [`strategy/claims-and-backlog-sync.md`](strategy/claims-and-backlog-sync.md)
and is checked by [`automation/gtm-backlog-sync.mjs`](automation/gtm-backlog-sync.mjs).

> If it is not in the backlog as built, it is not a claim. It is a roadmap item,
> and it is sold as one.

## Folder map

| Folder | What is in it | Primary owner |
| --- | --- | --- |
| `strategy/` | Positioning, ICP & personas, competitive landscape, pricing, claims↔backlog sync | Product marketing |
| `sales/` | Playbook, discovery bank, call/email scripts, demo script, objections, battlecards, qualification | Sales |
| `customer-success/` | Post-sale: onboarding, adoption/QBR, renewals/expansion, health/churn + CS agent runbooks | Customer Success |
| `marketing/` | Marketing plan, messaging house, content calendar, campaign briefs, website copy | Marketing / demand gen |
| `assets/` | Pitch-deck outline, one-pager, case-study template, FAQ | Product marketing |
| `ai-agents/` | Canonical shared context + runbooks/prompts for AI agents that execute GTM tasks | RevOps / AI |
| `automation/` | Runnable scripts: backlog-claim check, outreach list build, collateral generator | RevOps |
| `brand/` | Brand guide (colours, type, logo, voice) — every asset must follow it | Product marketing / design |

For public-site work, use [Public Site Content Operations](marketing/public-site-operations.md).
It is the shared human and AI workflow for drafting, reviewing and approving
website changes quickly without publishing automatically.

## Follow the brand

All assets — human-made or AI-generated — follow
[`brand/brand-guide.md`](brand/brand-guide.md). It is codified from the live
marketing site (`apps/web/assets/site.css`), so the deck, the one-pager, and the
website stay visually and verbally one brand. Brand and site CSS must not drift:
change one, update the other.

## The process (read this to see how it all fits)

- [`operating-model.md`](operating-model.md) — the human ↔ AI-agent process:
  end-to-end flow, agent orchestration, human-in-the-loop checkpoints, RACI, and
  the maintenance cadence that keeps every asset in sync.
- [`glossary.md`](glossary.md) — shared vocabulary (product, RBI/regulatory, GTM)
  so humans and agents read every term the same way.

## How to use this library

**Human, new to the account:** read `strategy/positioning-and-messaging.md`,
then `strategy/icp-and-personas.md`, then the relevant persona script in
`sales/`. Use `sales/qualification-framework.md` to score the opportunity.

**Human, building a campaign:** start in `marketing/messaging-house.md`, pull
proof points from `strategy/claims-and-backlog-sync.md`, brief it with
`marketing/campaign-briefs.md`.

**AI agent:** always load `ai-agents/shared-context.md` first (canonical facts),
then the task runbook (`agent-lead-research.md`, `agent-outreach-personalization.md`,
`agent-content-generation.md`, `agent-qualification.md`), and obey the
human-in-the-loop checkpoints in `operating-model.md`. Never assert a product
capability that is not in the shared context, and never send/publish without human
approval.

## What LoanOS is, in one paragraph

LoanOS India is an India-only, multi-tenant SaaS lending operating system for
RBI-regulated entities. It unifies loan origination (LOS), loan management (LMS),
loan workflow (LWS), and a compliance/AI-governance control plane, so that
**regulatory evidence is produced while the business runs, not reconstructed
afterwards**. Lending policy and AI guardrails are evaluated by a per-tenant,
fail-closed, byte-replayable decision engine that is also the enforcement point
for the RBI-ready AI kill switch.

## Source-of-truth documents (do not contradict these)

- Product scope: [`../product/what-we-are-building.md`](../product/what-we-are-building.md)
- Backlog: [`../product/build-backlog.md`](../product/build-backlog.md)
- Roadmap: [`../product/roadmap.md`](../product/roadmap.md)
- Capability catalog: [`../product/complete-system-capability-catalog.md`](../product/complete-system-capability-catalog.md)
- Regulatory register: [`../compliance/india-regulatory-register.md`](../compliance/india-regulatory-register.md)
- Architecture / tenancy: [`../architecture/saas-tenancy-and-operating-model.md`](../architecture/saas-tenancy-and-operating-model.md)

If any GTM claim conflicts with these, the source-of-truth document wins and the
GTM asset must be corrected.
