// Module 5 — LMS: the live loan account.
export default {
  id: "m05-lms",
  number: 5,
  title: "LMS — The live loan account",
  tagline: "The loan after the confetti: ledgers that never lie, schedules that must add up, and money that must reconcile.",
  summary: "Once funds move, the loan lives in the LMS for years. This module teaches the account itself — ledger and balance reconstruction, amortisation and interest math, the payment rails and their reconciliation, and the servicing events (statements, rate resets, prepayment, foreclosure) that define the borrower's experience.",
  lessons: [
    {
      id: "loan-account-ledger",
      title: "The loan account and its ledger",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain the loan account as an event-sourced ledger",
        "Describe the payment-allocation waterfall and why its order matters",
        "Understand accounting integration: subledger, GL, interest states"
      ],
      sections: [
        { heading: "An account is its history", body: "A LoanOS loan account opens automatically on approved disbursement and lives as an **immutable operational ledger**: disbursement, accruals, charges, payments, reversals — every financial event appended, never edited. The outstanding balance is not a stored number that might drift; it is **reconstructed** from the event history. If balance and history ever disagree, the history wins and the discrepancy is an incident.\n\nCorrections follow the same discipline: a wrong posting is reversed and re-posted with value-date control — visible, attributed, never silently amended. Financial-event ingestion is idempotent, so a retried payment webhook cannot double-credit an account." },
        { heading: "The waterfall: where a payment goes", body: "A borrower pays ₹10,000 against dues of penal charges ₹500, fees ₹300, interest ₹4,200 and principal. Which bucket absorbs the money first? The **payment-allocation waterfall** answers by policy — a typical order: charges → fees → interest → principal, with the sequence disclosed and configured per product.\n\nThe order is economically loaded: allocate to principal first and interest accrues on less; charges-first protects the lender's fee income. Regulators care because opaque allocation is a classic borrower harm. For a BA: the waterfall is product policy, it must match disclosure, and partial payments, advance payments, excess and unidentified receipts all need defined treatments (suspense accounts, refund paths) — not improvisation." },
        { heading: "From events to books", body: "Operational events become accounting: a **double-entry subledger** with balanced journals, chart-of-accounts mapping, GL export, day-end/period-close controls. Interest lives in states — accrued (earned, not yet due), overdue (due, unpaid), **suspended** (NPA accounts: recognition reversed and held in memorandum, module 6 explains why). Trial balance and reconciliation by event, day, provider and GL close the loop between what operations did and what finance reports." }
      ],
      regulatory: [
        { id: "RBI-IT-GRC", note: "Audit trails, STP controls and reconciliation discipline for financial systems." },
        { id: "RBI-FPC-PENAL", note: "Charge treatment on the ledger must match disclosed, non-capitalising penal-charge rules." }
      ],
      platform: [
        { type: "capability", ref: "ACC-002", note: "Immutable operational ledger and balance reconstruction." },
        { type: "capability", ref: "ACC-004", note: "Configurable payment-allocation waterfall." },
        { type: "capability", ref: "ACC-005", note: "Double-entry subledger and balanced journals." },
        { type: "doc", ref: "docs/product/what-we-are-building.md", note: "LMS plane definition: ledger events, balance reconstruction, accrual, charges." }
      ],
      terms: ["LMS", "Penal charges", "NPA"],
      related: ["m05-lms/schedules-interest", "m06-collections/delinquency-classification"],
      check: [
        { q: "A support engineer proposes fixing a wrong charge by updating the ledger row. Why is this refused?", options: ["Database permissions", "The ledger is append-only: corrections are reversals plus re-postings, attributed and visible", "It would be slow", "Charges cannot be wrong"], answer: 1, why: "Balance reconstruction and audit integrity depend on an append-only history; silent edits destroy both." },
        { q: "Why is the payment-allocation order a compliance topic and not just an accounting choice?", options: ["It isn't", "Allocation decides how fast principal falls and what the borrower effectively pays — it must match disclosed policy", "GST depends on it", "Only NPAs care"], answer: 1, why: "Opaque or lender-slanted allocation inflates borrower cost invisibly; the waterfall must be policy-defined and disclosed." }
      ]
    },
    {
      id: "schedules-interest",
      title: "Repayment schedules, EMI and interest math",
      duration: "20 min",
      verified: "17 Jul 2026",
      objectives: [
        "Compute and read a reducing-balance EMI schedule",
        "Distinguish flat vs reducing rates and spot the disclosure trap",
        "Explain floating-rate resets and the borrower's options"
      ],
      sections: [
        { heading: "EMI and the reducing balance", body: "The standard retail structure is the **EMI on a monthly reducing balance**: a constant instalment where each month's interest is computed on the outstanding principal, and the remainder of the instalment reduces principal. Early instalments are interest-heavy; late ones principal-heavy — that is why prepaying early in the tenor saves so much.\n\nThe schedule in the KFS is this amortisation table. Real life complicates it: **broken-period interest** when disbursement doesn't align with the cycle, holiday-calendar due-date movement, **moratorium/pre-EMI** phases where interest accrues before EMIs start (and may capitalise per policy — disclosed, always). A BA validating a schedule checks: instalments sum to principal plus computed interest, rounding follows the platform's exact-decimal rules, and the KFS table matches the system's table to the paisa." },
        { heading: "The flat-rate trap", body: "A **flat rate** computes interest on the *original* principal for the whole tenor — so 'flat 10%' on a 3-year loan costs roughly the same as a reducing rate near 18%. Quoting flat rates without the reducing-balance equivalent is a classic mis-selling pattern; the KFS's APR kills the ambiguity by expressing the true annualised cost on actual cash flows. Products priced flat (some vehicle/MFI segments) must disclose the effective-rate equivalence.\n\nOther structures a BA will meet: bullet (principal at maturity), balloon (large final instalment), step-up/step-down (instalments track expected income), seasonal (agri cash flows), daily-reducing overdraft/cash-credit lines with utilisation-based interest and minimum-due cycles." },
        { heading: "Floating rates: the reset ritual", body: "Floating-rate loans price as **benchmark + spread** and reprice on reset dates. RBI's rules for EMI-based floating loans protect the borrower at each reset: communicate the change and offer options — switch to fixed (per board policy), change EMI, change tenor, or prepay in part/full — with the choice recorded and the schedule reversioned.\n\nLoanOS implements borrower choice on reset and **schedule versioning**: every regeneration (reset, restructure, prepayment) creates a new schedule version with communication evidence. The audit question is always answerable: which schedule governed this account on this date, and did the borrower know?" }
      ],
      regulatory: [
        { id: "RBI-KFS-2024", note: "APR and the amortisation schedule are mandatory KFS content — the anti-flat-rate disclosure." },
        { id: "RBI-DL-2025", note: "Floating-rate reset FAQ/rules: communication and borrower options at reset (see register source list)." }
      ],
      platform: [
        { type: "capability", ref: "LMS-001", note: "Monthly reducing-balance amortisation." },
        { type: "capability", ref: "LMS-011", note: "Floating benchmark, spread, reset date and rate history." },
        { type: "capability", ref: "LMS-012", note: "Borrower choice on floating-rate reset." },
        { type: "capability", ref: "LMS-015", note: "Schedule versioning and borrower communication after change." }
      ],
      terms: ["EMI", "Amortisation", "APR", "Moratorium", "KFS"],
      related: ["m04-kfs-sanction/kfs", "m05-lms/servicing"],
      check: [
        { q: "Two offers: 'flat 10%' and 'reducing 15%', same amount and tenor. Which likely costs less?", options: ["Flat 10% — smaller number", "Reducing 15% — flat 10% ≈ reducing ~18%", "Identical", "Cannot be compared"], answer: 1, why: "Flat rates charge interest on the original principal throughout; the reducing-balance equivalent is roughly 1.8x the flat number. APR exists to expose exactly this." },
        { q: "A floating benchmark rises 50bps at reset. What must the borrower receive?", options: ["Nothing — floating means floating", "A notice, plus options: fixed switch per policy, EMI change, tenor change, or prepayment", "A new KFS only", "A penalty waiver"], answer: 1, why: "Reset communication and borrower options are mandated; the chosen option produces a new, communicated schedule version." }
      ]
    },
    {
      id: "payments-mandates",
      title: "Payments, mandates and reconciliation",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Describe the collection rails: NACH, UPI AutoPay, and their mandate lifecycles",
        "Walk the bounce-and-retry flow with its charges and notices",
        "Explain three-way reconciliation and the break queue"
      ],
      sections: [
        { heading: "The rails that pull EMIs", body: "Repayment at scale is mandate-based: **NACH** (the bank-account auto-debit rail — mandate registered, amended, suspended or cancelled with the bank) and **UPI AutoPay** (UPI-based recurring debit), plus standing instructions and plain transfers. The mandate has its own lifecycle a BA must model: setup with borrower authentication, amendment on EMI change, suspension during disputes, cancellation at closure.\n\nRemember the fund-flow rule from module 4: repayments flow **directly** from borrower to RE — collection into LSP wallets is prohibited, with narrow permitted exceptions. Cash collection in the field exists (module 6) under same-day posting and receipt controls." },
        { heading: "When the debit bounces", body: "A mandate presentation can return unpaid — insufficient funds, closed account, mandate cancelled. The return arrives with a **reason code** that drives everything after it:\n\n1. Post the bounce with its reason; the instalment is now overdue and DPD starts counting.\n2. Levy the bounce charge **only if the KFS disclosed it** — and as a charge, never capitalising penal interest.\n3. Notify the borrower and schedule the retry per policy.\n4. Repeated technical failures (mandate defects) route to a repair workflow, not to the borrower's conduct record.\n\nSection 138 (cheque dishonour) becomes relevant when instrument-based repayment bounces — a recovery lever module 6 covers." },
        { heading: "Reconciliation: trust, then verify", body: "Every day, three views must agree: what the provider says happened, what the bank statement shows, what the ledger posted. **Three-way reconciliation** matches them; mismatches enter a **break queue** with ageing, investigation, approval and (rarely) write-off. Unidentified receipts sit in suspense until owned. Duplicate protection is structural — idempotent ingestion means a replayed settlement file cannot double-post.\n\nA BA designing any payment feature must answer: how does this reconcile, what breaks can it create, and who clears them?" }
      ],
      regulatory: [
        { id: "RBI-FUND-FLOW", note: "Repayments flow directly to the RE; no LSP-controlled collection accounts." },
        { id: "RBI-PAY-DATA", note: "Payment-system data stays in India; masking/tokenisation for stored artefacts." },
        { id: "RBI-FPC-PENAL", note: "Bounce charges are disclosed charges, never capitalised penal interest." }
      ],
      platform: [
        { type: "capability", ref: "PAY-001", note: "NACH mandate setup, amendment, suspension and cancellation." },
        { type: "capability", ref: "PAY-005", note: "Bounce/return reason, charge, retry and borrower notice." },
        { type: "capability", ref: "PAY-013", note: "Daily provider-to-bank-to-ledger reconciliation." },
        { type: "capability", ref: "PAY-011", note: "Duplicate-payment protection and idempotency." }
      ],
      terms: ["NACH", "UPI AutoPay", "DPD", "Section 138"],
      related: ["m04-kfs-sanction/disbursement-fund-flow", "m06-collections/delinquency-classification"],
      check: [
        { q: "A settlement file is accidentally ingested twice. What protects the borrower's account?", options: ["Manual review catches it monthly", "Idempotent ingestion — the duplicate posting is rejected structurally", "The bank refunds", "Nothing; reversals are raised later"], answer: 1, why: "Financial-event ingestion is idempotent by design; duplicate protection is a ledger property, not an ops process." },
        { q: "An EMI bounces with 'insufficient funds'. Which action is NOT allowed?", options: ["Posting the overdue and starting DPD", "Levying the KFS-disclosed bounce charge", "Adding the charge to principal so interest accrues on it", "Notifying the borrower and retrying per policy"], answer: 2, why: "Capitalising charges is prohibited — penal/bounce charges are flat charges, never added to the interest-bearing principal." }
      ]
    },
    {
      id: "servicing",
      title: "Servicing: statements, changes, prepayment and foreclosure",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "List the standard servicing events and their evidence",
        "Explain part-prepayment options and foreclosure quotes",
        "Describe closure done right: NOC, releases, registry and bureau updates"
      ],
      sections: [
        { heading: "The quiet majority of the lifecycle", body: "Most of a loan's life is servicing: statements (periodic and on-demand), interest certificates for tax season, profile changes (address, contact, bank account — each verified, some maker-checked), due-date changes, hardship requests, and the rate-reset ritual from the schedules lesson. Every borrower-facing communication leaves delivery evidence, in the borrower's preferred language where configured.\n\nLoanOS's borrower portal surfaces the account view — balance, next due, schedule, documents, grievance — so servicing requests originate from an authenticated, attributable channel." },
        { heading: "Paying early: prepayment and foreclosure", body: "**Part-prepayment** reduces principal mid-tenor, and the borrower chooses the effect: lower EMI (same tenor) or shorter tenor (same EMI) — the latter usually saves more interest. The system re-amortises and issues a new schedule version with communication.\n\n**Foreclosure** closes the loan early: the borrower requests a **foreclosure quote** — outstanding principal + accrued interest to the payoff date + permitted charges — valid for a stated window. Charge rules are borrower-protective: RBI prohibits foreclosure charges on floating-rate loans to individuals for non-business purposes, and every charge must trace to the KFS. Payoff, closure and the paper trail follow." },
        { heading: "Closure is a checklist, not an event", body: "A loan ends properly only when:\n\n1. Dues are zero (scheduled completion, foreclosure or settlement).\n2. The **NOC / no-dues certificate** is issued.\n3. Mandates are cancelled.\n4. For secured loans: original documents returned within the required timeline and the **CERSAI** security-interest satisfaction is filed (registry timelines apply; delays carry compensation duties and grievance exposure).\n5. The **CIC closure update** goes out so the borrower's bureau file shows the loan closed.\n\nSkipping step 4 or 5 is the classic post-closure harm: a borrower who repaid in full but whose bureau report still shows the loan open, or whose property papers are lost in a branch. Both are grievance magnets with regulatory teeth." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Servicing conduct, communication evidence and borrower protections." },
        { id: "RBI-CIR-2025", note: "Closure must reach the CICs promptly; correction clocks and compensation protect the borrower." },
        { id: "CERSAI-CKYC", note: "Security-interest satisfaction at closure for secured loans." }
      ],
      platform: [
        { type: "capability", ref: "SRV-002", note: "Periodic and on-demand statements." },
        { type: "capability", ref: "LMS-013", note: "Part-prepayment with EMI/tenure choice." },
        { type: "capability", ref: "LMS-014", note: "Foreclosure quote, charge policy, payoff and closure." },
        { type: "capability", ref: "CLS-009", note: "NOC / no-dues certificate." },
        { type: "capability", ref: "CLS-012", note: "CIC closure update and borrower confirmation." },
        { type: "surface", ref: "/t/{tenantId}/portal/", note: "Borrower portal (tenant-scoped): schedule, statements, documents, grievance." }
      ],
      terms: ["Foreclosure", "NOC", "CIC", "CERSAI", "KFS"],
      related: ["m05-lms/schedules-interest", "m06-collections/resolution-closure", "m09-compliance/cic-reporting"],
      check: [
        { q: "A borrower part-prepays ₹2 lakh and wants maximum interest savings. Which option?", options: ["Reduce EMI, keep tenor", "Reduce tenor, keep EMI", "Split half and half", "Hold as advance EMI"], answer: 1, why: "Keeping the EMI constant against a lower principal shortens the tenor and cuts total interest more than lowering the instalment." },
        { q: "A repaid borrower's bureau report still shows the loan open after months. Which duty failed?", options: ["KYC refresh", "The CIC closure update", "Mandate cancellation", "NOC printing"], answer: 1, why: "Closure must flow to the CICs; a stale open status is exactly the harm the correction clocks and compensation rules target." }
      ]
    }
  ]
};
