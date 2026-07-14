# GTM Automation Scripts

Runnable, dependency-free Node (ESM `.mjs`, matching repo conventions). Run from
the repo root.

## Scripts

### `gtm-backlog-sync.mjs` — claims discipline gate
Parses `strategy/claims-and-backlog-sync.md` and fails (exit 1) on a malformed
claim row, an invalid `Status`, an empty `Evidence` cell, or a referenced source
doc that doesn't exist in the repo. Also warns on possible banned-phrase
assertions in GTM Markdown. **Run before shipping any campaign, deck, or page.**

```bash
node docs/gtm/automation/gtm-backlog-sync.mjs
```

### `build-proof-sheet.mjs` — rep proof sheet generator
Generates a Markdown proof sheet from the claims matrix, grouped Built / Partial /
Roadmap, so reps quote only live claims correctly.

```bash
node docs/gtm/automation/build-proof-sheet.mjs > /tmp/proof-sheet.md
```

### `outreach-list-build.mjs` — fit-screen & prioritise accounts
Applies the ICP anti-fit rules and a simple intent/committee score to a list of
target accounts; prints a tiered work order. Runs a demo sample with no args.

```bash
node docs/gtm/automation/outreach-list-build.mjs accounts.json
```

Input JSON shape:
```json
[{ "name": "Acme NBFC", "segment": "nbfc", "country": "IN",
   "borrowerCurrency": "INR", "reAccountable": true,
   "triggers": ["new product launch", "DLA/CIMS filing"],
   "committeeRoles": ["CCO", "Head of Credit", "CTO"] }]
```

### `cs-health-score.mjs` — Customer Success health score
Scores the six CS health dimensions, applies the forced-band rule (sponsor/value
at 0 caps the band at yellow), and prints a work list (reds first). Runs a demo
sample with no args. Backs `../customer-success/ai-agents/agent-health-monitor.md`.

```bash
node docs/gtm/automation/cs-health-score.mjs accounts.json
```

Input JSON shape:
```json
[{ "name": "Acme NBFC", "onboarding": 2, "value": 1, "usage": 2,
   "sponsor": 2, "support": 2, "commercial": 1 }]
```

## CI hook (recommended)

Add the claims gate to CI so no overclaim merges:

```yaml
# .github/workflows/ci.yml  (add a step)
- name: GTM claims discipline
  run: node docs/gtm/automation/gtm-backlog-sync.mjs
```

## Conventions

- No external npm dependencies (matches the repo's dependency discipline).
- Scripts are read-only over the repo except when you redirect output to a file.
- These automate the *guardrails and prioritisation*, not sending — humans (or
  approved connectors under human review) do the actual outreach/publishing.
