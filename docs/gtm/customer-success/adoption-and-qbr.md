# Adoption & QBR

Drive the platform into daily operations, then prove — quarterly — that it
delivered the compliance outcomes the customer bought.

## Adoption milestones (Stage 3)

Adoption is measured by governed behaviour in production, not raw logins:

| Milestone | Signal it's real |
| --- | --- |
| Origination live | Real compliant loans flowing through LOS with KFS gate + fund-flow guard |
| Evidence habit | Compliance team exports evidence packs as routine, not as a fire drill |
| Decisioning in use | Eligibility/decision engine in `shadow` then `active`; refer bands routing to human review |
| Servicing live (if LMS) | Loan accounts, statements, collections within FPC hours |
| Module adoption | Each contracted module actually used (AI Governance inventory populated; DLG/co-lending arrangements live; AA consents flowing) |
| Multi-team | Credit, ops, compliance, and (if relevant) collections all active |

Track each per account with a date; a stalled milestone is a health risk and a
CSM action.

## Driving adoption

- Map each milestone to the customer's success criteria and a named owner on their
  side.
- Remove friction: config help, enablement sessions, office hours.
- Reinforce the compliance value loop — every time they export evidence or a
  kill switch protects them, name it.
- Feed unmet needs to the backlog rather than over-promising.

## The QBR (Stage 4)

A compliance-value review, not a usage dump. 45–60 minutes.

**Structure**
1. **Success criteria scorecard** — their discovery goals vs. reality, with
   numbers (evidence-pack time, audit-prep effort, loans traced, incidents
   contained, launches unblocked).
2. **Value moments** — specific proof: an evidence pack that answered a supervisor
   query in minutes; a model drift auto-tripped and cleared via post-incident
   review; a security review passed.
3. **Health & adoption** — where they are on the milestone map; risks and plan.
4. **Roadmap alignment** — what's coming; honest on `Partial`/`Roadmap` items they
   care about (e.g. certified live integrations).
5. **Expansion hypothesis** — the next module/entity/product-line and the value
   case (hand to `renewals-and-expansion.md`).
6. **Actions** — owners and dates both sides.

**Prep** can be drafted by the QBR-prep agent (`ai-agents/agent-qbr-prep.md`); a
human CSM owns and delivers it.

## QBR value scorecard template

```
Account: <name>   Period: <Qn>   Sponsor: <exec>
Success criterion 1: <goal>  →  <result, number>  [on track | at risk]
Success criterion 2: <goal>  →  <result, number>  [on track | at risk]
Value moments this quarter:
  - <evidence-as-export / kill-switch / isolation / launch story>
Adoption: <milestones met> / <total>   Health: <green|yellow|red>
Roadmap items they care about: <item — Built|Partial|Roadmap status>
Expansion hypothesis: <module/entity>  Est. value: <...>
Agreed actions: <owner — action — date>
```

## Turning value into references

When an account hits clear value moments, flag as a reference/case-study candidate
and route to `../assets/case-study-template.md` — only with the customer's written
sign-off on any metric.
