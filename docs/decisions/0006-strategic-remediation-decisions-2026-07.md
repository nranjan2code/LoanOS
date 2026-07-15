# ADR 0006: Strategic Remediation decisions (July 2026)

- Status: Accepted
- Date: 2026-07-15
- Supersedes: no prior decision
- Extends: ADR 0001, ADR 0002, ADR 0003

## Context

Following a comprehensive product, compliance, and codebase review of the LoanOS lending platform, several strategic questions requiring owner decisions were raised under findings tracker `docs/product/review-findings-2026-07-12.md`. These questions span decision-engine deployment modes, microfinance scopes, credit insurance modeling, and market positioning. 

## Decision

To align the product direction, the following strategic decisions are accepted and formalized:

### 1. Decision Engine Deployment (REV-14)
* **Decision:** We commit to immediately wiring the Rust decision engine to `shadow` mode in all development and staging environments. We will run a clean divergence window check to ensure trace parity with the JavaScript evaluator. Additional Phase 6+ engine development (complex multi-stage partitioning) is paused, and capacity is redirected to live integrations and core lending breadth.

### 2. Microfinance (MFI) Scope (REV-33)
* **Decision:** Joint Liability Group (JLG) loan models, household income caps, and aggregate FOIR limits across multiple lenders (under the RBI Microfinance Directions 2022) are declared **out-of-scope (Non-Goals)** for the core individual lending platform. Appending MFI to the non-goals prevents custom schema pollution and keeps the core domain focused.

### 3. Credit Insurance Modeling (REV-43)
* **Decision:** Credit insurance is modeled explicitly as a **configurable product add-on** with mandatory Key Fact Statement (KFS) fee disclosure. The borrower must have explicit opt-in and opt-out options, and the premium is treated as an optional charge component rather than an implicit APR markup.

### 4. Market Positioning (REV-80)
* **Decision:** We position LoanOS India as the **"compliance and AI-governance control plane for digital lending,"** highlighting the immutable audit spine, live kill switch, DLG/co-lending correctness, and deterministic rules engine. LoanOS is sold as a compliance-first gatekeeper, with reference LOS/LMS/LWS engines included as standard extensions.

### 5. Beachhead Market (REV-81)
* **Decision:** The beachhead market is NBFCs, cooperative banks, and fintech-LSP+RE partnerships. turnkey regulatory conformance and out-of-the-box auditability are prioritized over custom enterprise workflows.

### 6. Product Focus (REV-82)
* **Decision:** Prioritize taking **unsecured personal term-loans** and **MSME term-loans** genuinely deep and live first. We focus on completing end-to-end integration and regulatory conformance for these two archetype profiles before expanding product breadth.

## Consequences

* The product documentation (`what-we-are-building.md` and `roadmap.md`) will be updated to reflect these boundaries.
* GTM materials and technical sales focus will lead with compliance/auditability evidence rather than generic feature sets.
* Product development will prioritize live provider adapters (CKYC, CIC, eSign, NACH) matching the beachhead requirements.
