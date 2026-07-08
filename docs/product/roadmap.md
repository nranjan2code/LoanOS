# Product Roadmap

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
- Borrower onboarding and consent ledger. First slice done.
- KYC state machine with CKYC/V-CIP placeholders. First slice done.
- Underwriting workflow with human review. Eligibility/affordability engine first slice done.
- Decision proposal and maker-checker approval. First slice done.
- KFS generation and digitally delivered document packet. First slice done.
- Sanction and disbursement readiness checks. First slice done.

Exit criteria:

- Every sanction is linked to KFS, consent, KYC, economic profile, policy version, and decision evidence.
- No fee can be posted unless it appears in the KFS or a permitted contingent-charge schedule.
- Disbursement is impossible through LSP/pass-through accounts.

## Phase 2: LMS MVP

Status: started. Current LMS slices open loan accounts on disbursement, generate repayment schedules, reconstruct balances, post payments, generate statements, control charges/waivers/reversals, compute delinquency, classify assets, enforce noticed recovery plus same-day cash posting, and generate CIC-ready internal snapshots.

Deliverables:

- Loan account ledger. First slice done.
- Repayment schedule and amortization. First slice done.
- EMI, floating-rate reset, statements, part-prepayment, foreclosure. Statement data first slice done.
- Penal-charge policy, waivers, reversals, and audit. First slice done.
- Delinquency, recovery assignment, and same-day cash recovery posting. First slice done.
- SMA/NPA asset classification. First slice done.
- CIC event feed model. Internal snapshot first slice done.

Exit criteria:

- Borrower balance can be reconstructed from immutable ledger events. First slice done.
- Statements match ledger state. First slice done.
- Recovery-agent notices are generated before contact. First slice done.
- Asset classification and CIC snapshots are generated from ledger/schedule state. First slice done.

## Phase 3: LWS and Compliance Operations

Status: started. Current slices derive workflow tasks from LOS/LMS/grievance state, attach SLA clocks, persist assignment/start/release/comment audit, enforce staff actor roles for regulated workflow actions, and manage the 30-day complaint escalation clock.

Deliverables:

- Maker-checker workflow engine. First task-queue and actor-role slice done.
- Exception queues and approval matrices. Derived queues and role checks first slice done; matrix administration planned.
- Grievance workflow with 30-day RBI CMS escalation clock. First slice done.
- Fraud workflow and committee packs.
- LSP/vendor periodic review and incident workflows.
- DLA CIMS export and CCO certification pack.

Exit criteria:

- Every manual override has actor, reason, policy, timestamp, and approver.
- CCO can export DLA data and certify data-collection/storage compliance.

## Phase 4: Production Integrations

Deliverables:

- CKYC/CERSAI.
- Credit bureaus/CICs.
- Bank account verification.
- eSign/document vault.
- NACH/UPI/payment rails.
- SMS/email/WhatsApp provider with India data posture.
- Observability, secrets, IAM, DR, incident response.

Exit criteria:

- Vendor onboarding captures data residency, audit rights, exit plan, and breach obligations.
- Data retention and deletion jobs are evidenced.
- DR runbook and access reviews pass.

## Phase 5: AI Governance and Model Risk Hardening

Deliverables:

- Full model inventory and lifecycle.
- Independent validation workflow.
- Bias/fairness, explainability, drift, hallucination, and adversarial testing evidence.
- Customer-facing AI disclosure and human handoff.
- AI incident reporting and sectoral risk intelligence pack.
- Global/model/workflow kill switch with post-incident review.

Exit criteria:

- No model can be used outside inventory.
- A kill-switch event blocks runtime use immediately.
- Clearing a switch requires approval and leaves the original evidence intact.
