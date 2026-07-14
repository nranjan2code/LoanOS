# Product Roadmap

## Review-Driven Remediation (2026-07-12)

A deep product/design/applicability review (LOS · LWS · LMS · compliance/AI plane · decision engine),
plus a code-level trace of the decision engine, produced a consolidated set of discoveries and
recommendations. The **authoritative, trackable list is
[`review-findings-2026-07-12.md`](review-findings-2026-07-12.md)** (stable `REV-n` IDs, priority, status,
evidence, acceptance). This section is a rollup only — update status in the tracker, not here.

| WS | Theme | Priority | Lead items |
| --- | --- | --- | --- |
| A | Documentation alignment | P0 | REV-01/02 done; REV-03 (single source of truth for engine status) |
| B | Decision engine: real, proven, multi-tenant | P1 | REV-10 gateway tests, REV-11 CI service lane, REV-12 per-tenant routing, REV-13 reason lineage, REV-14 wire-vs-pause **decision** |
| C | Live-path correctness | P1 | REV-20 exact money math, REV-21 NPA upgrade rule |
| D | Credit depth | P1 | REV-30 multi-bureau, REV-31 AA→income/FOIR, REV-32 bureau obligations, REV-33 MFI **decision** |
| E | Product breadth & India tax | P1–P2 | REV-40 multi-structure, REV-41 revolving/OD, and REV-42 GST done; REV-43 insurance decision |
| F | LWS recovery depth | P2 | REV-50 statutory legal recovery and REV-51 field-collections first slices done |
| G | Regulatory format fidelity & live integrations | P2 | REV-60 CIC URCF, REV-61 CKYC, REV-62 FIU FINnet, REV-63 CERSAI, REV-64 live providers |
| H | Architecture & scale | P2 | REV-70 split `server.js`, REV-71 storage scale; REV-72 co-lending accounting, ECL, tax, escrow and CBS boundary done |
| I | Go-to-market / positioning | P3 | REV-80 positioning, REV-81 beachhead, REV-82 depth-over-breadth (**decisions**) |

Sequencing guidance: **do WS-A + the P1s in WS-B/C first** (trust and correctness on the path that
actually runs), then WS-D (credit depth) and REV-42 (GST) to make a single real loan real, then breadth
(WS-E/F/G) and architecture (WS-H). WS-I decisions gate how wide vs. deep the build goes.

## Cross-Cutting Workstream: SaaS Tenancy and Vendor Posture

Status: S1–S6 first slice complete for every task (tenant partitioning, tenant-scoped service auth, tenant/platform human sessions, tenant user admin, access reviews, service-key rotation, isolation suite, hash-chained audit spine + evidence export, tenant portability export + evidenced offboarding, disclosed sub-processor register, 6-hour incident-notification workflow, audited platform-staff break-glass access, uniform audit provenance stamping).

LoanOS is delivered as a multi-tenant SaaS to regulated entities, which makes tenancy and our own vendor compliance a workstream that runs alongside the phases rather than after them. Sequenced stages:

- S1. Tenant context groundwork: state partitioned per tenant, tenant-scoped storage accessor. Done: the API store holds a control plane (tenant registry) and per-tenant data planes; handlers only ever see one tenant's partition.
- S2. Tenant-scoped authentication and tenant-context middleware. Done: every data-plane route resolves a tenant from tenant user session or `x-api-key`/bearer service credential and 401s without valid tenant context; platform onboarding provisions tenants behind a platform admin key or platform admin session with hashed api keys, owner-user provisioning, regulated entity/product seeding, and module/flow readiness.
- S2a. Tenant and platform administration. Done: tenant/platform users log in with HTTP-only sessions; tenant admins manage users, access reviews, and service-key rotation; platform admins manage platform users and tenant provisioning.
- S3. Cross-tenant isolation regression suite (two tenants, every resource type) running in CI. Done: the suite proves tenant B cannot read or mutate tenant A's records and that missing/invalid keys are rejected.
- S4. Append-only hash-chained audit spine replacing the flat event array; first evidence export pack. Done: every save seals the tenant's events into a tamper-evident SHA-256 chain (tenant-bound genesis), `GET /audit/events` reports chain validity, and `GET /audit/export` produces a verifiable evidence pack that 409s on a broken chain.
- S5. Tenant lifecycle: onboarding, sandbox environments, exit/portability export. Done: the platform onboarding wizard/API captures tenant shell, owner, RE profile, initial product policy, enabled modules/flows, and readiness; `GET /platform/tenants/:id/export` produces a reproducible portability pack (control record, full data plane, audit evidence pack), `POST /platform/tenants/:id/offboarding` performs evidenced deletion (data-plane purge, api-key revocation, deletion attestation), and sandbox environments can be provisioned, reset, and deleted with synthetic-only borrower enforcement, mock integration overrides, and request routing via sandbox keys or the `x-sandbox-name` header.
- S6. Vendor posture pack: due-diligence pack, incident notification (RE 6-hour RBI window, CERT-In), BCP/DR, sub-processor register, ISO 27001 / SOC 2 roadmap. First slices now cover incident notification, the residency-evidenced sub-processor register, audited tenant-visible break-glass, encrypted/audit-verified recovery packages, authenticated four-eyes restore, and measured RTO/RPO drill evidence. Due-diligence/certification packs, production database HA/PITR, managed immutable backup custody, real multi-AZ/region failover/failback, contractual objectives, and witnessed business-continuity exercises remain external/planned.

Exit criteria:

- No API call executes without an authenticated tenant context. Done for the data plane.
- Isolation suite proves tenant A cannot read or mutate tenant B, for every resource type. Done.
- Every state change lands in a tamper-evident, tenant-scoped audit chain, and an integrity-attested evidence pack can be exported. Done (S4).
- A full tenant export (records plus audit spine plus rendered documents) can be produced in a documented, re-loadable format. Done (S5).

## Phase 0: Compliance Foundation

Status: first executable slice complete.

Deliverables:

- Regulatory register with control IDs. Done.
- Domain kernel for India-only checks, KFS, fund flow, data residency, and model kill switch. Done.
- File-backed API for local development and demonstrations. Done.
- Tests proving unsafe loans are blocked. Done.
- Documentation pack explaining product scope, architecture, compliance checklist, current implementation, and backlog. Done.

Exit criteria:

- `npm test` passes. Done.
- A non-India loan is blocked. Done.
- An LSP pass-through account is blocked. Done.
- A missing KYC/economic profile is blocked. Done.
- A disabled AI model is blocked. Done.
- A valid India-only loan can reach decision readiness. Done at domain preflight level; full LOS workflow comes in Phase 1.

## Phase 1: LOS MVP

Status: started. Regulated-entity, product-policy, borrower-profile, consent-ledger, KYC-record registries, and the first LOS workflow state machine are implemented as early Phase 1 slices.

Deliverables:

- Tenant and RE setup. First slice done.
- Product registry and policy versioning. First slice done.
- Borrower onboarding and consent ledger. First slice done, including legal-entity borrower types (company/partnership/llp/trust) with a PMLA beneficial-owner registry gating sanction.
- KYC state machine with CKYC registry integration and V-CIP evidence vault. First slice done.
- Underwriting workflow with human review. Eligibility/affordability engine first slice done; refer-band applications route to a manual underwriting queue, and approving a referred application requires a recorded manual underwriting override (underwriter, reason, policy reference) recorded by a registered credit officer, and declines must cite a coded decline reason.
- Decision proposal and maker-checker approval. First slice done.
- KFS generation and digitally delivered document packet. First slice done.
- Sanction and disbursement readiness checks. First slice done.

Exit criteria:

- Every sanction is linked to KFS, consent, KYC, economic profile, policy version, and decision evidence.
- No fee can be posted unless it appears in the KFS or a permitted contingent-charge schedule.
- Disbursement is impossible through LSP/pass-through accounts.

## Phase 2: LMS MVP

Status: started. Current LMS slices cover amortising, bullet, moratorium, step-up, and non-amortising revolving/OD accounts; reconstruct balances and available limits; accrue scheduled or daily-utilisation interest; post payments; generate statements; control charges/waivers/reversals; compute delinquency and asset class; enforce recovery controls; restructure or resolve term accounts; and generate CIC-ready internal snapshots.

Deliverables:

- Loan account ledger. First slice done.
- Repayment schedule and amortization. Multi-structure slice done: weekly/fortnightly/monthly/quarterly amortising, bullet, moratorium, and step-up schedules share the KFS/LMS generator and reconcile to paise.
- Revolving credit and overdraft. First governed slice done: limit/drawing power, KFS illustration, maker-checker draw/review, daily utilised-balance interest, minimum due, repayment-restored availability, statements, and journals.
- EMI, floating-rate reset, statements, part-prepayment, foreclosure. Statement data, part-prepayment re-amortization, and foreclosure payoff/closure first slices done.
- Penal-charge policy, waivers, reversals, and audit. First slice done.
- Delinquency, recovery assignment, and same-day cash recovery posting. First slice done.
- Collections reminder/notice workflow. First slice done: RBI FPC voice-channel contact-hours gate.
- Hardship restructure, settlement, and write-off. First slice done: four-eyes tenure/rate concession with re-amortization; four-eyes below-par closure with waiver credits; book-loss write-off.
- SMA/NPA asset classification. First slice done.
- CIC event feed model. Internal snapshot first slice done.

Exit criteria:

- Borrower balance can be reconstructed from immutable ledger events. First slice done.
- Statements match ledger state. First slice done.
- Recovery-agent notices are generated before contact. First slice done.
- Asset classification and CIC snapshots are generated from ledger/schedule state. First slice done.

## Phase 3: LWS and Compliance Operations

Status: started. Current slices derive workflow tasks from LOS/LMS/grievance state, attach SLA clocks, persist assignment/start/release/comment audit, enforce staff actor roles for regulated workflow actions, capture manual underwriting override evidence on referred-application approvals, manage the 30-day complaint escalation clock, govern LSP agreement/due-diligence/review evidence, export active DLA records in RBI CIMS-ready shape, and run a fraud case through a natural-justice classification gate with a committee pack.

Deliverables:

- Maker-checker workflow engine. First task-queue and actor-role slice done.
- Exception queues and approval matrices. Derived queues and role checks first slice done; matrix administration planned.
- Grievance workflow with 30-day RBI CMS escalation clock. First slice done.
- Fraud workflow and committee packs. First slice done: a fraud case runs `reported → under_investigation → show_cause_issued → classified_fraud/classified_not_fraud`, with an adverse classification gated on a show-cause notice, borrower response (or the RBI FRM-2024 21-day window), and four-eyes separation between investigator and classifier; a checksum-sealed committee pack assembles the case facts, natural-justice trail, and classification verdict.
- LSP/vendor periodic review and incident workflows. LSP agreement, due-diligence, data, recovery, fee-control, and periodic-review registry first slice done; incident/exit workflows planned.
- DLA CIMS export and CCO certification pack. Export plus per-DLA compliance attestation first slice done; broader certification pack planned.

Exit criteria:

- Every manual override has actor, reason, policy, timestamp, and approver.
- CCO can export DLA data and certify data-collection/storage compliance. First slice done for active DLA registry records.

## Phase 4: Production Integrations

Deliverables:

- CERSAI. Governed canonical submission slice done: `cersai.js` builds checksum-sealed registration packets, retains provider submission/payment/certificate evidence, reconciles HMAC-authenticated registered/rejected callbacks, and supports independently approved repair lineage; certified CERSAI gateway schema and live credential onboarding remain planned.
- FIU-IND STR/CTR/CCR reporting. Governed canonical FINnet slice done: `fiu-str.js` emits ARF/TRF/CRF XML, retains provider submission evidence, reconciles HMAC-authenticated accepted/rejected callbacks against the exact packet checksum, and supports approved repair lineage; FIU XSD/rule-set certification and live FINGate onboarding remain planned.
- Credit bureaus/CICs.
- Bank account verification. First slice done: `ExternalServiceManager` supports mock/real bank-account verification, `POST /integrations/bank-account-verification` returns sanitized verification evidence, and disbursement is blocked without verified active account proof matching the destination account.
- eSign/document vault. First slice done: successful eSign automatically creates a tenant-scoped document-vault receipt with signature evidence, storage country, retention policy, per-document HTML/PDF SHA-256 checksums, and a manifest checksum; certified external eSign envelope onboarding remains planned.
- NACH/UPI/payment rails. First slice done: `ExternalServiceManager` supports mock/real payment rail provider switching with India residency enforcement, `POST /integrations/payment-rails/nach-mandates` and `POST /integrations/payment-rails/upi-collects` store sanitized initiation evidence, and `GET /payment-rails` exposes the tenant ledger. Live settlement files, reconciliation, refunds, and production provider onboarding remain planned.
- SMS/email/WhatsApp provider with India data posture. First slice done: `ExternalServiceManager` dispatches SMS/email/WhatsApp through mock/real providers with India residency enforcement, `POST /integrations/communications` stores masked/hash-only dispatch evidence, and `GET /communications` exposes the tenant ledger.
- Observability, secrets, IAM, DR, incident response.

Exit criteria:

- Vendor onboarding captures data residency, audit rights, exit plan, and breach obligations.
- Data retention and deletion jobs are evidenced.
- DR runbook and access reviews pass.

## Phase 5: AI Governance and Model Risk Hardening

Status: started. A runtime model-use guard plus global/model kill switch exist, a governed model lifecycle with an independent-validation gate is implemented, drift monitoring auto-trips a kill switch on threshold breach, generative models carry an adversarial/hallucination testing gate, customer-facing disclosure and human handoff are implemented, and kill-switch events open an incident that requires a post-incident review before the switch can be cleared.

Deliverables:

- Full model inventory and lifecycle. Lifecycle state machine first slice done.
- Independent validation workflow. Validation-gate first slice done: approval requires independent validation evidence and an approver independent of the owner.
- Bias/fairness, explainability, drift, hallucination, and adversarial testing evidence. First slices done: high-risk models require fairness/explainability/monitoring evidence to approve validation; generative models additionally require adversarial (red-team) and hallucination-testing evidence; drift observations breaching a model's threshold auto-trip a model-scoped kill switch.
- Customer-facing AI disclosure and human handoff. First slice done: disclosure is generated only for a customer-facing, active model (blocked for back-office/inactive/kill-switched), and handoff requests move pending → handled by a named human agent.
- AI incident reporting and sectoral risk intelligence pack. Kill-switch incident record first slice done; sectoral risk intelligence pack planned.
- Global/model/workflow kill switch with post-incident review. First slice done: clearing the global switch requires a recorded post-incident review.

Exit criteria:

- No model can be used outside inventory.
- A kill-switch event blocks runtime use immediately.
- Clearing a switch requires approval and leaves the original evidence intact.
