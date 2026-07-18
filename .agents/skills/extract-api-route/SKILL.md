---
name: extract-api-route
description: Use when adding new domain HTTP behavior to apps/api or extracting an inline handler from apps/api/src/server.js into a route module. server.js is a composition seam, not a feature home (REV-70).
---

# Add or extract an API route module

New domain HTTP behavior belongs in `apps/api/src/routes/`, one module per
resource. The trap is leaving the old inline handler alive next to the new
module — LoanOS is greenfield and forbids legacy aliases, dual dispatch and
compatibility shims (AGENTS.md). REV-70 tracks the ongoing extraction.

## Workflow

1. Create `apps/api/src/routes/<resource>.js` exporting one async router:
   ```js
   export async function routeThing(context) {
     const { method, path, url, req, res, store, readJson, sendJson, appendEvent } = context;
     if (method === "GET" && path === "/things") { /* ... */ return true; }
     return false; // not this router's path
   }
   ```
   Authentication, tenant resolution, mutation staffing and central
   request/audit attribution run **before** this boundary in `server.js` — the
   router owns only the tenant-partitioned resource. Say so in a header
   comment, as the existing modules do (see `routes/fraud-cases.js`).
2. Keep domain logic in `@loanos/core` and import it from there — the router
   holds HTTP shape (status codes, JSON envelopes, event append), never policy.
   Mutations that change state go through `appendEvent` so the audit hash chain
   stays complete.
3. Wire the module in `server.js`: add the import and the dispatch call in the
   routing sequence, and **delete the inline handler in the same change**. No
   old URL aliases, no fallback dispatch.
4. Add `tests/<resource>-route.test.js` modeled on an existing `*-route.test.js`
   (they exercise the route through the real server composition, including
   fail-closed and staffing paths).
5. Gate and document:
   ```bash
   npm test
   npm run knowledge:check
   ```
   Update `docs/architecture/current-implementation.md` where it maps the
   resource (the currency advisory nudges this). Cite `REV-70` in the commit
   when extracting existing handlers.

## Notes

- Fail closed at the HTTP boundary too: an invalid or blocked domain outcome
  returns the restrictive status (422/403), never a permissive default.
- One resource per module; if a module accumulates unrelated resources, split
  it rather than growing another seam.
