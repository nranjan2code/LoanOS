# Health & Churn

A transparent health model, the risk signals that feed it, and the save plays when
an account turns. Scored by the health-monitor agent
(`ai-agents/agent-health-monitor.md`) and `../automation/cs-health-score.mjs`; a
human CSM owns the response.

## Health dimensions (0–2 each; total /12)

| Dimension | 2 (green) | 0 (red) |
| --- | --- | --- |
| **Onboarding/adoption** | Milestones on track / met | Stalled, past due |
| **Value realisation** | Success criteria being met with numbers | No evidenced value |
| **Product usage** | Contracted flows/modules active in production | Dormant / sandbox-only |
| **Sponsor & relationship** | Engaged exec sponsor + active users | Sponsor gone / champion left |
| **Support & sentiment** | Few issues, positive sentiment | Escalations, frustration |
| **Commercial/renewal** | On-time trajectory, expansion interest | Renewal at risk, budget threat |

Bands: **10–12 green · 6–9 yellow · 0–5 red.** A red on Sponsor or Value forces at
least yellow overall regardless of total (they predict churn most).

## Risk signals to watch (compliance-SaaS specific)

- Onboarding milestone or readiness item slips past its date.
- Evidence-export habit never forms (they bought auditability and aren't using it).
- Decision engine stuck in `off`/`shadow`, never `active`.
- A `Partial`/`Roadmap` expectation gap the customer thought was live (e.g.
  certified CIC/FINnet) — set expectations before it festers.
- Security review re-opened, or a data-residency/incident concern raised.
- Sponsor or champion departs (common; multi-thread to survive it).
- Support escalations clustering; sentiment drop in QBRs.
- Usage decline in a contracted module.

## Save plays

| Situation | Play |
| --- | --- |
| Stalled onboarding | Re-run kickoff; re-anchor first-value milestone; unblock config/security |
| No value realised | Return to their discovery success criteria; demonstrate evidence-as-export / kill switch live; set a 30-day value milestone |
| Expectation gap on integrations | Honest `Partial` reset + governed-boundary walkthrough + roadmap date |
| Sponsor churn | Re-multi-thread fast: secure a new sponsor, brief them on value to date |
| Security/residency concern | Bring vendor-posture pack; offer dedicated data plane; involve InfoSec directly |
| Renewal at risk | Executive escalation; value scorecard; if needed, right-size rather than lose |

## Escalation

- **Yellow:** CSM owns a documented recovery plan with dates; note in the account.
- **Red:** escalate to Head of CS + exec sponsor; weekly recovery cadence; loop
  Sales/Finance if commercial.
- **Imminent churn:** save plan with a clear ask and a deadline; if unavoidable,
  run a graceful exit — the portability export (C-32/33) means leaving is clean,
  and a good exit protects reputation and re-entry.

## Close the loop to product

Every red/yellow root cause that is a product gap or friction becomes a
voice-of-customer item routed to `../product/build-backlog.md`, with the account
and the health impact noted. This is how retention pain sharpens the roadmap —
completing the cycle.

## Health record template

```
Account: <name>   Date: <ISO>   CSM: <name>
Scores: onboarding_ value_ usage_ sponsor_ support_ commercial_   Total _/12
Band: green|yellow|red   (forced band if sponsor/value = 0)
Top risk signal: <...>
Save play in motion: <play + owner + date>   |   Expansion-ready: yes/no
VoC routed to backlog: <item / n/a>
```
