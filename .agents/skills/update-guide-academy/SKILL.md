---
name: update-guide-academy
description: Use when changing Guide or Academy learning content (apps/help/**) — Guide articles, BA Academy or Technical Academy lessons and curricula. Learning content is governed source; edit content modules and generators, never generated HTML.
---

# Update Guide and Academy content safely

The Guide (`/help/`), BA Lending Academy (`/help/academy/`) and Technical
Academy (`/help/technical-academy/`) are generated, governed learning surfaces.
The trap: editing generated HTML (silently overwritten on rebuild) or letting a
lesson drift from what the platform actually does. The authoring contract is
`apps/help/README.md`; the architecture contract is
`docs/architecture/help-centre-and-academy.md`.

## Workflow

1. Edit the **source**, never generated output:
   - Guide roles, responsibility curricula, articles → `apps/help/help.js`
   - BA Academy content → `apps/help/academy/content/*.mjs`
   - Technical Academy content → `apps/help/technical-academy/content/*.mjs`
   - Renderers / learning pattern → `scripts/build-academy.mjs`,
     `scripts/build-technical-academy.mjs`
2. Preserve the learning design standard: every item answers *why am I here /
   what must I understand / how do I apply it / how do I know I am done*.
   Teach the adverse case, not only the happy path. Use `refer`/`deny`/`hold`
   precisely — never a vague permissive fallback.
3. Keep maturity honest: never present a lesson, screen or sandbox success as
   evidence of production readiness. Distinguish platform capability, tenant
   configuration, live-provider evidence and production admission.
4. Confirm claims against the product/architecture/regulatory sources, then
   update the content's **verification date** — a date means a qualified
   reviewer checked content and citations, not merely that the page rebuilt.
5. Rebuild and gate:
   ```bash
   npm run academy:build
   npm run technical-academy:build
   node --test tests/help-centre.test.js tests/ba-academy.test.js tests/technical-academy.test.js
   npm run knowledge:check
   ```
6. Visually verify the reading paths named in `apps/help/README.md` (Guide
   home, one role path, both course homes, one lesson) at desktop and mobile
   widths, including keyboard focus and cross-link **Back** behavior.

## Notes

- Course counts shown outside generated course homes are contract-tested in
  `tests/help-centre.test.js` — update the assertion with the count, never add
  another hand-maintained number.
- BA images are part of the validated contract: reuse an existing relevant
  asset before adding one, and every image needs accurate alternative text.
- No stored learner state, completion claims or certification language without
  amending the architecture contract first.
- Compliance-sensitive content additionally requires the control-owner review
  defined by the curriculum contracts in `docs/product/`.
