// Module — The 21 product journeys: deep dives.
// Each lesson sets `journeyType`; the generator derives the journey-contract
// panel (facts, evidence, facility, security, servicing) from
// packages/core/src/product-journey-contracts.js and the platform-support
// panel from docs/product/product-journey-support-matrix.md at build time,
// so structural detail can never drift from the shipped contracts.
const CONTRACTS = { type: "code", ref: "packages/core/src/product-journey-contracts.js", note: "The checksummed product contract this page's derived panel is built from." };

function j(journeyType, lesson) {
  return {
    id: journeyType.replaceAll("_", "-"),
    journeyType,
    duration: "10 min",
    verified: "17 Jul 2026",
    ...lesson,
    platform: [...(lesson.platform ?? []), CONTRACTS]
  };
}

export default {
  id: "journeys",
  title: "The 21 product journeys: deep dives",
  tagline: "Every product LoanOS ships, one page each: the business, the risk, the contract and its current maturity.",
  summary: "LoanOS defines exactly 21 canonical lending journeys as checksummed product contracts. This module gives a BA one deep-dive per journey: who borrows and why, where the risk and regulation concentrate, and — derived live from the contract — the required facts, evidence, facility, security and servicing capabilities, with the honest platform-support level from the journey support matrix.",
  lessons: [
    j("personal_loan", {
      title: "Personal loan",
      objectives: ["Explain the unsecured personal term loan end to end", "Name the affordability tests and rails that carry it"],
      sections: [
        { heading: "The product", body: "The baseline of this whole course: an unsecured term loan to a salaried or self-employed individual, repaid by monthly EMI, collected by NACH/UPI mandate. No collateral means underwriting *is* the product: bureau history, verified income, existing obligations and FOIR carry the entire risk decision, and pricing reflects it.\n\nBecause it is unsecured, delinquency management leans on conduct-bound collections and bureau consequences rather than enforcement — modules 5 and 6 apply almost verbatim." },
        { heading: "What a BA watches", body: "Speed-versus-control is the tension: personal loans are the most digital, most automated journey, so every shortcut proposal (skip a verification, pre-approve on thin data) lands here first. The KFS, cooling-off and fund-flow controls are non-negotiable regardless of how instant the experience feels. This is also LoanOS's deepest journey — the first-slice controlled path traced in the capstone." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "The canonical digital-lending journey." }, { id: "RBI-KFS-2024", note: "KFS gates the sanction of every retail loan." }],
      platform: [{ type: "capability", ref: "UWG-009", note: "EMI, FOIR, age, amount and tenor eligibility." }],
      terms: ["EMI", "FOIR", "NACH", "KFS"],
      related: ["m03-underwriting/policy-as-data", "m10-capstone/trace-a-loan"],
      check: [{ q: "Why does underwriting carry the whole risk decision in this journey?", options: ["Regulation forbids collateral", "It is unsecured — there is nothing to enforce, so credit assessment is the only protection", "EMIs are small", "The bureau insures it"], answer: 1, why: "With no security interest, recovery depends on the borrower's capacity and intent — both judged before sanction." }]
    }),
    j("msme_term_loan", {
      title: "MSME term loan",
      objectives: ["Underwrite a business rather than a salary", "Use GST, Udyam and cash-flow evidence correctly"],
      sections: [
        { heading: "The product", body: "A term loan to a micro, small or medium enterprise for expansion, equipment or other declared end use. The borrower is a **legal entity plus its promoters**: entity KYC, beneficial-owner checks and promoter guarantees join the file. Income proof becomes business proof — GST returns, Udyam registration, financial statements, and bank cash flows (often via the Account Aggregator).\n\nEnd use is declared and monitored: business loans that quietly finance consumption are a classic early-warning signal." },
        { heading: "What a BA watches", body: "Business vintage and cash-flow seasonality drive policy differently from salaried lending: FOIR gives way to debt-service coverage from business cash flows. Documentation is heavier and deficiency/waiver workflows work harder. CGTMSE guarantee cover can substitute for collateral on eligible loans — a policy parameter, not an afterthought." }
      ],
      regulatory: [{ id: "RBI-KYC-2016", note: "Entity CDD and beneficial-owner identification." }, { id: "RBI-DL-2025", note: "Digital MSME journeys carry the same conduct duties." }],
      platform: [{ type: "capability", ref: "UWG-008", note: "GST, ITR, Udyam, employment and business verification." }],
      terms: ["AA", "FOIR", "GST"],
      related: ["m03-underwriting/credit-data", "m02-onboarding/kyc-cdd"],
      check: [{ q: "What replaces salaried FOIR in MSME underwriting?", options: ["Nothing — FOIR applies as-is", "Debt-service coverage from verified business cash flows", "Promoter net worth only", "GST turnover alone"], answer: 1, why: "The repayment source is the business's cash flow; coverage of obligations from that cash flow is the affordability test." }]
    }),
    j("professional_practice_loan", {
      title: "Professional practice loan",
      objectives: ["Distinguish practice lending from generic business lending", "Anchor eligibility on professional registration"],
      sections: [
        { heading: "The product", body: "A term loan to a practising professional — doctor, chartered accountant, architect, lawyer — for clinic equipment, premises or working needs. The distinguishing asset is the **professional registration**: an active licence with a regulator (MCI/NMC, ICAI, bar council) anchors both identity and earning credibility, alongside practice receipts and tax returns.\n\nRisk behaves differently: earning capacity is personal and licence-bound, so registration status is verified at origination and re-verified during the loan's life." },
        { heading: "What a BA watches", body: "The registration-reverification servicing capability is the tell: a suspended licence is a material change that policy must catch. Practice cash flows can be lumpy (insurance reimbursements, seasonal filings) — schedule design and hardship handling should expect it." }
      ],
      regulatory: [{ id: "RBI-KYC-2016", note: "Professional registration joins CDD as an identity and standing check." }],
      platform: [{ type: "capability", ref: "UWG-013", note: "Manual underwriting workspace and credit note for judgement-heavy files." }],
      terms: ["CAM", "EMI"],
      related: ["m03-underwriting/referrals-overrides"],
      check: [{ q: "Why does this journey re-verify professional registration during servicing?", options: ["Marketing data", "A lapsed or suspended licence removes the earning basis the loan was sanctioned on", "Tax rules", "It doesn't"], answer: 1, why: "The licence is the credit anchor; its loss is a material adverse change the platform must surface." }]
    }),
    j("secured_business_loan", {
      title: "Secured business loan",
      objectives: ["Add collateral machinery to business underwriting", "Walk title, valuation, LTV and perfection"],
      sections: [
        { heading: "The product", body: "An MSME term loan backed by mortgaged property. Everything from the MSME term loan applies, plus the **collateral pipeline**: ownership and title search, independent valuation, LTV policy against market value, insurance with assignment, and **perfection** — registering the charge with CERSAI so the security interest is enforceable and visible to other lenders.\n\nThe reward is cheaper, larger credit; the price is a slower journey with legal opinions and valuation reports on the critical path." },
        { heading: "What a BA watches", body: "Perfection evidence **before disbursement** is the make-or-break control — an unperfected mortgage is barely security at all. At the other end, security release at closure (documents returned, CERSAI satisfaction filed) is dual-controlled and time-bound; module 5's closure checklist applies with force." }
      ],
      regulatory: [{ id: "CERSAI-CKYC", note: "Charge registration and satisfaction with the central registry." }],
      platform: [{ type: "capability", ref: "COL-006", note: "LTV, margin, haircut and revaluation policy." }, { type: "capability", ref: "COL-008", note: "CERSAI search, filing, registration, modification and satisfaction." }],
      terms: ["CERSAI", "SARFAESI"],
      related: ["m08-partners/product-families", "m06-collections/legal-recovery"],
      check: [{ q: "Why must CERSAI registration precede disbursement?", options: ["Tax reporting", "Unperfected security is unenforceable and invisible to other lenders — the collateral barely exists legally", "CERSAI charges late fees", "Valuation expires"], answer: 1, why: "Perfection is what turns a promise of security into an enforceable, publicly visible interest; evidence-before-disbursement is the contract's rule." }]
    }),
    j("loan_against_property", {
      title: "Loan against property",
      objectives: ["Contrast LAP with home loans", "Treat end-use and encumbrance as first-class risks"],
      sections: [
        { heading: "The product", body: "Credit against property the borrower **already owns** — the property is fuel, not the purchase. That inverts the risk questions: encumbrance status (is it already pledged?), occupancy (self-occupied, rented, vacant — each values and enforces differently) and **end use** of the money move to the centre, since LAP funds can flow anywhere from business expansion to debt consolidation.\n\nTitle, valuation, LTV and CERSAI perfection run as in any mortgage journey; LTV caps are typically tighter than home loans because resale of a lived-in or commercial property is messier." },
        { heading: "What a BA watches", body: "End-use codes are not decoration — regulatory treatment (and pricing) differs if LAP funds business versus consumption, and foreclosure-charge prohibitions apply to floating-rate non-business loans to individuals. Collateral revaluation and insurance tracking run for the life of the loan." }
      ],
      regulatory: [{ id: "CERSAI-CKYC", note: "Mortgage perfection and satisfaction." }, { id: "RBI-KFS-2024", note: "Charges — including foreclosure rules — disclose through the KFS." }],
      platform: [{ type: "capability", ref: "COL-003", note: "Ownership, encumbrance and eligibility checks." }],
      terms: ["Foreclosure", "CERSAI"],
      related: ["m05-lms/servicing", "m06-collections/legal-recovery"],
      check: [{ q: "What makes end use central in LAP but marginal in a home loan?", options: ["Nothing — both are identical", "Home-loan funds buy the mortgaged asset; LAP funds go anywhere, so their declared purpose drives regulatory and risk treatment", "LAP is unsecured", "End use sets the LTV"], answer: 1, why: "The home loan's purpose is structurally self-evident; LAP requires the platform to capture, code and monitor what the money is for." }]
    }),
    j("home_loan", {
      title: "Home loan",
      objectives: ["Sequence the property purchase into the credit journey", "Handle construction-linked disbursement and RERA"],
      sections: [
        { heading: "The product", body: "The longest-tenor retail product, financing purchase or construction of a dwelling, secured by the very property being bought. The journey weaves a *transaction* into a loan: sale agreement, seller or developer verification, **RERA project registration** for under-construction property, the borrower's own contribution (margin) evidenced before the lender's money moves, and title/valuation as in any mortgage.\n\nUnder-construction purchases disburse in **stages** — each tranche released against certified construction progress, with pre-EMI interest until full disbursement." },
        { heading: "What a BA watches", body: "Stage-based disbursement is the signature control: money follows verified construction, never the developer's demand letter alone. Contribution-first ordering protects seniority. And the thirty-year horizon makes floating-rate reset communication (module 5) and security release at closure recurring, decades-long duties." }
      ],
      regulatory: [{ id: "CERSAI-CKYC", note: "Mortgage perfection; satisfaction on closure." }, { id: "RBI-DL-2025", note: "Reset options and servicing conduct over a very long tenor." }],
      platform: [{ type: "capability", ref: "DSB-006", note: "Multiple, tranche, stage and construction-linked disbursement." }],
      terms: ["Moratorium", "EMI", "CERSAI"],
      related: ["m04-kfs-sanction/disbursement-fund-flow", "m05-lms/schedules-interest"],
      check: [{ q: "What evidence releases a construction-linked tranche?", options: ["The developer's demand letter", "A certified construction-stage confirmation per the disbursement plan", "Borrower request", "RERA registration alone"], answer: 1, why: "Stage certificates tie funds to verified physical progress — the control that failed in every stalled-project scandal." }]
    }),
    j("equipment_machinery_finance", {
      title: "Equipment & machinery finance",
      objectives: ["Run supplier-and-asset verification alongside credit", "Track the asset from invoice to installation"],
      sections: [
        { heading: "The product", body: "Finance for productive machinery — the lender pays the **supplier** against invoice, and the machine itself secures the loan via an asset charge. The journey therefore verifies two counterparties: the borrower (business underwriting) and the **supplier** (due diligence, quotation, invoice authenticity), then follows the asset — serial number, delivery evidence, installation certificate where required.\n\nSupplier payment is the permitted third-party fund flow: money moves to the verified supplier against the verified invoice, never as cash to the borrower." },
        { heading: "What a BA watches", body: "Invoice fraud is the signature risk: inflated or fabricated invoices with a colluding supplier turn an asset loan into an unsecured one. Serial-number capture and delivery/installation confirmation close the loop between paper and machine; asset monitoring keeps it closed." }
      ],
      regulatory: [{ id: "RBI-FUND-FLOW", note: "Supplier payment is a controlled, permitted end-use flow — not a loophole." }, { id: "RBI-KYC-2016", note: "Supplier due diligence rides on CDD discipline." }],
      platform: [{ type: "capability", ref: "DSB-007", note: "Supplier/dealer/end-use payment and invoice linkage." }],
      terms: ["Escrow", "EMI"],
      related: ["m04-kfs-sanction/disbursement-fund-flow"],
      check: [{ q: "Why pay the supplier rather than the borrower?", options: ["Faster settlement", "It binds the funds to the verified asset purchase, preserving both end use and the security's existence", "Tax efficiency", "Suppliers demand it"], answer: 1, why: "Direct supplier payment against a verified invoice is the control that ensures the financed machine actually exists and is actually bought." }]
    }),
    j("green_equipment_finance", {
      title: "Green equipment finance",
      objectives: ["Layer green-taxonomy evidence onto asset finance", "Handle subsidies and impact reporting honestly"],
      sections: [
        { heading: "The product", body: "Equipment finance for verifiably green assets — solar, efficient machinery, clean mobility infrastructure. Structurally it is the equipment journey plus a **green evidence layer**: a taxonomy code with supporting evidence, a baseline impact metric, and any subsidy or incentive programme reference that alters the economics.\n\nThe extra layer exists because green lending attracts incentives and claims — and claims need evidence. Greenwashing is a conduct risk with growing regulatory attention." },
        { heading: "What a BA watches", body: "Taxonomy re-verification and impact reporting are servicing duties, not origination checkboxes: an asset that stops qualifying (or a subsidy that lapses) changes disclosures and possibly pricing. Subsidy reconciliation is real accounting — incentive money flows on its own timetable and must reconcile against the loan." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "Green claims to borrowers are conduct-governed disclosures." }],
      platform: [{ type: "capability", ref: "RPT-011", note: "PSL classification and reporting — green/priority tagging feeds regulatory reporting." }],
      terms: ["GST"],
      related: ["journeys/equipment-machinery-finance"],
      check: [{ q: "What distinguishes this journey from plain equipment finance?", options: ["Lower rates only", "A verified green-taxonomy evidence layer with impact and subsidy tracking through the loan's life", "No supplier checks", "Government guarantee"], answer: 1, why: "The green layer is evidence-first: taxonomy code, baseline metric, ongoing re-verification — because incentives and claims attach to it." }]
    }),
    j("personal_vehicle_loan", {
      title: "Personal vehicle loan",
      objectives: ["Run the dealer-anchored purchase flow", "Track registration, hypothecation and insurance"],
      sections: [
        { heading: "The product", body: "Finance for a private vehicle, paid to the **dealer** against the on-road quotation, secured by **hypothecation** — the lender's charge noted on the RTO registration certificate itself. The journey runs dealer verification, borrower margin (down payment), delivery confirmation, then chases two artefacts: the registration certificate with the hypothecation endorsement, and comprehensive insurance naming the lender.\n\nAt closure, hypothecation release (RTO endorsement removal) is the vehicle world's equivalent of mortgage satisfaction — and the classic source of post-closure grievances when forgotten." },
        { heading: "What a BA watches", body: "The gap between disbursement and registration/insurance evidence is the risk window — post-disbursement document follow-up exists precisely for it. Dealer settlement discipline mirrors supplier payment in equipment finance." }
      ],
      regulatory: [{ id: "RBI-FUND-FLOW", note: "Dealer payment is the controlled end-use flow." }],
      platform: [{ type: "capability", ref: "DSB-013", note: "Post-disbursement document and end-use follow-up." }],
      terms: ["EMI", "NOC"],
      related: ["journeys/commercial-vehicle-finance", "m05-lms/servicing"],
      check: [{ q: "What is hypothecation, in one line?", options: ["A type of insurance", "The lender's charge on the vehicle recorded on its RTO registration", "A dealer discount", "A repayment schedule"], answer: 1, why: "The RTO endorsement is the perfection mechanism for vehicles — visible on the registration certificate and removed at closure." }]
    }),
    j("commercial_vehicle_finance", {
      title: "Commercial vehicle finance",
      objectives: ["Underwrite the vehicle as a business", "Bring permits and route economics into credit"],
      sections: [
        { heading: "The product", body: "Finance for trucks, buses and fleet vehicles where **the vehicle earns its own EMI**. Underwriting therefore models route economics — permit type, route or use code, fleet experience, projected vehicle cash flows — on top of the dealer/registration/insurance machinery of the personal vehicle journey.\n\nThe borrower ranges from a first-time single-truck operator to a fleet company, and policy differentiates sharply: fleet size and operator vintage are contract facts, not colour." },
        { heading: "What a BA watches", body: "Permit tracking is the journey's special servicing duty — an expired national/state permit idles the asset and its cash flow. Vehicle cash-flow review continues through the loan; commercial vehicles are also where repossession (module 6) is most operationally real, with yard, inventory and release controls." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "Conduct rules govern operator-segment collections hard." }],
      platform: [{ type: "capability", ref: "REC-007", note: "Repossession authorization, inventory, yard and release." }],
      terms: ["EMI", "PTP"],
      related: ["journeys/personal-vehicle-loan", "m06-collections/legal-recovery"],
      check: [{ q: "Why is the permit a servicing-time concern, not just an origination check?", options: ["Permits never expire", "An expired permit idles the vehicle — killing the very cash flow that services the loan", "RTO requires it", "Insurance depends on it"], answer: 1, why: "The asset's earning licence is the repayment source; the contract tracks it for the life of the loan." }]
    }),
    j("gold_loan", {
      title: "Gold loan",
      objectives: ["Run assay, custody and LTV as one discipline", "Explain margin calls and the auction backstop"],
      sections: [
        { heading: "The product", body: "Credit against pledged household gold — India's oldest collateral, and the journey where **custody is the product**. Assay determines purity and net eligible weight (stones deducted); the assessed rate prices the collateral; LTV caps the advance; the sealed packet enters dual-control vault custody with a receipt. Tenors are short; schedules are often bullet or interest-serviced.\n\nBecause gold is priced daily, **LTV is monitored daily**: a falling gold price triggers margin calls, and sustained breach leads to the regulated auction path — noticed, reserve-priced, surplus returned to the borrower." },
        { heading: "What a BA watches", body: "Every custody movement is dual-controlled and evidenced — packet seal, vault transfer, release. The auction is a borrower-protection process as much as a recovery one: notice, transparency, surplus return. Weight is exact; money is exact; there is no rounding culture in a gold vault." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "LTV caps and auction conduct for gold lending sit in RBI's lending regulations." }],
      platform: [{ type: "capability", ref: "COL-002", note: "Gold among collateral types: assay, custody, release." }],
      terms: ["Amortisation", "NOC"],
      related: ["m06-collections/legal-recovery", "m08-partners/product-families"],
      check: [{ q: "Gold prices fall 15% in a month. What does the journey do?", options: ["Nothing — LTV was checked at origination", "Daily LTV monitoring flags breaches, triggers margin calls, and escalates to the noticed auction path if uncured", "Auto-forecloses immediately", "Reprices the interest"], answer: 1, why: "Daily mark-to-market with margin-call and auction-policy machinery is the contract's core risk control." }]
    }),
    j("education_loan", {
      title: "Education loan",
      objectives: ["Structure credit around a course, not a salary", "Run moratorium and institution-direct payment"],
      sections: [
        { heading: "The product", body: "Finance for tuition and study costs, underwritten on the **future earning power** the course creates plus a co-borrower's (usually a parent's) present capacity. The journey verifies the institution, course and admission; pays **fees directly to the institution** in tranches aligned to the fee schedule; and grants a **moratorium** through the course plus a grace period before EMIs begin — with interest accruing (and its treatment disclosed) throughout.\n\nOverseas study adds visa evidence and forex dimensions; scholarship or margin money offsets the financed cost." },
        { heading: "What a BA watches", body: "Academic-progress tracking is the unusual servicing duty: a dropped-out student changes the risk completely. Moratorium mechanics must be honest in the KFS — capitalised interest quietly ballooning the principal is exactly the disclosure failure the APR exists to expose." }
      ],
      regulatory: [{ id: "RBI-KFS-2024", note: "Moratorium-interest treatment must be visible in APR and the amortisation table." }],
      platform: [{ type: "capability", ref: "LMS-005", note: "Moratorium, pre-EMI, EMI holiday and capitalised interest." }],
      terms: ["Moratorium", "APR", "EMI"],
      related: ["m05-lms/schedules-interest", "m04-kfs-sanction/kfs"],
      check: [{ q: "Why do fees flow to the institution rather than the student?", options: ["Institutions demand it", "It binds funds to the financed education — the end-use control this journey exists for", "Students lack bank accounts", "It avoids GST"], answer: 1, why: "Institution-direct tranche payment against the fee schedule is the end-use guarantee, exactly parallel to supplier payment in asset finance." }]
    }),
    j("agriculture_allied_finance", {
      title: "Agriculture & allied finance",
      objectives: ["Fit credit to seasons instead of months", "Use field, land and geo evidence properly"],
      sections: [
        { heading: "The product", body: "Credit for cultivation and allied activity (dairy, poultry, fisheries), where the repayment source is a **harvest, not a payroll**. The journey captures land or tenancy records, crop/activity and season codes, acreage with geo-tagged field evidence, and a seasonal cash-flow plan; weather and price risk references acknowledge what no lender controls.\n\nSchedules are **seasonal or irregular** — disbursement at sowing, repayment after harvest — and crop insurance is the risk transfer that makes the model work. Priority-sector classification usually applies." },
        { heading: "What a BA watches", body: "Offline field service is real here: capture happens where connectivity doesn't. Calamity restructure is a designed path, not an exception — weather events trigger recognised relief mechanics with their own classification treatment. Field evidence integrity (geo, time, photos) substitutes for the paper trail urban lending takes for granted." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "Field and assisted channels carry the same conduct and attribution duties." }],
      platform: [{ type: "capability", ref: "RPT-011", note: "PSL classification and reporting." }, { type: "doc", ref: "docs/architecture/android-field-operations-app.md", note: "The field app that carries offline capture and evidence." }],
      terms: ["Moratorium", "Restructuring"],
      related: ["m06-collections/collections-operations", "m08-partners/product-families"],
      check: [{ q: "Why are agri schedules irregular rather than monthly?", options: ["Rural banking hours", "Repayment capacity arrives with the harvest — the schedule mirrors the crop cycle", "Regulation forbids EMIs", "Interest is seasonal"], answer: 1, why: "Matching instalments to seasonal cash flow is the whole design; monthly EMIs against harvest income manufacture delinquency." }]
    }),
    j("microfinance_group_lending", {
      title: "Microfinance & group lending",
      objectives: ["Explain joint-liability group mechanics", "Treat household indebtedness and conduct as the core controls"],
      sections: [
        { heading: "The product", body: "Small, unsecured loans to members of a **joint-liability group** — the group's mutual guarantee and social cohesion substitute for collateral. The journey is group-first: group and centre references, member sequencing, a group resolution, training evidence, and centre-meeting collections.\n\nThe regulatory heart is the **household**: income and total indebtedness are assessed at household level, with repayment-capacity caps that prevent the over-lending spiral that produced India's microfinance crises. A no-coercion attestation is a contract fact — conduct is engineered in, not assumed." },
        { heading: "What a BA watches", body: "Household-indebtedness monitoring continues through the loan — other lenders' loans count. Conduct monitoring (collections behaviour at centre meetings) is the journey's compliance edge. Note the platform boundary honestly: the support matrix records this journey's current maturity, and JLG-specific rules are explicitly staged work." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "Conduct, coercion prohibition and household assessment sit at the centre of MFI regulation." }],
      platform: [{ type: "capability", ref: "UWG-010", note: "Household FOIR and microfinance indebtedness." }],
      terms: ["FOIR", "PTP", "FPC"],
      related: ["m06-collections/collections-operations", "m01-landscape/regulation-as-controls"],
      check: [{ q: "What substitutes for collateral in group lending?", options: ["Government guarantee", "The group's joint liability and social cohesion, protected by conduct rules", "Gold pledges", "Higher rates alone"], answer: 1, why: "Mutual guarantee within a trained, resolved group is the security model — which is why group formation evidence and conduct controls are contract facts." }]
    }),
    j("consumer_durable_finance", {
      title: "Consumer durable finance",
      objectives: ["Run point-of-sale credit at retail speed with full controls", "Reconcile merchant settlement, delivery and returns"],
      sections: [
        { heading: "The product", body: "Checkout credit for appliances and electronics: the customer picks a product, pays a down payment, and the lender settles the **verified merchant** against the invoice — often inside minutes, at a point-of-sale counter or online. The contract facts are the transaction's skeleton: merchant, SKU, invoice, amounts, delivery-OTP confirmation, serial number.\n\nSpeed changes nothing regulatory: KFS, consent, KYC and cooling-off all fire inside those minutes, which is why this journey is a favourite stress test of 'instant but governed'." },
        { heading: "What a BA watches", body: "Returns and cancellations are the special mechanics: a returned television must unwind a live loan — merchant clawback, refund, schedule cancellation — cleanly. Merchant conduct (dark patterns at checkout, pushed add-ons) is channel governance from module 8 at its sharpest." }
      ],
      regulatory: [{ id: "CCPA-DARK-PATTERNS", note: "Checkout credit is where deceptive-pattern rules bite hardest." }, { id: "RBI-FUND-FLOW", note: "Merchant settlement is the controlled end-use flow." }],
      platform: [{ type: "capability", ref: "CHN-004", note: "API/embedded-finance application intake." }],
      terms: ["Cooling-off period", "KFS"],
      related: ["m02-onboarding/acquisition-channels", "m04-kfs-sanction/kfs"],
      check: [{ q: "A financed appliance is returned to the merchant. What must the platform do?", options: ["Keep the loan running", "Unwind: merchant clawback, refund allocation, loan cancellation with clean accounting", "Convert to a personal loan", "Charge foreclosure fees"], answer: 1, why: "Cancellation-and-refund with returns reconciliation is a designed lifecycle capability — retail credit lives and dies by clean unwinds." }]
    }),
    j("invoice_discounting", {
      title: "Invoice discounting",
      objectives: ["Finance a receivable rather than a borrower", "Manage buyer risk, concentration and disputes"],
      sections: [
        { heading: "The product", body: "A seller has delivered goods and holds a 60-day invoice; the lender advances most of its face value now and collects from the **buyer** at maturity. Credit shifts to the buyer's willingness and ability to pay: buyer verification, invoice authenticity, buyer's acceptance, and a registered **assignment** of the receivable are the underwriting.\n\nAdvance rates (e.g. 80% of face value), per-buyer concentration limits and dispute status guard the pool; the facility revolves as invoices are financed and settled." },
        { heading: "What a BA watches", body: "Duplicate financing — the same invoice discounted with two lenders — is the signature fraud; assignment acknowledgement and registry checks exist for it. Disputes ('goods were defective') convert financial risk into commercial risk mid-flight; the dispute-management workflow decides who absorbs it." }
      ],
      regulatory: [{ id: "RBI-KYC-2016", note: "Both seller and buyer enter CDD; trade-based money laundering is the AML lens." }],
      platform: [{ type: "capability", ref: "PAR-011", note: "Assignment machinery in the transfer family." }],
      terms: ["Escrow", "GST"],
      related: ["journeys/supply-chain-finance", "m08-partners/product-families"],
      check: [{ q: "Whose credit matters most in invoice discounting?", options: ["The seller's", "The buyer's — they are the one who must pay the invoice at maturity", "The lender's", "Neither"], answer: 1, why: "The receivable's value is the buyer's obligation; buyer verification and acceptance are the real underwriting." }]
    }),
    j("purchase_order_finance", {
      title: "Purchase-order finance",
      objectives: ["Fund production before a receivable exists", "Control milestones from order to settlement"],
      sections: [
        { heading: "The product", body: "One step earlier than invoice discounting: the seller holds a confirmed **purchase order** but needs working capital to produce and ship. The lender funds against the order's value and cost estimate, releasing money at **fulfilment milestones** — raw material, production, shipment — and recovers from the buyer's payment after delivery.\n\nRisk is double: performance risk (will the seller deliver?) stacks on buyer credit risk. Margins between order value and cost, incoterms and shipment evidence are contract facts because they are the risk math." },
        { heading: "What a BA watches", body: "Milestone drawdown discipline is everything — funding ahead of verified progress converts trade finance into an unsecured loan to a hopeful manufacturer. Buyer-cancellation management is the designed answer to the order evaporating mid-production." }
      ],
      regulatory: [{ id: "RBI-KYC-2016", note: "Buyer and seller CDD; trade documentation authenticity." }],
      platform: [{ type: "capability", ref: "DSB-006", note: "Staged disbursement machinery reused as milestone drawdown." }],
      terms: ["Escrow"],
      related: ["journeys/invoice-discounting", "journeys/trade-finance-workflow"],
      check: [{ q: "What extra risk does PO finance carry over invoice discounting?", options: ["None", "Performance risk — the goods do not exist yet, so the seller must first deliver", "Currency risk only", "Lower margins"], answer: 1, why: "An invoice evidences completed delivery; a purchase order only promises it — milestone controls manage that gap." }]
    }),
    j("supply_chain_finance", {
      title: "Supply-chain finance",
      objectives: ["Scale receivables finance around an anchor", "Run programme limits and ERP-confirmed assets"],
      sections: [
        { heading: "The product", body: "Invoice finance industrialised around an **anchor** — a large corporate whose many suppliers (or dealers) need liquidity. The anchor's agreement and its **ERP confirmation** of each trade asset replace laborious per-invoice verification: if the anchor's system says the invoice is approved for payment, the receivable is real.\n\nLimits stack: a programme limit for the anchor relationship, per-participant limits, concentration caps. Collection concentrates too — the anchor pays into the programme at maturity, and settlement fans out." },
        { heading: "What a BA watches", body: "Anchor dependence is the systemic risk: the anchor's credit event hits the whole programme at once, which is what programme limits and dynamic limit management price. Participant onboarding is genuine CDD at scale — hundreds of small suppliers, each a real KYC file." }
      ],
      regulatory: [{ id: "RBI-KYC-2016", note: "Every participant is a customer requiring CDD, not a row in the anchor's vendor file." }],
      platform: [{ type: "capability", ref: "RSK-003", note: "Concentration limits and risk-appetite thresholds." }],
      terms: ["Escrow"],
      related: ["journeys/invoice-discounting", "m08-partners/lsp-dla-governance"],
      check: [{ q: "What does the anchor's ERP confirmation replace?", options: ["KYC on participants", "Per-invoice manual verification — the anchor's approval evidences the receivable", "Programme limits", "Settlement"], answer: 1, why: "ERP-confirmed trade assets are the scalability trick; CDD and limits remain fully in force." }]
    }),
    j("trade_finance_workflow", {
      title: "Trade-finance workflow",
      objectives: ["Handle instruments, documents and sanctions in cross-border trade", "Understand contingent versus funded exposure"],
      sections: [
        { heading: "The product", body: "The documentary end of trade: letters of credit, guarantees and collections, where the bank's promise (a **contingent** exposure) substitutes for trust between distant counterparties, becoming funded only if drawn. The workflow examines **documents, not goods**: instrument terms, shipment documents, customs evidence — discrepancies between them are the daily work.\n\nCross-border means **sanctions screening** on every party and route, currency in minor units of its own denomination, incoterms allocating who bears what, and SWIFT messaging as the transport." },
        { heading: "What a BA watches", body: "Trade-based money laundering is the AML frontier — over/under-invoicing and phantom shipments launder value through exactly these instruments, which is why screening and document examination are contract facts. Contingent accounting (exposure without disbursement) is unlike every other journey; treat it as its own discipline." }
      ],
      regulatory: [{ id: "RBI-KYC-2016", note: "Sanctions screening and trade-based AML sit inside the KYC/AML regime." }],
      platform: [{ type: "capability", ref: "KYC-011", note: "Sanctions and negative-list screening machinery." }],
      terms: ["STR", "FIU-IND"],
      related: ["m02-onboarding/kyc-cdd", "journeys/purchase-order-finance"],
      check: [{ q: "Banks in documentary trade deal in…", options: ["Goods", "Documents — conformity of papers to instrument terms, not the cargo itself", "Ships", "Warehouses"], answer: 1, why: "The instrument obliges payment against conforming documents; examination and discrepancy management are the craft." }]
    }),
    j("co_lending_programme", {
      title: "Co-lending programme",
      objectives: ["Operate the arrangement mechanics at journey level", "Own allocation, escrow and reconciliation duties"],
      sections: [
        { heading: "The product", body: "Module 8 taught the rules; this is the journey that runs them. The contract facts are the arrangement itself: originator and partner-lender references, **shares in basis points** (summing to 100% with the retention floor respected), the escrow account, the settlement **waterfall**, programme limits and per-loan allocation references.\n\nEvery lifecycle event — disbursement, EMI, charge, recovery — splits by share into partner subledgers, funded and settled through escrow per the waterfall." },
        { heading: "What a BA watches", body: "Reconciliation is the operating burden: partner statements, escrow movements and subledger legs must agree, with break management for when they don't. First-loss support arrangements (where present) interact with DLG rules — caps and classification duties from module 8 apply without dilution." }
      ],
      regulatory: [{ id: "RBI-CLA-2025", note: "Shares, retention floor, blended rate and escrow — enforced at journey level." }, { id: "RBI-FUND-FLOW", note: "Escrow is the permitted joint-funding channel." }],
      platform: [{ type: "capability", ref: "PAR-006", note: "Loan-level allocation and share reconciliation." }, { type: "code", ref: "packages/core/src/co-lending.js", note: "The arrangement module the journey binds to." }],
      terms: ["Co-lending", "Escrow", "DLG"],
      related: ["m08-partners/co-lending", "m08-partners/dlg"],
      check: [{ q: "An EMI arrives on an 80/20 co-lent loan. What happens in accounting?", options: ["It books to the originator", "It splits 80/20 into each partner's principal/interest/fee subledger legs and settles via the escrow waterfall", "It waits for month-end", "The bank keeps interest, the NBFC principal"], answer: 1, why: "Loan-level allocation by share, per component, per event — reconciled through escrow — is the journey's operating core." }]
    }),
    j("msme_working_capital", {
      title: "MSME working capital",
      objectives: ["Operate revolving limits and drawing power", "Run stock statements, reviews and renewals"],
      sections: [
        { heading: "The product", body: "Not a loan but a **revolving facility**: an approved limit the business draws and repays continuously, paying interest daily on what it uses. The lender's real control is **drawing power** — the portion of the limit actually available, recalculated from the borrower's **stock statements and receivables ageing** after margins: current assets secure the facility, so available credit tracks their verified value.\n\nAnnual **renewal** re-underwrites the relationship; the facility never self-amortises, so review discipline substitutes for a repayment schedule." },
        { heading: "What a BA watches", body: "Stale stock statements are the classic decay: drawing power computed from six-month-old inventory data is fiction, and policy penalises late statements by cutting DP. Stock audits verify the paper against the warehouse. Continuous churn (deposits and draws) makes this the LMS's daily-interest, utilisation-math stress test — module 5's daily-reducing machinery in production." }
      ],
      regulatory: [{ id: "RBI-DL-2025", note: "Facility conduct and disclosure duties apply to revolving credit too." }, { id: "RBI-IT-GRC", note: "Utilisation-based interest and DP recalculation demand exact, auditable computation." }],
      platform: [{ type: "capability", ref: "LMS-008", note: "Revolving credit, OD, cash credit and drawdown facilities." }],
      terms: ["GST", "EMI"],
      related: ["m05-lms/schedules-interest", "journeys/msme-term-loan"],
      check: [{ q: "The limit is ₹1 crore; margined stock and receivables support ₹62 lakh. How much can the borrower draw?", options: ["₹1 crore — the limit governs", "₹62 lakh — drawing power binds inside the limit", "₹81 lakh — the average", "Nothing until renewal"], answer: 1, why: "Drawing power, recalculated from current-asset statements, is the operative ceiling; the sanctioned limit is only its upper bound." }]
    })
  ]
};
