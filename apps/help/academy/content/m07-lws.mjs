// Module 7 — LWS: workflow and human control.
export default {
  id: "m07-lws",
  number: 7,
  title: "LWS — Workflow and human control",
  tagline: "The system that moves people: queues, approvals, complaints and cases — with every action attributed.",
  summary: "Between the automated planes sits the Loan Workflow System: derived task queues with SLA clocks, the maker-checker fabric that satisfies segregation-of-duties law, and the two workflows regulators read first — grievance redressal and fraud case handling.",
  lessons: [
    {
      id: "queues-sla",
      title: "Task queues, SLA clocks and attribution",
      duration: "15 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain derived queues — tasks computed from domain state, not created by hand",
        "Describe SLA clocks, priorities and breach handling",
        "State why every action carries actor attribution"
      ],
      sections: [
        { heading: "Queues that cannot lie", body: "LoanOS's LWS derives task queues **from domain state**: a KFS lacking acknowledgement evidence, a decision awaiting checker approval, an account crossing into an NPA-review threshold, a grievance nearing its clock — each condition *is* the task. Nobody creates or deletes these tasks by hand, so the queue cannot drift from reality: if the underlying state resolves, the task disappears; if not, it stays, visible and ageing.\n\nQueues exist for compliance exceptions, KFS evidence, credit decisions, AI human review, checker approvals, disbursement, collections, NPA review, grievance resolution and RBI CMS escalation — a direct map of the control points this course has covered." },
        { heading: "Clocks with consequences", body: "Every task carries **SLA metadata**: priority, due time, breach status. Some clocks are internal service standards; others are statutory — the grievance 30-day clock, CIC correction windows, incident-notification hours. Statutory clocks escalate rather than merely embarrass: an approaching breach raises priority and routes to the escalation owner.\n\nRole and queue visibility are enforced server-side: an actor sees and acts only within staffed roles, and assignment, start, release and comments are audited. The Guide's operating articles cover the day-to-day mechanics; what a BA specifies is which state creates a task, who may act, and what clock governs it." },
        { heading: "Attribution is the whole point", body: "Workflow exists so that months later, one question is always answerable: **who did what, in which role, on whose authority, and when**. Every action records its principal, session and correlation lineage — humans via login/SSO, agents via their scoped identities. 'The system did it' is never an acceptable audit answer; LWS makes sure it never has to be." }
      ],
      regulatory: [
        { id: "RBI-IAM-SOD", note: "Need-based access, activity accountability and independent control functions." },
        { id: "RBI-IT-GRC", note: "Audit trails and operational controls over processing." }
      ],
      platform: [
        { type: "capability", ref: "LWS-001", note: "Derived queues by domain state and exception." },
        { type: "capability", ref: "LWS-002", note: "Task SLA, priority, due time and breach status." },
        { type: "capability", ref: "LWS-004", note: "Assignment, start, release, comment and audit." },
        { type: "surface", ref: "/t/{tenantId}/staff/workspaces", note: "Canonical tenant-scoped staff workspace where queues and task controls surface." }
      ],
      terms: ["LWS", "SMA", "RBI CMS"],
      related: ["m07-lws/maker-checker", "m01-landscape/regulation-as-controls"],
      check: [
        { q: "Why are LWS tasks derived from domain state instead of created manually?", options: ["Saves clicks", "The queue then provably mirrors reality — no forgotten or fabricated tasks", "Performance", "Managers prefer it"], answer: 1, why: "A derived queue cannot omit a pending control or carry a stale one; the task list is a view of the truth, not a parallel record." }
      ]
    },
    {
      id: "maker-checker",
      title: "Maker-checker, exceptions and committees",
      duration: "16 min",
      verified: "17 Jul 2026",
      objectives: [
        "Explain segregation of duties as implemented, not aspirational",
        "Describe approval matrices and exception taxonomies",
        "Understand committee workflows and their evidence packs"
      ],
      sections: [
        { heading: "Four eyes, enforced by the platform", body: "**Maker-checker** is the rule that whoever prepares an action cannot approve it. It appears at every material gate this course has visited: policy versions, credit approvals, deviations, disbursement, restructures, fraud classification, DLG invocation. LoanOS enforces independence structurally — the checker must be a different authenticated human, staffing policies prevent one person from holding conflicting roles, and mutation authority is deny-by-default.\n\nThe regulatory root is the RBI's IT and governance directions: segregation of duties, need-based access, elimination of role conflicts, independent control functions. When a tenant asks 'can our ops head also approve their own disbursements?', the platform's answer — and the regulator's — is no." },
        { heading: "Approval matrices and exceptions", body: "Authority scales with materiality: **approval matrices** route by amount, product, risk grade and deviation depth — a ₹50,000 personal loan and a ₹5 crore LAP deviation see different approvers. Exceptions (documents waived, conditions overridden, policy departures) carry a **taxonomy**: typed, reasoned, evidenced and reportable, so 'exception' never becomes a euphemism for 'unrecorded decision'. Root-cause reporting over exception patterns is how risk teams find broken processes before auditors do." },
        { heading: "Committees: governance with minutes", body: "Some decisions belong to no individual: credit committees beyond thresholds, fraud classification committees, board risk committees. LWS models them as workflows — agenda, circulated pack, decision, minutes, conditions — with the pack assembled from platform evidence rather than screenshots. For a BA, a committee is a decision gate with multiple accountable humans and a documented output; treat its pack as a first-class deliverable." }
      ],
      regulatory: [
        { id: "RBI-IAM-SOD", note: "Segregation of duties, role-conflict management, independent control functions — the maker-checker mandate." },
        { id: "RBI-FRAUD-2024", note: "Committee oversight in fraud classification." }
      ],
      platform: [
        { type: "capability", ref: "LWS-006", note: "Configurable approval matrix by amount, product, risk and deviation." },
        { type: "capability", ref: "LWS-007", note: "Maker-checker/four-eyes policy library." },
        { type: "capability", ref: "LWS-012", note: "Committee agenda, circulation, decision, minutes and conditions." },
        { type: "doc", ref: "docs/architecture/tenant-role-staffing-and-feature-gating.md", note: "Canonical roles, staffing policies and separation rules." }
      ],
      terms: ["Maker-checker", "DLG"],
      related: ["m03-underwriting/referrals-overrides", "m07-lws/queues-sla"],
      check: [
        { q: "A small tenant wants one power-user who makes and approves everything 'until we scale'. The platform's position?", options: ["Fine with a waiver", "Fine below ₹1 lakh", "No — independence at control gates is enforced by staffing policy, not goodwill", "Fine if logged"], answer: 2, why: "Segregation of duties is a regulatory control; LoanOS staffing policies structurally prevent self-approval at material gates." }
      ]
    },
    {
      id: "grievance-fraud-cases",
      title: "Grievance redressal and fraud case workflow",
      duration: "18 min",
      verified: "17 Jul 2026",
      objectives: [
        "Walk the complaint lifecycle and its 30-day statutory clock",
        "Explain RBI CMS/Ombudsman escalation",
        "Contrast grievance handling with the fraud case's natural-justice track"
      ],
      sections: [
        { heading: "The complaint is a regulated object", body: "A borrower complaint follows a statutory arc:\n\n1. **Intake** through any channel — portal, branch, phone, email, LSP, post — with immediate **acknowledgement and reference number**.\n2. **Categorisation and assignment** to the grievance owner; investigation with the case's evidence.\n3. **Resolution within 30 days** — the RBI clock. The grievance officer (whose name the borrower saw on the KFS and the DLA disclosure) is accountable.\n4. If unresolved or rejected and the borrower remains dissatisfied, escalation to the **RBI Ombudsman via CMS** — where the RE's file, or its absence, speaks for it.\n\nLoanOS runs this as an LWS queue with the 30-day clock, overdue escalation and CMS evidence. Complaints against LSPs, DLAs and recovery agents attribute conduct to the responsible channel — feeding module 8's partner governance." },
        { heading: "Complaints are telemetry", body: "Beyond the individual case: root-cause analysis, corrective action, restitution where the RE erred — and **complaint analytics** by product, channel and issue type reported to the board. A spike of charge-related complaints on one product is a disclosure defect; a cluster on one agency is a conduct problem. Regulators read complaint patterns as a proxy for management quality, and so should a BA reading a portfolio." },
        { heading: "Fraud cases: the other courtroom", body: "The fraud workflow (met in module 2) shares machinery — queue, evidence, committee — but differs in posture: the subject is *suspected*, so **natural justice** governs: show-cause, response window, four-eyes classification, and only then reporting (FMR, LEA referral). Grievance protects the borrower's voice; the fraud track protects their right to be heard before a life-altering label. A BA must never let the two blur: a complaint is not an accusation, and an investigation is not a verdict." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "Grievance officer disclosure, 30-day resolution and CMS escalation path." },
        { id: "RBI-FRAUD-2024", note: "Natural justice, committee classification and reporting for fraud cases." }
      ],
      platform: [
        { type: "capability", ref: "GRV-002", note: "Immediate acknowledgement and reference." },
        { type: "capability", ref: "GRV-004", note: "30-day clock and overdue escalation." },
        { type: "capability", ref: "GRV-006", note: "RBI CMS link, submission, acknowledgement and order tracking." },
        { type: "capability", ref: "FRD-008", note: "Natural-justice show-cause and response workflow." },
        { type: "code", ref: "packages/core/src/compliance/compliance-controls.js", note: "Complaint registry with grievance-officer workflow and RBI clock." }
      ],
      terms: ["Grievance officer", "RBI CMS", "LSP"],
      related: ["m02-onboarding/fraud-screening", "m06-collections/collections-operations", "m08-partners/lsp-dla-governance"],
      check: [
        { q: "Day 28 of a complaint, unresolved, borrower furious. What does the platform do?", options: ["Auto-close as disputed", "Nothing until day 30", "The clock has already escalated it — overdue risk routes to the escalation owner before breach", "Extend the clock"], answer: 2, why: "The 30-day clock drives proactive escalation; breach of a statutory clock is a reportable failure, not a surprise." },
        { q: "What must happen before an account is formally classified as fraud?", options: ["Police complaint", "Show-cause and an opportunity to respond, then four-eyes/committee classification", "90 DPD", "Write-off"], answer: 1, why: "Natural justice is procedurally mandatory; classification without hearing the person is invalid." }
      ]
    }
  ]
};
