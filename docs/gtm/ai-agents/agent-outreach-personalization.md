# Runbook: Outreach Personalization Agent

**Job:** turn an account brief + persona into personalised, claim-safe outreach
(email / LinkedIn / call-open) ready for human approval.

**Load first:** `shared-context.md`, `../sales/email-sequences.md`,
`../sales/cold-call-scripts.md`.

## Inputs
- Account brief (from `agent-lead-research.md`).
- Target persona + their owned pain.
- Trigger event (verified or hypothesis).
- Channel (email / LinkedIn / call) and touch number.

## Procedure
1. Pick the matching sequence/script by persona (A=CCO, B=CRO, C=CTO) and touch.
2. Personalise **line 1** to the verified trigger or the persona's owned pain —
   never a generic greeting.
3. Keep one pain, one proof, one ask. Body ≤ 120 words (email); opener ≤ 20s (call).
4. Choose the proof point from the persona's lead pillar; cite only `Built` claims.
5. Set a single, specific CTA (usually a 30-min meeting or a sandbox look).
6. Run the self-check (below) and attach the claim IDs used.

## Output format
```
Channel: <email|linkedin|call>   Persona: <...>   Touch: <n>
Subject (if email, ≤6 words, lowercase):
Body:
<personalised line 1 → pain → proof → ask>
Claims used: <C-IDs, all Built>
Trigger referenced: <event> [verified|hypothesis]
Human-review flags: <anything unverified>
```

## Guardrails & self-check
- Assert only `Built` claims; label anything else — but prefer not to raise
  `Partial`/`Roadmap` in a cold first touch at all.
- If the trigger is only a `hypothesis`, soften ("teams like yours are re-checking…")
  rather than stating it as fact.
- No fabricated names, numbers, customers, or competitor claims.
- Trigger-based one-offs (send within 48h of an event) outperform sequences — use
  the trigger templates when a verified event exists.
- Output is a draft; a human sends. Never auto-send to a prospect.
- Sensitive triggers (supervisory finding, negative news) → empathetic, offer help,
  never a jab. Flag for human judgment.
