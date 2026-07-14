# Objection Handling

Format: **Objection → Reframe → Proof → Advance.** Proof cites a `Built` claim
where possible (`../strategy/claims-and-backlog-sync.md`). Never answer an
objection by overclaiming — honesty is the moat with compliance buyers.

## "We already have an LOS / LMS."
- **Reframe:** "Most do. The gap isn't originating or servicing — it's proving,
  end to end, *why* a loan was approved and that every disclosure and model
  decision was compliant. That evidence dies at the handoffs between separate
  systems."
- **Proof:** one hash-chained audit spine + exportable evidence pack (C-05/06);
  byte-replayable decisions (C-17).
- **Advance:** "Can I show a decision replayed from its audit record next to how
  you'd reconstruct that today?"

## "We'll build this in-house."
- **Reframe:** "You can build lending. The hard, never-finished part is a
  *provable* system that stays aligned to every RBI change — fail-closed
  decisioning, tenant isolation, signed policy bundles, an AI kill switch."
- **Proof:** competitive frame #2 in `competitive-landscape.md`; isolation proven
  in CI (C-07), exact-decimal math (C-16), kill switch wired to runtime (C-09).
- **Advance:** "Worth putting our capability next to your build estimate and the
  ongoing maintenance tax?"

## "Is this actually RBI-compliant / certified?"
- **Reframe:** "We don't claim certification — that requires your legal, security,
  and integration review. We claim the controls are *enforced in software*, and we
  show you exactly which are built, which are first-slice, and which are roadmap."
- **Proof:** regulatory register + claims-sync matrix; live demo of KFS gate,
  fund-flow guard, kill switch.
- **Advance:** "Let me walk your compliance lead through the register mapping."

## "Are the integrations (CIC / FINnet / CKYC / payment rails) live?"
- **Reframe:** "Straight answer: those are governed submission slices with the
  certified live gateways on our roadmap. The *governance and evidence boundary*
  around them is built today."
- **Proof:** C-34/35/37/38 (Partial); show the governed boundary in the demo.
- **Advance:** "Here's the roadmap and the boundary — does the sequencing work for
  your timeline?"

## "Are you SOC 2 / ISO 27001?"
- **Reframe:** "Certification is on our roadmap. What exists today is evidence-by-
  design and a full vendor-posture posture you can examine now."
- **Proof:** disclosed sub-processor register (C-29), 6-hour incident clocks
  (C-30), audited break-glass (C-31), tenant export (C-32); certification roadmap
  (C-41, Roadmap).
- **Advance:** "Can I get this in front of your InfoSec team early so it's not a
  late-stage surprise?"

## "What about lock-in? / What if we leave?"
- **Reframe:** "Exit is a product feature, not a negotiation."
- **Proof:** reproducible, re-loadable tenant portability export incl. records +
  audit + documents (C-32); evidenced offboarding (C-33).
- **Advance:** "I can show the export format now so procurement sees it up front."

## "Too expensive / just need a cheap LMS."
- **Reframe:** "If it's purely a cheap LMS, we're probably not the fit — and I'll
  say so. If the real cost is audit fire drills, a compliance-driven launch slip,
  or an unstoppable model incident, that's the number to compare against."
- **Proof:** value hypotheses in the playbook; quantify their evidence-assembly
  cost from discovery.
- **Advance:** "Let's put a number on your current cost of proving compliance and
  compare."

## "We're mid-migration / no bandwidth."
- **Reframe:** "Then the last thing you want is to bolt compliance on afterward.
  Sandbox lets your team evaluate with synthetic data, zero production risk."
- **Proof:** sandbox with synthetic-only enforcement + mock integrations (C-42).
- **Advance:** "Spin up a sandbox tenant this week — no production touch."

## "Security won't approve a multi-tenant vendor."
- **Reframe:** "That's the right instinct — so we prove isolation, not assert it."
- **Proof:** cross-tenant isolation regression suite in CI (C-07); Postgres RLS
  (C-08); per-tenant encryption; break-glass sealed into the tenant's own chain
  (C-31).
- **Advance:** "Dedicated data plane is available if pooled isn't acceptable —
  let's scope that with your CTO."

## "How do I know a model can really be stopped?"
- **Reframe:** "Because the kill switch is in the runtime decision path, not a
  governance binder."
- **Proof:** model/global kill switch (C-09), drift auto-trip (C-11), post-incident
  review to clear (C-13) — demo it live.
- **Advance:** "Want to trip it in the sandbox and watch decisions degrade to
  manual review?"

## Handling silence / stall
Return to the trigger date and the economic buyer. "What has to be true by
[trigger date] — and who else needs to see this before then?" If no trigger and no
sponsor, it's not qualified; nurture with content, don't force the forecast.
