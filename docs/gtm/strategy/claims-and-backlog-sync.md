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
| C-40 | Enterprise IAM/SSO, admin maker-checker, deeper key management | Partial | architecture/enterprise-security-and-scale.md; live IdP/KMS remains deployment-specific |
| C-41 | SOC 2 / ISO 27001 certification | Roadmap | roadmap.md S6 certification roadmap |
| C-42 | Sandbox environments enforce synthetic-only borrowers with mock integration overrides | Built | roadmap.md S5 sandbox environments |
| C-43 | Revolving credit / overdraft accounts with daily utilised-balance interest | Built | roadmap.md Phase 2 revolving/OD slice |
| C-44 | DLA registry exports active records in RBI CIMS-ready shape with compliance attestation | Built | what-we-are-building.md DLA registry |
| C-45 | Real provider readiness fails closed without current production certification, India residency, endpoint, and credential evidence | Built | architecture/provider-integration-governance.md; GET /integrations/readiness |
| C-46 | External audit-anchor evidence must match the verified tenant chain head and event count | Partial | architecture/data-governance.md; production TSA/WORM service remains deployment-specific |
| C-47 | Evidence custody enforces India storage, retention, legal holds, and proof-bearing deletion | Built | architecture/data-governance.md; /governance/evidence APIs |
| C-48 | Critical data-quality failures block maker-checker certification | Partial | architecture/data-governance.md; enterprise catalogue/stewardship remains deployment depth |
| C-49 | Tenant federation requires MFA, domain/group policy and independently tested metadata before activation | Partial | architecture/enterprise-security-and-scale.md; live token validation remains deployment-specific |
| C-50 | Idempotent SCIM deactivation immediately removes a federated user's effective access | Partial | architecture/enterprise-security-and-scale.md; live SCIM connector remains deployment-specific |
| C-51 | Database and backup readiness resolve India-region, HSM-backed, purpose-attested managed keys | Partial | architecture/enterprise-security-and-scale.md; direct KMS/HSM operation remains deployment-specific |
| C-52 | PostgreSQL HA and PITR readiness requires multi-AZ synchronous topology, WAL, immutable custody, RPO/RTO and restore evidence | Partial | architecture/enterprise-security-and-scale.md; managed database operation remains deployment-specific |
| C-53 | Published APIs, events and webhooks are checksum, schema, tenancy, ordering, idempotency, retry and dead-letter governed | Partial | architecture/enterprise-security-and-scale.md; dispatch/queue runtime remains deployment-specific |
| C-54 | Production automation readiness fails closed without supply-chain, migration, rollback, drift, HA/PITR and capacity dependencies | Partial | architecture/enterprise-security-and-scale.md; cloud rollout execution remains deployment-specific |
| C-55 | Ongoing CDD requires current UN, UAPA, PEP and internal-negative lists and complete rescreening | Partial | architecture/risk-aml-fraud-governance.md; production list feeds and matching operations remain external |
| C-56 | Exact-paise transaction-monitoring rules emit checksum-bound, tipping-off-restricted AML alerts | Partial | architecture/risk-aml-fraud-governance.md; live ingestion and investigation operations remain deployment-specific |
| C-57 | Versioned fraud policy deterministically scores device, identity, duplicate, negative-list, mule and early-warning facts | Partial | architecture/risk-aml-fraud-governance.md; intelligence providers and investigation tooling remain external |
| C-58 | Portfolio snapshots enforce connected exposure and concentration limits and run exact-paise stress scenarios | Partial | architecture/risk-aml-fraud-governance.md; bank data feeds and approved methodology remain institutional |
| C-59 | RCSA evidence connects controls, KRIs, loss events, root causes and mandatory high-risk actions | Partial | architecture/risk-aml-fraud-governance.md; institution-wide operation remains deployment-specific |
| C-60 | Recurring model reports bind cohort fairness, bad rate and drift to an active model version | Partial | architecture/risk-aml-fraud-governance.md; independent validation and source certification remain institutional |
| C-61 | Risk-committee packs validate source records and seal their evidence references | Partial | architecture/risk-aml-fraud-governance.md; board/committee operation remains institutional |
| C-62 | Implementation projects bind an approved configuration checksum, source scope, roles, freeze time and rollback plan | Partial | architecture/implementation-migration-go-live.md; customer discovery and execution remain external |
| C-63 | Migration evidence reconciles source counts and exact-paise control totals and blocks unresolved cleansing or rejects | Partial | architecture/implementation-migration-go-live.md; source ETL remains customer/vendor execution |
| C-64 | Opening balances compare principal, interest, fees, ledger totals, installments and schedule checksums account by account | Partial | architecture/implementation-migration-go-live.md; production source extraction remains external |
| C-65 | Parallel run requires five days of exact finance, regulatory and portfolio reconciliation | Partial | architecture/implementation-migration-go-live.md; bank operating execution remains institutional |
| C-66 | UAT covers product, role, exception and regulatory controls while severe defects block and role training expires | Partial | architecture/implementation-migration-go-live.md; customer testing and training delivery remain external |
| C-67 | Go-live readiness joins migration, balances, parallel run, UAT, role training, DR, security, providers and three-function sign-off | Partial | architecture/implementation-migration-go-live.md; production switching remains external |
| C-68 | Cutover records five controlled steps, requires rollback proof on failure, and gates hypercare exit on time, severity and SLA | Partial | architecture/implementation-migration-go-live.md; command-centre operation remains external |
| C-69 | Lending programmes bind an RE to approved products, operating units, channels, segments, exact-paise limits and effective dates | Partial | architecture/institutional-operations.md; organisation-master and commercial operation remain deployment-specific |
| C-70 | Regulatory applicability determines canonical controls and drives owner/reviewer/evidence-bound obligation calendars | Partial | architecture/institutional-operations.md; regulatory-content feeds and scheduling workers remain external |
| C-71 | Configurable workflow cases pin a reachable state-machine version and enforce role, evidence, condition and four-eyes transitions | Partial | architecture/institutional-operations.md; BPMN UI, timer workers and definition migration remain planned |
| C-72 | Approval matrices resolve exact-paise amount, product, risk and deviation facts to roles, approval count and unanimity | Partial | architecture/institutional-operations.md; institution delegated-authority administration remains external |
| C-73 | Workforce policy retains capacity, leave substitution, queue escalation and balancing rules | Partial | architecture/institutional-operations.md; HR feeds and runtime routing remain deployment-specific |
| C-74 | Bulk task plans are idempotent, checksum-bound, capped at 100 and require separate approval above 25 | Partial | architecture/institutional-operations.md; transactional task execution remains planned |
| C-75 | India business-calendar pause policy and versioned exception taxonomy retain root cause, ownership and remediation SLA | Partial | architecture/institutional-operations.md; runtime timer application and analytics remain planned |
| C-76 | Branch and approved channel intake fails closed on identity scope, partner authority, programme/product eligibility, territory and PIN serviceability | Partial | architecture/customer-channel-experiences.md; application-layer partner/unit scope is built, while database RLS and access certification remain |
| C-77 | Lead contact matching surfaces open leads and known customers without silently merging or converting them | Partial | architecture/customer-channel-experiences.md; probabilistic identity resolution and downstream reconciliation remain planned |
| C-78 | Every lead action retains actor, reason and evidence while channel users remain outside credit approval and fund flow | Partial | architecture/customer-channel-experiences.md; end-to-end application conversion orchestration remains planned |
| C-79 | Customer party relationships, accessibility/contact intent, succession restrictions and exact related exposure join into customer-360 | Partial | architecture/customer-channel-experiences.md; transactional merge and full servicing actions remain planned |
| C-80 | Tenant-branded channel workspace is accessible, installable and caches only its static shell—not customer or lead API data | Partial | architecture/customer-channel-experiences.md; production assistive/device certification and encrypted field-offline queues remain planned |
| C-81 | Converted-lead commission is calculated in exact paise, independently approved, payment-reconciled and clawed back only inside policy | Partial | architecture/customer-channel-experiences.md; invoice/GST/TDS/GL/bank-file/dispute depth remains planned |

## Change process

1. Product ships/changes a capability → update the row's `Status` and `Evidence`.
2. New external claim proposed → add a row here **first**, then use it in assets.
3. CI/pre-campaign → run `gtm-backlog-sync.mjs`; fix any failure before shipping.
4. Quarterly → reconcile against `../product/build-backlog.md` and `roadmap.md`.
