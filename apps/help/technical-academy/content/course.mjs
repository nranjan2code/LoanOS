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

const controls = [
  lesson("lws", "LWS queues, SLA and maker-checker", "26 min",
    ["Explain derived work", "Trace assignment and SLA evidence", "Enforce independence"],
    [["Tasks are derived", "LWS projects actionable work from domain state: compliance exceptions, AI review, checker approval, disbursement, collections, NPA review and grievances. Resolving the domain condition resolves the task; a separate task database must not become a competing truth."], ["Work is attributed", "Assignment, start, release and comment events retain actor, role, queue and time evidence. Business calendars and SLA policies determine due state."], ["Four eyes", "Maker and checker independence is validated against authenticated identity and action history. Committees, overrides and release approvals add purpose-specific authority rather than generic admin bypasses."]],
    ["Domain condition", "Derived queue item", "Authorized assignment", "Work + evidence", "Independent approval", "Domain transition"],
    [["code", "packages/core/src/workflow-tasks.js"], ["doc", "docs/architecture/institutional-operations.md"], ["doc", "docs/architecture/tenant-role-staffing-and-feature-gating.md"]]),
  lesson("decision-engine", "Deterministic decision engine", "32 min",
    ["Describe bundle evaluation", "Explain determinism and fail-closed behavior", "Separate business and control engines"],
    [["Policy is data", "Decision models are signed JSON bundles with schemas, expression graphs and golden corpora. Pure Rust crates parse and evaluate without clocks, randomness, I/O or async dependencies."], ["Runtime", "The Node gateway sends canonical string money/ratio inputs to the tenant runtime. The engine verifies bundle and input contracts, evaluates deterministically and returns outcome plus trace. Timeout, invalid response or unavailable service maps to refer/deny."], ["Topology", "Business lending decisions and ctrl-* identity/staffing decisions run in separately administered per-tenant instances. Replay evidence includes bundle checksum and facts so the same evaluation can be reproduced byte-identically."]],
    ["Versioned model JSON", "Sign + publish bundle", "Tenant runtime", "Canonical facts", "Deterministic evaluation", "Outcome + trace", "Audit replay"],
    [["doc", "docs/architecture/decision-engine-design.md"], ["code", "rules/crates/rules-eval/src/lib.rs"], ["code", "apps/api/src/control-rules-engine.js"]]),
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
    { id: "t03-lending", title: "The lending lifecycle in code", tagline: "From application facts to a closed, reconstructable account.", lessons: lending },
    { id: "t04-controls", title: "Workflow, policy, AI and evidence", tagline: "The control machinery that makes the platform safe and replayable.", lessons: controls },
    { id: "t05-journeys", title: "All product journeys", tagline: "How 21 journeys compose the common lifecycle with specialist controls.", lessons: journeys },
    { id: "t06-operations", title: "Integrations, security and operations", tagline: "Run, observe, recover and admit the platform without overstating maturity.", lessons: operations }
  ]
};
