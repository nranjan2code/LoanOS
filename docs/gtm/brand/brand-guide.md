# LoanOS India — Brand Guide

**Single source of truth for the brand.** Codified from the live marketing site
(`apps/web/assets/site.css`, `apps/web/assets/site.js`) so GTM assets, decks,
one-pagers, and AI-generated content stay visually and verbally consistent. If you
change the brand here, update the site CSS to match (and vice-versa) — the two must
not drift.

## Brand essence

- **Name:** LoanOS India
- **Domain / contact:** aitailorworkshop.in · hello@aitailorworkshop.in
- **Descriptor:** India-first lending lifecycle SaaS (LOS · LMS · Workflow ·
  Compliance control)
- **Essence in one line:** *Accountable by construction.* Operational speed with
  institutional control.
- **Personality:** precise, calm, credible, institutional-but-modern. Never hypey,
  never fear-mongering. We earn trust by being exact.

## Logo & mark

- **Wordmark:** "LoanOS" in the sans face, weight 700, letter-spacing −0.02em.
- **Brand mark:** [loanos-logo-mark.png](../../../apps/web/assets/loanos-logo-mark.png)
  is the primary graphic mark. It depicts a continuous lending path with a lime
  line and saffron completion point on a forest field.
- **Sub-label:** small uppercase descriptor beneath the wordmark (letter-spacing
  0.1em), muted.
- Do not redraw, recolour, crop, add effects to, or combine the mark with other
  symbols. Keep clear space at least equal to the mark height around it.
- This file is the approved web master. Before trademark filing, obtain a
  professional distinctiveness and similarity search; the repository cannot
  establish registrability or clearance.

## Colour system (canonical tokens)

Use the CSS variable names verbatim when producing web/HTML assets.

| Token | Hex | Role |
| --- | --- | --- |
| `--ink` | `#10241f` | Primary text |
| `--forest` | `#123e32` | Primary brand green / buttons (`.ink`) / headings on light |
| `--forest-deep` | `#082b23` | Dark sections, footer, announcement bar |
| `--leaf` | `#2d765f` | Accent text, eyebrows, links/hover, emphasised words |
| `--lime` | `#dff276` | Primary CTA fill, highlights, mark letter, selection |
| `--lime-soft` | `#edf6bd` | Soft background glow |
| `--saffron` | `#f0a064` | Accent (dots, focus outline), warm highlight |
| `--rose` | `#e59a94` | Secondary accent |
| `--sky` | `#b9dfe1` | Cool accent card |
| `--paper` | `#f7f4ec` | Page background |
| `--sand` | `#f1ecdf` | Alternating section background |
| `--white` | `#fff` | Cards, surfaces |
| `--muted` | `#5b6863` | Secondary/body text |
| `--line` | `rgba(8,43,35,.16)` | Borders/dividers |

**Theme colour (meta):** `#123e32`.
**Section accents:** paper, sand, and `forest-deep` establish the page rhythm;
lime, saffron, rose, and sky are supporting signals rather than competing card
treatments.

Pairing rules: forest/forest-deep backgrounds carry white text and lime accents;
light (paper/sand/white) backgrounds carry ink/forest text with leaf accents.
Lime is a **highlight**, not a body colour — never large blocks of lime text.

## Typography

- **Display / headings:** `DM Serif Display` (`--display`), weight 400,
  letter-spacing −0.035em, tight line-height (~0.98). Used for `h1`/`h2` "display"
  and large numerics.
- **Body / UI:** `DM Sans` (`--sans`), weights 400–700, line-height 1.55.
- **Eyebrow / kicker:** DM Sans 700, uppercase, letter-spacing 0.1em, in `--leaf`
  (or `--lime` on dark, class `.eyebrow.light`).
- Fallbacks: display → Georgia, serif; sans → system-ui, sans-serif.
- Emphasis inside a display heading uses `<em>` styled non-italic in `--leaf`.

All website typography must use the semantic `--type-*` scale. The canonical
roles are display XL/LG/MD, display small/card, title LG/MD, body LG/body/body
small, label, and metadata. Body-small text is 14px and metadata/labels never
drop below 12px. Component-specific font-size literals are not permitted.

## Layout & shape

- Max content width `--max: 1180px`; gutter via `.wrap`.
- Editorial surfaces use `--radius-sm: 3px`; compact controls use
  `--radius-md: 6px`; pills use `--radius-pill: 999px`.
- Soft shadow `--shadow: 0 18px 52px rgba(8,43,35,.10)` is reserved for overlays
  and floating evidence, not ordinary content rows.
- Content is arranged as editorial rows with dividers. Avoid mixing a rounded
  card wall with flat editorial rows on the same page.
- Use the shared `--space-*` scale for structural gaps and section rhythm.
- Generous whitespace; one idea per section; alternating paper / sand / forest
  section backgrounds for rhythm.
- Focus ring: 3px `--saffron`, offset 4px (accessibility — keep it).

## Voice & tone (verbal brand)

Aligned with `../marketing/messaging-house.md`. The brand *voice* rules:

- **Precise over persuasive.** State the mechanism, then the benefit. "KFS must be
  disclosed before a contract executes" beats "powerful compliance."
- **Evidence, not adjectives.** Every capability claim carries a proof point.
- **Honest about maturity.** "First slice / governed boundary" and "on our roadmap"
  are on-brand phrases, not weaknesses.
- **Calm authority.** No hype, no FUD, no exclamation marks. Institutional readers.
- **India-specific and exact.** Use RBI-anchored terms correctly (KFS, DLD 2025,
  DLG, FPC, V-CIP, CERSAI, FIU-IND).

**Approved words:** enforce, gate, evidence, replay, fail-closed, tamper-evident,
in-flow, governed boundary, India-first/India-hosted, accountable by construction.

**Avoid:** "RBI certified", "guaranteed compliant", "fully automated compliance",
"bank-grade" as a boast, "revolutionary/cutting-edge", exclamation marks, and any
`Partial`/`Roadmap` claim stated as live.

## Imagery

- Real Indian lending contexts (teams, MSME, manufacturing) — see
  `apps/web/assets/images/`. Documentary, warm, credible; not stocky or glossy.
- Product views show the *governed record*: case + policy version + reason + next
  human action together (see the homepage product-proof component).
- Social card: `loanos-social-card.jpg` (1200×630 style).

## Accessibility (non-negotiable, part of the brand)

- Maintain WCAG-AA contrast (ink/forest on light; white on forest-deep).
- Visible text must be at least 12px; body copy should normally be 14–17px.
- Keep the visible focus ring; captions-first video (no audio dependency); the
  site ships a skip link. New assets inherit these.

## How GTM assets apply this

- **HTML/web assets:** use the CSS variables and classes above; link
  `apps/web/assets/site.css`.
- **Decks (pptx):** forest/lime on a paper background, DM Serif Display titles, DM
  Sans body; one idea per slide.
- **Docs (docx/pdf):** DM Sans body, forest headings, lime/saffron as sparing
  accents; keep the honesty ("built vs roadmap") sections.
- **AI-generated content:** the content agent applies this voice section; visual
  assets use these tokens. See `../ai-agents/agent-content-generation.md`.
