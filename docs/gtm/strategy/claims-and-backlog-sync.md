# Claims ↔ Backlog Sync (Proof Matrix)

This is the **contract between GTM and Product**. Every externally-facing claim
must appear here with a status and evidence. Sales and Marketing may only assert
`Built` claims as present-tense capability. `Partial` claims are sold as "first
slice / governed boundary." `Roadmap` claims are sold as future direction only.

**Machine-checked.** [`../automation/gtm-backlog-sync.mjs`](../automation/gtm-backlog-sync.mjs)
parses this file. Rules it enforces:

- Every claim row has an ID `C-NN`, a `Status` of exactly `Built | Partial | Roadmap`,
  and a non-empty `Evidence` cell.
- `Built` and `Partial` claims must cite evidence (source doc / capability / endpoint).
- Referenced source docs must exist on disk.

Run it before shipping any new campaign or deck:

```bash
node docs/gtm/automation/gtm-backlog-sync.mjs
```

## Status legend

| Status | May be sold as | Example phrasing |
| --- | --- | --- |
| Built | Present capability | "LoanOS enforces KFS before any contract executes." |
| Partial | First slice / governed boundary | "LoanOS ships a governed CERSAI submission slice; certified live gateway is on the roadmap." |
| Roadmap | Direction only | "Enterprise SSO/SAML is on our roadmap." |

## Claim matrix

| ID | Marketing claim | Status | Evidence |
| --- | --- | --- | --- |
| C-01 | Non-India / non-INR loans are blocked | Built | what-we-are-building.md India-only boundary; preflight checks |
| C-02 | KFS must be disclosed and accepted before a contract executes | Built | roadmap.md Phase 1; KFS gate + sanction readiness |
| C-03 | Disbursement/repayment cannot route through an LSP pass-through account | Built | what-we-are-building.md direct fund-flow checks |
| C-04 | Aadhaar biometric/OTP/PID is never stored | Built | what-we-are-building.md Aadhaar prohibited-storage checks |
| C-05 | Every state change is sealed into a per-tenant tamper-evident SHA-256 hash chain | Built | roadmap.md S4; audit spine + /audit/export |
| C-06 | An integrity-attested evidence pack can be exported per tenant | Built | roadmap.md S4; GET /audit/export |
| C-07 | Cross-tenant read/write is impossible by construction and proven in CI | Built | roadmap.md S3; cross-tenant isolation suite |
| C-08 | Optional Postgres storage isolates tenant data with Row-Level Security | Built | what-we-are-building.md postgres driver; db/schema.sql |
| C-09 | Any AI model can be blocked instantly by a model-scoped or global kill switch | Built | roadmap.md Phase 5; packages/core model-governance |
| C-10 | Model approval requires independent-validation evidence and an independent approver | Built | roadmap.md Phase 5 validation gate |
| C-11 | Drift breaching a model threshold auto-trips a model-scoped kill switch | Built | roadmap.md Phase 5 drift monitoring |
| C-12 | Generative models require adversarial (red-team) and hallucination-testing evidence to validate | Built | roadmap.md Phase 5 generative gate |
| C-13 | Clearing a kill switch requires a recorded post-incident review | Built | roadmap.md Phase 5 exit criteria |
| C-14 | Credit policy is evaluated by a per-tenant, fail-closed decision engine | Built | AGENTS.md rules/ engine; INV-5 fail-closed |
| C-15 | Policy bundles are content-hashed, four-eyes-approved, and ed25519-signed | Built | what-we-are-building.md decision engine section |
| C-16 | Money math uses exact decimal arithmetic (no float) | Built | AGENTS.md INV-6; clippy float-deny gate |
| C-17 | Any decision replays byte-identically from its audit record | Built | AGENTS.md INV-1/8/12 determinism |
| C-18 | Loan account balance can be reconstructed from immutable ledger events | Built | roadmap.md Phase 2 exit criteria |
| C-19 | Collections enforce RBI Fair Practices voice contact-hours | Built | roadmap.md Phase 2 collections gate |
| C-20 | Recovery agents must be empanelled (due diligence, training, code of conduct) before assignment | Built | what-we-are-building.md recovery-agent registry |
| C-21 | SMA/NPA asset classification and CIC-ready snapshots are generated from ledger state | Built | roadmap.md Phase 2 SMA/NPA |
| C-22 | DLG arrangements enforce a 5% portfolio cap, permitted forms, and an invocation window | Built | what-we-are-building.md DLG arrangements |
| C-23 | Co-lending arrangements reconcile partner shares to 100% with a retention floor and blended-rate disclosure | Built | what-we-are-building.md co-lending arrangements |
| C-24 | Account Aggregator consents run a requested→active→revoked/expired lifecycle with India residency | Built | what-we-are-building.md AA consents |
| C-25 | DPDP right-to-erasure is gated on statutory retention and fulfils by in-place redaction | Built | what-we-are-building.md erasure workflow |
| C-26 | DPDP access and correction requests run under a 30-day SLA clock | Built | what-we-are-building.md access/correction rights |
| C-27 | Grievance workflow runs a 30-day RBI clock with RBI CMS escalation evidence | Built | roadmap.md Phase 3 grievance |
| C-28 | Fraud cases pass a natural-justice gate (show-cause + response window, four-eyes classification) | Built | roadmap.md Phase 3 fraud workflow |
| C-29 | A disclosed sub-processor register with DPA + data-residency evidence is standing-disclosed to tenants | Built | roadmap.md S6 sub-processor register |
| C-30 | Incident notification tracks independent 6-hour CERT-In and RBI clocks with overdue detection | Built | roadmap.md S6 incident notification |
| C-31 | Platform-staff break-glass access is time-boxed, tenant-scoped, and sealed into the tenant's audit chain | Built | roadmap.md S6 break-glass |
| C-32 | A full tenant portability export (records + audit + documents) can be produced in a re-loadable format | Built | roadmap.md S5 export; GET /platform/tenants/:id/export |
| C-33 | Evidenced tenant offboarding purges the data plane, revokes keys, and retains a deletion attestation | Built | roadmap.md S5 offboarding |
| C-34 | CERSAI security-interest registration runs draft→filed→registered→modified→satisfied with a secured-loan disbursement gate | Partial | roadmap.md Phase 4; governed submission slice, live gateway roadmap |
| C-35 | FIU-IND STR/CTR FINnet reporting emits ARF/TRF/CRF XML with reconciled callbacks | Partial | roadmap.md Phase 4; governed FINnet slice, FINGate onboarding roadmap |
| C-36 | Bank-account verification blocks disbursement without verified active-account proof | Built | roadmap.md Phase 4 bank-account verification |
| C-37 | eSign success creates a tenant-scoped document-vault receipt with checksums and retention policy | Partial | roadmap.md Phase 4; certified eSign envelope onboarding roadmap |
| C-38 | NACH/UPI payment rail initiation stores masked/hash-only evidence with India residency | Partial | roadmap.md Phase 4; live settlement/reconciliation roadmap |
| C-39 | CIC reporting crosses a checksum/idempotency-bound provider adapter and reconciles signed callbacks | Partial | roadmap.md Phase 4; proprietary CIC certification remains external |
| C-40 | Enterprise IAM/SSO, admin maker-checker, deeper key management | Roadmap | what-we-are-building.md next build Epic 11 S5/S6 |
| C-41 | SOC 2 / ISO 27001 certification | Roadmap | roadmap.md S6 certification roadmap |
| C-42 | Sandbox environments enforce synthetic-only borrowers with mock integration overrides | Built | roadmap.md S5 sandbox environments |
| C-43 | Revolving credit / overdraft accounts with daily utilised-balance interest | Built | roadmap.md Phase 2 revolving/OD slice |
| C-44 | DLA registry exports active records in RBI CIMS-ready shape with compliance attestation | Built | what-we-are-building.md DLA registry |
| C-45 | Real provider readiness fails closed without current production certification, India residency, endpoint, and credential evidence | Built | architecture/provider-integration-governance.md; GET /integrations/readiness |

## Change process

1. Product ships/changes a capability → update the row's `Status` and `Evidence`.
2. New external claim proposed → add a row here **first**, then use it in assets.
3. CI/pre-campaign → run `gtm-backlog-sync.mjs`; fix any failure before shipping.
4. Quarterly → reconcile against `../product/build-backlog.md` and `roadmap.md`.
