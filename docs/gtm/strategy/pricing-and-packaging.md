# Pricing & Packaging

> Pricing here is a **GTM framework**, not an approved rate card. Final numbers
> require Finance/Founder sign-off. Package **boundaries** are anchored to the
> product's real module entitlement model so we never sell a package the product
> cannot gate.

## Packaging follows the product's module model

The platform already gates capabilities per tenant via `onboarding.enabledModules`
(opt-out by default; a platform admin can narrow it). Named module gates in the
product today:

- `ai_governance` → gates `/ai/*`
- `collections` → gates `/recovery-agents*`
- `marketplace` → gates `/loans/marketplace-offers*`
- `dlg` → gates `/dlg-arrangements*`
- `co_lending` → gates `/co-lending-arrangements*`
- `integrations` → gates `/integrations/*` and `/account-aggregator/*`

Packaging maps to these gates so entitlement is enforced in software, not on a
contract PDF.

## Editions

### Core — "Compliant lending, end to end"
LOS + LMS + LWS + Compliance OS foundation. Borrower onboarding, KYC/consent,
product policy, KFS, sanction, disbursement readiness, loan account/ledger,
statements, delinquency, grievance workflow, and the per-tenant audit spine +
evidence export. Multi-tenant isolation and tenant lifecycle included.

*Always includes the non-negotiables:* India-only boundary, fund-flow guard,
KFS-before-contract, data residency, tamper-evident audit.

### Core + AI Governance (`ai_governance`)
Adds model inventory, governed lifecycle with independent-validation gate,
model/global kill switch, drift auto-trip, generative adversarial/hallucination
gate, customer-facing AI disclosure + human handoff. **Recommended default** for
any RE using scorecards or GenAI in the credit path — and increasingly a board/
RBI expectation.

### Core + Distribution (`dlg`, `co_lending`, `marketplace`)
For REs with LSP/partner distribution: Default Loss Guarantee arrangements (5%
portfolio cap, permitted forms, invocation window), co-lending arrangements
(100% share reconciliation, retention floor, blended-rate disclosure), and
marketplace offers.

### Core + Integrations (`integrations`)
Account Aggregator consents, bank-account verification, payment rails (NACH/UPI),
communications (SMS/email/WhatsApp), and the external-service provider boundary.

### Enterprise / Dedicated
Dedicated data plane (vs. pooled default), enhanced onboarding approvals,
enterprise IAM/SSO (roadmap), priority vendor-posture/BCP-DR pack, and a
white-glove onboarding + exit guarantee.

## Value metric options (pick one to test)

| Metric | Pros | Cons |
| --- | --- | --- |
| Per active loan account / month | Aligns to value & LMS scale | Needs volume forecast; discounting at scale |
| Per originated loan (LOS) | Aligns to growth motion | Volatile month to month |
| Platform fee + module tiers + usage | Predictable base, expansion via modules | More line items to explain |
| Per regulated entity / per DLA | Simple for multi-entity groups | Weak link to usage |

**Recommended starting model:** annual platform fee (by RE tier) + per-module
uplift (AI Governance, Distribution, Integrations) + volume-banded usage on
active loan accounts. Dedicated data plane priced as an Enterprise uplift.

## Pricing levers & guardrails

- **Discount authority:** define floor by edition; require approval below floor.
- **Do not discount AI Governance to zero** — it anchors the compliance-first
  story and is the stickiest module.
- **Onboarding / implementation fee:** one-time, scaled by module count and
  dedicated-vs-pooled. Reflects the managed onboarding wizard + RE/product seeding.
- **Sandbox** environments (synthetic-only) can be offered free during evaluation
  to de-risk the buy — the product already supports sandbox provisioning/reset.

## Commercial proof points that justify price

- Exit is a feature: reproducible portability export → "no lock-in" removes a
  procurement objection and supports a premium.
- Evidence-as-export → quantify the buyer's current cost of assembling audit
  evidence manually; price against that avoided cost.
- Kill switch + fail-closed → price against the tail risk of an unblockable
  model incident.

## What NOT to do

- Do not sell a module the tenant's entitlement model cannot gate.
- Do not bundle roadmap integrations into Core pricing as if live-certified.
- Do not offer perpetual/on-prem — the delivery model is India-hosted SaaS with
  optional dedicated data plane.
