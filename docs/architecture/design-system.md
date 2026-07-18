# Design system

Verified: 2026-07-18

The canonical LoanOS user-interface standard. The tokens already exist and are
imported product-wide; this document makes the standard itself load-bearing so
any human or agent touching a frontend knows the rules without excavating CSS.

## The standard

- **Theme: warm-paper light, single theme.** A warm cream canvas
  (`--bg-base: #f7f4ec`), white panels, ink text (`#17201d`), and a monochrome
  forest-ink primary accent (`#173f35`) with functional hues for status. There
  is **no dark theme**; do not introduce one without an ADR.
- **Token source of truth:** [`apps/shared/design-tokens.css`](../../apps/shared/design-tokens.css)
  (Design System v2). It defines the spacing scale (4px base), typography
  scale, surface layers, borders, text colors and accents. Every app imports
  this file; at time of writing that includes web, customer, partner,
  administration, help, journey-workspace, and the application shells.
- **Reuse tokens; never hand-roll values.** New surfaces use `var(--…)` for
  color, spacing and type. A hardcoded hex or px value that duplicates a token
  is a defect. A genuinely new token goes into the shared file with a comment,
  not into an app stylesheet.
- **App stylesheets layer on top, they do not fork.** Per-app CSS
  (`help.css`, `administration-workspace.css`, …) may compose and extend
  tokens for its layout, but never redefines the base palette or scales.
- **Status colors carry meaning.** Restrictive outcomes (`deny`/`refer`/
  `hold`/error) must be visually distinct from success and never rendered in a
  reassuring color; this is the UI face of the fail-closed rule.

## Accessibility requirements (platform-wide)

These were first written down for the Guide/Academy (`apps/help/README.md`)
but apply to every surface:

- Full keyboard operability with visible focus; logical heading structure.
- Readable at mobile widths; wide content scrolls in its own container.
- Every image has accurate alternative text; no decorative photography where
  a diagram communicates better.
- No stored user state in learning/preview surfaces beyond what the
  architecture contract grants.
- Verify new/changed surfaces at desktop and mobile widths before done.

## Known boundaries (honest gaps)

- `apps/dashboard/index.css` predates the shared file and carries its own
  duplicated token block, which has already drifted (Inter vs DM Sans). It
  should converge on importing `apps/shared/design-tokens.css`; until then,
  dashboard styling changes must be checked against the shared tokens by hand.
- There is no visual-regression tooling; conformance is enforced by review
  and by this document.
- Brand marks and public-site imagery are governed separately by the GTM
  brand guide and the public-site content gate.

Changing the standard itself (tokens, theme, accessibility bar) updates this
document in the same change — a currency rule watches the token file.
