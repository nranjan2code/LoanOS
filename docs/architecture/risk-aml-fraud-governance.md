# Risk, AML, Fraud, and Model-Monitoring Control Plane

Status date: 2026-07-14

## Implemented scope

`packages/core/src/compliance/risk-aml-governance.js` provides a deterministic, tenant-scoped control layer for the institution's second-line risk work:

- Screening-list registration requires a SHA-256 content digest, provider/version lineage, India storage, current validity, evidence, and maker-checker approval. Ongoing CDD cannot complete without current UN-sanctions, UAPA, PEP, and internal-negative lists or without evaluating every mandatory family.
- Ongoing CDD records purpose/nature, source-of-funds and beneficial-ownership evidence, exact-paise expected versus observed activity, geography risk, match outcomes, the next review date, and an evidence checksum. Screening matches, material profile deviations, and high-risk geography fail to enhanced due diligence.
- Transaction-monitoring policy is approved data. Deterministic single-amount, daily-velocity, structuring, high-risk-geography, and counterparty-watchlist rules evaluate exact-paise transaction facts and emit restricted, checksum-bound AML alerts.
- Fraud policy weights device, IP, velocity, location, identity-link, bank-account, address, employer, negative-list, mule, and post-disbursement early-warning facts. The same inputs and policy version produce the same clear/refer/block result; refer and block outcomes require investigation.
- Portfolio snapshots aggregate exact-paise exposure by product, segment, geography, channel, partner, vintage, asset class, and connected group. Approved limits produce explicit breaches and require remediation. Stress scenarios compare deterministic basis-point losses with declared capital buffers and require management action on breach.
- RCSA records inherent risk, controls, derived residual risk, KRIs, exact-paise loss events, root causes, and actions. High residual risk cannot be recorded without an action.
- Recurring model reports bind active model/version lineage to cohort approval rates, bad-rate performance and drift thresholds. A breach requires remediation evidence.
- Risk-committee packs validate every referenced portfolio, stress, RCSA, model and AML record and seal the reference set with a checksum.

All mutation routes require a tenant administrator, security administrator, or operator; readback also permits auditors. Independent approvals are actor-bound at the HTTP boundary, every resource remains in the authenticated tenant partition, and every mutation is projected into the tenant audit chain.

## API surface

The route module `apps/api/src/routes/risk-aml-controls.js` exposes `GET /risk/controls` and creation endpoints under `/aml`, `/fraud`, `/risk`, and `/model-governance`. File and Postgres tenant-state persistence use the same registry fields, so the optional Postgres driver continues to apply RLS at the tenant-state boundary.

## Fail-closed boundaries

This is a governed evidence and decision layer, not a claim that LoanOS operates the institution's external intelligence or risk function. Production adoption still requires contracted and independently validated sanctions/PEP data feeds, screening matching/tuning and disposition operations, transaction ingestion and case investigation, device/network/link-analysis providers, fraud-loss and recovery operations, enterprise data warehouse feeds, board-approved risk appetite and stress methodology, capital-model validation, committee operation, and independent model-risk validation. Missing, expired, incomplete, mismatched, or unapproved evidence is rejected rather than treated as clear.

## Verification

`tests/risk-aml-governance.test.js` covers mandatory current-list rescreening, activity escalation, exact-paise transaction monitoring, restricted alerts, deterministic fraud scoring, portfolio/connected exposure limits, stress breaches, RCSA actions, recurring model reports, risk-pack lineage, and authenticated tenant API persistence.
