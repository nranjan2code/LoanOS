# Content Calendar

A repeatable cadence tied to the messaging house and regulatory moments. Dates are
relative (Week N) — set absolute dates when planning a quarter. Every piece names
its pillar and its proof source.

## Cadence model

- **Weekly:** 2–3 LinkedIn POV posts (founder/exec + company).
- **Bi-weekly:** 1 long-form pillar/blog piece.
- **Monthly:** 1 webinar or roundtable; 1 newsletter.
- **Reactive:** rapid explainer within 48h of any RBI direction/draft/finding.

## Quarter skeleton (repeatable)

| Week | Format | Working title | Pillar | Proof source |
| --- | --- | --- | --- | --- |
| 1 | Pillar blog | "Why lending audits become fire drills — and how to end them" | P1 | C-05/06/17 |
| 1–2 | LinkedIn ×5 | Hooks from the pillar (evidence-as-export, KFS-as-control) | P1 | C-02/06 |
| 2 | Webinar | "Model-risk readiness under RBI: enforce, don't document" | P3 | C-09/10/11/13 |
| 3 | Pillar blog | "The AI kill switch that's actually wired into the decision" | P3 | C-09/11/13 |
| 3–4 | LinkedIn ×5 | Drift auto-trip, post-incident-review-to-clear | P3 | C-11/13 |
| 4 | Newsletter | Roundup + regulatory watch | mixed | claims-sync |
| 5 | Pillar blog | "Compliance-as-code: KFS, consent, and fund-flow as gates" | P1 | C-01/02/03/04 |
| 6 | Roundtable | CCO peer session: evidence on demand | P1 | C-06/32 |
| 7 | Pillar blog | "Multi-tenant, but provable: isolation your InfoSec can verify" | Foundation | C-07/08 |
| 8 | Case study | Design-partner story (as available) | mixed | reference |
| 9 | Pillar blog | "Distribution without losing the boundary: DLG & co-lending" | mixed | C-22/23/44 |
| 10 | Webinar | "Exit is a feature: portability & no lock-in" | Foundation | C-32/33 |
| 11 | LinkedIn ×5 | Trap-setting questions as posts | mixed | battlecards |
| 12 | Newsletter | Quarter roundup + next-quarter regulatory watch | mixed | claims-sync |

## Evergreen pillar pages (owned SEO)

- KFS enforcement in digital lending
- The AI kill switch and RBI model-risk readiness
- DLG (Default Loss Guarantee) done compliantly
- Co-lending arrangement mechanics
- Data residency & Aadhaar-artifact prohibition
- Tenant isolation and evidence for RE outsourcing obligations

## Regulatory-moment playbook (reactive)

When a new RBI direction/draft/finding drops:
1. Within 24h: internal read + claims-sync check for any affected wording.
2. Within 48h: publish a plain-language "what it means for *enforcement*" explainer.
3. Feed the angle to sales as a trigger email (`../sales/email-sequences.md`).

## Repurposing chain (one pillar → many assets)

Pillar blog → 5 LinkedIn hooks → 1 newsletter section → 1 webinar segment → 3
sales-email angles → 1 one-pager update. The AI content agent
(`../ai-agents/agent-content-generation.md`) can draft the whole chain from one
approved pillar.

## Governance

No calendar item publishes without: named pillar, cited proof source, and a green
run of `gtm-backlog-sync.mjs`. Reactive pieces get the same check, faster.
