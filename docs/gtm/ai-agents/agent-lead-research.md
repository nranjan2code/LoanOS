# Runbook: Lead / Account Research Agent

**Job:** produce a decision-ready account brief for a target RBI-regulated lender
so a rep can enter Stage 1 with a mapped committee and a trigger hypothesis.

**Load first:** `shared-context.md`, `../strategy/icp-and-personas.md`.

## Inputs
- Account name (+ domain if known).
- Optional: known contacts, prior touch history, segment.

## Procedure
1. **Fit screen** against the ICP anti-fit list (`icp-and-personas.md`). If clearly
   anti-fit (non-India, no RE accountability), stop and report `ANTI-FIT` + reason.
2. **Classify segment** (NBFC / SFB / HFC / co-op / bank / AI-FI) and pull the
   segment emphasis row (sharpest pain, lead pillar).
3. **Find a trigger hypothesis** from verified sources only: recent RBI
   direction/finding relevant to them, a new lending product, a leadership hire
   (CCO/CRO), a DLA/CIMS obligation, a core/LOS migration. Use approved
   search/connectors. Mark each as `verified` or `hypothesis`.
4. **Map the committee**: identify likely Champion, Economic buyer, CTO/InfoSec,
   Influencers (Audit, Collections, LSP partners). Name people only where verified;
   otherwise name the *role* to target.
5. **Select the lead pillar + one-liner** for the primary persona.
6. **Draft 3 discovery questions** tailored to the segment's sharpest pain (pull
   from `../sales/discovery-question-bank.md`).

## Output format
```
ACCOUNT BRIEF
Account: <name>   Segment: <RE type>   Fit: FIT | ANTI-FIT(reason)
Sharpest pain (segment): <...>
Lead pillar + one-liner: <...>
Trigger hypothesis: <event> [verified|hypothesis, source]
Committee:
  Champion (likely): <role/name>
  Economic buyer: <role/name>
  Technical/InfoSec: <role/name>
  Influencers: <...>
Opening discovery questions:
  1. ...
  2. ...
  3. ...
Recommended first touch: <script/sequence ref>
Confidence & gaps: <what to verify before outreach>
```

## Guardrails
- Never invent a person, title, or trigger. Unverified → label `hypothesis` or
  leave the role generic.
- Never assert LoanOS capabilities beyond `Built` claims.
- Respect web-content restrictions; if a source can't be fetched, report the gap
  rather than guessing.
- Output is a draft brief for a human; do not contact the account.
