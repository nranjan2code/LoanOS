// Module 10 — Capstone.
export default {
  id: "m10-capstone",
  number: 10,
  title: "Capstone",
  tagline: "Prove it to yourself: one loan, end to end, and the map you keep afterwards.",
  summary: "The course ends where the platform begins: trace one synthetic loan through every gate you have learned, in the sandbox, and leave with the reference map a working BA actually uses — which document answers which question, and how to keep your knowledge verified.",
  lessons: [
    {
      id: "trace-a-loan",
      title: "Capstone: trace one compliant loan end to end",
      duration: "45 min",
      verified: "17 Jul 2026",
      objectives: [
        "Run a synthetic application through consent, KYC, decision, KFS, sanction and disbursement",
        "Name the control and the evidence at each gate as you pass it",
        "Follow the account into servicing, delinquency and closure paths"
      ],
      sections: [
        { heading: "The exercise", body: "Everything in this course converges on one traceable journey. In the sandbox (synthetic borrowers only — that boundary is itself a control), run the Guide's *first compliant loan* exercise and narrate each step in this course's terms:\n\n1. **Consent** — purpose-bound entries appear in the consent ledger (module 2).\n2. **KYC** — the record reaches a verified state with evidence; Aadhaar artefacts conspicuously absent (module 2).\n3. **Decision** — verified facts meet a versioned policy in the engine; note the reason codes and lineage (module 3). Resolve one referral through the workflow, not around it.\n4. **KFS** — generate, deliver, accept; try to levy an undisclosed charge and watch it fail (module 4).\n5. **Sanction and packet** — conditions, validity, eSign evidence, vault receipt (module 4).\n6. **Disbursement** — the readiness checklist goes green; maker-checker authorises; the account opens (modules 4–5).\n7. **Servicing** — schedule, statement, a simulated payment posting through the waterfall (module 5).\n8. **The stress path** — simulate a missed instalment: DPD starts, the account enters a bucket, a collections task derives (module 6, module 7).\n9. **Evidence** — export the scoped evidence pack and verify chain integrity (module 9)." },
        { heading: "What you should be able to say afterwards", body: "The exit bar for this course is a narrative test. For any step, you can answer: **which regulation demands this** (register family ID), **which control implements it** (capability ID or module), **what evidence it left** (audit event, document, ledger entry), and **what would have happened on failure** (the fail-closed path). If any answer is fuzzy, the relevant module lesson is one click away.\n\nRemember the boundary the Guide states plainly: completing the sandbox exercise is onboarding evidence — it does not, by itself, make anything production-ready." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "The journey you trace is the directions' conduct model made executable." },
        { id: "RBI-KFS-2024", note: "The KFS gate you exercise mid-journey." }
      ],
      platform: [
        { type: "guide", ref: "first-compliant-loan", note: "The Guide's guided exercise this capstone wraps." },
        { type: "guide", ref: "evidence-pack", note: "Export and verify the evidence pack at the end." },
        { type: "surface", ref: "/dashboard/", note: "Staff workspace where the journey's tasks surface." },
        { type: "doc", ref: "docs/operations/demo-handbook.md", note: "Showcase operating model — the same journey, presented." }
      ],
      terms: ["Sandbox", "KFS", "DPD", "Evidence pack", "Maker-checker"],
      related: ["m01-landscape/regulation-as-controls", "m09-compliance/audit-evidence"],
      check: [
        { q: "Why must the capstone use synthetic borrowers?", options: ["Real data is slow", "The sandbox enforces synthetic-only borrowers — using production personal data in training is itself a data-protection violation", "Licensing costs", "No reason; it's convention"], answer: 1, why: "Training and evaluation happen in the sandbox boundary precisely so personal data never leaks into learning exercises." },
        { q: "Completing the capstone proves…", options: ["The tenant is production-ready", "You can trace and explain the governed journey — an onboarding outcome, not a production attestation", "The policies are correct", "Nothing"], answer: 1, why: "The maturity language is deliberate: sandbox completion is learning evidence; production readiness has its own, separate gates." }
      ]
    },
    {
      id: "ba-toolkit",
      title: "The BA toolkit: where every answer lives",
      duration: "12 min",
      verified: "17 Jul 2026",
      objectives: [
        "Use the repository's documents as a reference system, not a reading list",
        "Route any new question to its owning source",
        "Keep your knowledge — and this course — verified over time"
      ],
      sections: [
        { heading: "The routing table", body: "A working BA doesn't memorise; they route. The map:\n\n- **\"Is this regulated? By what?\"** → `docs/compliance/india-regulatory-register.md` — control families, sources, implementation anchors.\n- **\"Does the platform do this? How completely?\"** → `docs/product/complete-system-capability-catalog.md` (status per capability) and `docs/product/product-journey-support-matrix.md` (evidence tier per journey).\n- **\"What are we building, and what's out of scope?\"** → `docs/product/what-we-are-building.md`.\n- **\"How does this subsystem work?\"** → `docs/architecture/` — origination journey, decision engine design, data governance, digital workers, tenancy.\n- **\"Why was it decided this way?\"** → `docs/decisions/` ADRs.\n- **\"What does this term mean, exactly?\"** → the course glossary and `docs/gtm/glossary.md`.\n- **\"How do I operate it?\"** → the Guide's task articles at `/help/`.\n\nWhen sources disagree, escalate the discrepancy — the register and design docs win over lessons and marketing, and a disagreement is a documentation bug someone must fix." },
        { heading: "Staying current", body: "Regulation moves: directions get amended, drafts finalise, commencement dates arrive (the DPDP Rules' phased schedule is a live example). The platform's answer is verification discipline — the register carries a research baseline date, guides and lessons carry verification dates, and a user-visible change is incomplete until its guidance is updated. Treat a stale verification date the way an engineer treats a failing test.\n\nThis course follows the same rule. Each lesson shows when it was last verified; if you find drift between a lesson and the register, catalogue or code — the lesson is wrong until proven otherwise. Fix flows through the curriculum source (`apps/help/academy/content/`), a rebuild, and review. You are now part of the maintenance loop: welcome to governed lending." }
      ],
      regulatory: [
        { id: "RBI-DL-2025", note: "The regulatory landscape this toolkit keeps you current against." },
        { id: "DPDP-RULES-2025", note: "A live example of phased commencement that demands date-tracking, not assumption." }
      ],
      platform: [
        { type: "doc", ref: "docs/README.md", note: "The documentation map and definition of done." },
        { type: "doc", ref: "docs/product/ba-lending-academy-curriculum.md", note: "This course's own design, contract and governance." },
        { type: "guide", ref: "activate-tenant", note: "Where operating knowledge begins when you join a real implementation." },
        { type: "surface", ref: "/help/", note: "The Guide & Academy — search, roles, learning paths." }
      ],
      terms: ["RBI", "DPDP", "KFS"],
      related: ["m01-landscape/regulatory-map", "m10-capstone/trace-a-loan"],
      check: [
        { q: "A stakeholder asks whether a capability is production-ready. Your first stop?", options: ["This course", "The capability catalogue's status column and the journey support matrix", "The sales deck", "Engineering chat"], answer: 1, why: "Maturity truth lives in the catalogue and support matrix; everything else — including this course — defers to them." },
        { q: "You find a lesson contradicting the regulatory register. What is true?", options: ["The lesson — it's newer", "The register — and the lesson must be corrected through the curriculum source and rebuilt", "Whichever reads better", "Neither"], answer: 1, why: "The register is the maintained source of regulatory truth; course content is downstream and carries a fix-forward duty." }
      ]
    }
  ]
};
