# Shared Context for AI Agents (Canonical Facts)

**Every AI agent doing GTM work loads this file first.** It is the single source
of product truth for agents. If a fact isn't here or in the linked source docs, the
agent does **not** assert it. When this file and a `../product/` source doc
disagree, the source doc wins.

## Non-negotiable rule for agents

> Assert only `Built` capabilities as present-tense fact. Label `Partial` as "first
> slice / governed boundary." Label `Roadmap` as "on the roadmap." Never invent a
> capability, a metric, a customer, or a competitor fact. When unsure, say so or
> flag for human review.

Authoritative claim status: [`../strategy/claims-and-backlog-sync.md`](../strategy/claims-and-backlog-sync.md).

## What LoanOS is (canonical)

India-only, multi-tenant SaaS lending operating system for RBI-regulated entities
(banks, SFBs, payments banks in scope, co-operative banks, NBFCs, HFCs, AI-FIs).
Four planes — LOS, LMS, LWS, Compliance/AI OS — plus a per-tenant, fail-closed,
byte-replayable Rust decision engine that also enforces the AI kill switch.
Positioning: **compliance evidence produced while the loan runs.**

## Value pillars (with claim IDs agents may cite)

1. **Evidence in-flow** — C-01, C-02, C-03, C-04, C-05, C-06.
2. **Decisions you can replay** — C-14, C-15, C-16, C-17.
3. **AI under human command** — C-09, C-10, C-11, C-12, C-13.
4. **Foundation / RE outsourcing posture** — C-07, C-08, C-29, C-30, C-31, C-32, C-33.

## Persona one-liners (for tone matching)

- CCO → "Evidence for every disclosure, consent, and decision — exportable in minutes."
- CRO/Credit → "Credit policy as signed, replayable rules, with a kill switch over every model."
- CTO/InfoSec → "Isolation proven in CI, India-hosted, and a re-loadable exit."
- CEO → "Launch compliant lending products faster — compliance runs in the flow."
- Collections → "FPC contact-hours and empanelled agents enforced by construction."

## Hard boundaries agents must respect (anti-claims)

- Not RBI-certified / not "guaranteed compliant." Never say either.
- Not a global/multi-country platform. India-only is deliberate.
- Live certified integrations (CIC, FINnet, CKYC, live payment rails) are
  `Partial`/`Roadmap` — never "live."
- SOC 2 / ISO 27001 are `Roadmap`.
- Not a core banking system.
- Never claim to store Aadhaar; the product prohibits it.

## Approved vocabulary

enforce · gate · evidence · replay · fail-closed · tamper-evident · in-flow ·
governed boundary · India-hosted · RBI Digital Lending Directions 2025 · KFS ·
kill switch · byte-replayable · tenant isolation.

Avoid: "RBI certified," "guaranteed compliant," "fully automated compliance,"
hype adjectives without a proof point.

## Source-of-truth links (agents may read these)

- Product scope: `../product/what-we-are-building.md`
- Backlog: `../product/build-backlog.md`
- Roadmap: `../product/roadmap.md`
- Capability catalog: `../product/complete-system-capability-catalog.md`
- Regulatory register: `../compliance/india-regulatory-register.md`
- Positioning: `../strategy/positioning-and-messaging.md`
- ICP/personas: `../strategy/icp-and-personas.md`
- Claims matrix: `../strategy/claims-and-backlog-sync.md`

## Self-check every agent runs before returning output

1. Did I assert any capability not in the claims matrix as `Built`? → fix.
2. Did I label every `Partial`/`Roadmap` item correctly? → fix.
3. Did I invent any metric, customer, quote, or competitor fact? → remove or flag.
4. Is every claim attached to a proof point or clearly a roadmap statement?
5. Is the tone matched to the target persona?
