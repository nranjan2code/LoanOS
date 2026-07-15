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

The current large-bundle execution order and completion status are maintained in
the [build backlog's Large Delivery Bundle Sequence](build-backlog.md#large-delivery-bundle-sequence-2026-07-14).

Bundle D status: audit/data-governance product controls are complete for verified external-anchor evidence, critical business-event completeness, evidence custody/legal holds/deletion proof, field lineage, and declarative DQ certification. Production TSA/WORM infrastructure and institution-wide stewardship remain external/deployment work.

Bundle E status: enterprise-security/scale product controls are complete for certified federation and SCIM identity state, purpose-attested managed keys, security-log custody, PostgreSQL HA/PITR/capacity dependencies, OpenAPI/event/webhook governance, and deployment-automation readiness. Live IdP, KMS/HSM, SIEM/WORM/NTP, managed database/queue, and cloud rollout controllers remain external deployment work.

Bundle F status: risk/AML/fraud governance control-plane first slice is complete for current-list ongoing CDD, exact-paise transaction monitoring, deterministic multi-signal fraud policy, portfolio/connected exposure limits, stress testing, RCSA/KRI/loss actions, recurring cohort model reports, and checksum-sealed risk-committee packs. Live intelligence and transaction feeds, matching/case operations, institutional risk methodology, independent validation and committee operation remain external or deployment work.

Bundle G status: migration/go-live governance control-plane first slice is complete for approved configuration and source mappings, count and exact-paise conversion reconciliation, account opening-balance/schedule validation, five-day finance/regulatory/portfolio parallel run, control-complete UAT, expiring role training, joined DR/security/provider/three-function readiness, evidence-bound cutover/rollback, and seven-day hypercare exit. Source extraction/ETL, staff and bank test operation, production switching and witnessed continuity remain customer/vendor execution.

Bundle H status: institutional operating-model/configurable-workflow control-plane first slice is complete for RE programmes and organisation hierarchy, regulatory applicability and obligation calendars, India business-calendar/SLA-pause policy, reachable version-pinned state machines, exact-paise approval resolution, workforce/delegation/escalation policy, bounded bulk-action approval and versioned exception/root-cause controls. Organisation/content feeds, runtime schedulers/routing, workflow-version migration, transactional bulk execution and institution-wide operating methodology remain deployment work.

Bundle I status: customer/channel operations first slice is complete for approved partner authority, branch/partner lead intake, programme/product/PIN serviceability, contact-hash customer matching, evidence-bound lead lifecycle, commission-policy governance, customer party graph and merge plans, accessibility/communication preferences, succession restriction/approval, joined exact-paise customer exposure, and an accessible tenant-branded privacy-safe PWA shell. External-partner row-level entitlement, conversion orchestration, commission finance/settlement, transactional merge, succession servicing actions, translated content packs and encrypted field-offline queues remain.

Bundle J status: production channel hardening first slice is complete for identity-bound tenant/partner/operating-unit scope, filtered channel projections, customer-master denial, out-of-scope mutation rejection, and exact-paise converted-lead commission assessment through independent approval, reconciled settlement and time-bound clawback. Database RLS/isolation evidence, periodic access certification, conversion orchestration, invoice/GST/TDS/GL/bank-file/dispute depth remain.

Bundle K status: customer identity consolidation and safe conversion first slice is complete for deterministic merge-impact enumeration/checksum, stale-impact rejection, independently approved atomic borrower-reference remap, collapsed-relationship retirement, non-destructive merged-profile lineage, rollback/evidence record, and lead conversion restricted to an existing application owned by the named borrower with duplicate-link rejection. Per-field conflict UI, external identity/provider reconciliation, downstream event publication, executable rollback and one-click full-compliance application creation remain.

Bundle L status: succession servicing first slice is complete for independently approved and expiring claimant authority, named-account and allow-listed action scope, exact-paise repayment records, evidence-bound communication/statement and material account requests, four-eyes closure/settlement/transfer/mandate changes and revocation, and fail-closed expired/revoked use. Legal-work queues and downstream LMS/finance execution, reconciliation, reversal and notification remain.

Bundle M status: succession downstream execution first slice is complete for fresh authority/scope revalidation, four-eyes effect approval, idempotent LMS repayment posting with bank/reconciliation lineage, zero-dues checksum-sealed closure NOC, evidence-bound downstream completion for other action families, and mandatory legal-review, notification and reversal-plan references. Native settlement/ownership-transfer/mandate adapters and staffed legal queues remain.

Bundle N status: succession legal operations and native-effects first slice is complete for assigned/due legal review, checklist/basis evidence, information requests and independent decisions; native LMS compromise settlement; non-novating claimant servicing transfer that preserves the original debtor; and same-account migration from an old mandate to a registered claimant mandate. External court/registrar/legal-document connectors, provider cancellation confirmation and workforce/SLA dashboards remain.

Parallel Bundles O–R status: channel/CRM governance, partner-finance operations, customer-identity completion and succession operational controls are complete at the application/control-plane layer. This includes credential/access/conduct governance, exact GST/TDS/payable/bank-file/reversal controls, per-field checksum/version-bound merge and rollback with outbox events, and certified checksum/idempotency-bound succession connectors with verified callbacks plus SLA/capacity queues. Live IAM/HR/GSTN/bank/CBS/court/registrar/provider/broker integrations, operator UX and production database/infrastructure evidence remain.

Parallel Bundles S–V status: Indian-language/offline governance, production-infrastructure evidence, bank assurance execution and live-integration onboarding/conformance are complete at the control-plane layer. Institution-approved translations and encrypted offline envelopes, all eight infrastructure dependency families with witnessed drills, exact ETL plus independent assurance/release gates, and India-resident adverse-tested provider activation are executable. Real services, credentials, institutional/assessor evidence, MDM/key delivery and witnessed production operation remain external execution.

Parallel Bundles W–Z status: 39 formerly Missing platform/product, KYC/underwriting, collateral/disbursement and servicing/collections capabilities now have executable first-slice controls. Exact money, tenant boundaries, evidence/checksums, deterministic derivation and maker-checker gates are enforced. Live source/registry/provider/finance/workforce adapters, institution-specific policies/models, operator UX and production operational evidence remain.

Parallel Bundles AA–AD status: the last 27 Missing catalogue entries now have first-slice controls across LMS/recovery/closure, partner/grievance, regulatory/data integration and role workspaces. The catalogue therefore has zero Missing entries, while Partial status truthfully preserves external integration, institutional policy, UX certification, runtime and witnessed-operation gaps.

Bundles AE–AJ status: vendor mapping/transports/crypto workers, product-journey administration, verified organisation bootstrap, canonical IAM, exhaustive admission/enterprise simulation and persistent platform operations are complete at the product/control-plane layer. Bundle AJ adds a unified eight-dimension tenant activation gate, persistent expiring conformance campaigns, exact-byte RS256/ES256 provider-revocation verification and a durable tenant/workload-fenced identity worker plane with bounded retry, DLQ/escalation and independent replay. Selected commercial providers, contracts/credentials, native fixtures, managed schedules/handler deployments, database CAS/RLS evidence, telemetry/custody and institution-witnessed assurance remain external execution.

Bundle AK status: the identity-worker plane now has a runnable bounded scheduler, service-plane client, explicit non-commercial simulator, injected live-port boundary, health/readiness/Prometheus telemetry, opt-in container deployment and operational runbook. Claims, outcomes, finalization and audit share the tenant-scoped PostgreSQL advisory-lock transaction and RLS path; an environment-gated database race test proves the expected single-winner claim. Commercial adapters, selected-provider credentials/contracts, managed scheduling/alert routing, selected-database execution evidence, production soak/chaos and institution-witnessed operation remain external.

Guide and Academy status: the canonical platform-owned help surface is implemented with role-based discovery, search, learning paths and maturity/environment/control labels. Governed tenant/RE overlays, formal assignments, assessments, certification expiry and external LMS interoperability remain future adoption work.

## Cross-Cutting Workstream: SaaS Tenancy and Vendor Posture

Status: S1–S9 first slice complete for every task (tenant partitioning, tenant-scoped service auth, tenant/platform human sessions, tenant user admin, access reviews, service-key rotation, isolation suite, hash-chained audit spine + evidence export, tenant portability export + evidenced offboarding, disclosed sub-processor register, 6-hour incident-notification workflow, audited platform-staff break-glass access, uniform audit provenance stamping, artifact-bound security assurance, governed SOC investigation records, and compliance-control assurance/audit evidence).

LoanOS is delivered as a multi-tenant SaaS to regulated entities, which makes tenancy and our own vendor compliance a workstream that runs alongside the phases rather than after them. Sequenced stages:

- S1. Tenant context groundwork: state partitioned per tenant, tenant-scoped storage accessor. Done: the API store holds a control plane (tenant registry) and per-tenant data planes; handlers only ever see one tenant's partition.
- S2. Tenant-scoped authentication and tenant-context middleware. Done: every data-plane route resolves a tenant from tenant user session or `x-api-key`/bearer service credential and 401s without valid tenant context; platform onboarding provisions tenants behind a platform admin key or platform admin session with hashed api keys, owner-user provisioning, regulated entity/product seeding, and module/flow readiness.
- S2a. Tenant and platform administration. Done: tenant/platform users log in with HTTP-only sessions; tenant admins manage users, access reviews, and service-key rotation; platform admins manage platform users and tenant provisioning.
- S3. Cross-tenant isolation regression suite (two tenants, every resource type) running in CI. Done: the suite proves tenant B cannot read or mutate tenant A's records and that missing/invalid keys are rejected.
- S4. Append-only hash-chained audit spine replacing the flat event array; first evidence export pack. Done: every save seals the tenant's events into a tamper-evident SHA-256 chain (tenant-bound genesis), `GET /audit/events` reports chain validity, and `GET /audit/export` produces a verifiable evidence pack that 409s on a broken chain.
- S5. Tenant lifecycle: onboarding, sandbox environments, exit/portability export. Done: the platform onboarding wizard/API captures tenant shell, owner, RE profile, initial product policy, enabled modules/flows, and readiness; `GET /platform/tenants/:id/export` produces a reproducible portability pack (control record, full data plane, audit evidence pack), `POST /platform/tenants/:id/offboarding` performs evidenced deletion (data-plane purge, api-key revocation, deletion attestation), and sandbox environments can be provisioned, reset, and deleted with synthetic-only borrower enforcement, mock integration overrides, and request routing via sandbox keys or the `x-sandbox-name` header.
- S6. Vendor posture pack: due-diligence pack, incident notification (RE 6-hour RBI window, CERT-In), BCP/DR, sub-processor register, SLA/concentration oversight, ISO 27001 / SOC 2 roadmap. First slices now cover incident notification, the residency-evidenced sub-processor register, audited tenant-visible break-glass, governed vendor contract/residency/due-diligence/review/exit evidence, derived SLA breaches and basic tenant/service concentration, encrypted/audit-verified recovery packages, authenticated four-eyes restore, and measured RTO/RPO drill evidence. Certification packs, procurement feeds, fourth-party and portfolio/region concentration, independently sourced SLA telemetry, contract enforcement, production database HA/PITR, managed immutable backup custody, real multi-AZ/region failover/failback, and witnessed business-continuity exercises remain external/planned.
- S7. Secure-SDLC assurance. First slice requires artifact-bound SAST, DAST, dependency, container, IaC and secret-scan evidence, checksum/signature-referenced SBOM metadata, severe-finding reconciliation, severity remediation SLAs, independent retest/closure, bounded non-critical risk exceptions, and a fail-closed release-approval gate. Scanner/pipeline authentication, report and signature verification, CVE/KEV/VEX feeds, automated patch/escalation, maintained threat models, penetration/red-team execution and effectiveness evidence remain planned.
- S8. SIEM/SOC operations. First slice governs independently approved/tested detection rules, source-bound alert checksum/deduplication/SLA evidence, independent dismissal, linked investigations, India-resident hash-chained evidence, containment-to-recovery gates, independent closure, and ingestion/180-day-retention/trusted-time coverage assessment. India-hosted SIEM/log/WORM custody, authenticated collectors, NTP, threat intelligence/UEBA, SOAR/forensics, SOC staffing, hunting and effectiveness exercises remain planned.
- S9. Compliance assurance and audit. First slice governs canonical-control test plans, population/sample/workpaper results, deficiency issues and independent remediation closure, completed-period control-owner certification/sign-off, internal/statutory/RBI evidence-request engagements, and checksum-sealed committee metrics. Granular obligation/control hierarchy, recurring campaigns, statistical sampling, evidence/workpaper connectors, issue escalation/risk acceptance, confidential audit spaces, regulator portals, e-signatures, rendered packs/minutes/actions and independent effectiveness testing remain planned.

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

Status: application/control-layer journey complete for the unsecured personal term-loan slice. Regulated-entity/product/borrower registries, self-service capture, policy document checklist and quarantine/review, conditions precedent, sanction validity, language-evidenced KFS, decision, contracting and disbursement gates are connected; Phase 4 governs provider readiness while each RE completes external onboarding.

Deliverables:

- Tenant and RE setup. First slice done.
- Product registry and policy versioning. First slice done.
- Borrower onboarding and consent ledger. First slice done, including legal-entity borrower types (company/partnership/llp/trust) with a PMLA beneficial-owner registry gating sanction.
- Authenticated digital application journey. First slice done with safe product options, session-grounded borrower identity, source/attribution, amount/tenor/account capture, declaration, preferred language and borrower portal UI.
- KYC state machine with CKYC registry integration and V-CIP evidence vault. First slice done.
- Underwriting workflow with human review. Eligibility/affordability engine first slice done; refer-band applications route to a manual underwriting queue, and approving a referred application requires a recorded manual underwriting override (underwriter, reason, policy reference) recorded by a registered credit officer, and declines must cite a coded decline reason.
- Decision proposal and maker-checker approval. First slice done.
- KFS generation and digitally delivered document packet. First slice done.
- Product-driven application documents, quarantine, independent review/waiver and conditions precedent. First slice done.
- Sanction and disbursement readiness checks. First slice done, including sanction expiry and governed origination gates.

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

Status: provider-governance and transport-control layer complete. Fifteen provider families require credential-safe configuration, India residency, active time-bound production certification and operational health before live readiness. CIC, CKYCRR and AA transports now join the existing adapters; actual contracts, credentials, allow-listing and provider/regulator certification remain deployment-specific external work.

Deliverables:

- CERSAI. Governed canonical submission slice done: `cersai.js` builds checksum-sealed registration packets, retains provider submission/payment/certificate evidence, reconciles HMAC-authenticated registered/rejected callbacks, and supports independently approved repair lineage; certified CERSAI gateway schema and live credential onboarding remain planned.
- FIU-IND STR/CTR/CCR reporting. Governed canonical FINnet slice done: `fiu-str.js` emits ARF/TRF/CRF XML, retains provider submission evidence, reconciles HMAC-authenticated accepted/rejected callbacks against the exact packet checksum, and supports approved repair lineage; FIU XSD/rule-set certification and live FINGate onboarding remain planned.
- Credit bureaus/CICs. Governed transport slice done: canonical CIC batches cross the provider boundary with checksum-derived idempotency and signed callback reconciliation; proprietary CIC conformance/certification remains external.
- CKYCRR and Account Aggregator. Governed transport slice done: CKYCRR packet submission and signed response reconciliation, plus consent-preflighted AA fetch evidence without raw FI persistence; ecosystem certification remains external.
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

Status: started, with governed model-risk, digital-worker control-plane, provider-boundary, domain-policy, and commercial-control slices implemented. The platform has model-use gates, kill switches, lifecycle/validation controls, drift-triggered suspension, generative-model evidence gates, customer disclosure/handoff, incident review, four proposal-only worker templates, tenant pricing/installations, four-role approval, dual decision-engine authorization, usage budgets, invoice-ready commercial records, a Mumbai-only injected provider contract, and execution/usage lineage. No live external LLM or agent runtime is connected; these controls do not constitute production deployment or regulatory certification.

Deliverables:

- Full model inventory and lifecycle. Lifecycle state machine first slice done.
- Independent validation workflow. Validation-gate first slice done: approval requires independent validation evidence and an approver independent of the owner.
- Bias/fairness, explainability, drift, hallucination, and adversarial testing evidence. First slices done: high-risk models require fairness/explainability/monitoring evidence to approve validation; generative models additionally require adversarial (red-team) and hallucination-testing evidence; drift observations breaching a model's threshold auto-trip a model-scoped kill switch.
- Customer-facing AI disclosure and human handoff. First slice done: disclosure is generated only for a customer-facing, active model (blocked for back-office/inactive/kill-switched), and handoff requests move pending → handled by a named human agent.
- AI incident reporting and sectoral risk intelligence pack. Kill-switch incident record first slice done; sectoral risk intelligence pack planned.
- Global/model/workflow kill switch with post-incident review. First slice done: clearing the global switch requires a recorded post-incident review.
- Governed digital-worker marketplace. First slice done: CAM preparation, underwriting review, document/compliance review, and service-support triage templates are versioned, tenant installable, proposal only, and bound to approved actions.
- Tenant commercial and customization controls. First slice done: maker-checker exact-paise pricing contracts, pinned model/prompt/knowledge/action configuration, immutable rated usage, usage-budget reservations, tenant/platform reports, and hash-sealed GST-ready commercial records with independent approval; credits, payment/accounting integration, tax validation, legal invoicing, and marketplace UI remain.
- Material-agent activation. First slice done: four distinct authenticated human roles plus a fresh control-engine decision are required before activation.
- Runtime agent authorization and traceability. Control-boundary slice done: both model-consumption and agent-action decisions must allow each run, and execution/output/usage lineage is checksum and audit bound.
- India-resident model/agent runtime and evaluation programme. Provider-boundary and specialized-policy slices done: the injected adapter enforces Mumbai, tenant/model allowlists, dual traces, constrained proposal output, checksums, timeout/cancellation and metering; retrieval/data-access, outbound communication, underwriting influence and case mutation policies have golden corpora. Planned: approved provider registration/deployment, durable worker, domain call-site integration, task-quality suites, red-team/regression gates, continuous worker monitoring, and automatic suspension.

Exit criteria:

- No model can be used outside inventory.
- A kill-switch event blocks runtime use immediately.
- Clearing a switch requires approval and leaves the original evidence intact.
- No digital worker can activate or run without tenant-local installation, staffing, approval, and two fresh deterministic authorization traces.
- Every completed worker run is proposal only, human-disposition capable, usage rated, and reproducible from model, prompt, knowledge, input, output, policy, and actor lineage.
