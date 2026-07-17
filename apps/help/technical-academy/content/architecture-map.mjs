export const architectureLayers = [
  { id: "experience", number: "01", name: "Experience & channels", short: "Borrower, staff, partner and field journeys", description: "Purpose-built surfaces keep borrower guidance, institutional work and assisted operations in their correct trust boundaries.", systems: [
    ["Borrower experience", "Customer portal, applications, consent, KFS and servicing", "t02-platform-internals/channel-surfaces.html", ["product", "operations"]],
    ["Institutional workspaces", "Dashboard, administration and governed work queues", "t04-controls/lws.html", ["operations", "risk"]],
    ["Partner & field operations", "DSA, LSP and assisted-channel boundaries", "t06-delivery-experience/field-branch-operations.html", ["implementation", "operations"]]
  ]},
  { id: "journeys", number: "02", name: "Products & journeys", short: "LOS, LMS, LWS and specialist lending", description: "Twenty-one product journeys compose a shared lending lifecycle with product-specific facts, evidence, controls and adverse paths.", systems: [
    ["Loan origination (LOS)", "Application, KYC, underwriting, KFS and sanction", "t03-lending/origination.html", ["product", "risk"]],
    ["Loan management (LMS)", "Account, schedule, ledger, payments and closure", "t03-lending/lms-ledger.html", ["finance", "operations"]],
    ["Lending work system (LWS)", "Queues, SLAs, maker-checker and human authority", "t04-controls/lws.html", ["operations", "risk"]],
    ["Specialist product journeys", "Secured, MSME, co-lending, trade and retail patterns", "t05-journeys/index.html", ["product", "implementation"]]
  ]},
  { id: "domain", number: "03", name: "Domain services", short: "Parties, credit, money, servicing and evidence", description: "Cohesive domain boundaries own lending state. Policy stays data, money stays exact and every material transition remains attributable.", systems: [
    ["Customer, party & consent", "Relationships, privacy, rights and evidence", "t02-customer-risk/crm-parties.html", ["product", "risk"]],
    ["Identity, KYC & fraud", "CDD, AML, sanctions and verification", "t02-customer-risk/kyc-aml.html", ["risk", "security"]],
    ["Credit & collateral", "Underwriting, CAM, valuation and perfection", "t03-credit-assets/underwriting-cam.html", ["risk", "product"]],
    ["Payments & accounting", "Mandates, allocation, reconciliation and exact money", "t03-credit-assets/payments-reconciliation.html", ["finance", "operations"]],
    ["Servicing & resolution", "Delinquency, collections, restructuring and closure", "t03-lending/servicing-collections.html", ["operations", "risk"]]
  ]},
  { id: "control", number: "04", name: "Decision & control plane", short: "Deterministic policy, authority, AI and audit", description: "The control plane turns regulation, institutional policy and authenticated human authority into replayable decisions and evidence.", systems: [
    ["Business rules runtime", "Per-tenant lending decisions and signed policy bundles", "t04-rules-engine/runtime-topology.html", ["engineering", "risk"]],
    ["Control rules runtime", "Identity, staffing and authority—isolated from business policy", "t02-tenancy/identity-staffing.html", ["security", "risk"]],
    ["Model governance", "Provenance, kill switch and human review", "t04-controls/ai-workers.html", ["risk", "engineering"]],
    ["Audit & compliance", "Hash-chain lineage, evidence and assurance", "t04-controls/audit-compliance.html", ["risk", "security"]]
  ]},
  { id: "platform", number: "05", name: "Platform & data", short: "APIs, tenancy, storage, events and integrations", description: "Shared platform services enforce tenant context, contract validation, persistence boundaries and governed exchange with external providers.", systems: [
    ["API composition", "Authentication, validation, idempotency and routes", "t02-platform-internals/api-contracts.html", ["engineering", "implementation"]],
    ["Tenant isolation", "Request, storage and runtime partitioning", "t02-tenancy/tenant-isolation.html", ["engineering", "security"]],
    ["Storage & data products", "PostgreSQL RLS, migrations, reporting and projections", "t02-platform-internals/storage-rls.html", ["engineering", "finance"]],
    ["Provider integrations", "Governed adapters, callbacks and reconciliation", "t06-operations/integrations.html", ["engineering", "implementation"]]
  ]},
  { id: "operations", number: "06", name: "Security & operations", short: "Delivery, observability, recovery and assurance", description: "Operational controls keep releases immutable, service health observable, recovery testable and production admission evidence-led.", systems: [
    ["Security architecture", "Classification, residency, keys, access and response", "t06-operations/data-security.html", ["security", "engineering"]],
    ["Release & deployment", "Selective artifacts, immutable delivery and rollback", "t06-operations/deployment.html", ["engineering", "implementation"]],
    ["Reliability & recovery", "SLIs, alerts, fail-closed operation and witnessed restore", "t06-operations/observability-recovery.html", ["operations", "security"]],
    ["Implementation & migration", "Discovery, mapping, rehearsal and go-live evidence", "t06-delivery-experience/implementation-migration.html", ["implementation", "operations"]]
  ]}
];

export const architecturePersonas = [["all", "Whole enterprise"], ["product", "Product & BA"], ["risk", "Risk & compliance"], ["operations", "Operations"], ["engineering", "Engineering & architecture"], ["security", "Security"], ["finance", "Finance & treasury"], ["implementation", "Implementation"]];
