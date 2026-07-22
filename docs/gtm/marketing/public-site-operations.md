# Public Site Content Operations

This is the working system for improving the LoanOS public site quickly while
keeping every page accurate, reviewable and coherent. It applies to humans and
AI agents working in `apps/web/`.

## Operating principle

AI may research, structure, draft, update local files and run quality checks.
A named human owner approves anything that becomes public. No agent publishes,
sends, or changes a live DNS, hosting or CMS setting.

The public site is product marketing, not a build-status dashboard. Explain
what LoanOS can help an institution configure and operate. Do not promise a
feature, integration, certification, customer outcome or roadmap date unless it
is supported by the claims matrix.

## The fast path

1. **Open a content brief.** State audience, page or journey, customer question,
   desired outcome, claim IDs, source documents, CTA and owner.
2. **Draft locally.** A human or AI updates the page, product generator, image
   asset or metadata. Product page changes belong in
   `apps/web/scripts/generate-product-pages.mjs`, then regenerate the pages.
3. **Review claims and voice.** Check `strategy/claims-and-backlog-sync.md`,
   `marketing/messaging-house.md`, and `brand/brand-guide.md`.
4. **Run the combined gate.** `npm run web:content:check` validates claims and
   site integrity in one command.
5. **Human approval.** The owner approves the exact preview and records the
   decision in the brief or pull request.
6. **Publish separately.** Publishing is a deliberate human action after the
   gate passes. The repository automation never deploys by itself.

## Required brief

Use this block in an issue, pull request or task before material page work:

```text
Audience and question:
Page or product journey:
Goal and primary CTA:
Claims used and source links:
Customer proof or approved evidence:
Image brief and uniqueness check:
SEO intent and target query:
Human owner and reviewer:
Publish decision: draft / approved / published
```

## Page standards

- Start with the customer or operating problem, not a feature list.
- Each product journey page has its own five product-specific milestones. Do
  not reuse a generic journey with nouns swapped.
- Use one distinct, context-relevant documentary image per product page. Avoid
  3D, HUD, sci-fi, stock-dashboard imagery, logos, emoji and decorative glyphs.
- Keep sentences direct. Avoid em dashes, artificial contrast phrases and
  roadmap language that makes a buyer doubt the product.
- Every page requires a title, description, canonical URL, Open Graph data,
  appropriate structured data, an accessible image description and a clear CTA.
- The deployed showcase origin, `https://demo.aitailorworkshop.in`, is the
  canonical public-site origin used by page metadata, structured data, robots
  and the sitemap.
- Every external contact action uses `hello@aitailorworkshop.in`.
- Brand mark changes require design-owner approval and trademark clearance
  before external use or registration.

## Review roles

| Check | AI may do | Human owner must do |
| --- | --- | --- |
| Product and claim research | Summarise sources and flag uncertainty | Confirm supported claim and maturity |
| Copy and SEO draft | Draft page, metadata and structured data | Approve claim wording and CTA |
| Visuals | Propose or generate an image brief, detect reuse | Approve the final brand and image choice |
| Quality gate | Run `npm run web:content:check` | Resolve any failure before approval |
| Publishing | Prepare the change and checklist | Publish or authorise publishing |

## Automation

`npm run web:check` runs the public-site integrity check. It verifies the
expected product-page count, product-specific journey structure, unique image
assets, canonical and sitemap coverage, approved contact address, logo asset,
metadata and structured data.

`npm run web:content:check` runs both the claims gate and the site check. It is
the required pre-publish command and runs in CI.

## Cadence

- **Per page change:** brief, draft, combined gate, human approval.
- **Monthly:** review high-intent pages, search terms, CTA performance and any
  repeated or stale imagery.
- **On a product change:** update claims evidence first, then the public copy,
  product journey and related pages.
- **Quarterly:** review content library, sitemap, AI agent prompt, brand asset
  and trademark status.
