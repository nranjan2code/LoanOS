# AI Agents for GTM

Runbooks that let an AI agent execute GTM tasks the same way the human playbook
prescribes — with the same claims discipline. These are **prompt + procedure**
files: give the agent the runbook plus `shared-context.md` and the inputs it names.

## Load order (mandatory for every agent)

1. [`shared-context.md`](shared-context.md) — canonical product facts + anti-claims.
2. The task runbook for the job.
3. Only the source docs the runbook points to.

## Available runbooks

| Runbook | Job | Human counterpart |
| --- | --- | --- |
| [`agent-lead-research.md`](agent-lead-research.md) | Research & brief a target account | `../sales/sales-playbook.md` Stage 0 |
| [`agent-outreach-personalization.md`](agent-outreach-personalization.md) | Draft personalised outreach | `../sales/email-sequences.md`, `cold-call-scripts.md` |
| [`agent-content-generation.md`](agent-content-generation.md) | Draft marketing content | `../marketing/` |
| [`agent-qualification.md`](agent-qualification.md) | Score/qualify an opportunity | `../sales/qualification-framework.md` |

Customer Success agent runbooks live with their department in
[`../customer-success/ai-agents/`](../customer-success/ai-agents/): onboarding
orchestration, health monitor, and QBR prep. They obey the same load order and
golden rules below.

## Golden rules for every agent

- **Claims discipline first.** Assert only `Built` claims as present fact. Label
  `Partial`/`Roadmap`. Never fabricate facts, metrics, customers, or competitor
  claims (see `shared-context.md`).
- **Cite proof.** Attach a claim ID or source doc to product claims.
- **Stay in tools.** For live web/company data use approved connectors/search;
  respect the web-content restrictions. If a fact can't be verified, flag it.
- **Human-in-the-loop for external sends.** Agents draft; a human approves before
  anything goes to a prospect or is published.
- **Run the checker.** Before returning marketing copy, conceptually apply the
  `gtm-backlog-sync` rules; for batch output, a human runs the script.

## Relationship to platform skills/agents

If richer connectors are available (e.g. ZoomInfo skills for `account-research`,
`build-list`, `buying-committee`; brand-voice agents for content), these runbooks
describe the GTM-specific *instructions and guardrails* to layer on top of them —
they are not a replacement for those tools.
