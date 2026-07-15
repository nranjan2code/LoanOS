# Demo Script

A compliance-led demo. The narrative is **"watch compliance evidence being
produced as the loan runs."** Every click ends on an artifact of evidence. Tie
each beat to a `Built` claim (IDs from `../strategy/claims-and-backlog-sync.md`).

## Pre-demo (do not skip)

- Follow the [synthetic demo operator handbook](../../operations/demo-handbook.md)
  for release, health, credentials, journey, evidence, rollback and teardown
  checks. Use the preconfigured `dev` showcase tenant for a dependable broad
  demonstration. Use a `workshop-*` tenant only when live tenant configuration
  is part of the agreed narrative.
- Confirm the persona-owned pain from discovery — open on it.
- Load a sandbox tenant (synthetic borrowers only). Never demo on a real tenant.
- Have the claims-sync matrix open; if asked "is this live?", answer honestly.
- Decide the 2–3 beats that map to *their* pain; do not run all seven.
- Confirm that a workshop tenant has its own tenant-bound business engine
  before any decision execution. Never reuse the showcase engine.

## Opening (2 min)

> "In discovery you told me [their pain — e.g. audit evidence takes weeks across
> systems]. I'm going to show you the same loan you run today, but watch what
> happens to the evidence at each step — it's produced in the flow, and it's
> exportable. I'll stop wherever you want to go deeper."

## Beat 1 — Onboarding, consent, KYC (C-04, C-24, C-26)
Show borrower onboarding → consent + DPDP notice captured to the ledger → KYC with
V-CIP India-storage and **Aadhaar prohibited-storage** enforced.
> "Consent isn't a checkbox — it's a ledgered, timestamped evidence record. And the
> system refuses to store Aadhaar artefacts by construction."

## Beat 2 — Eligibility & the decision engine (C-14, C-15, C-16, C-17)
Run eligibility → refer/deny band routes to human review. Explain the per-tenant,
fail-closed engine; signed policy bundles; exact-decimal math.
> "This decision just replayed byte-for-byte from its audit record. Your policy is
> signed, versioned data — not scattered if-statements — and any error lands on
> refer/deny, never a permissive default."

## Beat 3 — KFS before contract (C-02)
Attempt to move toward sanction without KFS → **blocked**. Then generate KFS,
disclose, accept → sanction readiness unlocks.
> "No contract executes before the Key Facts Statement is disclosed and accepted.
> That's a gate, not a guideline."

## Beat 4 — Fund-flow guard & disbursement (C-03, C-36)
Attempt disbursement via an LSP pass-through / unverified account → **blocked**.
Show verified-account proof → disbursement proceeds.
> "Disbursement can't route through an LSP pass-through account, and it won't fire
> without verified active-account proof."

## Beat 5 — AI kill switch (C-09, C-11, C-13)
Show model inventory → trip a model kill switch (or a drift auto-trip) → model-
dependent decisions degrade to manual review → clearing requires post-incident
review.
> "Any model, blocked instantly, fail-closed. Drift trips it automatically, and you
> can't just switch it back on — clearing needs a recorded post-incident review."

## Beat 6 — Evidence export (C-05, C-06, C-32)
Export the per-tenant, integrity-attested evidence pack. Show the hash chain
validity check.
> "This is the 'audit is a fire drill' problem gone. One export, tamper-evident,
> independently verifiable. And your full tenant export is re-loadable — exit is a
> feature, not a hostage situation."

## Beat 7 (for LMS/collections buyers) — Servicing & collections (C-18, C-19, C-20, C-21)
Show ledger reconstruction, a collections reminder blocked outside FPC contact-
hours, empanelled-agent enforcement, and automatic SMA/NPA classification.

## Honesty beats (say these unprompted when relevant)

- CERSAI / FINnet / eSign / payment rails: "This is a governed submission slice
  with the certified live gateway on our roadmap — here's exactly where the
  boundary is." (C-34/35/37/38)
- SOC 2 / ISO: "Roadmap. Here's our vendor-posture pack and sub-processor register
  in the meantime." (C-41)

## Close

> "You saw evidence produced at every step and exported in one action, and a model
> stopped instantly and safely. Which of these maps most directly to the pain you
> opened with — and who else on your side needs to see it?"

Advance = schedule the security/InfoSec session and a sandbox eval. Capture next
steps in CRM.

## Demo don'ts

- Don't demo on real/production data.
- Don't click into a `Partial`/`Roadmap` area and imply it's live.
- Don't run all seven beats — depth on their pain beats breadth.
