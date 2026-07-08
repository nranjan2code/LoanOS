# ADR 0001: India-Only Compliance-First Foundation

## Status

Accepted.

## Context

LoanOS India is being built from a blank workspace as a regulated lending platform for India. The platform must support LOS, LMS, LWS, and compliance operations. The first product direction is India-only and RBI-compliant.

RBI Digital Lending Directions, 2025 are the current digital-lending anchor. AI/model kill-switch design is included because the RBI model-risk direction of travel is clear, even though the June 24, 2026 model-risk guidance found during research is draft/public consultation as of July 8, 2026.

## Decision

The first executable foundation must be compliance-first, not UI-first.

We will start with:

- Regulatory control catalog.
- India-only lending gates.
- KFS and sanction-readiness gates.
- Fund-flow controls.
- Data-residency controls.
- Aadhaar prohibited-storage checks.
- AI model inventory and kill switch.
- File-backed API for local demonstration and tests.

We will not begin with a borrower-facing UI or a generic lending workflow until these controls are executable.

## Consequences

Positive:

- Unsafe flows are blocked early.
- Future UI/API work can reuse the same compliance kernel.
- Compliance evidence is designed into the domain model.
- RBI AI/model-risk readiness is not bolted on later.

Tradeoffs:

- The first slice is not a complete product.
- There is no production database, auth, UI, or integrations yet.
- Product velocity may feel slower at first, but later modules will have clearer guardrails.

## Review Triggers

Revisit this decision if:

- The platform expands outside India.
- RBI finalizes model-risk guidance with materially different requirements.
- A regulated entity requires a different deployment or data-residency model.
- Legal/compliance review changes interpretation of key control families.

