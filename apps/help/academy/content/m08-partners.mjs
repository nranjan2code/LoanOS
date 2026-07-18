// Module 8 — Partnerships and product families.
export default {
  id: "m08-partners",
  number: 8,
  title: "Partnerships and product families",
  tagline: "Lending is a team sport with strict rules: partners, guarantees, shared loans — and the products they carry.",
  summary: "Few REs lend alone. This module covers the governed partnership models — LSP/DLA oversight, Default Loss Guarantees with their caps and clocks, co-lending with its shares and escrow — and closes with a tour of India's retail product families and how policy differs across them.",
  lessons: [
    {
      id: "lsp-dla-governance",
      title: "LSP and DLA governance in depth",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "Run the LSP lifecycle: due diligence, contract, review, exit",
        "Maintain the DLA inventory and its public disclosures",
        "Attribute partner conduct and handle partner incidents"
      ],
      sections: [
        { heading: "Before the partnership: due diligence", body: "Module 1 introduced the triangle; here is the governance a BA operationalises. Onboarding an LSP requires **enhanced due diligence**: legal existence, financial health, technology and security posture, data-handling practices, conduct history, and — for collection-touching LSPs — recovery-agent controls. The agreement pins roles, data boundaries, fee structure (**RE-paid**, never borrower-padded), audit rights and exit terms.\n\nThen the cycle: **periodic review** with portfolio monitoring, refreshed diligence, and an exit plan that keeps borrower service continuous if the partnership ends. The outsourcing directions treat a failed vendor exit as the RE's operational risk — plan it before signing, not after." },
        { heading: "The DLA inventory is a living register", body: "Every borrower-facing surface — RE-owned apps and websites, LSP-owned ones — sits in the **DLA registry** with ownership, grievance contact, linkage to the RE's website (the borrower can always verify who the lender is), and India data-handling attributes. The register exports **CIMS-ready rows** for RBI reporting, and the CCO attests to it. Launching a journey on an unregistered surface is a reportable miss — which is why registration is a workflow gate, not a memo." },
        { heading: "When a partner fails", body: "Partner incidents — data breach at an LSP, conduct violations by an agency, an app collecting data beyond consent — trigger the partner-incident workflow: containment, borrower impact assessment, remediation, possibly **suspension** (the platform can pause a channel's authority without destroying its records) and exit. Conduct attribution (module 7's grievance lesson) supplies the evidence: every complaint tied to a channel accumulates into that partner's review file." }
      ],
      regulatory: [
        { id: "RBI-LSP-DLG", note: "LSP due diligence and oversight duties." },
        { id: "RBI-DLA-CIMS", note: "DLA reporting and public-disclosure maintenance." },
        { id: "RBI-OUTSOURCE", note: "Outsourcing lifecycle: diligence, audit rights, exit plans." }
      ],
      platform: [
        { type: "capability", ref: "PAR-001", note: "LSP agreement, role, due diligence, review, data and fee controls." },
        { type: "capability", ref: "PAR-002", note: "LSP incident, breach, remediation, suspension and exit." },
        { type: "capability", ref: "RPT-002", note: "DLA CIMS export and CCO certification." }
      ],
      terms: ["LSP", "DLA", "CIMS"],
      related: ["m01-landscape/digital-lending-model", "m07-lws/grievance-fraud-cases"],
      check: [
        { q: "Who pays the LSP's fees for sourcing a loan?", options: ["The borrower, as a disclosed charge", "The RE — partner fees cannot be loaded onto the borrower", "Split 50/50", "The DLG provider"], answer: 1, why: "The directions require LSP compensation to come from the RE; smuggling it into borrower charges violates both fee and disclosure rules." }
      ]
    },
    {
      id: "dlg",
      title: "Default Loss Guarantee: shared risk, capped and clocked",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain what a DLG is and why RBI regulates it tightly",
        "State the eligibility, form, cap and invocation rules",
        "Identify the duties the RE can never delegate to a DLG"
      ],
      sections: [
        { heading: "The economics and the danger", body: "In many RE–LSP partnerships the LSP believes in 'its' borrowers and offers to absorb first losses: a **Default Loss Guarantee**. Useful — it aligns incentives and lets REs enter segments they'd otherwise avoid. Dangerous — unbounded DLG turns the RE into a rent-a-licence: the LSP effectively lends, unregulated, behind the RE's badge. That is precisely what the RBI's DLG framework prevents." },
        { heading: "The rulebook", body: "The framework's teeth:\n\n- **Eligible providers and contracts** — a proper agreement with an LSP meeting eligibility norms.\n- **Permitted forms only** — cash deposit with the RE, fixed deposit with lien, or bank guarantee. Promises and comfort letters are not DLG.\n- **The 5% cap** — DLG cannot exceed **5% of the outstanding portfolio** it covers. First-loss beyond that is structurally prohibited.\n- **The 120-day clock** — the RE must **invoke** the guarantee within 120 days of a default, or the cover lapses for that case.\n- **Disclosure** — DLG arrangements are disclosed; portfolio performance stays transparent.\n\nAnd the non-delegable core: **NPA classification and provisioning stay with the RE**. A loss covered by DLG is still an NPA on the RE's book — the guarantee compensates; it never launders asset quality." },
        { heading: "In the platform", body: "LoanOS models DLG as a governed object: provider eligibility, form, cap tracking against the covered portfolio, invocation windows with clocks, replenishment, recovery-sharing and disclosure evidence — implemented in the core DLG module with the exposure math and clocks the framework demands. A BA scoping a DLG-backed program specifies the covered portfolio definition precisely: caps and invocations compute against it." }
      ],
      regulatory: [
        { id: "RBI-LSP-DLG", note: "DLG eligibility, permitted forms, 5% portfolio cap, 120-day invocation, disclosure, RE-retained classification duty." }
      ],
      platform: [
        { type: "capability", ref: "PAR-003", note: "DLG provider eligibility, form, cap, tenor and invocation." },
        { type: "capability", ref: "PAR-004", note: "DLG exposure, replenishment, recovery, disclosure and accounting." },
        { type: "code", ref: "packages/core/src/lending/dlg.js", note: "The DLG module: caps, forms, invocation windows." }
      ],
      terms: ["DLG", "NPA", "LSP"],
      related: ["m06-collections/delinquency-classification", "m08-partners/co-lending"],
      check: [
        { q: "An LSP offers to guarantee 12% of first losses on its sourced portfolio. What does the platform do?", options: ["Accept — more cover is safer", "Accept with disclosure", "Reject — DLG is capped at 5% of the portfolio", "Convert to co-lending"], answer: 2, why: "The 5% cap is structural: beyond it, the arrangement becomes de facto unlicensed lending by the LSP, which the framework exists to prevent." },
        { q: "A DLG fully covers a defaulted loan. Its classification on the RE's book?", options: ["Standard — no loss", "NPA per IRACP, regardless of the guarantee", "Off-book", "The LSP's problem"], answer: 1, why: "Classification duty is retained by the RE; DLG compensates losses but never changes asset quality." }
      ]
    },
    {
      id: "co-lending",
      title: "Co-lending: two balance sheets, one loan",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain the co-lending model and its funding mechanics",
        "State the share, retention, blended-rate and escrow rules",
        "Describe loan-level allocation and partner reconciliation"
      ],
      sections: [
        { heading: "Why two lenders share one loan", body: "**Co-lending** pairs complementary strengths: typically an NBFC's origination reach and a bank's cheap capital, jointly funding loans under a **prior master agreement**. The borrower gets credit that neither partner would extend alone; each partner books its share.\n\nThe 2025 arrangements rulebook: **funding shares are disclosed and sum to 100%**; the **originating RE retains a minimum share** (a retention floor — skin in the game, no originate-and-dump); the borrower sees **one blended rate** (the weighted price of both partners' funds — not two confusing rates); and **all money moves through an escrow account** — no routing through a single partner's books that could disguise the arrangement." },
        { heading: "One borrower, two ledgers", body: "Operationally, every rupee event splits by share: disbursement funds arrive from both partners via escrow; each EMI's principal, interest and charges **allocate loan-level** to each partner's ledger legs; fees and taxes divide per agreement; collections and recoveries (including from module 6's paths) allocate by share. Partner reconciliation runs on statements and break management like any other financial interface.\n\nServicing stays single-faced: the borrower deals with one servicer, one grievance path, one KFS — the co-lending complexity is the lenders' problem, never the borrower's. LoanOS's co-lending module implements the agreement, share validation, blended-rate math and escrow routing." },
        { heading: "Adjacent structures", body: "A BA should recognise the neighbours: **direct assignment / portfolio sale** (transferring existing loans), **securitisation** (pooling and tranching), **servicing transfer** (moving the servicing duty), and **participation**. Each has its own rulebook; the platform's transfer capabilities model them separately from co-lending, which is a *joint origination* structure, not a transfer." }
      ],
      regulatory: [
        { id: "RBI-CLA-2025", note: "Co-lending: prior agreement, disclosed shares summing to 100%, retention floor, single blended rate, escrow routing." },
        { id: "RBI-FUND-FLOW", note: "Escrow is the permitted exception to direct flow — single-partner pass-through remains prohibited." }
      ],
      platform: [
        { type: "capability", ref: "PAR-005", note: "Co-lending agreement, roles, shares, retention, rate and escrow." },
        { type: "capability", ref: "PAR-006", note: "Loan-level allocation and share reconciliation." },
        { type: "capability", ref: "DSB-011", note: "Co-lending escrow and partner funding confirmation." },
        { type: "code", ref: "packages/core/src/lending/co-lending.js", note: "The co-lending module: shares, blended rate, escrow." }
      ],
      terms: ["Co-lending", "Escrow", "EMI", "KFS"],
      related: ["m04-kfs-sanction/disbursement-fund-flow", "m08-partners/dlg"],
      check: [
        { q: "In an 80/20 bank/NBFC co-lending pact, the borrower's rate is…", options: ["The bank's rate on 80% and the NBFC's on 20%, shown separately", "One blended rate weighted across both partners' pricing", "The higher of the two", "Negotiable per EMI"], answer: 1, why: "The borrower sees a single all-in blended rate; the internal split is the partners' accounting, not the borrower's problem." },
        { q: "Why must co-lending funds move through escrow?", options: ["Faster settlement", "So neither partner's account becomes an undisclosed pass-through controlling the joint flows", "Tax efficiency", "RBI charges fees on escrow"], answer: 1, why: "Escrow keeps the joint funding transparent and prevents single-partner control — the co-lending-specific application of the fund-flow principle." }
      ]
    },
    {
      id: "product-families",
      title: "Product families: how policy changes with the product",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Tour India's retail/MSME product families and their distinguishing controls",
        "Map product differences to policy, collateral and schedule variations",
        "Know what LoanOS's first slice supports versus catalogues"
      ],
      sections: [
        { heading: "The same skeleton, different organs", body: "Every product this platform catalogues walks the same lifecycle you have learned — consent, KYC, decision, KFS, disbursement, servicing, collections, closure. What changes per family is the policy, collateral and schedule shape:\n\n- **Unsecured personal term loan** — the baseline this course traced; FOIR-led decisioning, monthly EMI, no collateral. LoanOS's first-slice depth is here.\n- **MSME term loan** — business income analysis (GST returns, ITR, bank cash flows via AA), Udyam registration, sometimes CGTMSE guarantee cover in place of collateral.\n- **Working capital / OD / cash credit** — revolving limits, daily-reducing interest, utilisation and limit reviews rather than fixed EMIs.\n- **Home loan / LAP** — property collateral: title opinion, valuation, LTV caps, CERSAI registration, construction-linked tranche disbursement; the longest tenors.\n- **Vehicle / equipment finance** — asset-backed with RTO/registry lien, dealer/end-use payment at disbursement, repossession as the recovery lever.\n- **Gold loan** — LTV-regulated against pledged gold, short tenors, bullet or interest-serviced schedules, auction as recovery.\n- **Education loan** — moratorium through study plus grace, step-up repayment.\n- **Agri / seasonal** — harvest-aligned irregular schedules, PSL classification relevance.\n- **Supply-chain / invoice finance** — receivable-backed, tenor tied to invoice maturity." },
        { heading: "What a BA extracts from this", body: "When scoping a new product, interrogate the family: What secures it (and which registry perfects it)? What schedule shape fits the cash flows? Which extra verifications enter KYC/underwriting (property title, dealer invoice, gold assay, Udyam)? Which recovery levers apply (SARFAESI needs security interest; repossession needs the asset)? Which regulatory overlays attach (LTV caps, PSL tags, MFI rules — noting the platform currently excludes JLG/MFI-specific machinery)?\n\nEach answer lands in the same place: an effective-dated product policy with its eligibility, pricing, schedule and document requirements — module 3's policy-as-data, parameterised per family. The capability catalogue's product packs enumerate exactly which capabilities each family needs beyond the core." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Digital lending conduct applies across product families." },
        { id: "CERSAI-CKYC", note: "Secured families ride on registry perfection (CERSAI, RTO, land records)." }
      ],
      platform: [
        { type: "doc", ref: "docs/product/complete-system-capability-catalog.md", note: "Product-specific capability packs: per-family requirements beyond the core." },
        { type: "capability", ref: "COL-006", note: "LTV, margin, haircut and revaluation policy for secured families." },
        { type: "capability", ref: "LMS-008", note: "Revolving credit, OD, cash credit and drawdown facilities." },
        { type: "guide", ref: "configure-product", note: "Operating guide: configure a lending product policy." }
      ],
      terms: ["FOIR", "SARFAESI", "CERSAI", "Moratorium", "AA"],
      related: ["m03-underwriting/policy-as-data", "m06-collections/legal-recovery"],
      check: [
        { q: "Which product family most naturally uses a bullet repayment schedule?", options: ["Salaried personal loan", "Home loan", "Gold loan", "Education loan"], answer: 2, why: "Short-tenor gold loans commonly repay principal at maturity (bullet), with the pledged gold securing the exposure." },
        { q: "What must exist before SARFAESI can be used on a home loan default?", options: ["A guarantor", "A registered security interest (e.g. CERSAI) and NPA status", "A court decree", "DLG cover"], answer: 1, why: "SARFAESI enforcement requires a perfected security interest and applies to NPA accounts — no decree needed, that being its point." }
      ]
    }
  ]
};
