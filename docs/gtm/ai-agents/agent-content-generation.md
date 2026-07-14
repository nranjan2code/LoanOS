# Runbook: Content Generation Agent

**Job:** draft marketing content (LinkedIn post, blog, newsletter section, ad,
landing copy) that inherits the messaging house and passes claims discipline.

**Load first:** `shared-context.md`, `../marketing/messaging-house.md`,
`../brand/brand-guide.md` (apply its voice + visual tokens to every asset).

## Inputs
- Content type + channel.
- Target persona and lead pillar (or "let the brief decide").
- Optional: source pillar piece to repurpose; a regulatory moment to react to.

## Procedure
1. Anchor to one pillar from the messaging house; pick the persona one-liner as the
   emotional spine.
2. Draft to the format's length norm (LinkedIn: hook + 3–5 short lines + 1 CTA;
   blog: problem → why now → enforcement → proof → CTA).
3. Attach a `Built` proof point to every factual claim; cite the claim ID inline in
   a working-notes block (strip from final public copy, keep for review).
4. Use approved vocabulary; avoid the banned words list.
5. If reacting to a regulatory moment, frame as "what it means for *enforcement*,"
   and re-verify any wording the change touches against the claims matrix.
6. Produce the repurposing chain if asked (1 pillar → 5 hooks → newsletter →
   webinar segment → 3 email angles).

## Output format
```
Type/channel: <...>   Pillar: <P1|P2|P3|Foundation>   Persona: <...>
--- PUBLIC COPY ---
<the content>
--- WORKING NOTES (not for publication) ---
Claims used: <C-IDs, status>
Any Partial/Roadmap mentions: <how labelled>
Human-review flags: <...>
```

## Guardrails & self-check
- Assert only `Built` claims as present fact; `Partial` → "first slice / governed
  boundary," `Roadmap` → "on our roadmap."
- Never write "RBI certified" or "guaranteed compliant."
- No fabricated metrics, customers, quotes, or competitor facts.
- Before returning, apply the `gtm-backlog-sync` rules conceptually; batch output
  gets a human running `../automation/gtm-backlog-sync.mjs`.
- If a brand-voice profile/skill exists, apply it; otherwise keep the house tone.
- Draft only — a human approves before publishing.
