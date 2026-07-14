# Cold Call & Voicemail Scripts

Short, permission-based, compliance-led. Lead with a pain the persona owns, not a
product tour. Bracketed `[…]` = personalise. Keep the opener under 20 seconds.

## Universal opener frame

> "Hi [Name], [Your name] from LoanOS. I know this is out of the blue — can I take
> 30 seconds and you tell me if it's worth continuing?"
> *(pause for yes)*

## CCO / Head of Compliance

**Opener:**
> "We work with RBI-regulated lenders on one specific problem: producing
> digital-lending evidence — KFS, consent, fund-flow, DLA, model decisions —
> *while the loan runs*, so audits stop being fire drills. When your last
> supervisory query asked why a specific loan was approved, how long did
> assembling that answer take?"

**If pain:** "That's exactly the gap we close — every decision leaves a
tamper-evident trail you export in minutes. Worth a 30-minute look next week?"

**If 'we're fine':** "Totally fair. Most teams are fine until the day they're
examined. Can I send a one-pager so it's on your radar for the next review cycle?"

## CRO / Head of Credit

**Opener:**
> "Quick one — [Name], I work with credit heads on model risk. If one of your
> scorecards started drifting on a Friday, what stops it from being used on
> Saturday, and who has to approve turning it back on?"

**If interest:** "We run your credit policy as signed, versioned, replayable rules
with a kill switch over every model — drift auto-trips it, and clearing it needs a
post-incident review. That's the RBI model-risk direction, enforced. 30 minutes?"

## CTO / Head of Engineering

**Opener:**
> "[Name], I'll be direct — are you carrying a build-vs-buy decision on the lending
> compliance stack? Most engineering teams underestimate the standing cost of
> keeping fail-closed decisioning, tenant isolation, and an AI kill switch aligned
> to every RBI change."

**If interest:** "We're multi-tenant with isolation proven in CI, Postgres RLS,
exact-decimal money math, an append-only audit chain, and a re-loadable exit
export — India-hosted. Worth comparing against your build estimate?"

## CEO / Business Head

**Opener:**
> "[Name], one question: is compliance currently the thing that slows down
> launching new lending products? We flip that — compliance is enforced inside the
> flow, so launches get faster and safer, not slower."

## Gatekeeper / EA

> "Hi, I'm hoping you can point me right. I need the person who owns digital-lending
> compliance and model risk — usually the CCO or Head of Credit. Who would that be
> for [Company]?"

## Voicemails (under 20 seconds)

**Compliance:**
> "[Name], [Your name] at LoanOS. We help RBI-regulated lenders produce audit
> evidence while the loan runs instead of reconstructing it later. I'll email a
> one-pager — if it's relevant, a 30-minute call. Thanks."

**Credit/Risk:**
> "[Name], [Your name], LoanOS. One question I'll leave you with: if a model drifts
> on a Friday, what stops it being used Saturday? That's the problem we solve.
> Details in your inbox."

## Objection snippets (on the call)

- **"Send me an email."** → "Will do — so I send the right thing, are you more
  focused on audit evidence or model governance right now?"
- **"We built our own."** → "Makes sense for origination. The part teams
  underestimate is keeping the *provable* compliance aligned to every RBI update.
  Can I show what that ongoing tax looks like?"
- **"No budget."** → "Understood. What's the trigger — an inspection, a launch,
  a filing — that would make this a priority? I'll time my follow-up to that."

## Call discipline

One clear ask (a 30-minute meeting). One pain per call. Never demo on the cold
call. Log the trigger date and the persona's owned pain in CRM for the AI SDR
assistant to personalise follow-up (`ai-agents/agent-outreach-personalization.md`).
