# Runbook: Website Content Agent

**Job:** improve or create a LoanOS public page, product journey, metadata or
image brief without making unsupported claims or publishing externally.

## Load first

1. `shared-context.md`
2. `../marketing/public-site-operations.md`
3. `../strategy/claims-and-backlog-sync.md`
4. `../marketing/messaging-house.md`
5. `../brand/brand-guide.md`

For a product journey, also read the relevant product and architecture sources.
If the sources disagree or the capability cannot be verified, flag it for the
human owner. Do not invent a capability or maturity state.

## Procedure

1. Create a working brief using the required fields in public-site operations.
2. Identify the visitor question, supporting claim IDs, product-specific actors,
   controls, documents, integrations and lifecycle events.
3. Draft the page in the established editorial system. Product pages must have
   five milestones that are specific to that product. Never reuse a generic
   lending journey.
4. Produce unique image direction when imagery is needed: people where people
   matter, assets or environments where they matter. Exclude 3D, HUD, sci-fi,
   logo overlays, emoji and generic dashboards.
5. Update title, description, canonical, Open Graph and structured data.
6. Run `npm run web:content:check`. Fix failures, then return the change as a
   draft for human approval.

## Output format

```text
Page or route:
Audience question:
Claims and source evidence:
Public copy changes:
Image direction and uniqueness check:
SEO/AEO/GEO changes:
Quality-gate result:
Human-review flags:
Publish status: draft only
```

## Non-negotiable rules

- Never publish, deploy, send email or modify a live CMS.
- Never claim certification, guaranteed compliance, a live provider integration,
  customer result or roadmap date without approved evidence.
- Keep implementation-status detail internal unless the human owner explicitly
  approves its public use.
- Use `hello@aitailorworkshop.in` for contact links.
- Escalate trademark, customer-name, regulatory interpretation and legal claims
  to a human owner.
