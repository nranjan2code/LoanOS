# Campaign Briefs

Reusable brief template + three ready-to-run campaigns. A brief is not approved
until the claims-sync check passes and a human confirms claim status.

## Brief template

```
Campaign name:
Owner:                     Dates:
Objective (one metric):
Segment / target accounts:
Persona & lead pillar:
Core message (one line):
Proof points (claim IDs — Built only for live assertions):
Offer / CTA:
Channels & sequence:
Assets required:
Success metric & target:
Claims-sync check: PASS/FAIL (date)   Human claim review: name/date
```

## Campaign 1 — "Audit is an export, not a fire drill"

- **Objective:** book exec briefings with CCOs at Tier-1/2 accounts.
- **Segment/persona:** all RE types; CCO + Internal Audit; **Pillar 1**.
- **Core message:** Stop reconstructing compliance after the fact — export a
  tamper-evident evidence pack in minutes.
- **Proof:** C-05, C-06, C-17, C-32.
- **Offer/CTA:** 20-minute evidence-pack demo (sandbox, synthetic data).
- **Channels:** founder LinkedIn POV → pillar blog → ABM email Sequence A →
  CCO roundtable invite.
- **Assets:** pillar blog, one-pager, demo clip (Beat 6), roundtable landing page.
- **Success:** exec briefings booked with target CCOs.

## Campaign 2 — "The kill switch that's actually wired in"

- **Objective:** engage CRO/Credit + Model Risk on RBI model-risk readiness.
- **Segment/persona:** REs using scorecards/GenAI in credit; CRO/Head of Credit;
  **Pillar 3**.
- **Core message:** Model governance in the runtime decision path — drift trips it,
  and clearing it needs a post-incident review.
- **Proof:** C-09, C-10, C-11, C-12, C-13.
- **Offer/CTA:** webinar "Model-risk readiness: enforce, don't document" + sandbox
  kill-switch demo.
- **Channels:** webinar → email Sequence B → LinkedIn hooks → follow-up clip
  (Beat 5).
- **Success:** qualified Credit/Risk opportunities into Stage 2.

## Campaign 3 — "Exit is a feature" (procurement de-risk)

- **Objective:** neutralise lock-in / vendor-risk objections mid-cycle; accelerate
  security & procurement.
- **Segment/persona:** CTO/InfoSec + Procurement; **Foundation**.
- **Core message:** Provable isolation, India-hosted, and a re-loadable exit
  export — leave whenever you want.
- **Proof:** C-07, C-08, C-32, C-33, C-29/30/31.
- **Offer/CTA:** vendor-posture pack + a walkthrough of the portability export
  format.
- **Channels:** targeted 1:1 to in-cycle accounts; enablement for AEs to deploy
  when the objection appears.
- **Success:** security-review pass-rate; reduced procurement stall time.

## Regulatory-moment campaign (template, reactive)

- **Trigger:** a new RBI direction/draft/finding.
- **Objective:** own the "what it means for enforcement" narrative within 48h.
- **Assets:** explainer post + blog + sales trigger email.
- **Guardrail:** re-run claims-sync on any wording the change touches before
  publishing.

## Shared guardrail

Every campaign asset asserts only `Built` claims as present capability. `Partial`
→ "first slice / governed boundary." `Roadmap` → "on our roadmap." Run
`node docs/gtm/automation/gtm-backlog-sync.mjs` before launch.
