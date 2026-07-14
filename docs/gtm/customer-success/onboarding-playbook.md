# Onboarding Playbook

Get a new tenant from signed to first compliance value fast, using the platform's
own onboarding wizard and sandbox. Onboarding is where trust is won or lost for a
compliance buyer — do it evidenced and in order.

## Prerequisites (from the Sales handoff)

Edition + enabled modules, discovery success criteria, security-review notes, and
the onboarding blueprint: RE profile, initial product policy, enabled
modules/flows, readiness checklist. Confirm all present before kickoff.

## Kickoff (Day 0)

- Confirm the success plan and the first-value milestone + date.
- Name the customer sponsor and the working team (compliance, credit, ops,
  engineering/InfoSec as needed).
- Decide data-plane model (pooled default vs. dedicated) per the security notes.
- Agree the sandbox-first path: evaluate/validate on synthetic data before any
  production borrower.

## Provisioning sequence (platform control plane)

The platform wizard/API creates the tenant in one governed transaction. Walk it in
this order and evidence each step:

1. **Tenant shell + owner** — provision the tenant and first owner user.
2. **Regulated entity profile** — RE type, India/data-residency, grievance
   officer, board-policy gates.
3. **Initial product policy** — INR product, APR/amount/tenor limits, cooling-off,
   penal-charge and eligibility rules, with an effective date.
4. **Modules & flows** — enable exactly the entitled modules (`ai_governance`,
   `collections`, `dlg`, `co_lending`, `marketplace`, `integrations`); narrow if
   the contract scoped down.
5. **Readiness checklist** — work it to green.
6. **Service credential** — issue the one-time tenant service key; rotate per
   policy; set up tenant admin users / invites.

## Sandbox validation (before production)

- Provision a sandbox environment — it enforces **synthetic-only borrowers** and
  mock integration overrides (C-42), so the team can validate flows with zero
  production risk.
- Validate the buyer's priority journeys end-to-end in sandbox: onboarding →
  consent/KYC → eligibility → KFS → sanction → disbursement readiness, plus any
  contracted module (collections, DLG, co-lending, AA).
- Run the security/InfoSec walkthrough here: isolation posture, audit export,
  break-glass, exit export.

## First-value milestone (Stage 2)

Declare first value when the customer has, in their own tenant:

1. Traced **one compliant loan end-to-end** (consent → KYC → underwriting → KFS →
   sanction → disbursement → [servicing]).
2. Exported **one integrity-attested evidence pack** (C-06) and verified the audit
   chain.

These two map directly to the promise they bought — lead the celebration around
them, not around login counts.

## Go-live checklist

- [ ] Readiness checklist green; required RE/product policies effective.
- [ ] Entitled modules/flows enabled; nothing enabled beyond contract.
- [ ] Security review closed (data-plane model agreed; sub-processor register
      shared; incident-notification expectations set).
- [ ] Service key issued + rotation scheduled; admin users/invites set.
- [ ] First-value milestone met in sandbox; production cutover plan agreed.
- [ ] Success plan finalised; QBR date booked; health baseline captured.
- [ ] Exit/portability export demonstrated once (removes future procurement
      anxiety and proves C-32/33).

## Common onboarding risks & plays

| Risk | Play |
| --- | --- |
| Security review stalls go-live | Bring the vendor-posture pack + dedicated-data-plane option early; don't wait to be asked |
| Policy config ambiguity | Start from the seeded blueprint; version policy with effective dates rather than editing in place |
| "Where's the live CIC/FINnet integration?" | Honest `Partial` framing; validate the governed boundary in sandbox; set roadmap expectation |
| Sponsor goes quiet | Re-anchor on their dated success criteria; escalate to exec sponsor |

## Handoff to steady-state

When go-live checklist is complete, transition from onboarding cadence to adoption
check-ins (`adoption-and-qbr.md`) and start continuous health scoring
(`health-and-churn.md`).
