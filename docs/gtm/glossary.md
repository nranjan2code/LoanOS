# Glossary

Shared vocabulary so every human and AI agent reads a term the same way. When a
GTM asset uses a regulatory term, use it exactly as defined here. Product truth
lives in `../product/`; this is the plain-language index.

## Product & platform

| Term | Meaning |
| --- | --- |
| LoanOS India | India-only, multi-tenant SaaS lending operating system for RBI-regulated entities. |
| LOS | Loan Origination System — onboarding through sanction and disbursement readiness. |
| LMS | Loan Management System — the live loan account: ledger, repayment, servicing, collections, closure. |
| LWS | Loan Workflow System — routes human/operational work (maker-checker, exceptions, grievance, fraud). |
| Compliance / AI OS | The control plane: regulatory catalog, policy registry, DLA/LSP registries, model governance. |
| Decision engine | Per-tenant, fail-closed, byte-replayable Rust engine that evaluates lending policy + AI guardrails and enforces the kill switch. |
| Tenant | One contracting regulated entity; all its data lives inside a hard-isolated boundary. |
| Policy bundle | Content-hashed, four-eyes-approved, ed25519-signed package of lending/guardrail policy the engine evaluates. |
| Kill switch | Control that instantly blocks a model (model-scoped or global); runtime use stops fail-closed. |
| Audit hash chain | Per-tenant, append-only SHA-256 chain sealing every state change; tamper-evident and verifiable. |
| Evidence pack | Integrity-attested export of a tenant's audit evidence. |
| Break-glass | Time-boxed, tenant-scoped emergency access, sealed into the tenant's own audit chain. |
| Sandbox | Evaluation environment enforcing synthetic-only borrowers and mock integrations. |

## RBI / regulatory (India)

| Term | Meaning |
| --- | --- |
| RE (Regulated Entity) | Bank, SFB, payments bank, co-operative bank, NBFC, HFC, or AI-FI accountable to the RBI. |
| DLD 2025 | RBI Reserve Bank of India (Digital Lending) Directions, 2025 (dated 8 May 2025) — current source of truth for digital lending. |
| KFS | Key Facts Statement — mandatory pre-contract disclosure of fees, APR, penal charges, cooling-off, grievance path. |
| LSP | Lending Service Provider — a partner acting for the RE; must stay inside the RE's accountability boundary. |
| DLA | Digital Lending App/web surface (RE- or LSP-owned); reportable in RBI CIMS-ready form. |
| CIMS | RBI's Centralised Information Management System — reporting format for DLAs. |
| DLG | Default Loss Guarantee — capped (5% of portfolio) loss cover arrangement with an eligible LSP. |
| Co-lending | Arrangement where partners share a loan (shares sum to 100%) with a retention floor and a disclosed blended rate. |
| FPC | Fair Practices Code — includes recovery contact-hours limits enforced in collections. |
| V-CIP | Video-based Customer Identification Process; recordings must be India-stored. |
| CKYC | Central KYC registry. |
| CERSAI | Central Registry of Securitisation Asset Reconstruction and Security Interest — security-interest registration (SARFAESI). |
| FIU-IND / FINnet | Financial Intelligence Unit – India; FINnet is its reporting gateway (STR/CTR/CCR). |
| SMA / NPA | Special Mention Account / Non-Performing Asset — delinquency/asset classification stages. |
| CIC | Credit Information Company (credit bureau). |
| AA | Account Aggregator — consent-based financial-data sharing framework. |
| DPDP | Digital Personal Data Protection Act — consent, access, correction, erasure duties. |
| CERT-In | India's computer emergency response team; carries incident-notification duties (6-hour clock). |
| Cooling-off period | RBI-mandated window during which a borrower may exit a digital loan. |
| Penal charges | Charges for default, treated as charges — not penal interest — per RBI. |

## GTM / sales & marketing

| Term | Meaning |
| --- | --- |
| Claims discipline | Rule that every external claim maps to a Built/Partial/Roadmap row in the claims matrix. |
| Built / Partial / Roadmap | Claim maturity: live capability / first-slice governed boundary / future direction. |
| Proof point | The specific control, endpoint, ADR/INV ID, or claim ID that substantiates a claim. |
| Messaging house | Roof (promise) → pillars → proof band structure every asset inherits. |
| Pillar | One of: Evidence in-flow (P1), Replayable decisions (P2), AI under command (P3), + Foundation. |
| ICP | Ideal Customer Profile — firmographic fit definition. |
| Persona | A named buyer role (CCO, CRO, CTO, CEO, Collections, Auditor). |
| Champion / Economic buyer / Gatekeeper | Committee roles: internal seller / budget holder / approval blocker (e.g. InfoSec, procurement). |
| MEDDICC | Qualification framework (Metrics, Economic buyer, Decision criteria/process, Identify pain, Champion, Competition) + Compliance Trigger. |
| Trigger event | A dated forcing event (inspection, filing, launch, mandate, leadership hire) that creates urgency. |
| Multi-thread | Engaging ≥3 committee roles (Champion + technical + economic buyer) — not single-threading on the champion. |
| Battlecard | Head-to-head guide vs. an alternative (build / point tools / do nothing / vendor). |
| Human-in-the-loop | Mandatory human approval checkpoint before any outbound/public/committal action. |
| CSM | Customer Success Manager — owns post-sale value, health, renewal, and expansion for an account. |
| Onboarding | Standing up a new tenant via the platform wizard through to first value and go-live. |
| First value | The moment a customer traces one compliant loan end-to-end and exports one evidence pack. |
| QBR | Quarterly Business Review — proves compliance value against the customer's discovery success criteria. |
| Health score | 0–12 score across six dimensions; sponsor/value at 0 caps the band at yellow. |
| Expansion | Growing an account by enabling more gated modules or more of the RE's lending. |
| Renewal readiness gate | A renewal is not "safe" unless health is green, value is proven, and there's no expectation gap. |
| Voice-of-customer (VoC) | Retention/adoption learnings routed to the product backlog — closes the cycle. |

## Anti-terms (never use as live claims)

"RBI certified", "guaranteed compliant", "fully automated compliance",
"bank-grade" (as a boast), any `Partial`/`Roadmap` capability described as
production/live. See `strategy/claims-and-backlog-sync.md` and `brand/brand-guide.md`.
