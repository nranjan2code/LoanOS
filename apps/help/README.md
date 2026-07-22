# Guide and Academy authoring guide

`apps/help/` contains three connected learning surfaces:

- the Guide at `/help/` for task guidance and responsibility paths;
- the BA Lending Academy at `/help/academy/` for business process, regulation and lending-domain learning;
- the Technical Academy at `/help/technical-academy/` for architecture, code, controls, integrations and operating boundaries.

The canonical architecture contract is `docs/architecture/help-centre-and-academy.md`. Curriculum contracts live in `docs/product/ba-lending-academy-curriculum.md` and `docs/product/technical-academy-curriculum.md`.

## Learning design standard

Every learning item must help the learner answer four questions:

1. **Why am I here?** State the audience, task or outcome and estimated time before the detail.
2. **What must I understand?** Use a short sequence, descriptive headings and one idea per paragraph. Define specialist terms or link the glossary.
3. **How do I apply it?** Include a realistic decision, adverse case, evidence requirement or sandbox task. Do not teach only the happy path.
4. **How do I know I am done?** End with retrieval practice, a knowledge check or a completion checklist that names the restrictive failure boundary.

Write for scanning without reducing technical precision:

- lead with the action or conclusion;
- prefer concrete verbs and sentences that identify the actor and source of authority;
- keep paragraphs focused and move genuine sequences into lists;
- expand an abbreviation on first use in a learning path;
- distinguish platform capability, tenant configuration, live-provider evidence and production admission;
- never use a lesson, screen or successful sandbox case as evidence of production readiness;
- use `refer`, `deny`, `hold` or `pending reconciliation` precisely—never a vague permissive fallback.

Pages include session-only focus mode, reading progress and current-section highlighting through `learning-experience.js`. These aids intentionally store no learner state. Do not add local storage, browser profiling, completion claims or certification language without amending the architecture contract.

Every Academy page also exposes an explicit **Back** control. Academy cross-links carry a same-origin `returnTo` context so Back reliably returns to the page the learner came from even when browser referrer data is suppressed. Same-origin history is the secondary route; a direct-entry page falls back to its course home, and a course home falls back to the Guide. This URL context is navigation, not stored learner state. Do not replace it with hard-coded parent-only navigation—lessons, atlases and architecture pages are intentionally interlinked.

## Where to edit

- Guide roles, responsibility curricula and articles: `help.js`.
- Guide shell and page structure: `index.html`; visual rules: `help.css`, `responsibility-paths.css`, `navigation-flow.css` and `learning-experience.css`.
- BA Academy content: `academy/content/*.mjs`. Generated HTML under `academy/` must not be edited.
- BA Academy renderer and learning pattern: `scripts/build-academy.mjs`; visual rules: `academy/academy.css`.
- Technical Academy content: `technical-academy/content/*.mjs`. Generated HTML under module and atlas directories must not be edited.
- Technical Academy renderer and learning pattern: `scripts/build-technical-academy.mjs`; visual rules: `technical-academy/technical-academy.css`.

Course counts shown outside generated course homes must match the curriculum source and its contract tests. Avoid introducing another hand-maintained count; when duplication is unavoidable, update the associated assertion in `tests/help-centre.test.js`.

Images are part of both Academy content contracts. Use an existing subject-relevant image before creating another asset, and give every image accurate alternative text. BA assets resolve from the shared/public or BA-owned image sets. Technical Academy orientation photography lives under `/help/technical-academy/assets/images/`, is mapped once per module and is reused across its sessions; the build fails when a mapped asset or alternative text is absent. Technical flows and the Enterprise Architecture Explorer remain the accessible explanation of system relationships—photography supplies human and operating context, never a decorative substitute for a diagram.

## Review and verification

1. Confirm claims against the relevant product, architecture, regulatory and current-implementation sources.
2. Update the affected content source and its verification date. A date means a qualified reviewer checked the content and citations—not merely that the page was rebuilt.
3. Rebuild generated courses:

   ```bash
   npm run academy:build
   npm run technical-academy:build
   ```

4. Run the focused gates:

   ```bash
   node --test tests/help-centre.test.js tests/ba-academy.test.js tests/technical-academy.test.js
   npm run knowledge:check
   ```

5. Inspect at least the Guide home, one role path, one Guide article, both course homes, one standard lesson, the Enterprise Architecture Explorer and one technical journey at desktop and mobile widths. Enter through a cross-link and test Back, then test a direct URL and its fallback. Check image loading and alternative text, keyboard focus, contents links, focus mode, answer disclosure, long headings and source links.

Compliance-sensitive content still requires the control-owner review defined by the curriculum contracts. Borrower guidance remains outside this institutional surface.
