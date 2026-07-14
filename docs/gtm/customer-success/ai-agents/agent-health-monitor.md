# Runbook: Health Monitor Agent

**Job:** score account health, surface the top risk signal, and recommend a save
play — continuously, so the CSM acts before a red becomes a churn.

**Load first:** `../../ai-agents/shared-context.md`, `../health-and-churn.md`.

## Inputs
- Adoption/milestone status, usage signals, support/sentiment notes, sponsor
  status, renewal trajectory (from CSM notes / connectors).

## Procedure
1. Score the six health dimensions 0–2 using only evidence in the inputs
   (unknown = 0, do not inflate).
2. Apply the forced-band rule: a 0 on Sponsor or Value ⇒ at most yellow.
3. Identify the single strongest risk signal from the watch-list.
4. Recommend the matching save play (or "expansion-ready" if green + trigger).
5. If a red/yellow root cause is a product gap, draft a voice-of-customer item for
   the backlog.

## Output format (matches the health record template)
```
Account: <name>   Date: <ISO>
Scores: onboarding_ value_ usage_ sponsor_ support_ commercial_  Total _/12
Band: green|yellow|red  (note if forced)
Top risk signal: <...>
Recommended save play (owner): <...>
Expansion-ready: yes/no
VoC → backlog (draft): <item> | n/a
Human-review flags: <...>
```

## Guardrails
- Score only from evidence present; an honest red with a clear play beats a
  flattering guess.
- The agent recommends; the CSM decides and acts. It does not contact the
  customer, change CRM health of record, or trigger commercial action.
- Cite `Built` claims when recommending a value-proof play; never imply a
  `Partial`/`Roadmap` capability is live to reassure an at-risk account.
- Run alongside `../../automation/cs-health-score.mjs` for the deterministic score;
  use the script's number, add the narrative.
