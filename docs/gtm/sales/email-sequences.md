# Email & LinkedIn Sequences

Multi-touch outbound. Each touch: one pain, one proof, one ask. Keep bodies under
120 words. Bracketed `[…]` = personalise. Never assert `Roadmap`/`Partial` claims
as live (see `../strategy/claims-and-backlog-sync.md`).

## Sequence A — CCO / Compliance (5 touches, ~12 business days)

**T1 — Email — Day 1**
Subject: proving *why* a loan was approved
> [Name] — when a supervisor or auditor asks why a specific loan was approved, how
> long does assembling that answer take across your systems?
> We built LoanOS so the answer is an export, not a project: every KFS, consent,
> fund-flow, and model decision lands in a per-tenant, tamper-evident audit chain.
> Worth 30 minutes to compare against how you evidence compliance today?

**T2 — LinkedIn — Day 3**
> Connection note: "[Name] — sent you a note on producing digital-lending evidence
> in-flow rather than reconstructing it at audit. Curious how [Company] handles
> that today."

**T3 — Email — Day 5**
Subject: KFS as a control, not a PDF
> Quick follow-up. Most stacks treat KFS and disclosures as documents. LoanOS makes
> them enforced gates — no contract executes before KFS is disclosed and accepted.
> That single control removes a whole class of audit findings. Open to a look?

**T4 — Email — Day 9**
Subject: 2-minute proof
> [Name] — rather than a pitch, I can show a 2-minute clip: a decision replayed
> byte-for-byte from its audit record, and an evidence pack exported for one
> product line. Want me to send it?

**T5 — Email — Day 12 (break-up)**
Subject: closing the loop
> I'll stop here so I'm not noise. If evidence-on-demand and model kill-switch
> readiness become priorities before your next review cycle, reply and I'll pick it
> straight back up. One-pager attached either way.

## Sequence B — CRO / Head of Credit (4 touches)

**T1 — Email — Day 1**
Subject: what stops a drifting model on a Saturday?
> [Name] — if a scorecard starts drifting Friday, what stops it being used Saturday,
> and who approves turning it back on? LoanOS runs your credit policy as signed,
> versioned, replayable rules with a kill switch over every model — drift auto-trips
> it; clearing it needs a post-incident review. 30 minutes?

**T2 — LinkedIn — Day 3** — light touch referencing T1.

**T3 — Email — Day 6**
Subject: policy you can replay byte-for-byte
> Follow-up: our engine is per-tenant and fail-closed — any error lands on
> refer/deny, never a permissive default — and every decision replays identically
> from its audit record. That's model-risk readiness enforced in the decision path.

**T4 — Email — Day 10 (break-up).**

## Sequence C — CTO / Engineering (4 touches)

**T1 — Email — Day 1**
Subject: build vs. buy on lending compliance
> [Name] — honest question: are you carrying a build-vs-buy call on the lending
> compliance stack? The underestimated cost is *keeping* fail-closed decisioning,
> tenant isolation, and an AI kill switch aligned to every RBI change. LoanOS ships
> that: isolation proven in CI, Postgres RLS, exact-decimal math, append-only audit
> chain, India-hosted, re-loadable exit export. Compare against your estimate?

**T2–T4:** isolation proof → exit/portability (no lock-in) → break-up.

## Trigger-based one-off emails (highest reply rate)

Send within 48h of a trigger event. Reference the trigger in line 1.

- **New RBI direction / draft:** "Given [direction], teams are re-checking how
  [KFS / model risk / DLA] is *enforced*, not just documented…"
- **New lending product launch:** "Saw [Company] is launching [product] — the fast
  way to keep compliance from becoming the bottleneck is enforcing it in the flow…"
- **Leadership hire (CCO/CRO):** "Congrats on the [role] move. If you're auditing
  how compliance evidence is produced in your first 90 days…"
- **Supervisory finding / news:** handle with care and empathy; offer help, not a
  jab.

## Writing rules

- Subject lines: lowercase, specific, no hype, ≤ 6 words.
- One ask per email. One proof per email.
- Personalise line 1 to a trigger or a persona-owned pain, never "I hope this finds
  you well."
- Every factual product claim must be a `Built` claim. If unsure, check the
  claims-sync matrix or ask the AI content agent to validate.
