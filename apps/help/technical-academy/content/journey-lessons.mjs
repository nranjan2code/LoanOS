import { PRODUCT_JOURNEY_CONTRACTS } from "@loanos/core/journeys/product-journey-contracts.js";

const verified = "2026-07-17";

const meta = {
  personal_loan: ["Personal loan", "Controlled first slice", "Connected LOS, underwriting, KFS, contracting, disbursement, LMS and servicing tests", "Tenant policy/UAT and live providers", "salary, employment, obligations and bureau-backed affordability", "direct borrower-account payment after bank verification", "mandate, EMI, prepayment and foreclosure", "income mismatch, thin-file referral, mandate failure and early delinquency"],
  co_lending_programme: ["Co-lending programme", "Controlled first slice", "Arrangement, allocation, entity accounting, escrow settlement and reconciliation", "Partner certification and tenant operating evidence", "arrangement authority, lender shares, programme limit and allocation", "multi-lender funding through the governed escrow/waterfall", "participant subledgers, waterfall settlement and lender reconciliation", "allocation imbalance, partner short-funding, escrow break and waterfall dispute"],
  msme_working_capital: ["MSME working capital", "Controlled first slice", "Revolving limit, draw, interest, repayment, review and accounting", "Tenant borrowing-base policy and integrations", "drawing power from stock, eligible receivables, limits and renewal evidence", "controlled revolving draw within current drawing power", "statement monitoring, limit review, annual renewal and cash-credit closure", "stale stock statement, limit excess, ineligible receivable and renewal lapse"],
  msme_term_loan: ["MSME term loan", "Configurable pattern", "Common term-loan lifecycle plus tenant journey administration", "Product-specific tenant UAT", "entity, promoter, Udyam/GST, business cash flow and end use", "borrower or verified end-use payee according to product policy", "business cash-flow review, end-use monitoring and EMI servicing", "GST/bank inconsistency, end-use breach, covenant exception and business stress"],
  professional_practice_loan: ["Professional practice loan", "Configurable pattern", "Registration, practice cash flow, purpose and asset gates", "Institution policy and end-to-end tenant evidence", "active professional registration, practice vintage, receipts and purpose", "borrower or verified supplier according to approved end use", "registration re-verification, practice cash-flow review and EMI", "expired licence, volatile receipts, purpose mismatch and practice closure"],
  secured_business_loan: ["Secured business loan", "Configurable pattern", "Collateral, title, valuation, insurance, perfection and release gates", "Asset/provider certification and tenant UAT", "business cash flow plus ownership, title, valuation, LTV and security perfection", "controlled borrower/end-use payment only after mortgage conditions", "end-use and collateral monitoring, insurance, EMI and security release", "title defect, valuation expiry, LTV breach, perfection failure and insurance lapse"],
  loan_against_property: ["Loan against property", "Configurable pattern", "Property/title/valuation/stage/security controls", "State/product policy and certified providers", "ownership, occupancy, encumbrance, title, valuation, LTV and mortgage", "borrower payment after mortgage/perfection conditions", "revaluation, insurance tracking, EMI and dual-control release", "co-owner gap, encumbrance, legal exception, valuation decline and release delay"],
  home_loan: ["Home loan", "Configurable pattern", "Property, construction-stage, title and disbursement gates", "Developer/project administration and tenant E2E", "property/developer, RERA, agreement value, contribution, title, valuation and stage", "seller/developer tranche after contribution and certified stage", "construction monitoring, stage draws, EMI/pre-EMI and security release", "project delay, stage rejection, developer change, title defect and contribution shortfall"],
  equipment_machinery_finance: ["Equipment & machinery finance", "Configurable pattern", "Supplier, invoice, serial, installation, collateral and staged payment gates", "Vendor integration and tenant E2E", "supplier, quotation/invoice, asset, serial, margin and installation", "verified supplier in stages against delivery/installation", "asset, insurance and installation monitoring with scheduled repayment", "invoice fraud, serial mismatch, non-delivery, installation failure and supplier refund"],
  green_equipment_finance: ["Green equipment finance", "Configurable pattern", "Equipment controls plus green-taxonomy evidence gate", "Approved taxonomy/incentive/reporting configuration", "equipment facts plus approved taxonomy, baseline impact and subsidy", "verified supplier after equipment and green-evidence gates", "taxonomy re-verification, impact reporting and subsidy reconciliation", "taxonomy expiry, impact underperformance, subsidy rejection and green-claim correction"],
  personal_vehicle_loan: ["Personal vehicle loan", "Configurable pattern", "Dealer, vehicle, registration, insurance and payment gates", "Vehicle registry/provider integration and tenant E2E", "dealer, quotation, contribution, VIN, registration and insurance plans", "verified dealer against quotation and borrower margin", "registration, insurance, EMI and hypothecation release", "VIN mismatch, delivery cancellation, registration delay, insurance lapse and total loss"],
  commercial_vehicle_finance: ["Commercial vehicle finance", "Configurable pattern", "Vehicle/dealer/registration/permit and cash-flow gates", "Fleet/permit integrations and tenant E2E", "dealer/vehicle facts plus permit, route, fleet and vehicle cash flow", "verified dealer after contribution and permit conditions", "permit tracking, vehicle cash-flow review, EMI and hypothecation release", "permit expiry, route restriction, vehicle downtime, repossession and fleet concentration"],
  gold_loan: ["Gold loan", "Configurable pattern", "Assay, purity, exact weight, packet, custody, LTV and auction-policy gates", "Branch devices/custody integration and witnessed operations", "exact weight/purity/rate, packet seal, vault, LTV and auction policy", "borrower account after dual-control pledge custody", "daily LTV, margin call, custody movements, auction and dual-control release", "assay dispute, seal break, price shock, uncured margin call, auction surplus and lost packet"],
  education_loan: ["Education loan", "Configurable pattern", "Institution/course/admission, co-borrower, moratorium and stage gates", "Institution validation and tenant E2E", "student/co-borrower, institution/course, admission, fee schedule and moratorium", "institution-direct fee tranches against schedule and progress", "academic progress, moratorium interest, tranche review and EMI conversion", "visa refusal, dropout, fee refund, institution fraud and moratorium extension"],
  agriculture_allied_finance: ["Agriculture & allied finance", "Configurable pattern", "Land/activity/crop/season/cash-flow/weather-price evidence gates", "Live land/weather/market/programme data and tenant E2E", "land/tenancy, crop/activity, acreage, geo, season, harvest and risk evidence", "seasonal draw against verified activity and programme conditions", "field monitoring, crop stages, insurance, seasonal repayment and calamity restructure", "offline-sync conflict, crop failure, calamity declaration, land dispute and harvest-price shock"],
  microfinance_group_lending: ["Microfinance & group lending", "Configurable pattern", "Group/household indebtedness, field evidence and conduct gates", "Group meeting/offline field operation and tenant E2E", "group/member identity, household income/debt, capacity, training and conduct", "member/group disbursement under approved programme and household cap", "centre collection, indebtedness monitoring, conduct surveillance and group servicing", "duplicate member, aggregate-debt breach, coercion complaint, group fracture and offline cash mismatch"],
  consumer_durable_finance: ["Consumer durable finance", "Configurable pattern", "Merchant, SKU, invoice, affordability and supplier-payment gates", "POS/merchant integration and tenant E2E", "merchant, SKU, invoice, down payment, delivery OTP and serial", "verified merchant after checkout controls and delivery condition", "EMI plus cancellation, refund and returns reconciliation", "dark pattern, delivery failure, return after disbursement, merchant clawback and serial mismatch"],
  invoice_discounting: ["Invoice discounting", "Configurable pattern", "Buyer/invoice/assignment, limit/concentration, draw and proceeds controls", "Buyer/ERP verification and tenant E2E", "seller/buyer, accepted invoice, assignment, advance rate, concentration and dispute", "seller draw after invoice and assignment verification", "buyer collection, settlement allocation, revolving availability and dispute management", "duplicate invoice, buyer rejection, dilution, overdue buyer, concentration breach and short settlement"],
  purchase_order_finance: ["Purchase-order finance", "Configurable pattern", "Buyer/PO, milestone, supplier release and settlement controls", "Order/fulfilment integration and tenant E2E", "buyer/PO, cost, margin, shipment, incoterm and fulfilment milestones", "milestone draw to controlled supplier/production uses", "shipment monitoring, buyer acceptance and proceeds allocation", "buyer cancellation, cost overrun, milestone failure, shipment delay and acceptance dispute"],
  supply_chain_finance: ["Supply-chain finance", "Configurable pattern", "Anchor/participant, programme limit, transaction, funding and settlement controls", "Anchor ERP/portal integration and tenant E2E", "anchor programme, participant, trade asset, ERP confirmation and nested limits", "participant draw after anchor confirmation and limit checks", "dynamic limits, anchor collection, programme reconciliation and participant review", "false ERP confirmation, anchor dispute, participant-limit breach, concentration and reconciliation break"],
  trade_finance_workflow: ["Trade-finance workflow", "Configurable pattern", "Counterparty/document/shipment/release/proceeds workflow controls", "Instrument-specific banking messages, sanctions/trade data and tenant E2E", "applicant/beneficiary, instrument, currency, shipment, customs, sanctions and discrepancies", "funded or contingent release only after document/condition examination", "instrument messaging, document examination, discrepancy and contingent accounting", "sanctions hit, discrepant documents, message failure, FX/currency exception and contingent crystallisation"]
};

const order = ["personal_loan", "co_lending_programme", "msme_working_capital", "msme_term_loan", "professional_practice_loan", "secured_business_loan", "loan_against_property", "home_loan", "equipment_machinery_finance", "green_equipment_finance", "personal_vehicle_loan", "commercial_vehicle_finance", "gold_loan", "education_loan", "agriculture_allied_finance", "microfinance_group_lending", "consumer_durable_finance", "invoice_discounting", "purchase_order_finance", "supply_chain_finance", "trade_finance_workflow"];

const regulationEffects = {
  "RBI-DL-2025": "Digital journey conduct, borrower disclosure, direct fund flow, servicing and recovery accountability.",
  "RBI-KFS-2024": "APR, charges, repayment schedule and pre-contract terms must be delivered and evidenced before execution.",
  "RBI-KYC-2016": "Customer identification, CDD, beneficial-owner and ongoing due-diligence evidence gate the relationship.",
  "DPDP-2023": "Purpose-bound notice, consent/other lawful basis, minimisation and data-principal rights govern personal data.",
  "RBI-FUND-FLOW": "Disbursement and repayment must use authorised direct flows; an LSP cannot control borrower funds.",
  "RBI-FPC-PENAL": "Penal charges must be reasonable, disclosed and posted as charges rather than capitalised penal interest.",
  "RBI-CLA-2025": "Co-lending allocation, customer treatment, participant responsibility and accounting follow the approved arrangement.",
  "RBI-LSP-DLG": "LSP and default-loss support require capped, evidenced and regulated-entity-controlled governance.",
  "CCPA-DARK-PATTERNS": "Checkout, offer and consent design must not manipulate selection, add-ons or borrower understanding.",
  "RBI-AA-2016": "Account Aggregator financial data requires explicit consent artefacts, purpose limits and traceable use.",
  "CERSAI-CKYC": "CKYC lookup/upload evidence and identifiers support reusable, regulated customer due diligence.",
  "RBI-CIR-2025": "Credit reporting events must be accurate, timely, reconcilable and corrected through a governed process."
};

const specificRegulations = {
  personal_loan: ["RBI-AA-2016", "RBI-CIR-2025"],
  co_lending_programme: ["RBI-CLA-2025", "RBI-LSP-DLG", "RBI-CIR-2025"],
  msme_working_capital: ["RBI-AA-2016", "RBI-CIR-2025"],
  msme_term_loan: ["RBI-AA-2016", "RBI-CIR-2025"],
  professional_practice_loan: ["RBI-AA-2016", "RBI-CIR-2025"],
  secured_business_loan: ["RBI-CIR-2025"], loan_against_property: ["RBI-CIR-2025"], home_loan: ["RBI-CIR-2025"],
  equipment_machinery_finance: ["RBI-CIR-2025"], green_equipment_finance: ["RBI-CIR-2025"],
  personal_vehicle_loan: ["RBI-CIR-2025"], commercial_vehicle_finance: ["RBI-CIR-2025"], gold_loan: ["RBI-CIR-2025"],
  education_loan: ["RBI-CIR-2025"], agriculture_allied_finance: ["RBI-CIR-2025"],
  microfinance_group_lending: ["RBI-CIR-2025"],
  consumer_durable_finance: ["CCPA-DARK-PATTERNS", "RBI-CIR-2025"],
  invoice_discounting: ["RBI-CIR-2025"], purchase_order_finance: ["RBI-CIR-2025"], supply_chain_finance: ["RBI-CIR-2025"],
  trade_finance_workflow: ["RBI-CIR-2025"]
};

const human = (value) => value.replaceAll("_", " ");
const list = (items) => items.map(human).join(", ");

const commonCases = (specific) => [
  ["Happy path", "All contract facts/evidence, policy and independent approvals are current", "Progress monotonically through composed lifecycle; create exact accounting and audit lineage"],
  ["Policy decline", "Eligibility, affordability, limit, LTV or specialist rule declines", "Record reason/trace; prohibit KFS-contract-disbursement progression"],
  ["Missing or invalid evidence", "A required document, checksum, version or condition is absent/expired", "Fail closed at the current stage; create visible exception/manual work"],
  ["Provider timeout", "A required external verification has no authoritative response", "Refer or hold; never convert timeout into a positive fact"],
  ["Replay or duplicate", "Same idempotency key/callback is resubmitted", "Return prior result or reject changed content; never double post or double disburse"],
  ["Stale version", "Contract, schema, product configuration or proposal version changed", "Reject stale action; require re-evaluation against the current version"],
  ["Wrong tenant", "Actor or object belongs to another tenant", "Deny without cross-tenant disclosure; retain safe security evidence"],
  ["Wrong role or self-approval", "Actor lacks channel/role authority or maker equals checker", "Deny and preserve the pending proposal for an independent actor"],
  ["Revocation mid-work", "Identity, staffing, product or provider authority is suspended", "Pause affected specialist/composed cases and create governed escalation"],
  ["Reconciliation mismatch", "Provider, bank, escrow, merchant or subledger totals disagree", "Post nothing ambiguous; route suspense/manual reconciliation with exact amounts"],
  ["Accounting imbalance", "Principal, interest, fee or suspense journal does not balance", "Reject the posting atomically and alert; business status cannot outrun accounting"],
  ["Delinquency", "A contractual amount remains overdue", "Derive DPD/classification, create conduct-governed collections work and retain cure/restructure paths"],
  ["Cancellation or cooling-off", "Borrower/product permits exit before or shortly after disbursement", "Unwind documents, provider/merchant funds and ledger according to policy; evidence every refund"],
  ["Closure", "Economic balance, charges and required releases/reporting are complete", "Dual-control release where secured; issue NOC and preserve immutable history"],
  ["Rollback or ambiguous effect", "A transition partially reaches an external system", "Pause for manual intervention; never guess whether money/security moved"],
  ["Audit replay", "Reviewer supplies recorded facts, policy/bundle and versions", "Reproduce the decision and verify hashes, actor lineage, documents and ledger"],
  ["Journey-specific adverse cases", specific, "Apply the specialist contract, fail closed, surface the owner and retain resolution evidence"]
];

function make(journeyType) {
  const contract = PRODUCT_JOURNEY_CONTRACTS[journeyType];
  const [title, support, boundary, remaining, underwriting, disbursement, servicing, adverse] = meta[journeyType];
  const regulationIds = [...new Set(["RBI-DL-2025", "RBI-KYC-2016", "DPDP-2023", "RBI-KFS-2024", "RBI-FUND-FLOW", "RBI-FPC-PENAL", ...(specificRegulations[journeyType] ?? [])])];
  return {
    id: journeyType.replaceAll("_", "-"), journeyType, title: `${title}: complete technical journey`, duration: "42 min", verified,
    journeyName: title, maturity: support, implementedBoundary: boundary, productionGap: remaining,
    contractSummary: { archetype: human(contract.archetype), facility: human(contract.facility.type), security: human(contract.security.type), version: `v${contract.contractVersion}`, facts: contract.requiredFacts.map(human), evidence: contract.requiredEvidence.map(human), accounting: Object.values(contract.accounting).map(human) },
    regulations: regulationIds.map((id) => ({ id, effect: regulationEffects[id] })),
    objectives: [`Implement the ${title} contract without bypassing common controls`, "Trace happy, adverse, servicing, distress and closure paths", "Identify current platform evidence and the remaining production boundary"],
    sections: [
      ["Contract and configuration", `Canonical contract product-journey/${journeyType} v${contract.contractVersion}; archetype ${human(contract.archetype)}; facility ${human(contract.facility.type)}; security ${human(contract.security.type)}. Tenant administration must bind entitlement, product policy/version, pricing/KFS, providers, staffed roles, accounting, content/language and release readiness before intake. The contract checksum prevents a workspace or lifecycle from silently using a different schema.`],
      ["Capture, facts and evidence", `Authorised borrower, partner, field, branch and staff channels render the contract schema. Required facts are: ${list(contract.requiredFacts)}. Required evidence is: ${list(contract.requiredEvidence)}. Drafts remain tenant-, actor-, channel-, contract- and version-bound; server validation rejects omitted, malformed, cross-tenant or stale material.`],
      ["Specialist assessment and credit decision", `The specialist underwriting focus is ${underwriting}. Common India, consent, KYC/AML, fraud, affordability and product-policy gates still apply. Facts enter deterministic policy with provenance; outcomes are approve, refer or decline. Exceptions and material model influence require attributed human review, and the approving checker must be independent of the proposer.`],
      ["KFS, contract and disbursement", `Approved terms flow through APR/charge validation, KFS render, digital delivery and acceptance, agreement packet and eSign evidence. Disbursement uses ${disbursement}. Contract evidence, beneficiary authority and dual control are mandatory; unavailable verification or an ambiguous provider effect holds the lifecycle rather than opening an LMS account.`],
      ["LMS, accounting and servicing", `The account uses exact decimal-string minor units and double-entry idempotent posting across ${contract.accounting.principalLedger}, ${contract.accounting.interestLedger}, ${contract.accounting.feeLedger} and ${contract.accounting.suspenseLedger}. Specialist servicing includes ${servicing}. Schedule is contractual expectation; ledger is actual money. Every provider settlement is reconciled before final allocation.`],
      ["Distress, recovery and closure", `Overdue obligations derive DPD and classification before conduct-governed collections work. Product policy controls hardship, restructure, settlement, recovery, write-off and cure. Closure requires zero/settled economics, reporting updates, NOC and ${contract.security.releaseRequiresDualControl ? "independently approved security/collateral release" : "final account and mandate closure"}. Cancellation never deletes history.`],
      ["API, state and evidence map", `Workspace capture projects through /journey-workspaces and the journey-application promotion boundary; specialist cases use /admin/specialist-journeys; common stage proposals/approvals use composed-journey routes. Persist journey type, contract/schema/configuration checksum, actor/tenant/channel, specialist result, policy trace, proposal/checker, KFS/document hashes, disbursement reference, account/ledger IDs, tasks/escalations and audit hashes. Product pause, identity revocation and ambiguous effects pause the composed lifecycle.`],
      ["Maturity and production boundary", `Canonical support: ${support}. Implemented boundary: ${boundary}. Remaining before production-ready: ${remaining}. This lesson describes the complete target and current executable contract; it does not claim that a tenant has certified providers, configured policy, completed UAT, witnessed security/DR or current operating-effectiveness evidence.`]
    ],
    flow: ["Tenant journey readiness", "Typed capture + evidence", "Specialist + credit decision", "KFS + contract", "Controlled disbursement", "LMS + servicing", "Distress / closure + replay"],
    cases: commonCases(adverse),
    sources: [["code", "packages/core/src/journeys/product-journey-contracts.js"], ["code", "packages/core/src/journeys/product-journey-schemas.js"], ["code", "packages/core/src/journeys/composed-journey-lifecycle.js"], ["code", "apps/api/src/routes/composed-journeys.js"], ["test", "tests/product-journey-conformance.test.js"], ["doc", "docs/product/product-journey-support-matrix.md"]]
  };
}

export const technicalJourneyLessons = order.map(make);
export const technicalJourneyTypes = Object.freeze([...order]);

export const journeyCasebookLessons = [
  {
    id: "journey-adverse-casebook", title: "Cross-journey adverse-case playbook", duration: "38 min", verified,
    objectives: ["Apply the mandatory adverse corpus consistently", "Choose deny, refer, pause, compensate or manual-intervention outcomes", "Prevent ambiguous external effects"],
    sections: [
      ["Failure taxonomy", "Validation failures deny the malformed action. Credit uncertainty refers to an authorised human. Authority loss pauses active work. Confirmed reversible side effects use governed compensation. Unknown external effects require manual intervention and reconciliation—never an optimistic retry."],
      ["Concurrency and replay", "Idempotency binds intent and content. Same key/same content returns the recorded result; same key/changed content is a conflict. Version checks prevent a stale proposal from approving current state. Callbacks validate signature, timestamp, tenant, provider, event identity and current transition."],
      ["Containment", "Product suspension, provider failure or principal revocation identifies every affected specialist and composed journey. New transitions stop immediately; existing evidence remains readable; escalations name the blocked stage, owner, cause and safe resume conditions."],
      ["Recovery proof", "A recovered case must reconcile external facts, ledger, documents, workflow and audit hashes before resume. Rollback is a business transition with evidence, not a database reset. Tests must prove no double money movement, no cross-tenant leak and no maker-checker collapse."]
    ],
    flow: ["Detect failure", "Classify certainty + authority", "Deny / refer / pause", "Reconcile effects", "Approve compensation or resume", "Replay evidence"],
    cases: commonCases("Apply the journey-specific adverse list in its dedicated lesson"),
    sources: [["doc", "docs/product/product-journey-platform-depth-audit.md"], ["code", "packages/core/src/journeys/product-journey-conformance.js"], ["test", "tests/product-journey-conformance.test.js"]]
  },
  {
    id: "journey-state-evidence-map", title: "Journey state, API and evidence reference", duration: "36 min", verified,
    objectives: ["Locate every journey component", "Trace identifiers and checksums across services", "Debug a stuck journey without mutating around controls"],
    sections: [
      ["Objects", "Product administration owns tenant configuration/readiness. Contract and schema own typed capture. Journey application owns promoted intake. Specialist service owns product-specific assessment. Composed lifecycle owns common stages. Loan account owns money. Workflow projection owns actionable work. Audit owns attributed lineage."],
      ["Identifiers", "Carry tenantId, journeyType, product contract/schema/configuration checksum, draft/application ID, specialist case/result, lifecycle ID/version, transition proposal, policy/bundle trace, document packet, disbursement, account, ledger event, task/escalation and audit hash. Never join by display name."],
      ["Debug order", "Read current tenant/product authority, lifecycle version and pause/escalation first. Then inspect mandatory stage evidence, proposal/checker lineage, provider journal/reconciliation, LMS posting and audit chain. Fix the failed source condition and use the governed transition; never edit status directly."],
      ["Evidence export", "A defensible pack connects product version and actors to input facts/evidence, deterministic decisions, human approvals, borrower documents/communications, money/security events, exceptions, remediation, reporting and closure. Hashes and exact amounts allow independent verification."]
    ],
    flow: ["Product configuration", "Workspace draft", "Journey application", "Specialist case", "Composed lifecycle", "Account + workflow", "Audit/evidence export"],
    sources: [["code", "packages/core/src/journeys/journey-application-service.js"], ["code", "packages/core/src/journeys/specialist-journey-service.js"], ["code", "packages/core/src/journeys/composed-journey-lifecycle.js"], ["code", "apps/api/src/routes/journey-applications.js"]]
  },
  {
    id: "journey-production-certification", title: "Journey production-certification casebook", duration: "38 min", verified,
    objectives: ["Separate contract completeness from go-live", "Assemble tenant/journey/version evidence", "Explain expiring certification"],
    sections: [
      ["Platform evidence", "Contract, schemas, persistent APIs, lifecycle composition, exact accounting, workspaces and generated conformance establish the internal platform boundary for the current template version."],
      ["Tenant evidence", "The regulated entity must approve product/policy, pricing, content, roles, delegations, providers, accounting mappings, reports, procedures and risk acceptance. Journey UAT must cover happy and adverse cases with the tenant's actual configuration."],
      ["Live operations", "Provider contracts/credentials, India residency, callback/reconciliation certification, capacity/SLO, support/on-call, migration, backup/restore, failover/failback, security tests and institution-witnessed exercises must be current."],
      ["Decision", "Production-ready is tenant-, environment-, journey-, configuration- and version-specific. The contract requires eleven current evidence domains plus every provider family declared by the template. The API rejects production proposals until trusted provider, deployment and institution registries are joined; request-body references cannot certify a journey. A changed or suspended dependency reopens certification."]
    ],
    flow: ["Platform conformance", "Tenant configuration", "Live-provider certification", "UAT + migration", "Security + DR", "Independent approvals", "Production admission + expiry monitoring"],
    sources: [["code", "packages/core/src/journeys/product-journey-certification.js"], ["doc", "docs/architecture/production-completion-controls.md"], ["doc", "docs/architecture/implementation-migration-go-live.md"], ["test", "tests/product-journey-certification.test.js"]]
  }
];
