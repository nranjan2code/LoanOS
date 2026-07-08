# LoanOS India Architecture Blueprint

## Mission

Build an India-only lending operating system that can run regulated digital lending programs for banks, NBFCs, HFCs, co-operative banks, and All-India Financial Institutions while preserving borrower protection, auditability, and RBI/India compliance by design.

The platform is split into three product planes and one shared control plane:

- LOS: borrower onboarding, product discovery, KYC, underwriting, offer, KFS, sanction, execution, and disbursement readiness.
- LMS: repayment schedule, servicing, statements, collections, recovery, restructuring, delinquency, NPA signals, settlements, write-offs, closures.
- LWS: workflow system for maker-checker, human review, exceptions, vendors, complaints, fraud, compliance, audit, committees, and supervisory evidence.
- Compliance and AI control plane: policy registry, consent, data residency, model inventory, AI kill switch, event evidence, reporting exports.

## Regulated-Entity Boundary

Every tenant must identify the regulated entity (RE), license type, products, and app/DLA footprint before loans can be originated.

Required tenant objects:

- RE profile: legal name, RBI category, RBI identifiers, principal office, board-approved policies.
- Product registry: product family, eligible borrower class, fees, penal-charge policy, APR method, cooling-off policy.
- DLA registry: app/website name, owner, app-store/website links, grievance officer, CIMS status.
- LSP registry: contractual scope, due diligence, data storage, recovery role, DLG role, audit rights, termination/exit.
- Model registry: model owner, version, use case, materiality, risk tier, validation status, monitoring plan, kill-switch state.

## Core Services

| Service | Plane | Responsibilities |
| --- | --- | --- |
| Tenant and RE service | Control | Regulated entity setup, board policies, product approval gates |
| Borrower profile service | LOS/LMS | Customer profile, economic profile, consent references, KYC state |
| Consent service | Control | DPDP notice, explicit consent, revocation, third-party sharing, retention choices |
| KYC service | LOS | CKYC, V-CIP evidence, Aadhaar boundary, beneficial owner checks, risk category |
| Product and pricing service | LOS | Eligibility, fees, APR, penal charges, loan terms, cooling-off |
| Underwriting service | LOS | Rules, scorecards, AI model calls, human review, decision evidence |
| KFS/document service | LOS/LMS | KFS, sanction letter, agreement, statements, privacy policy delivery |
| Fund-flow service | LOS/LMS | Disbursement validation, direct repayment rails, LSP/pass-through prevention |
| Loan account service | LMS | Ledger, amortization, repayment schedule, balances, closures |
| Servicing communication service | LMS | EMI/rate reset notices, quarterly statements, recovery-agent notices |
| Collections and recovery service | LMS/LWS | Delinquency, assignment, cash recovery evidence, hardship, restructure |
| Grievance service | LWS | DLA and website complaints, 30-day clock, RBI CMS escalation information |
| Fraud risk service | LWS | Fraud case management, natural justice workflow, LEA reporting evidence |
| Vendor and LSP oversight | LWS/Control | Due diligence, periodic review, audit, incident and exit management |
| AI governance service | Control | Inventory, validation, monitoring, incident reporting, kill switch |
| Audit evidence service | Control | Immutable event log, policy snapshots, decision lineage, export packs |
| Regulatory reporting service | Control | CIC, CIMS DLA, CKYC, CERSAI, FIU-IND support, board/committee packs |

## Loan Lifecycle

1. Product and RE readiness
   - Product has active board-approved policy.
   - DLA/LSP/model entries are complete.
   - Public website disclosures are complete.

2. Borrower onboarding
   - India-only checks pass.
   - Consent notices are presented and recorded.
   - KYC/CDD and economic profile are captured.
   - Aadhaar/e-KYC remains a connector boundary with no biometric/OTP/PID storage.

3. Eligibility and underwriting
   - Product rules and affordability rules run.
   - AI/model calls are allowed only if model inventory and kill-switch checks pass.
   - Material credit decisions require human review or a documented human-on-the-loop policy.
   - Decisions include model version, policy version, data snapshot, and reviewer evidence.

4. Offer and KFS
   - APR, fees, contingent charges, penal charges, recovery mechanism, cooling-off, and grievance officer are disclosed.
   - Any fee not in KFS is rejected later.
   - Multi-lender offer views must be unbiased and ranking criteria must be disclosed.

5. Sanction and execution
   - Digitally signed KFS, sanction letter, agreement, product summary, account statements, and privacy policies flow to verified email/SMS.
   - Contract execution is blocked if KFS or privacy/data policy evidence is missing.

6. Disbursement
   - Disbursement goes to borrower bank account unless an explicit permitted exception applies.
   - End-use disbursement goes directly to end-beneficiary.
   - No LSP/DLA/pass-through account can control funds.

7. Servicing
   - Ledger generates repayment schedule, statements, charges, waivers, and borrower communications.
   - Floating-rate EMI reset options and quarterly statement requirements are supported for applicable personal loans.
   - CIC reporting events are generated.

8. Collections and recovery
   - Recovery agent assignment is communicated before contact.
   - Cash recovery, where necessary for delinquent loans, is reflected same day in borrower account.
   - LSP fees are paid by RE, not from borrower recovery proceeds.

9. Closure, restructuring, settlement, write-off
   - Closure statement and NOC are issued.
   - Restructuring/settlement/write-off workflows preserve approval and customer communication evidence.
   - CERSAI security interest satisfaction is tracked for secured loans.

## AI Kill-Switch Design

The AI kill switch is implemented at three levels:

- Global: block all AI/model-assisted decisions for the tenant or platform.
- Model: suspend/deactivate one model version.
- Workflow: route affected cases to manual review, revalidation, or rollback.

Runtime guard behavior:

1. A decision service requests model use with `modelId`, `purpose`, `borrowerImpact`, and `caseId`.
2. AI governance checks global switch, model status, validation status, materiality, and policy requirements.
3. If blocked, the service receives a compliance finding and must not call the model.
4. Event evidence records actor, reason, scope, timestamp, affected model/version, and recovery plan.
5. Clearing a kill switch requires approval reference and does not delete the original event.

## Data Residency and Privacy

Data classes:

- Identity/KYC: India storage, strict access, CKYC/V-CIP evidence, no prohibited Aadhaar artifacts.
- Credit/application: India storage, lifecycle retention, CIC evidence.
- Payment/ledger: India storage; payment-system provider eligibility for India data storage.
- Model input/output: India storage by default; no vendor cross-border processing without a recorded 24-hour return/delete control.
- Audit evidence: append-only storage, retention by regulatory/legal policy.

Every service must emit:

- `data_class`
- `storage_country`
- `processor`
- `retention_policy_id`
- `consent_reference`
- `deletion_or_lock_status`

## Build Sequence

1. Compliance kernel and event model.
2. Tenant/RE, product, DLA, LSP, and model registries.
3. LOS MVP: onboarding, KYC state, underwriting, KFS, sanction, disbursement guard.
4. LMS MVP: loan account ledger, repayment schedule, borrower statements, charges, CIC event feed.
5. LWS MVP: maker-checker, exceptions, grievance, fraud, vendor review.
6. Integrations: CKYC, bureaus/CIC, bank account verification, UPI/NACH/payment rails, eSign, document vault.
7. Supervisory packs: CIMS DLA export, board/risk/compliance packs, audit trails, data-retention evidence.

