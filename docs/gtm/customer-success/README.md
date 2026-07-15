# Customer Success

The post-sale half of the revenue cycle: turn a signed contract into realised
value, a renewal, and expansion — without ever letting a compliance promise go
unmet. Same discipline as the rest of the library: only `Built` capabilities are
described as live, everything follows the brand voice, and AI agents draft while
humans own the customer relationship.

## Where CS sits in the cycle

```
Sales close ──▶ Onboard ──▶ Adopt ──▶ Prove value (QBR) ──▶ Renew ──▶ Expand
                  │            │              │                 │         │
                  └──────── health scoring runs continuously ──┴─────────┘
                                     │
                          Voice-of-customer ──▶ product backlog
```

## Folder map

| Doc | Purpose |
| --- | --- |
| [`cs-playbook.md`](cs-playbook.md) | The CS operating model: segments, lifecycle stages, cadence, RACI, success-plan model |
| [`onboarding-playbook.md`](onboarding-playbook.md) | Onboarding via the platform wizard, sandbox→production, first-value milestones |
| [`adoption-and-qbr.md`](adoption-and-qbr.md) | Adoption milestones and the QBR that proves compliance value |
| [`renewals-and-expansion.md`](renewals-and-expansion.md) | Renewal motion + module expansion (AI Governance / Distribution / Integrations) |
| [`health-and-churn.md`](health-and-churn.md) | Health-score model, risk signals, and save plays |
| [AI-agent runbooks](ai-agents/README.md) | Onboarding orchestration, health monitor and QBR preparation |

## Handoff in (from Sales)

At close, Sales delivers (per `../sales/sales-playbook.md` Stage 7): agreed edition
+ enabled modules, the discovery success criteria, security-review notes, and the
onboarding blueprint (RE profile, initial product policy, enabled modules/flows,
readiness checklist). CS confirms and owns from here.

## Non-negotiables for CS

- **Never let live behaviour outrun a claim.** If a customer asks for a capability
  that is `Partial`/`Roadmap` (e.g. a certified live integration), set expectations
  honestly — see `../strategy/claims-and-backlog-sync.md`.
- **Value = the compliance outcomes they bought.** Prove evidence-as-export, the
  kill switch, provable isolation, and exit-readiness — not vanity usage.
- **Close the loop.** Every recurring ask, gap, or friction becomes a
  voice-of-customer item routed to the product backlog.
- **Agents draft; humans own the relationship.** See
  `../operating-model.md` human-in-the-loop checkpoints.
