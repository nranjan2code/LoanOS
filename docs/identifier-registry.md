# Identifier registry — the knowledge graph

LoanOS carries several parallel identifier schemes that cite one another across
product, architecture, compliance and go-to-market documents. Together they form
a knowledge graph: a claim points at a capability, a capability points at an
engine invariant and a test, an architecture doc points at an ADR. This page is
the schema for that graph — the authoritative source of each scheme, its format,
and the automation that keeps citations from dangling.

Read this before inventing a new identifier or citing an existing one. For AI
agents: every ID below is a stable anchor you can resolve mechanically instead of
searching prose.

## Schemes

| Scheme | Format | Authoritative source | Meaning |
| --- | --- | --- | --- |
| Capability ID | `PREFIX-NNN` (prefix 2–4 letters, exactly 3 digits) | [complete-system-capability-catalog.md](product/complete-system-capability-catalog.md) | One target capability. Mirrored into [capability-trace.json](product/capability-trace.json) and `dashboard-data.json`. |
| Engine requirement | `INV-n` · `DEC-n` · `SEC-n` · `PH-n` (1–2 digits) | [decision-engine-design.md](architecture/decision-engine-design.md) | `INV` invariant / test obligation · `DEC` design decision · `SEC` security control · `PH` delivery phase. |
| ADR ID | `NNNN` (4 digits, as filename prefix) | [docs/decisions/](decisions/README.md) `NNNN-*.md` | One irreversible architecture decision. |
| GTM claim ID | `C-NN` | [claims-and-backlog-sync.md](gtm/strategy/claims-and-backlog-sync.md) | One marketing claim, its status and evidence. |
| Epic ID | `Epic N` (heading) | [build-backlog.md](product/build-backlog.md) | One backlog epic. |
| Integration ID | `INT-*`, `INT-ADM-NN` | [platform-module-integration-api-map.md](architecture/platform-module-integration-api-map.md) | One external dependency / admission scenario. |

### Capability prefixes

`ACC AIG AUD CHN CLL CLS COL CON CUS DOC DSB FIN FRD GRV IMP INT KYC LMS LWS OFR
OPS PAR PAY PLT PRD REC REG RPT RSK SEC SRV UWG UX` — the digit count
disambiguates the shared `SEC` prefix: `SEC-012` is a capability, `SEC-12` is an
engine security control.

### Local namespaced schemes

Some documents carry their own self-contained invariant table with a namespaced
prefix — for example `ORG-INV-1..14` in
[organisation-signup-and-bootstrap-identity.md](architecture/organisation-signup-and-bootstrap-identity.md).
These are local to their document and are **not** engine `INV-n` identifiers.
Always namespace a document-local scheme (`ORG-INV-`, never bare `INV-`) so the
graph automation does not read it as an engine citation.

## The edges, and what enforces them

A citation is an edge from one scheme to another. These are checked in CI:

| Edge | Enforcement | Gate |
| --- | --- | --- |
| Catalogue capability ↔ trace entry (both directions, 1:1) | error | `npm run trace:validate` |
| Capability evidence ref → real repository file / endpoint | error | `npm run trace:validate` |
| Claim evidence → engine ID / capability ID | error | `npm run graph:check` |
| Architecture doc → engine ID | error | `npm run graph:check` |
| Any doc → `ADR NNNN` | error | `npm run graph:check` |
| Capability `dependencies[]` (ID-shaped) → capability | warning | `npm run graph:check` |
| Every doc reachable from `docs/README.md`, links valid | error | `npm run docs:check` |
| Claim rows well-formed, unique, evidence present | error | `npm run web:content:check` |

`graph:check` runs [validate-knowledge-graph.mjs](../scripts/validate-knowledge-graph.mjs).
Warning-level edges (currently three dangling capability dependencies) are real
data debt surfaced for a human to resolve; they do not fail the build until the
intended target is known and the edge is corrected, at which point the check can
be ratcheted to error — the same discipline as the evidence floors in
[capability-evidence-policy.json](product/capability-evidence-policy.json).

## Keeping citations current

The required-update matrix in
[documentation-governance.md](documentation-governance.md) says which companion
documents must move when a change lands. Its machine form is
[documentation-governance-rules.json](documentation-governance-rules.json),
evaluated diff-aware by [check-currency.mjs](../scripts/check-currency.mjs)
(`npm run currency:check`) — advisory by design, so it nudges the author when a
companion document looks stale.
