# Website Sync Review — `apps/web` (loanos.in)

Assessment of the internet-facing marketing site against the new GTM messaging
house, claims-discipline matrix, and brand guide. Scope: `apps/web/` (home,
platform, financial-institutions, for-msmes, loan-types, partners, resources,
trust) + `assets/site.css`.

## Headline finding: the site is already largely in sync

The live site was written with exactly the claims discipline this library
enforces. Concretely:

- **No overclaiming.** A scan for `certified`, `guaranteed`, `SOC 2`, `ISO 27001`,
  `100%`, `bank-grade`, `ensures compliance` returned **zero** hits.
- **The trust page is exemplary.** It states plainly: *"It is not a certification
  or a claim of production regulatory approval,"* and *"Production readiness
  requires more than code… legal/compliance review, security assessment… live
  integration validation… remain necessary."* This matches our `Roadmap`/`Partial`
  framing and the "Where we're honest" sections of the GTM assets.
- **Messaging matches the house.** The site already leads with the handoff problem
  ("The handoff is usually the problem"), one governed record, policy-as-product,
  controls-in-the-workflow, human-governed / AI kill-switch — i.e. our Pillars 1–3
  and the "compliance produced in-flow" frame.
- **Brand is consistent.** The brand guide (`../brand/brand-guide.md`) was codified
  *from* this site's CSS, so decks/one-pagers/AI content now inherit the same
  colours, type, and voice.

**Conclusion:** no corrective rewrite is needed. The recommendations below are
governance links and small enhancements to keep site and GTM from drifting.

## Recommended changes (additive, low-risk)

| # | Where | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | trust/index.html "Implemented controls" | Map the three "Working" cards to claim IDs, and adopt the same three buckets we use everywhere: **Built / Partial / Roadmap** (today the page shows "Working" + a prose caveat). | One vocabulary across site, deck slide 12, and the claims matrix; easier to keep in sync. |
| 2 | trust + platform pages | Where integrations are mentioned (CERSAI, FIU-IND/FINnet, eSign, payment rails, CIC), ensure they read as "governed submission boundary; certified live gateway on roadmap" (C-34/35/37/38/39). | These are `Partial`/`Roadmap`; keep them from ever reading as live. |
| 3 | Publishing process | Add `node docs/gtm/automation/gtm-backlog-sync.mjs` to the site's pre-publish/CI check. | Fails the build if any page introduces an unbacked claim. |
| 4 | Homepage / trust | Consider a small "Built vs on the roadmap" transparency block linking to how we track it. | Turns honesty into a differentiator; mirrors pitch-deck slide 12. |
| 5 | CTAs | Site CTAs ("Book a demo", "Explore the platform", "Review the trust model") are on-brand; optionally test the evidence-led CTA "See an evidence pack exported" from `website-copy.md`. | Sharper, proof-led CTA aligned to Pillar 1. |
| 6 | Segment pages | Align `financial-institutions` / `for-msmes` / `partners` emphasis to the segment matrix in `../strategy/icp-and-personas.md`. | Consistent segment messaging between site and sales. |

## Terminology: site ↔ GTM (already consistent)

| Site phrase | GTM equivalent | Status |
| --- | --- | --- |
| "AI kill-switch controls" | Pillar 3 kill switch (C-09/11/13) | aligned |
| "policy version… traceable reasons and evidence" | Pillar 2 replayable decisions (C-14–17) | aligned |
| "evidence follows the action" | Pillar 1 evidence in-flow (C-05/06) | aligned |
| "direct fund-flow evidence" | fund-flow guard (C-03) | aligned |
| "regulated entity remains accountable" | RE-accountability boundary | aligned |
| "Exit is a product capability" | "Exit is a feature" (C-32/33) | aligned |

## What NOT to change

- Don't add certification/badge language until certifications actually exist
  (C-41 is `Roadmap`). The trust page's honesty is a strength — keep it.
- Don't drop the "not a certification / production readiness requires more"
  caveat.
- Don't restyle the brand mark or introduce off-palette colours (see brand guide).

## Governance rule going forward

Site and GTM library share one claims matrix. Any new site claim gets a row in
`../strategy/claims-and-backlog-sync.md` **first**, then the sync script gates
publishing. If the brand changes in the site CSS, update `../brand/brand-guide.md`
in the same change (and vice-versa).

## Implementation note

These are recommendations, not applied edits — the live site is customer-facing, so
changes to it should be made deliberately. Any of items 1–6 can be implemented on
request; item 3 (wire the claims gate into CI) is the highest-leverage and lowest-
risk place to start.
