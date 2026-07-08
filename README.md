# LoanOS India

LoanOS India is a greenfield loan and lending operating system for India. The platform scope covers:

- LOS: loan origination, onboarding, KYC, eligibility, pricing, offer, KFS, sanction, document execution.
- LMS: repayment schedules, servicing, statements, collections, restructuring, NPA signals, write-off/settlement workflows.
- LWS: workflow orchestration for humans, vendors, regulated entities, exceptions, approvals, and audit.
- Compliance OS: India-only regulatory controls, evidence trails, data residency, model governance, and AI kill-switch operations.

This first slice is intentionally compliance-first. It gives us a runnable domain kernel and API that reject non-India lending flows, unsafe fund flows, missing KYC/economic profile, missing KFS disclosures, weak data-residency posture, and disabled AI models.

## Regulatory Stance

The source of truth for current digital lending is the RBI `Reserve Bank of India (Digital Lending) Directions, 2025`, dated May 8, 2025. The older September 2, 2022 digital lending circular is treated as repealed for new design work.

The AI kill-switch requirement is included as a hard platform control. As of July 8, 2026, the RBI model-risk guidance found during research is a June 24, 2026 draft/public-consultation item, not a final circular. We still implement it as a mandatory design constraint because the platform must be ready for RBI-supervised model risk management.

## Current Executable Slice

```bash
npm test
npm run dev:api
```

The API uses a local JSON store under `.loanos-data/` by default. Set `LOANOS_DATA_DIR` to use another location.

Useful endpoints:

- `GET /health`
- `GET /compliance/controls`
- `GET /regulated-entities`
- `POST /regulated-entities`
- `GET /regulated-entities/:id`
- `GET /products`
- `POST /products`
- `GET /products/:id`
- `GET /borrowers`
- `POST /borrowers`
- `GET /borrowers/:id`
- `GET /borrowers/:id/consents`
- `POST /borrowers/:id/consents`
- `GET /borrowers/:id/kyc-records`
- `POST /borrowers/:id/kyc-records`
- `GET /staff/actors`
- `POST /staff/actors`
- `GET /staff/actors/:id`
- `GET /complaints`
- `POST /complaints`
- `GET /complaints/:id`
- `POST /complaints/:id/assignments`
- `POST /complaints/:id/reviews`
- `POST /complaints/:id/resolution`
- `POST /complaints/:id/rbi-cms-escalation`
- `POST /ai/models`
- `POST /ai/kill-switch`
- `POST /ai/kill-switch/clear`
- `GET /workflow/tasks`
- `GET /workflow/tasks/:id`
- `POST /workflow/tasks/:id/assignments`
- `POST /workflow/tasks/:id/start`
- `POST /workflow/tasks/:id/release`
- `POST /workflow/tasks/:id/comments`
- `POST /loans/applications`
- `GET /loans/applications/:id`
- `POST /loans/applications/:id/kfs`
- `POST /loans/applications/:id/decision`
- `POST /loans/applications/:id/human-reviews`
- `POST /loans/applications/:id/approvals`
- `POST /loans/applications/:id/disbursement`
- `GET /loan-accounts`
- `GET /loan-accounts/:id`
- `GET /loan-accounts/:id/schedule`
- `GET /loan-accounts/:id/statement`
- `GET /loan-accounts/:id/delinquency`
- `GET /loan-accounts/:id/asset-classification`
- `GET /loan-accounts/:id/cic-snapshot`
- `GET /reporting/cic/snapshots`
- `POST /loan-accounts/:id/recovery-assignments`
- `POST /loan-accounts/:id/charges`
- `POST /loan-accounts/:id/payments`
- `POST /loan-accounts/:id/cash-recoveries`
- `POST /loan-accounts/:id/waivers`
- `POST /loan-accounts/:id/reversals`

## Build Principles

- India only: INR, India-resident borrowers, India-hosted primary systems, India-specific regulatory workflows.
- Regulated-entity boundary first: a bank/NBFC/HFC/co-operative/AI-FI remains accountable for LSP/DLA/vendor actions.
- No pass-through fund control by LSPs: disbursement and repayment flows must be direct as permitted by RBI directions.
- KFS before contract: fees, APR, penal charges, cooling-off and grievance details must be disclosed before execution.
- Human command over AI: every credit-impacting model must be inventoried, validated, monitored, reviewable, and kill-switchable.
- Evidence by design: every decision, consent, model use, override, document, and exception must leave an audit trail.

## Design Docs

- [Documentation index](/Users/nisheethranjan/Projects/AIBank/docs/README.md)
- [What we are building](/Users/nisheethranjan/Projects/AIBank/docs/product/what-we-are-building.md)
- [Build backlog](/Users/nisheethranjan/Projects/AIBank/docs/product/build-backlog.md)
- [India regulatory register](/Users/nisheethranjan/Projects/AIBank/docs/compliance/india-regulatory-register.md)
- [Compliance build checklist](/Users/nisheethranjan/Projects/AIBank/docs/compliance/compliance-build-checklist.md)
- [LoanOS architecture blueprint](/Users/nisheethranjan/Projects/AIBank/docs/architecture/loanos-india-blueprint.md)
- [Current implementation map](/Users/nisheethranjan/Projects/AIBank/docs/architecture/current-implementation.md)
- [Product roadmap](/Users/nisheethranjan/Projects/AIBank/docs/product/roadmap.md)

## Current Status

Phase 0 has a working executable foundation:

- Compliance control catalog.
- Regulated entity registry with board-policy and grievance-officer gates.
- Product policy registry with pricing, KFS, eligibility, cooling-off, and penal-charge gates.
- Registry-backed loan application resolution through `regulatedEntityId` and `productId`/`productCode`.
- Borrower profile registry with India-only and economic-profile checks.
- Consent ledger for DPDP-style purpose/notice/evidence records.
- KYC record registry with V-CIP India-storage and Aadhaar prohibited-storage checks.
- Staff actor registry with India-only operational actors, roles, queue access, and assignment authority.
- Complaint registry and grievance workflow with 30-day RBI Ombudsman clock and RBI CMS escalation evidence.
- Borrower-backed application resolution through `borrowerId`.
- LOS application workflow state machine for preflight, KFS, decision proposal, human review, maker-checker approval, and disbursement.
- LWS task queues derived from LOS/LMS state, with SLA metadata, role checks, assignment, start, release, and comment audit.
- LMS loan account creation on disbursement with repayment schedule, ledger, balance summary, and payment posting.
- LMS borrower statement generation plus disclosed-charge, waiver, and reversal ledger controls.
- LMS delinquency buckets, noticed recovery-agent assignment, and same-day cash recovery posting.
- LMS SMA/NPA asset classification and CIC-ready reporting snapshots from account state.
- India-only loan application preflight.
- KFS generation and sanction readiness checks.
- LSP/pass-through fund-flow rejection.
- Aadhaar prohibited-storage checks.
- AI model inventory, model kill switch, global kill switch, and model-use guard.
- File-backed API for local development.
- Automated tests proving the first compliance gates.
