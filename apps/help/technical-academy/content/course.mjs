import { journeyCasebookLessons, technicalJourneyLessons } from "./journey-lessons.mjs";

const verified = "2026-07-17";

const lesson = (id, title, duration, objectives, sections, flow, sources, extra = {}) => ({
  id, title, duration, verified, objectives, sections, flow, sources, ...extra
});

const architecture = [
  lesson("platform-map", "The whole platform in one map", "24 min",
    ["Place every LoanOS surface and runtime", "Explain the four product planes", "Trace one request from channel to evidence"],
    [
      ["The product shape", "LoanOS is an India-only, multi-tenant lending operating system. LOS originates credit, LMS owns the live account, LWS coordinates human work, and the compliance control plane makes policy, evidence and model governance executable. These are product planes, not four disconnected products."],
      ["Two runtimes, one governed system", "The Node control/data plane owns HTTP workflows, tenant state and the audit chain. The pure-Rust decision plane evaluates signed policy bundles deterministically. The boundary is deliberate: workflow code asks for a decision; it does not quietly reimplement policy."],
      ["How to read the repository", "Front ends live under apps/. Domain controls live mainly under packages/core/. The API composes those controls in apps/api/. Rust policy execution lives under rules/. PostgreSQL schema and RLS live under db/. Architecture, product maturity and regulatory claims remain governed documents under docs/."],
    ],
    ["Borrower / staff / partner channel", "Node API and domain services", "Per-tenant business + control engines", "Tenant store and audit chain", "Evidence, reports and operations"],
    [["doc", "docs/product/what-we-are-building.md"], ["doc", "docs/architecture/loanos-india-blueprint.md"], ["code", "apps/api/src/server.js"], ["code", "rules/README.md"]]),
  lesson("planes-and-boundaries", "LOS, LMS, LWS and the control plane", "22 min",
    ["State which plane owns each lifecycle fact", "Recognise a dangerous cross-plane shortcut", "Explain shared controls"],
    [
      ["LOS owns origination", "Applications, consent/KYC references, product eligibility, underwriting, KFS, sanction and disbursement readiness belong to LOS. Origination ends only after the controlled transition opens a loan account."],
      ["LMS owns money after disbursement", "Schedules, accruals, ledger entries, balances, allocations, delinquency, repayment, servicing and closure belong to LMS. A UI-calculated balance is never authoritative; the ledger and exact-money domain rules are."],
      ["LWS moves accountable work", "Queues, assignments, SLA clocks, maker-checker, grievances, fraud cases and committees belong to LWS. The control plane supplies tenant, product, policy, partner, regulatory and model authority across all three planes."],
    ],
    ["Product + RE readiness", "LOS application", "Controlled disbursement", "LMS account", "LWS tasks throughout", "Compliance evidence throughout"],
    [["doc", "docs/architecture/loanos-india-blueprint.md"], ["doc", "docs/architecture/platform-module-integration-api-map.md"], ["doc", "docs/architecture/current-implementation.md"]]),
  lesson("request-lifecycle", "An HTTP request from edge to audit", "25 min",
    ["Trace authentication and tenant resolution", "Locate validation and persistence", "Explain why the audit event is part of the transaction"],
    [
      ["Admission before mutation", "A request enters the framework-free Node server, is matched to a route, authenticated by session or API key, and resolved to one tenant. Role, staffing and control-engine authority are checked before protected mutations."],
      ["Pure domain, explicit persistence", "Route handlers translate transport data into calls to pure domain functions. Those functions validate invariants and return canonical records. The store persists tenant-partitioned state; PostgreSQL deployments add RLS as a second isolation boundary."],
      ["Evidence is an output", "Material transitions append attributed audit events. Decision calls retain input, bundle, outcome and trace lineage. Failure at authentication, tenant scope, policy availability or evidence validation returns a restrictive error; it never falls through to success."],
    ],
    ["HTTP route", "Session / API-key auth", "Tenant + role gate", "Domain invariant", "Store / RLS", "Audit projection", "Response"],
    [["code", "apps/api/src/server.js"], ["code", "apps/api/src/file-store.js"], ["doc", "docs/architecture/saas-tenancy-and-operating-model.md"]]),
  lesson("source-of-truth", "PRD, capability status and technical truth", "20 min",
    ["Use the canonical product definition", "Distinguish implemented from production-ready", "Find evidence for a capability claim"],
    [
      ["The PRD stack", "The canonical product definition is what-we-are-building.md. The complete-system capability catalogue decomposes that intent into stable capability IDs and maturity. The journey support matrix owns public maturity for all 21 product journeys. Architecture documents explain the designed boundary; current-implementation.md explains what exists."],
      ["Evidence beats page presence", "A screen, lesson or route is not proof of production readiness. Capability trace records connect a requirement to code, tests and documents. Live providers, tenant configuration, UAT, security, DR and witnessed operating effectiveness may still be required."],
      ["Change discipline", "When code and a load-bearing architecture source disagree, reconcile the design explicitly. User-visible workflow changes update Guide/Academy content. Structural decisions need ADRs; decision-engine changes must map to INV, DEC and SEC obligations."],
    ],
    ["Product definition", "Capability catalogue", "Architecture contract", "Code + tests", "Trace evidence", "Tenant production admission"],
    [["doc", "docs/product/what-we-are-building.md"], ["doc", "docs/product/complete-system-capability-catalog.md"], ["doc", "docs/product/capability-trace.json"], ["doc", "docs/product/product-journey-support-matrix.md"]])
];

const tenancy = [
  lesson("tenant-isolation", "Tenant isolation from request to engine", "26 min",
    ["Describe all isolation layers", "Explain per-tenant engine topology", "Identify cross-tenant failure modes"],
    [["Isolation is layered", "Tenant identity is resolved at admission, propagated through domain and storage calls, partitioned in file state, and enforced with PostgreSQL RLS in database mode. Cache keys, jobs, exports and audit queries must carry the same tenant scope."], ["Engine isolation", "Every tenant receives its own business decision runtime. A separate ctrl-* runtime handles identity and staffing authority. They cannot share URL, bundle, identity or operator boundary."], ["Proof", "Negative tests attempt cross-tenant reads and writes. Production assurance additionally requires deployment configuration, key custody, telemetry privacy and recovery evidence—not just passing unit tests."]],
    ["Authenticated tenant", "Tenant-scoped route", "Tenant domain partition", "Postgres RLS", "Tenant audit chain", "Isolated engine pair"],
    [["doc", "docs/decisions/0002-multi-tenant-saas-delivery.md"], ["doc", "docs/decisions/0005-isolated-platform-control-policy-engine.md"], ["code", "db/schema.sql"]]),
  lesson("identity-staffing", "Identity, roles, staffing and authority", "25 min",
    ["Separate identity from business authority", "Explain staffing gates", "Trace revocation"],
    [["Authentication is not authorization", "Sessions, API keys and federation establish an actor. Tenant roles and feature staffing determine what that actor may do. Domain maker-checker rules remain authoritative even when IAM says a user can reach a route."], ["Control-engine authority", "Protected staff mutations are classified and evaluated through the isolated control rules engine. Unknown or unavailable control decisions deny in active mode."], ["Revocation", "SCIM/federation lifecycle, staff status, delegation expiry, queue assignment and digital-worker installation state all affect authority. Revocation must stop future work while retaining historical attribution."]],
    ["IdP / login", "Tenant actor", "Role + staffing", "ctrl-* decision", "Domain maker-checker", "Attributed mutation"],
    [["doc", "docs/architecture/tenant-role-staffing-and-feature-gating.md"], ["code", "apps/api/src/mutation-staffing-policy.js"], ["doc", "docs/architecture/federated-access-and-forensic-custody-operations.md"]]),
  lesson("bootstrap", "Organisation signup and tenant activation", "24 min",
    ["Trace bootstrap without circular authority", "Name activation gates", "Separate setup from production admission"],
    [["Bootstrap problem", "A new organisation has no trusted tenant administrator yet. Signup therefore creates a bounded bootstrap identity and evidence package before normal tenant authority exists."], ["Activation", "Regulated-entity identity, product policies, staffing, domains, engine runtimes and conformance results become joined readiness evidence. Partial activation must not silently permit lending."], ["Production is later", "Tenant activation makes the platform operable in its approved environment. Production admission additionally requires live integrations, UAT, security and operational assurance."]],
    ["Organisation signup", "Bootstrap identity", "RE verification", "Tenant + engine provisioning", "Staffing", "Conformance", "Activation"],
    [["doc", "docs/architecture/organisation-signup-detailed-design.md"], ["doc", "docs/architecture/tenant-activation-runtime-and-conformance.md"], ["doc", "docs/decisions/0004-bootstrap-identity-and-tenant-activation.md"]])
];

const lending = [
  lesson("origination", "LOS: application to approval", "30 min",
    ["Trace the complete LOS state machine", "Place consent, KYC and credit facts", "Explain refer versus approve"],
    [["Create a governed application", "Channel intake binds an India borrower, regulated entity, active product policy and provenance-tagged facts. Consent and KYC are referenced evidence, not loose booleans copied between screens."], ["Underwrite", "Eligibility, affordability, bureau/account data and fraud signals become decision inputs. Deterministic policy returns approve, refer or decline with trace lineage. Material AI influence requires human review; overrides are attributed and separately authorized."], ["Approve safely", "Approval is a state transition, not a UI button. Required reviews, maker-checker independence, policy version and evidence completeness are validated before the application can proceed to contracting."]],
    ["Lead / application", "Consent + KYC", "Credit facts", "Policy decision", "Human referral", "Maker-checker approval"],
    [["doc", "docs/architecture/origination-journey.md"], ["code", "packages/core/src/application-workflow.js"], ["code", "apps/api/src/rules-engine.js"]]),
  lesson("kfs-contract-disburse", "KFS, contracting and disbursement", "30 min",
    ["Explain disclosure readiness", "Trace document evidence", "Describe the fund-flow guard"],
    [["KFS before commitment", "The platform calculates APR and charges, renders the KFS and amortisation disclosure, records digital delivery and acceptance, and prevents sanction readiness when evidence is incomplete."], ["Execution packet", "Sanction letter, agreement summary, privacy notice, checksums, delivery and eSign evidence form a versioned packet. A later dispute should reconstruct exactly what the borrower received and accepted."], ["Money moves last", "Bank-account verification, mandate/payment evidence, purpose-specific payee rules and direct fund-flow controls run before disbursement. A failed provider or ambiguous beneficiary blocks the transition; it does not create a loan account."]],
    ["Approved terms", "KFS render", "Delivery + acceptance", "Agreement + eSign", "Bank/payee verification", "Fund-flow decision", "Disburse + open LMS"],
    [["code", "packages/core/src/loan-policy.js"], ["code", "packages/core/src/document-packet.js"], ["doc", "docs/architecture/origination-journey.md"]]),
  lesson("lms-ledger", "LMS: schedule, ledger and exact money", "32 min",
    ["Distinguish schedule from ledger", "Explain exact-paise accounting", "Reconstruct a balance"],
    [["Account opening", "Successful disbursement opens the LMS account with contractual principal, rate, tenor and schedule rules. Schedule rows describe expected cash flows; ledger events record what actually happened."], ["Exact money", "Domain values use integer paise or validated decimal strings at boundaries. Interest, allocation, charges, waivers and reversals have explicit rounding. Floating point is prohibited on Rust evaluation paths."], ["Reconstruction", "Balance is derived from ordered, immutable ledger events. Payment allocation, accrual, prepayment, foreclosure and correction events preserve lineage; destructive editing would make statements and audit replay unreliable."]],
    ["Disbursement event", "Contract schedule", "Accrual events", "Payment allocation", "Charges / reversals", "Derived balance", "Statement"],
    [["code", "packages/core/src/loan-account.js"], ["doc", "docs/architecture/decision-engine-design.md"], ["doc", "docs/product/what-we-are-building.md"]]),
  lesson("servicing-collections", "Servicing, delinquency, collections and closure", "32 min",
    ["Trace a performing and distressed account", "Explain DPD/SMA/NPA derivation", "Locate closure evidence"],
    [["Servicing", "Payments reconcile to ledger allocations; statements and change notices derive from canonical account state. Rate resets, mandate changes, prepayment and foreclosure are controlled events with borrower communications."], ["Distress", "Overdue amounts derive DPD and asset classification. LWS creates collection/review work; strategy, agent assignment, conduct evidence, cash posting, hardship, restructure and recovery accounting remain linked to the account."], ["Closure", "A zero economic balance is necessary but not sufficient. Closure posts the final state, releases collateral/security where relevant, produces NOC and bureau/reporting updates, and retains the full account history."]],
    ["Due instalment", "Payment or overdue", "DPD + classification", "Collections / restructure", "Settlement / recovery", "Zero balance", "Release + NOC + close"],
    [["code", "packages/core/src/loan-account.js"], ["code", "packages/core/src/servicing-collections-completion.js"], ["code", "packages/core/src/lms-recovery-closure-completion.js"]])
];

const platformInternals = [
  lesson("channel-surfaces", "Web, mobile and assisted-channel boundaries", "26 min",
    ["Map each user surface to its authority", "Keep browser and device state non-authoritative", "Trace channel risk controls"],
    [["Surfaces are projections", "Customer, tenant, dashboard, platform, field-operations and DSA experiences project tenant-scoped API state. They may collect and display facts, but cannot become a parallel ledger, policy store or approval authority."], ["Channel controls", "Sessions, step-up authentication, device posture, consent purpose, field-agent attribution and offline synchronization constrain what each surface can do. A stale or untrusted client must be rejected or referred at the server boundary."], ["Accessible, tenant-aware delivery", "Branding and role navigation are tenant overlays on canonical workflows. Accessibility, language and low-bandwidth behavior must preserve the same evidence and control semantics rather than introducing a weaker path."]],
    ["Customer / staff / partner surface", "Session + device context", "Tenant API", "Domain and policy authority", "Audit event", "Safe projection"],
    [["doc", "docs/architecture/customer-channel-experiences.md"], ["code", "apps/api/src/routes/customer-channel-controls.js"], ["code", "packages/core/src/customer-channel-operations.js"]]),
  lesson("api-contracts", "API composition, validation and idempotency", "28 min",
    ["Separate transport from domain authority", "Design replay-safe mutations", "Understand module composition"],
    [["A thin transport boundary", "The framework-free HTTP server authenticates, resolves the tenant and translates payloads. Domain packages own invariants; routes must not duplicate policy or manufacture success from incomplete downstream results."], ["Safe retries", "Mutation contracts validate identifiers, versions and evidence, then use idempotency or replay protection where duplicate delivery is possible. Provider callbacks are authenticated before they can advance state."], ["Composition", "Cross-module journeys join stable records and attributed events across LOS, LMS, LWS and the control plane. Explicit contracts prevent a convenience endpoint from bypassing maker-checker, decision or evidence gates."]],
    ["HTTP request", "Auth + tenant", "Schema + version", "Domain command", "Idempotency / replay gate", "Persistence + audit", "Canonical response"],
    [["doc", "docs/architecture/platform-module-integration-api-map.md"], ["code", "apps/api/src/server.js"], ["code", "apps/api/src/provider-callback-dispatcher.js"]]),
  lesson("storage-rls", "Storage, PostgreSQL RLS and migrations", "30 min",
    ["Compare file and PostgreSQL drivers", "Explain RLS as a second boundary", "Make schema change fail closed"],
    [["One storage contract", "Local showcase mode uses tenant-partitioned JSON while production-shaped deployments can use PostgreSQL. Both implement the same storage boundary so domain behavior does not change with the driver."], ["Defence in depth", "Application code must always carry tenant scope. PostgreSQL row-level security independently restricts rows using the transaction tenant context; it does not excuse missing app-layer checks."], ["Controlled evolution", "Schema compatibility, backfill, rollback and audit preservation are release concerns. An unknown or incompatible schema blocks activation or deployment until a reviewed migration or replacement path exists."]],
    ["Tenant domain record", "Storage contract", "Transaction tenant context", "RLS policy", "Commit + audit", "Migration evidence"],
    [["code", "apps/api/src/storage.js"], ["code", "apps/api/src/postgres-store.js"], ["code", "db/schema.sql"], ["doc", "docs/architecture/postgres-migration.md"]]),
  lesson("reporting-data-products", "Regulatory reporting, analytics and data products", "28 min",
    ["Separate operational truth from projections", "Preserve purpose and tenant isolation", "Trace report evidence"],
    [["Projections, not new truth", "CIC files, finance extracts, dashboards and analytical datasets are derived from canonical domain records and ledger events. Corrections remain governed domain events and flow into regenerated projections."], ["Purpose-separated data", "Exports and data products carry tenant, purpose, residency, minimization, retention and access controls. Cross-tenant aggregation cannot expose tenant or borrower data through metrics, caches or model features."], ["Submission evidence", "Report generation records the source window, schema/version, control checks, totals and checksum. Submission acknowledgement, rejection, correction and resubmission remain linked for audit replay."]],
    ["Canonical records + ledger", "Controlled projection", "Quality reconciliation", "Versioned report / dataset", "Submission or use", "Acknowledgement + lineage"],
    [["code", "packages/core/src/reporting-data-integration-completion.js"], ["code", "packages/core/src/cic-reporting.js"], ["doc", "docs/architecture/data-governance.md"]])
];

const customerAndRisk = [
  lesson("crm-parties", "Leads, customers, parties and relationships", "28 min",
    ["Trace a lead into a governed party record", "Model individuals and legal entities", "Prevent duplicate and cross-tenant identities"],
    [["Acquisition is governed", "DLA, branch, DSA, partner and assisted leads retain channel, campaign, consent purpose, attribution and neutral-offer evidence before conversion."], ["Party is broader than borrower", "Individuals, organisations, beneficial owners, co-applicants, guarantors, nominees and related parties use typed relationships and effective dates rather than being flattened into an application."], ["Resolution is tenant-local", "Deduplication and relationship resolution are tenant scoped, evidence based and reviewable. A probable match creates work; it does not silently merge people or leak another tenant's identity."]],
    ["Campaign / referral", "Lead + consent", "Party resolution", "Relationship graph", "Application role", "Attributed history"],
    [["code", "packages/core/src/channel-crm-governance.js"], ["code", "packages/core/src/customer-identity-operations.js"], ["doc", "docs/architecture/customer-channel-experiences.md"]]),
  lesson("consent-rights", "Consent, privacy and data-principal rights", "30 min",
    ["Explain purpose-bound consent", "Trace access, correction and erasure", "Reconcile retention and legal hold"],
    [["Consent is a ledger", "Notice version, language, purpose, data categories, channel, actor and proof are recorded as a lifecycle. Withdrawal stops future optional processing without erasing required historical evidence."], ["Rights are workflows", "Access, correction, nomination and erasure requests authenticate the person, gather scoped data, run SLA clocks and retain fulfilment evidence. They are not ad-hoc database edits."], ["Retention wins explicitly", "Regulatory retention, active contracts, disputes and legal holds may delay erasure. The response records the lawful reason and later resumes deletion or redaction when the hold clears."]],
    ["Notice + purpose", "Consent event", "Permitted processing", "Rights request", "Retention / legal-hold decision", "Fulfilment evidence"],
    [["code", "packages/core/src/data-principal-rights.js"], ["code", "packages/core/src/data-retention.js"], ["doc", "docs/architecture/data-governance.md"]]),
  lesson("kyc-aml", "KYC, CDD, AML and sanctions screening", "34 min",
    ["Trace KYC and beneficial ownership", "Separate provider evidence from verified status", "Operate ongoing AML review"],
    [["Identity evidence", "CKYCRR, offline Aadhaar, V-CIP and permitted documents enter through typed provider evidence. Prohibited biometric, OTP and PID artifacts are never persisted."], ["Risk-based CDD", "Customer type, beneficial ownership, PEP/sanctions results, geography, occupation/business and source-of-funds evidence determine due diligence and periodic-review requirements."], ["Ongoing control", "Expiry, material change and monitoring alerts move a customer to refresh or enhanced review. Missing or unavailable authoritative evidence blocks sanction or escalates; it never becomes verified by default."]],
    ["Identity evidence", "Provider verification", "Beneficial owners", "Screening + risk rating", "Periodic review", "Eligible / refresh / EDD"],
    [["code", "packages/core/src/kyc-underwriting-completion.js"], ["code", "packages/core/src/risk-aml-governance.js"], ["doc", "docs/architecture/risk-aml-fraud-governance.md"]]),
  lesson("fraud-application-risk", "Fraud, identity and application-risk operations", "32 min",
    ["Separate signals from findings", "Trace investigation and natural justice", "Coordinate fraud and cyber incidents"],
    [["Signals are not verdicts", "Device, velocity, document, bureau and network anomalies create explainable risk signals. Rules and approved models can refer or hold an application, but unreviewed signals do not label a customer fraudulent."], ["Governed case", "Investigation preserves evidence, conflicts, notices, responses and committee independence. Classification and reporting require the defined authority and natural-justice steps."], ["Contain and report", "Confirmed fraud can revoke credentials, pause journeys and trigger bank, FIU, RBI or law-enforcement duties. Case, financial, security and reporting records remain linked without conflating their ownership."]],
    ["Risk signal", "Application hold", "Investigation case", "Customer response", "Independent classification", "Containment + reporting"],
    [["code", "packages/core/src/fraud-case.js"], ["doc", "docs/architecture/risk-aml-fraud-governance.md"], ["code", "packages/core/src/security-operations.js"]]),
  lesson("documents-verification", "Documents, OCR, verification and evidence custody", "30 min",
    ["Trace document provenance", "Treat OCR as a proposal", "Bind execution packets immutably"],
    [["Custody first", "Uploads record tenant, actor, purpose, media type, checksum, malware result, classification and encryption metadata before a document can support a decision."], ["Extraction is not truth", "OCR and document AI produce provenance-tagged candidate facts with confidence and model lineage. Validation or human review promotes accepted facts; low confidence and mismatch create work."], ["Packets are immutable", "KFS, sanction, agreement, notices and signed artifacts bind exact versions and checksums with delivery and acceptance evidence. Replacement creates a new version rather than rewriting what the borrower saw."]],
    ["Upload", "Scan + checksum", "OCR / extraction", "Verify or review", "Versioned vault", "Packet + delivery evidence"],
    [["code", "packages/core/src/document-vault.js"], ["code", "packages/core/src/document-packet.js"], ["code", "packages/core/src/kyc-underwriting-completion.js"]])
];

const creditAndAssets = [
  lesson("underwriting-cam", "Underwriting workbench, CAM and human decisions", "34 min",
    ["Assemble a credit assessment", "Separate policy outcome from human authority", "Govern exceptions and overrides"],
    [["One evidence map", "Applicant, bureau, Account Aggregator, income, obligation, fraud, collateral and product-policy facts retain source and freshness in the credit assessment memorandum."], ["Decision layers", "Deterministic policy produces eligibility and referral reasons. Approved models may contribute tagged facts; the sanctioned human authority owns material judgment and cannot delegate approval to generated narrative."], ["Exceptions are explicit", "Policy exceptions name the rule, rationale, compensating controls, approver and expiry. Maker-checker and committee independence are validated from authenticated actors and prior action history."]],
    ["Verified credit facts", "Policy evaluation", "CAM proposal", "Referral / exception", "Independent approval", "Decision evidence"],
    [["code", "packages/core/src/eligibility.js"], ["code", "packages/core/src/kyc-underwriting-completion.js"], ["doc", "docs/architecture/origination-journey.md"]]),
  lesson("collateral-security", "Collateral, valuation and security perfection", "34 min",
    ["Model collateral and ownership", "Trace valuation independence", "Gate disbursement on perfection"],
    [["Asset and charge", "Property, vehicle, equipment, gold and receivable collateral use typed assets, owners, liens, insurance, custody and security-interest records rather than a generic notes field."], ["Independent value", "Panel eligibility, valuation method, date, comparables, haircut and review evidence determine eligible value and LTV. Stale, conflicted or missing valuation refers or blocks."], ["Perfect before funding", "Title/legal review, CERSAI or other registration, original-document custody and insurance conditions become explicit disbursement gates. Monitoring, revaluation, release and satisfaction continue through closure."]],
    ["Asset + owner", "Search + legal review", "Independent valuation", "Security creation", "Registration + custody", "Monitor / release"],
    [["code", "packages/core/src/collateral-disbursement-completion.js"], ["code", "packages/core/src/cersai.js"], ["doc", "docs/architecture/composed-product-journey-lifecycle.md"]]),
  lesson("payments-reconciliation", "Payments, mandates, allocation and reconciliation", "34 min",
    ["Trace a payment rail end to end", "Apply exact allocation", "Resolve breaks without duplicate posting"],
    [["Mandate and initiation", "NACH, UPI, bank and other rails bind customer authority, account verification, limits, purpose, due item and idempotency before initiation or presentment."], ["Settlement before ledger", "Signed provider events and settlement files reconcile to the expected instruction. Only an accepted, unmatched settlement posts once to the immutable loan ledger using the configured waterfall."], ["Break operations", "Returns, chargebacks, suspense, value-date corrections and unmatched rows create attributed work with exact-paise reconciliation. Corrections use reversal and repost events, never destructive edits."]],
    ["Mandate / instruction", "Rail initiation", "Signed status", "Settlement reconciliation", "Exact allocation", "Break or ledger post"],
    [["code", "packages/core/src/payment-operations.js"], ["code", "packages/core/src/payment-reconciliation.js"], ["code", "packages/core/src/loan-account.js"]])
];

const institutional = [
  lesson("product-administration", "Product, pricing and policy administration", "32 min",
    ["Separate templates from tenant products", "Version pricing and policy", "Promote configuration safely"],
    [["Canonical template", "Platform templates define bounded product families and required contracts. A tenant subscription and derivative can narrow or configure allowed behavior but cannot remove regulatory invariants."], ["Versioned economics", "Rates, charges, GST, allocation, eligibility, documents and journey controls use effective-dated immutable versions with independent approval."], ["Promotion", "Configuration moves through development, test, UAT and production with diff, validation, conformance, rollback and attribution. An unknown field or stale dependency blocks activation."]],
    ["Platform template", "Tenant subscription", "Draft derivative", "Validate + four eyes", "Environment promotion", "Effective product version"],
    [["code", "packages/core/src/product-platform-administration.js"], ["code", "packages/core/src/product-template-catalogue.js"], ["doc", "docs/architecture/re-tenant-onboarding-and-product-administration.md"]]),
  lesson("partners-economics", "LSP, DSA, co-lending and partner economics", "34 min",
    ["Govern partner authority", "Trace participant accounting", "Control commissions and settlement"],
    [["Partner lifecycle", "Due diligence, agreement, services, territories, credentials, capacity, training, incidents and exit define what an LSP, DSA, recovery agency or co-lender may do."], ["Customer obligation stays coherent", "Co-lending participant shares and DLG protections do not fragment the borrower's contractual account. Entity books, escrow and settlement reconcile to the same canonical obligation."], ["Exact economics", "Commissions, clawbacks, GST/TDS, participant interest and settlement use integer paise, approved schedules and independently reconciled invoices. A dispute pauses affected settlement without rewriting source events."]],
    ["Partner admission", "Scoped authority", "Attributed activity", "Exact economics", "Invoice / escrow reconciliation", "Oversight / exit"],
    [["code", "packages/core/src/partner-finance.js"], ["code", "packages/core/src/co-lending-finance.js"], ["doc", "docs/architecture/institutional-operations.md"]]),
  lesson("finance-treasury-tax", "Finance, tax, treasury and profitability", "34 min",
    ["Map subledger to general ledger", "Explain tax evidence", "Trace funding and profitability"],
    [["Accounting boundary", "Loan, payment, charge, waiver, write-off and recovery events produce balanced accounting projections. EOD/BOD pauses until external GL acknowledgement and exact reconciliation."], ["Tax", "GST and TDS treatment is determined from versioned product, charge, party and jurisdiction facts. Returns and invoices retain source-event and correction lineage."], ["Treasury and profitability", "Cash position, funding facilities, ALM, transfer pricing and product/partner profitability derive from reconciled books. Management views cannot alter customer balances or hide unsettled breaks."]],
    ["Domain financial event", "Subledger entries", "Tax treatment", "GL interface + acknowledgement", "Treasury projection", "Profitability + reconciliation"],
    [["code", "packages/core/src/finance-accounting.js"], ["code", "packages/core/src/finance-management.js"], ["code", "packages/core/src/tax.js"]]),
  lesson("enterprise-risk", "Portfolio, credit, market and operational risk", "32 min",
    ["Aggregate without losing lineage", "Trace limits and early warnings", "Separate measurement from action authority"],
    [["Portfolio view", "Exposure, concentration, vintage, delinquency, expected-loss and stress views derive from tenant-local accounts and approved classifications with drill-back lineage."], ["Limits and signals", "Borrower/group, product, geography, partner, sector and funding limits run on defined measures and effective versions. Breach and early-warning signals create review or containment work."], ["Governed action", "Risk appetite, overrides, provisioning, watchlists and remediation require named committees and evidence. Analytics or model scores inform action but do not silently mutate accounts or policy."]],
    ["Reconciled exposures", "Risk measures", "Limits + stress", "Breach / EWS", "Committee action", "Monitoring evidence"],
    [["code", "packages/core/src/finance-management.js"], ["code", "packages/core/src/reporting-data-integration-completion.js"], ["doc", "docs/architecture/institutional-operations.md"]]),
  lesson("customer-protection", "Grievance, conduct and customer protection", "30 min",
    ["Trace complaint ownership and SLA", "Control staff and partner conduct", "Escalate and remediate fairly"],
    [["One complaint record", "Every channel captures acknowledgement, category, product/account link, owner, communications, evidence and regulatory clocks. Transfers do not restart the clock."], ["Conduct controls", "Recovery contact windows, agent notice, language, vulnerable-customer flags, dark-pattern prevention and partner monitoring apply consistently across channels."], ["Resolution and escalation", "Root cause, redress, compensation, closure acceptance and RBI CMS escalation retain independent review. Repeat issues feed product, partner and control remediation rather than disappearing as closed tickets."]],
    ["Complaint / conduct signal", "Acknowledge + classify", "Investigate", "Redress / compensation", "Independent closure", "Escalation + root cause"],
    [["code", "packages/core/src/grievance.js"], ["code", "packages/core/src/partner-grievance-completion.js"], ["doc", "docs/architecture/customer-channel-experiences.md"]]),
  lesson("regulatory-reporting", "Regulatory and external reporting operations", "34 min",
    ["Build a controlled filing", "Reconcile acknowledgements and corrections", "Distinguish authority-specific duties"],
    [["Authority-specific contracts", "CIC, CKYCRR, FIU-IND, CERSAI, DLA/CIMS and other submissions use versioned schemas, calendars, signatories, residency and channel requirements."], ["Pre-submission control", "The platform freezes the source window, validates completeness, reconciles counts and exact totals, records maker-checker approval and seals a checksum before dispatch."], ["Closed-loop evidence", "Signed acknowledgement, row rejects, correction, resubmission and accepted closure link to the original filing. Portal/manual submission remains an evidenced external dependency rather than being presented as automated."]],
    ["Reporting calendar", "Source snapshot", "Schema + reconciliation", "Approval + checksum", "Dispatch / portal", "Ack / correct / close"],
    [["code", "packages/core/src/cic-reporting.js"], ["code", "packages/core/src/ckyc-reporting.js"], ["code", "packages/core/src/reporting-data-integration-completion.js"]])
];

const deliveryAndExperience = [
  lesson("field-branch-operations", "Branch, DSA and field-operations architecture", "30 min",
    ["Trace territory and assignment", "Operate offline safely", "Preserve conduct and cash evidence"],
    [["Operational hierarchy", "Branch, agency, manager, field officer and DSA relationships constrain territory, capacity, product and task assignment. Revocation and expiry stop new work immediately."], ["Offline is bounded", "Mobile apps cache only an encrypted, time-boxed workset. Commands carry version and idempotency evidence; server reconciliation rejects stale authority or conflicting state."], ["Field proof", "Visits, geo/time evidence, customer acknowledgement, recovery-agent notice, receipts and same-day cash posting retain device and actor lineage with privacy minimization."]],
    ["Authorized roster", "Territory + queue", "Encrypted offline workset", "Field action + evidence", "Sync conflict gate", "Domain + audit update"],
    [["doc", "docs/architecture/android-field-operations-app.md"], ["doc", "docs/architecture/android-dsa-origination-app.md"], ["code", "packages/core/src/channel-crm-governance.js"]]),
  lesson("implementation-migration", "Implementation, migration, UAT and adoption", "36 min",
    ["Plan a tenant implementation", "Reconcile migration exactly", "Separate sandbox readiness from production admission"],
    [["Controlled implementation", "Discovery maps products, processes, roles, data, integrations, controls and gaps into versioned configuration and accountable work. Scope changes reopen affected evidence."], ["Migration", "Mapping packs, cleansed source extracts, dry runs, rejects, exact financial reconciliation, cutover and rollback are tenant scoped and independently approved. Unreconciled balances block launch."], ["Adoption and admission", "Role training, sandbox campaigns, UAT, operating procedures, staffing, support and witnessed cutover join technical evidence. Simulator success can establish sandbox readiness, never live production readiness."]],
    ["Discovery + scope", "Configuration + mapping", "Dry run + reconciliation", "UAT + training", "Four-eyes cutover", "Hypercare + admission evidence"],
    [["code", "packages/core/src/implementation-governance.js"], ["doc", "docs/architecture/implementation-migration-go-live.md"], ["doc", "docs/architecture/production-completion-controls.md"]]),
  lesson("engineering-quality", "Testing, delivery governance and definition of done", "32 min",
    ["Choose the right evidence layer", "Run adverse and isolation tests", "Keep docs and claims aligned"],
    [["Test pyramid for controls", "Pure domain tests prove invariants; API tests prove authentication, tenancy and composition; PostgreSQL tests prove RLS; Rust tests prove deterministic policy; conformance packs prove provider behavior."], ["Adverse first", "Timeout, replay, duplicate, stale version, cross-tenant, revoked actor, self-approval, reconciliation and recovery cases are mandatory wherever the happy path could move money or authority."], ["Done includes truth", "Code, tests, architecture, capability trace, user guidance and maturity claims move together. A screen or simulator does not advance production status without environment and operating evidence."]],
    ["Requirement + invariant", "Implementation", "Unit + integration", "Adverse + isolation", "Docs + trace", "Release / admission evidence"],
    [["doc", "docs/architecture/current-implementation.md"], ["doc", "docs/product/complete-system-capability-catalog.md"], ["code", ".github/workflows/ci.yml"]])
];

const rulesEngine = [
  lesson("engine-contract", "Decision-engine architecture and invariants", "34 min",
    ["Explain the pure deterministic core", "Map INV, DEC and SEC obligations", "Recognise policy that belongs outside workflow code"],
    [["A separate policy plane", "The Rust workspace is the deterministic policy brain. Workflow gathers canonical facts and asks a named decision; policy does not leak into route-level conditionals."], ["Load-bearing invariants", "Evaluation has no clock, randomness or I/O, uses exact decimals, produces stable trace lineage and fails closed. The design document's INV, DEC and SEC identifiers are test obligations, not commentary."], ["Crate boundaries", "Core contracts, expressions, models, compilation, evaluation, bundles, governance, providers and service adapters remain separated so pure evaluation crates do not acquire network or async dependencies."]],
    ["Decision contract", "Typed model", "Compiled expression", "Pure evaluation", "Outcome + trace", "Invariant tests"],
    [["doc", "docs/architecture/decision-engine-design.md"], ["code", "rules/Cargo.toml"], ["code", "rules/crates/rules-core/src/contract.rs"]]),
  lesson("model-expression", "Decision models, facts and expression language", "34 min",
    ["Read a model contract", "Distinguish missing, invalid and false", "Design explainable outcomes"],
    [["Typed facts", "Models declare the facts they accept, their types and validation constraints. Money and ratios cross JSON boundaries as strings so parsing is explicit and floating-point ambiguity never enters evaluation."], ["Expression semantics", "The expression language supports bounded deterministic operations with defined comparison, boolean and missing-value behavior. Unknown functions or malformed operands invalidate evaluation rather than producing a permissive guess."], ["Outcomes and reasons", "Models return domain outcomes such as approve, refer, decline, allow, deny or require_human with stable reason and trace information. Explainability comes from evaluated policy structure, not generated prose."]],
    ["Input schema", "Canonical facts", "Expression graph", "Typed operators", "Outcome", "Reasons + trace"],
    [["code", "rules/crates/rules-expr/SPEC.md"], ["code", "rules/crates/rules-model/Cargo.toml"], ["code", "rules/fixtures/lending-eligibility.json"]]),
  lesson("bundle-governance", "Bundle compilation, approval and signing", "32 min",
    ["Trace policy from source to runtime", "Explain four-eyes and signature checks", "Handle stale or incompatible bundles"],
    [["Compile before publish", "Authored model JSON is schema-checked and compiled into a bounded bundle. Golden cases prove intended behavior before the artifact can become a release candidate."], ["Governed publication", "Content hashes bind the exact artifact. Independent approval and ed25519 signing establish provenance; runtime verification rejects tampering, wrong tenant, wrong purpose, expiry or incompatible versions."], ["Immutable promotion", "A published version is never silently edited. Promotion, canary, rollback and retirement retain the version and approval trail, while an unavailable valid bundle produces a restrictive decision."]],
    ["Authored models", "Compile + corpus", "Independent approval", "Hash + sign", "Tenant promotion", "Runtime verification", "Retire / rollback"],
    [["code", "rules/crates/rules-bundle/src/lib.rs"], ["code", "rules/crates/rules-governance/Cargo.toml"], ["code", "rules/crates/rules-bundle/tests/bundle_security.rs"]]),
  lesson("evaluation", "Deterministic evaluation and exact money", "34 min",
    ["Trace one evaluation", "Explain exact decimal handling", "Prove fail-closed behavior"],
    [["Canonical request", "The gateway sends a decision name, tenant-bound bundle identity and validated facts. The evaluator performs no lookup: all permitted inputs are present in the request and bundle."], ["Exact and reproducible", "Decimal values use rust_decimal and serialized strings. Stable ordering and canonical output ensure the same accepted input and bundle produce byte-identical decision evidence."], ["Restrictive errors", "Missing facts, invalid decimals, unsupported operations, contract mismatch and internal errors cannot fall through to approve or allow. Business decisions refer; authority and guardrail decisions deny or require human review as defined by contract."]],
    ["Verified bundle", "Validated fact set", "Exact-decimal operators", "Expression evaluation", "Restrictive outcome", "Canonical trace"],
    [["code", "rules/crates/rules-eval/src/lib.rs"], ["code", "rules/clippy.toml"], ["doc", "docs/architecture/decision-engine-design.md"]]),
  lesson("runtime-topology", "Per-tenant runtimes and Node gateways", "32 min",
    ["Separate business and control runtimes", "Trace gateway failure handling", "Understand provider and service adapters"],
    [["Isolation is physical", "Each tenant has its own business runtime and a separately administered ctrl-* runtime for staffing and identity authority. They cannot share URL, bundle, identity or operator boundary."], ["Two explicit gateways", "The business and control Node gateways validate response contracts and map timeout, unavailable service or malformed output to restrictive results. Workflow code consumes only the typed gateway result."], ["Runtime forms", "The workspace supports service, native and WebAssembly adapter boundaries without weakening the core contract. Deployment chooses an approved provider while conformance verifies identical policy semantics."]],
    ["Tenant workflow", "Business or control gateway", "Isolated runtime identity", "Verified bundle", "Evaluate", "Typed restrictive response", "Audit"],
    [["code", "apps/api/src/rules-engine.js"], ["code", "apps/api/src/control-rules-engine.js"], ["code", "rules/crates/rules-service/Cargo.toml"], ["doc", "docs/decisions/0005-isolated-platform-control-policy-engine.md"]]),
  lesson("replay-testing-operations", "Golden corpora, differential replay and fleet operations", "36 min",
    ["Build a policy test strategy", "Replay a historical decision", "Operate a runtime fleet safely"],
    [["Layered proof", "Unit and property tests cover expression semantics; golden corpora cover policy examples; bundle security tests cover provenance; gateway tests cover fail-closed integration. Float-deny clippy and cargo-audit protect the evaluation supply chain."], ["Differential replay", "Corpus generation and rules-diff compare implementations or policy versions before promotion. rules-replay reconstructs decisions from retained bundle and fact lineage, making behavioral changes visible rather than anecdotal."], ["Fleet operations", "Health, version inventory, staged rollout and rollback operate per tenant and separately for business and control fleets. A runtime may be replaced, but policy identity and evidence continuity must remain intact."]],
    ["Model change", "Golden + adverse corpus", "Compile + security tests", "Differential replay", "Tenant canary", "Fleet promotion", "Monitor / rollback"],
    [["code", "rules/fixtures/eligibility-corpus.json"], ["code", "rules/tools/rules-diff/Cargo.toml"], ["code", "rules/tools/rules-replay/Cargo.toml"], ["code", "rules/tools/rules-fleet/Cargo.toml"]])
];

const controls = [
  lesson("lws", "LWS queues, SLA and maker-checker", "26 min",
    ["Explain derived work", "Trace assignment and SLA evidence", "Enforce independence"],
    [["Tasks are derived", "LWS projects actionable work from domain state: compliance exceptions, AI review, checker approval, disbursement, collections, NPA review and grievances. Resolving the domain condition resolves the task; a separate task database must not become a competing truth."], ["Work is attributed", "Assignment, start, release and comment events retain actor, role, queue and time evidence. Business calendars and SLA policies determine due state."], ["Four eyes", "Maker and checker independence is validated against authenticated identity and action history. Committees, overrides and release approvals add purpose-specific authority rather than generic admin bypasses."]],
    ["Domain condition", "Derived queue item", "Authorized assignment", "Work + evidence", "Independent approval", "Domain transition"],
    [["code", "packages/core/src/workflow-tasks.js"], ["doc", "docs/architecture/institutional-operations.md"], ["doc", "docs/architecture/tenant-role-staffing-and-feature-gating.md"]]),
  lesson("ai-workers", "AI models and governed digital workers", "30 min",
    ["Explain model provenance", "Trace kill-switch enforcement", "Describe proposal-only workers"],
    [["Models do not become policy", "Model output enters as a provenance-tagged fact with model/version/use-case lineage. Material influence invokes human review. Deterministic rules—not a model response—own the final executable outcome."], ["Kill switch", "Model governance owns global, model and workflow switch state; the decision engine enforces it. A disabled or unvalidated dependency degrades model-dependent work to manual review."], ["Workers", "Marketplace installations require commercial, role, staffing and guardrail activation. Workers propose CAM, underwriting, document or service outputs; independent humans approve material actions. Execution retains installation, model, prompt, guardrail, input and output lineage."]],
    ["Approved installation", "Model + prompt", "Input minimization", "Dual guardrails", "Proposal", "Human approval", "Mutation + lineage"],
    [["code", "packages/core/src/model-governance.js"], ["doc", "docs/architecture/agentic-ai-digital-workers.md"], ["doc", "docs/architecture/ai-agent-platform-operations.md"]]),
  lesson("audit-compliance", "Audit chain, compliance and evidence", "28 min",
    ["Explain tamper evidence", "Build an evidence pack mentally", "Separate control design from operating effectiveness"],
    [["Audit spine", "Material events are canonicalized and linked by hashes. Actor, tenant, action, object, policy and before/after context make silent mutation detectable while redaction rules keep prohibited data out."], ["Compliance by construction", "The regulatory register maps obligations into control families. Consent, KFS, fund-flow, grievance, model, vendor and reporting evidence is emitted during workflows rather than assembled from screenshots afterward."], ["Assurance", "Code and tests demonstrate control design. Production claims additionally require tenant configuration, provider evidence, monitored operation, incident handling, DR exercises and independent review with expiry."]],
    ["Regulatory obligation", "Control + policy", "Workflow enforcement", "Audit event", "Evidence export", "Control-owner / auditor review"],
    [["code", "packages/core/src/audit.js"], ["doc", "docs/compliance/platform-admission-control-map.md"], ["doc", "docs/architecture/control-assurance.md"]])
];

const journeyOverview = [
  lesson("journey-framework", "How all product journeys are composed", "25 min",
    ["Distinguish base lifecycle from journey contract", "Locate journey configuration", "Read maturity correctly"],
    [["Composition", "Every product journey reuses the governed base lifecycle and adds typed facts, evidence gates, lifecycle extensions and product-specific controls. Journey differences are data contracts, not forks of the whole LOS/LMS."], ["Execution", "The canonical contract registry defines required fields and evidence. APIs persist tenant journey state, workspaces render typed tasks, and conformance tests cover every declared journey."], ["Maturity", "Controlled first slice and configurable pattern describe platform evidence, not a tenant go-live. Each tenant still needs policy bindings, owners, live providers, UAT and operating assurance."]],
    ["Base lending lifecycle", "Product journey contract", "Tenant configuration", "Typed workspace", "Conformance evidence", "Tenant activation"],
    [["code", "packages/core/src/product-journey-contracts.js"], ["doc", "docs/architecture/composed-product-journey-lifecycle.md"], ["doc", "docs/product/product-journey-support-matrix.md"]]),
  lesson("retail-secured-journeys", "Retail and secured journeys", "34 min",
    ["Compare personal, property, vehicle and gold flows", "Locate collateral/perfection controls", "Name each journey's servicing duty"],
    [["Unsecured personal", "Personal lending uses the common consent, KYC, affordability, bureau, policy, KFS, mandate and direct-disbursement path without collateral perfection."], ["Property and housing", "Loan against property and home loans add title, valuation, legal review, insurance, LTV, security perfection, construction-stage or developer evidence, and release. Secured business lending uses the same collateral spine with business cash-flow facts."], ["Vehicle and gold", "Vehicle loans add dealer payment, registration, hypothecation, permit/insurance tracking and release. Gold adds exact assay/weight, packet custody, daily LTV monitoring, margin calls and controlled auction."]],
    ["Personal loan", "Secured business / LAP / home", "Personal / commercial vehicle", "Gold", "Shared collateral + release services"],
    [["code", "packages/core/src/product-journey-contracts.js"], ["code", "packages/core/src/collateral-disbursement-completion.js"], ["doc", "docs/architecture/archetype-journey-workspaces.md"]]),
  lesson("msme-asset-journeys", "MSME, equipment and green finance", "32 min",
    ["Compare term and revolving credit", "Trace supplier/end-use evidence", "Explain the green evidence layer"],
    [["MSME credit", "MSME term loans reuse scheduled lending with business registration, cash flow, purpose and security facts. Working capital adds facility limits, draws, utilisation, interest, repayments and periodic borrowing-base/review controls."], ["Equipment", "Equipment finance binds supplier, invoice, serial/asset, installation, borrower margin and staged direct supplier payment to collateral controls."], ["Green equipment", "Green finance composes the equipment journey with approved taxonomy, baseline impact, incentive/subsidy and periodic re-verification evidence. The label never substitutes for asset or credit controls."]],
    ["Business facts", "Term or revolving structure", "Supplier + asset evidence", "Stage payment", "Collateral monitoring", "Green re-verification"],
    [["code", "packages/core/src/product-journey-contracts.js"], ["doc", "docs/product/product-journey-platform-depth-audit.md"], ["doc", "docs/architecture/composed-product-journey-lifecycle.md"]]),
  lesson("special-segment-journeys", "Education, agriculture and microfinance", "34 min",
    ["Explain non-monthly repayment sources", "Place field evidence", "Describe household/group controls"],
    [["Education", "Institution/course/admission and co-borrower facts drive tranche payments to the institution. Moratorium, accrued-interest disclosure and academic progress continue into servicing."], ["Agriculture", "Land/tenancy, crop/activity, acreage, season, geo evidence and weather/price references drive seasonal cash flow and irregular schedules. Field capture and calamity restructure are first-class paths."], ["Microfinance", "Group formation, household income and aggregate indebtedness, repayment-capacity caps, training and conduct evidence govern group lending. The support matrix still controls what may be claimed for live operations."]],
    ["Segment evidence", "Purpose / household assessment", "Special schedule", "Field or institution evidence", "Ongoing monitoring", "Distress treatment"],
    [["code", "packages/core/src/product-journey-contracts.js"], ["doc", "docs/architecture/android-field-operations-app.md"], ["doc", "docs/product/product-journey-support-matrix.md"]]),
  lesson("embedded-trade-journeys", "Consumer durable and trade journeys", "36 min",
    ["Trace merchant checkout credit", "Compare invoice, PO and supply-chain finance", "Locate trade-document controls"],
    [["Consumer durable", "Point-of-sale finance binds merchant, SKU, invoice, affordability, delivery and supplier payment while still executing consent, KYC and KFS. Returns require a controlled merchant clawback and loan unwind."], ["Receivables and orders", "Invoice discounting finances an accepted receivable with buyer, assignment, duplicate/concentration and proceeds controls. Purchase-order finance starts earlier and adds performance milestones. Supply-chain finance adds anchor, participant and programme limits across repeated transactions."], ["Trade workflow", "Trade finance adds counterparties, instruments, documents, shipment milestones, release conditions and proceeds control. External banking messages and sanctions/trade-data providers remain explicit readiness dependencies."]],
    ["Merchant checkout", "Invoice receivable", "Purchase order milestones", "Anchor programme", "Trade documents", "Controlled settlement"],
    [["code", "packages/core/src/product-journey-contracts.js"], ["doc", "docs/product/product-journey-support-matrix.md"], ["doc", "docs/architecture/provider-integration-governance.md"]]),
  lesson("partner-journeys", "Co-lending, LSPs, DLAs and partners", "32 min",
    ["Explain RE accountability", "Trace co-lending allocation", "Locate partner authority and finance"],
    [["LSP/DLA boundary", "The regulated entity remains accountable. Registries bind agreement scope, due diligence, data residency, grievance, recovery, fee and exit obligations. Partner actors receive limited, attributable authority."], ["Co-lending", "Arrangement terms drive participant allocation, entity accounting, escrow settlement and reconciliation. One customer journey must retain each participant share without corrupting the customer-facing obligation."], ["Partner operations", "Onboarding, credential expiry, territory/capacity, leads, commissions, GST/TDS, disputes, incidents, exits and portfolio transfers are governed lifecycles—not free-form integrations."]],
    ["RE product", "Partner / LSP authority", "Application", "Allocation", "Escrow settlement", "Participant accounting + oversight"],
    [["code", "packages/core/src/co-lending.js"], ["code", "packages/core/src/channel-crm-governance.js"], ["code", "packages/core/src/partner-finance.js"], ["doc", "docs/architecture/re-tenant-onboarding-and-product-administration.md"]])
];

const journeys = [journeyOverview[0], ...technicalJourneyLessons, ...journeyCasebookLessons];

const operations = [
  lesson("integrations", "External providers and conformance", "30 min",
    ["Explain provider boundaries", "Trace callbacks safely", "Separate simulator evidence from live readiness"],
    [["Adapters", "Provider-neutral contracts isolate KYC, bureau, bank verification, payments, communication and other vendors. Requests carry tenant, purpose, residency, idempotency and lineage."], ["Callbacks", "Signed callbacks validate timestamp, content and replay bounds before state changes. Retry queues, circuit breakers, reconciliation and dead-letter handling preserve delivery without accepting duplicates."], ["Readiness", "Deterministic simulators test adverse behavior. A live provider requires procurement, security/residency review, certification, credentials, conformance evidence and tenant activation. Simulator success is never a live claim."]],
    ["Domain request", "Provider adapter", "Certified provider", "Signed callback", "Replay/idempotency gate", "Reconciliation", "Domain event"],
    [["doc", "docs/architecture/provider-integration-governance.md"], ["code", "packages/core/src/external-services.js"], ["code", "packages/core/src/live-integration-operations.js"]]),
  lesson("data-security", "Data, privacy and security architecture", "30 min",
    ["Describe data classification and residency", "Trace purpose limitation", "Name security operations"],
    [["Data contract", "India residency, tenant partitioning, purpose limitation, retention and subject-rights workflows apply across records, documents, events and telemetry. Aadhaar biometric, OTP and PID artifacts are prohibited from storage."], ["Security", "Secrets, encryption, key custody, session controls, step-up, device certification, redaction, vulnerability management, incident response and forensic custody form the operating boundary around domain controls."], ["Lifecycle", "Access, correction, erasure/legal-hold, export and exit must preserve regulatory records and audit integrity. Data products and CDC are purpose-separated; analytics cannot become a cross-tenant escape hatch."]],
    ["Classify + purpose", "Collect minimum", "India-resident encrypted store", "Role-scoped use", "Retention / legal hold", "Export or erasure evidence"],
    [["doc", "docs/architecture/data-governance.md"], ["doc", "docs/architecture/security-operations.md"], ["doc", "docs/architecture/security-assurance.md"]]),
  lesson("deployment", "AWS release, runtime and rollback", "32 min",
    ["Describe the release boundary", "Trace immutable deployment", "Explain health rollback"],
    [["Selective package", "The demo package is built from an explicit allowlist and committed HEAD. Android apps, dependencies, local outputs and repository-wide archives are excluded."], ["Immutable release", "Artifacts use immutable S3 keys with SHA-256 verification. First boot bootstraps once; ordinary updates use SSM, an atomic release switch and health checks. Schema mismatch fails closed."], ["Operations", "CloudFormation owns infrastructure. Smoke tests, DNS plan, credentials, recovery and teardown follow the runbook. Showcase evidence does not equal production admission."]],
    ["Committed HEAD", "Allowlisted package", "Checksum + immutable S3", "SSM stage", "Atomic switch", "Health check", "Keep or rollback"],
    [["doc", "docs/architecture/aws-showcase-deployment.md"], ["code", "deploy/aws/package-demo.sh"], ["code", "deploy/aws/release-demo.sh"], ["doc", "docs/operations/demo-handbook.md"]]),
  lesson("observability-recovery", "Observability, recovery and production admission", "32 min",
    ["Read service health without leaking tenant data", "Explain recovery evidence", "Assemble go-live gates"],
    [["Observe", "Bounded route metrics, latency/availability SLIs, SLO and error-budget state, provider health and stuck-work alerts support operations. Platform metrics avoid tenant labels; tenant health is role-gated."], ["Recover", "Encrypted recovery packages validate India residency, checksums and audit-chain integrity. Authenticated four-eyes restore, RTO/RPO measurement and witnessed exercises prove more than a backup file exists."], ["Admit", "Production admission joins live integrations, security, resilience, data, staffing, policy, migration, UAT, model risk, operating procedures and independent assurance. Evidence expires and must be renewed."]],
    ["Telemetry + alerts", "Incident", "Fail closed / contain", "Recovery package", "Four-eyes restore", "Exercise evidence", "Production admission"],
    [["code", "apps/api/src/observability.js"], ["code", "apps/api/src/recovery.js"], ["doc", "docs/architecture/production-completion-controls.md"], ["doc", "docs/architecture/implementation-migration-go-live.md"]]),
  lesson("capstone", "Capstone: trace one loan and prove it", "45 min",
    ["Trace an end-to-end loan", "Name every source of authority", "Produce a defensible evidence map"],
    [["Scenario", "A tenant originates a personal loan through its DLA. The borrower consents, completes KYC, is referred by policy because an approved model contributes a material fact, accepts a KFS, signs, receives direct disbursement, misses one instalment, cures, prepays and closes."], ["Trace", "For each transition identify channel, API route, tenant/actor, domain record, business/control decision, policy/model version, LWS task, ledger event, document/communication, audit event and failure outcome."], ["Review", "Compare the result to the product definition, capability status and journey support matrix. Mark platform evidence separately from tenant/live-provider evidence. Any missing authority, exact-money link, borrower communication or immutable lineage is a design gap—not a documentation footnote."]],
    ["Consent + KYC", "Underwriting + human review", "KFS + contract", "Disbursement", "Ledger + delinquency", "Prepay + close", "Evidence replay"],
    [["doc", "docs/product/what-we-are-building.md"], ["doc", "docs/product/capability-trace.json"], ["doc", "docs/architecture/current-implementation.md"]])
];

export const course = {
  title: "LoanOS Technical Academy",
  description: "A system-level learning path through every LoanOS plane, runtime, control, lending lifecycle and product journey—grounded in the canonical product definition and implementation evidence.",
  audience: "Engineers, solution architects, technical business analysts, implementation leads, security reviewers and operators.",
  verified,
  modules: [
    { id: "t01-system", title: "System orientation", tagline: "See the whole operating system before opening a file.", lessons: architecture },
    { id: "t02-tenancy", title: "Tenancy, identity and activation", tagline: "Who is acting, for which regulated entity, with what authority.", lessons: tenancy },
    { id: "t02-platform-internals", title: "Channels, APIs, storage and data", tagline: "Follow information from a user surface through contracts, persistence and governed projections.", lessons: platformInternals },
    { id: "t02-customer-risk", title: "Customers, identity and application risk", tagline: "Follow people, consent and evidence from acquisition through verified identity and risk operations.", lessons: customerAndRisk },
    { id: "t03-lending", title: "The lending lifecycle in code", tagline: "From application facts to a closed, reconstructable account.", lessons: lending },
    { id: "t03-credit-assets", title: "Credit, collateral and payments", tagline: "Deep technical control of underwriting, secured lending and money movement.", lessons: creditAndAssets },
    { id: "t04-rules-engine", title: "The Rules Engine", tagline: "Author, sign, evaluate, replay and operate deterministic policy as a first-class platform runtime.", lessons: rulesEngine },
    { id: "t04-controls", title: "Workflow, AI and evidence", tagline: "The human and machine control machinery around every governed decision.", lessons: controls },
    { id: "t05-journeys", title: "All product journeys", tagline: "How 21 journeys compose the common lifecycle with specialist controls.", lessons: journeys },
    { id: "t06-institutional", title: "Institutional control and economics", tagline: "Operate products, partners, finance, risk, customer protection and regulatory reporting as one governed institution.", lessons: institutional },
    { id: "t06-delivery-experience", title: "Field delivery, implementation and engineering quality", tagline: "Take the platform into branches, devices and production with reconciled evidence.", lessons: deliveryAndExperience },
    { id: "t06-operations", title: "Integrations, security and operations", tagline: "Run, observe, recover and admit the platform without overstating maturity.", lessons: operations }
  ]
};

// Every numbered family in the complete-system capability catalogue must resolve
// to a primary Academy session. The generator validates these paths so a future
// curriculum edit cannot silently drop a product family.
export const capabilityCoverage = {
  1: "t02-tenancy/tenant-isolation", 2: "t06-institutional/product-administration",
  3: "t06-institutional/product-administration", 4: "t02-customer-risk/crm-parties",
  5: "t02-customer-risk/crm-parties", 6: "t02-customer-risk/consent-rights",
  7: "t02-customer-risk/kyc-aml", 8: "t02-customer-risk/fraud-application-risk",
  9: "t02-customer-risk/documents-verification", 10: "t03-credit-assets/underwriting-cam",
  11: "t03-credit-assets/collateral-security", 12: "t03-lending/kfs-contract-disburse",
  13: "t03-lending/kfs-contract-disburse", 14: "t03-lending/lms-ledger",
  15: "t03-lending/lms-ledger", 16: "t03-credit-assets/payments-reconciliation",
  17: "t03-lending/servicing-collections", 18: "t03-lending/servicing-collections",
  19: "t05-journeys/journey-adverse-casebook", 20: "t03-lending/servicing-collections",
  21: "t06-institutional/partners-economics", 22: "t04-controls/lws",
  23: "t06-institutional/customer-protection", 24: "t06-institutional/regulatory-reporting",
  25: "t06-institutional/finance-treasury-tax", 26: "t06-institutional/enterprise-risk",
  27: "t04-controls/ai-workers", 28: "t04-controls/audit-compliance",
  29: "t06-operations/data-security", 30: "t02-platform-internals/api-contracts",
  31: "t06-operations/observability-recovery", 32: "t02-platform-internals/channel-surfaces",
  33: "t06-delivery-experience/implementation-migration"
};
