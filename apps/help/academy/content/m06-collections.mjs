// Module 6 — Collections and recovery.
export default {
  id: "m06-collections",
  number: 6,
  title: "Collections and recovery",
  tagline: "Getting money back without breaking people: classification math, conduct law, courtrooms and closure.",
  summary: "Collections is where lending's economics and ethics collide, and where India's regulators look hardest. This module covers delinquency measurement and asset classification (DPD, SMA, NPA), the conduct-bound collections operation, the legal recovery arsenal, and the resolution paths — restructuring, settlement, write-off and closure.",
  lessons: [
    {
      id: "delinquency-classification",
      title: "Delinquency: DPD, SMA and NPA classification",
      duration: "20 min",
      verified: "17 Jul 2026",
      objectives: [
        "Compute DPD and place an account in its bucket",
        "Walk the SMA-0/1/2 → NPA ladder and its day-end discipline",
        "Explain the financial consequences: income reversal, provisioning, upgrade rules"
      ],
      sections: [
        { heading: "DPD: the clock that starts at midnight", body: "**Days Past Due** counts from the oldest unpaid due. Miss an EMI on the 5th, and on the 6th the account is 1 DPD; a partial payment doesn't stop the clock unless it clears the oldest due. Collections organises accounts into **buckets** (1–30, 31–60, 61–90, 90+) that drive strategy and staffing.\n\nRBI's stress ladder formalises the early buckets as **Special Mention Accounts**:\n\n- **SMA-0** — 1–30 days overdue.\n- **SMA-1** — 31–60 days.\n- **SMA-2** — 61–90 days.\n\nAt **more than 90 days overdue, the account becomes an NPA**. Classification happens in the **day-end process, every day** — not at month-end when it looks better. The IRACP clarifications ended the older habit of month-end-only tagging: an account that crosses 90 DPD on the 17th is an NPA on the 17th." },
        { heading: "NPA is a financial event, not a label", body: "The moment an account turns NPA:\n\n1. **Income recognition reverses** — interest booked but not collected leaves the P&L; future interest accrues only in memorandum (recognised on actual receipt).\n2. **Provisioning** rises with age and security per IRACP (and Ind AS ECL staging for applicable entities).\n3. **Upgrade is strict** — the account returns to standard only when *all* arrears of interest and principal are cleared, not when it merely slips under 90 DPD.\n4. Borrower-level pull: for most retail treatment, one NPA loan drags the borrower's other loans with the same RE.\n\nThis is why collections intensity concentrates at SMA-2: the 90-day line is where the lender's book, not just the borrower's file, takes the hit." },
        { heading: "The signals a BA should surface", body: "Good collections analytics measure movement, not just stock: **roll rates** (share of a bucket that worsens next cycle), **cure rates** (share that recovers), collection efficiency, and early-warning signals (bounce on first EMI is a famous fraud/quality flag). In LoanOS, delinquency computation and bucket status are ledger-derived — DPD is a function of the event history, so classification is reproducible and reportable (CRILC/SMA reporting feeds off it for applicable exposures)." }
      ],
      regulatory: [
        { id: "RBI-CIR-2025", note: "Delinquency and default status flow to the CICs in the UCRF cadence; SMA/CRILC reporting for applicable exposures." },
        { id: "RBI-DL-2025", note: "NPA-classification duty is retained by the RE even where a DLG covers losses (see module 8)." }
      ],
      platform: [
        { type: "capability", ref: "CLL-001", note: "DPD, overdue amount, bucket and delinquency status." },
        { type: "capability", ref: "CLL-014", note: "Collection analytics: roll rates, cure and liquidation." },
        { type: "capability", ref: "RPT-009", note: "CRILC/SMA and large-exposure reporting." },
        { type: "code", ref: "packages/core/src/compliance-controls.js", note: "Delinquency computation and asset classification on the LMS account model." }
      ],
      terms: ["DPD", "SMA", "NPA", "IRACP", "EMI"],
      related: ["m05-lms/loan-account-ledger", "m06-collections/collections-operations", "m09-compliance/cic-reporting"],
      check: [
        { q: "An account is 75 DPD. Its classification?", options: ["SMA-0", "SMA-1", "SMA-2", "NPA"], answer: 2, why: "61–90 days overdue is SMA-2 — the last stop before NPA at >90 days." },
        { q: "An NPA borrower pays enough to reach 45 DPD. Does the account upgrade to standard?", options: ["Yes — under 90 now", "Yes, after 30 clean days", "No — upgrade requires clearing ALL arrears of principal and interest", "Only with committee approval"], answer: 2, why: "IRACP upgrade rules demand full arrear clearance; partial catch-up leaves the account an NPA regardless of the DPD number." }
      ]
    },
    {
      id: "collections-operations",
      title: "Collections operations and the conduct rulebook",
      duration: "20 min",
      verified: "17 Jul 2026",
      objectives: [
        "Design a bucket-based collections strategy with treatments and channels",
        "State the conduct rules: contact hours, harassment prohibition, agent notice",
        "Explain PTP discipline and field/cash controls"
      ],
      sections: [
        { heading: "Strategy: right treatment, right account", body: "Collections is segmentation. Strategy assigns each account a **treatment plan** by product, bucket, risk and history: soft reminders (SMS/WhatsApp/email) in early buckets, telecalling with trained scripts as delinquency deepens, field visits and agency placement for hard buckets, legal review beyond that. The workhorse metric is the **PTP — promise to pay**: a dated commitment, tracked kept-or-broken, with broken promises escalating the treatment.\n\nVulnerable customers (hardship, illness, disaster) get differentiated handling — module 6's resolution lesson covers where hardship legitimately leads." },
        { heading: "The conduct rulebook is law, not etiquette", body: "India's collections conduct rules — Fair Practices Code, Digital Lending Directions, outsourcing directions — are explicit:\n\n- **Contact hours** — no calls or visits outside the permitted window (broadly 8:00–19:00 under conduct guidance); LoanOS encodes this as a contact-hours guard on reminder and notice logging.\n- **No harassment** — no abuse, intimidation, public shaming, contacting the borrower's contact list. The app-lending scandals that produced the 2021–22 crackdown were precisely these behaviours.\n- **Agent accountability** — recovery agents are registered, due-diligenced and trained; the **borrower is notified before an agent makes contact**, with the agent's identity; complaints against agents are tracked and can suspend them.\n- **RE liability** — every one of these failures by an outsourced agency lands on the RE (module 1's non-transferable accountability).\n\nFor a BA, each rule is a system control: a dialer that ignores contact hours, or an agent assignment without borrower notice, is a build defect with regulatory consequences." },
        { heading: "Field and cash: the leakiest pipe, plumbed", body: "Field collection handles the cash economy: visits with geo/time evidence, digital receipts issued on the spot, and the platform's rule that **cash collected posts to the account the same day** — the gap between collection and posting is where fraud lives. Cash exceptions require approval; agency settlements (fees, incentives) reconcile against evidenced collections.\n\nLoanOS ships an Android field-operations app for exactly this workflow — visits, receipts, evidence — feeding the same ledger and audit chain as every other channel." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Recovery conduct, agent-notice duty and borrower protection in digital lending." },
        { id: "RBI-OUTSOURCE", note: "Agency conduct is the RE's responsibility; due diligence and review are mandatory." }
      ],
      platform: [
        { type: "capability", ref: "CLL-004", note: "Reminder and notice logging with contact-hours guard." },
        { type: "capability", ref: "CLL-006", note: "Promise-to-pay, kept/broken PTP and follow-up." },
        { type: "capability", ref: "CLL-007", note: "Recovery-agent registry, due diligence and authorization." },
        { type: "capability", ref: "CLL-008", note: "Borrower notice before agent assignment/contact." },
        { type: "capability", ref: "CLL-011", note: "Cash exception approval and same-day account posting." },
        { type: "doc", ref: "docs/architecture/android-field-operations-app.md", note: "The field-ops Android app: visits, receipts, evidence." }
      ],
      terms: ["PTP", "FPC", "DPD"],
      related: ["m06-collections/delinquency-classification", "m06-collections/legal-recovery", "m07-lws/grievance-fraud-cases"],
      check: [
        { q: "A dialer campaign is configured to start at 7:00 am 'to catch borrowers before work'. What should block it?", options: ["Nothing — mornings are efficient", "The contact-hours guard: calls outside the permitted window violate conduct rules", "Telecom regulations only", "Borrower preferences only"], answer: 1, why: "Contact-hour limits are conduct law under FPC/DLD guidance; LoanOS encodes the window as a guard on outreach logging." },
        { q: "Before a recovery agent first contacts a borrower, what must exist?", options: ["A court order", "Borrower notification of the assignment and the agent's identity", "An NPA classification", "A settlement offer"], answer: 1, why: "Advance notice of agent assignment is a regulatory duty; LoanOS implements it as a blocking control (CLL-008)." }
      ]
    },
    {
      id: "legal-recovery",
      title: "Legal recovery: SARFAESI, Section 138 and the court tracks",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Choose the right legal track for a given default",
        "Walk the SARFAESI timeline from demand notice to sale",
        "Understand repossession, auction and shortfall handling"
      ],
      sections: [
        { heading: "The arsenal, mapped", body: "When collections fails, law begins. The tracks, roughly by loan type and size:\n\n- **SARFAESI** — secured loans with a registered security interest: enforce the collateral without a court decree.\n- **Section 138, NI Act** — criminal prosecution for dishonoured cheques/instruments; a pressure lever more than a recovery pipe.\n- **Lok Adalat** — statutory conciliation for smaller dues; fast, cheap, settlement-oriented.\n- **DRT** — Debts Recovery Tribunal for larger secured actions.\n- **Arbitration / civil suit** — contract-based recovery where other tracks don't fit.\n- **Insolvency (IBC)** — corporate borrowers, the heaviest machinery.\n\nTrack selection is a policy decision (cost, speed, security, amount), and cases carry limitation dates — miss one and the claim dies. LoanOS models legal recovery as cases with strategy, statutory clocks, hearings and expenses." },
        { heading: "SARFAESI: the 60-day drumbeat", body: "The canonical secured-recovery sequence:\n\n1. Account is NPA (SARFAESI applies to NPAs) with a CERSAI-registered security interest.\n2. **Section 13(2) demand notice** — repay within **60 days**.\n3. Borrower representation, if any, answered with reasons.\n4. **Possession** (symbolic, then physical, with magistrate assistance where needed), publication, valuation.\n5. **Auction** — reserve price, public notice, bids, sale, proceeds applied to dues.\n6. Surplus returns to the borrower; **shortfall** remains recoverable through other tracks.\n\nEvery step has form, timeline and evidence requirements — procedural defects hand the borrower a challenge. The platform's statutory-clock tracking exists because these deadlines are unforgiving in both directions." },
        { heading: "Repossession with rules", body: "Movable collateral (vehicles, equipment) adds repossession: authorized (never coercive — conduct rules from the previous lesson fully apply), inventoried at custody, yarded, and either released on cure or sold. Proceeds and expenses account to the loan precisely: valuation, auction costs, sale proceeds, shortfall. Settlement during legal action is common and legitimate — cases can conclude by negotiated payment and withdrawal, which is the next lesson's territory." }
      ],
      regulatory: [
        { id: "CERSAI-CKYC", note: "SARFAESI enforcement rides on the CERSAI-registered security interest." },
        { id: "RBI-DL-2025", note: "Recovery conduct rules apply during legal action too — enforcement is not a licence to harass." }
      ],
      platform: [
        { type: "capability", ref: "REC-002", note: "SARFAESI demand notice and statutory clock." },
        { type: "capability", ref: "REC-004", note: "Section 138 cheque-bounce notice and case." },
        { type: "capability", ref: "REC-008", note: "Auction reserve, bids, sale, proceeds and shortfall." },
        { type: "capability", ref: "REC-011", note: "Limitation dates, next hearing, SLA and escalation." }
      ],
      terms: ["SARFAESI", "Section 138", "Lok Adalat", "DRT", "NPA", "CERSAI"],
      related: ["m06-collections/collections-operations", "m06-collections/resolution-closure"],
      check: [
        { q: "How long does a borrower have after a SARFAESI 13(2) demand notice?", options: ["30 days", "45 days", "60 days", "90 days"], answer: 2, why: "The statutory demand notice gives 60 days to discharge the dues before enforcement proceeds." },
        { q: "Auction proceeds exceed the dues. The surplus…", options: ["Belongs to the lender", "Goes to a recovery-incentive pool", "Returns to the borrower", "Goes to CERSAI"], answer: 2, why: "Enforcement recovers dues, not more; surplus after dues and lawful expenses is the borrower's." }
      ]
    },
    {
      id: "resolution-closure",
      title: "Restructuring, settlement, write-off and closure",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Distinguish the four endings of a distressed loan and their triggers",
        "Explain restructuring's classification consequences",
        "Describe OTS governance and what 'technical write-off' really means"
      ],
      sections: [
        { heading: "Restructuring: changing the deal to save it", body: "For a borrower in genuine difficulty with genuine intent, **restructuring** modifies sanctioned terms — extended tenor, revised schedule, moratorium — after a documented hardship assessment. Approval is four-eyes, re-amortisation is versioned, and the borrower is communicated.\n\nThe honesty mechanism: restructuring has **classification consequences**. Restructured accounts are typically downgraded (or held in a lower classification with elevated provisioning) and must demonstrate sustained performance before upgrading. Rules differ by framework and era — the invariant a BA can rely on: restructuring is never a free reset of the delinquency clock, because hiding stress by rescheduling was the exact abuse the rules target. Bureau reporting also tags the account as restructured." },
        { heading: "Settlement: agreeing to less", body: "A **one-time settlement (OTS)** accepts less than full dues to close the exposure — rational when recovery costs exceed the recoverable. Governance is everything: a policy defines eligibility and minimum recovery; the **sacrifice** (amount forgone) determines the approval authority (an authority matrix — bigger sacrifice, higher approver); payment is tracked to completion; only then does the shortfall waiver execute and the account close *as settled*.\n\n'Settled' is not 'closed normally': the bureau record says so, and it constrains the borrower's future credit. A borrower agreeing to OTS should hear that clearly — conduct includes honesty about consequences." },
        { heading: "Write-off: cleaning the book, keeping the claim", body: "A **technical write-off** removes the exposure from the earning book (fully provided, charged off) **while retaining the legal right to recover**. It is an accounting act, not debt forgiveness — recovery efforts and legal cases continue, and post-write-off recoveries credit back per policy.\n\nEvery distressed path ends at the same gate as a healthy loan: **closure done right** — dues resolved (paid, settled or written off), NOC where due, mandates cancelled, security released and CERSAI satisfied for secured loans, and the CIC updated with the truthful final status. The final status *is* the borrower's financial epitaph for that loan; getting it wrong is a grievance and a correction-clock violation." }
      ],
      regulatory: [
        { id: "RBI-CIR-2025", note: "Restructured/settled/written-off statuses reach the CICs accurately; correction clocks protect the borrower." },
        { id: "RBI-DL-2025", note: "Conduct duties — including honest communication of consequences — persist through resolution." }
      ],
      platform: [
        { type: "capability", ref: "CLS-002", note: "Four-eyes restructure approval and re-amortisation." },
        { type: "capability", ref: "CLS-004", note: "OTS proposal, sacrifice, policy and authority matrix." },
        { type: "capability", ref: "CLS-006", note: "Technical write-off while retaining legal dues." },
        { type: "capability", ref: "CLS-008", note: "Closure on scheduled repayment, foreclosure or settlement." },
        { type: "capability", ref: "CLS-011", note: "CERSAI/registry satisfaction and closure evidence." }
      ],
      terms: ["Restructuring", "OTS", "Write-off", "NOC", "Moratorium", "CIC"],
      related: ["m06-collections/legal-recovery", "m05-lms/servicing", "m09-compliance/cic-reporting"],
      check: [
        { q: "Why does restructuring carry a classification consequence?", options: ["To punish borrowers", "To prevent rescheduling from being used to hide portfolio stress", "Accounting convenience", "It doesn't"], answer: 1, why: "Evergreening — rolling stress forward via reschedules — was the historic abuse; classification consequences make restructuring visible and costly enough to be honest." },
        { q: "After a technical write-off, the borrower's debt is…", options: ["Forgiven entirely", "Transferred to CERSAI", "Still legally recoverable — only the book treatment changed", "Converted to equity"], answer: 2, why: "Write-off is an accounting removal from the earning book; the legal claim and recovery efforts persist, and recoveries credit back." }
      ]
    }
  ]
};
