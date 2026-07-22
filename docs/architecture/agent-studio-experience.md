# Agent Studio experience contract

Verified: 2026-07-22

Status: implemented interaction and information-architecture baseline for capability AIG-025.

Agent Studio is the tenant staff surface for designing, testing, releasing and governing bounded digital assistants. It is not a model playground and it must never make agent authority look broader than the underlying control plane allows. The experience therefore optimizes for task orientation, progressive disclosure, human accountability and visible restrictive boundaries.

## Review findings that drove the redesign

The July 2026 review found that the first UI slice exposed the domain controls but did not yet form a usable operating experience:

- The client bundle could not parse because several lifecycle and approval functions were declared twice. The browser displayed a permanent loading message and no workspace data. Static marker tests did not execute a JavaScript syntax check, so the defect escaped.
- All creation, knowledge, memory, testing, release, operations, finance, provider-admission, approval and reporting forms were present on one roughly 6,750-pixel document. Workspace buttons hid groups after initialization, but the page still reflected backend capabilities rather than staff tasks.
- The four creation steps were labels, not an interaction model. Users faced one long form without stage validation, a persistent summary or a clear handoff after submission.
- There was no landing overview. Returning users had to choose a subsystem before they could see owned work, portfolio state or the next useful action.
- Role filtering sat above every workspace even though it affected only the operations queue, which suggested a broader permission change than it actually made.
- Lifecycle actions relied on native `window.prompt` dialogs. These prompts offered little context, could not collect a structured suspension reason plus incident reference together, and produced an inconsistent keyboard and visual experience.
- Status and readiness feedback competed with page content. Empty, loading, restrictive and successful outcomes lacked a consistent hierarchy.
- The mobile layout stacked the same large administrative surface rather than reducing cognitive load.

## Information architecture

Agent Studio now uses six task-based workspaces:

| Workspace | Staff question | Primary content |
| --- | --- | --- |
| Overview | What needs me, and where is work progressing? | Portfolio metrics, priority queue, recent assistants and quick starts |
| Build | How do I propose a bounded assistant? | Four-stage builder, approved templates and persistent draft summary |
| Resources | What may assistants know, remember and follow? | Knowledge packs, governed memory stores and visual work plans |
| Validate | How do I prove the restrictive path and version the result? | Expected/adverse test design, server-derived rehearsals, release readiness and rollback |
| Operate | What work do I own and how do I contain an assistant? | Role-focused attention queue, portfolio actions and configuration comparison |
| Controls | What independent evidence and approvals remain? | Four-person approval, activation evidence, provider admission, governance health and exact spending limits |

The navigation labels use staff verbs while retaining precise domain language inside the workspace. URL fragments preserve Back/Forward navigation, arrow keys move across the workspace navigation, and exactly one workspace is visible at a time.

## Builder contract

Creation is a four-stage flow:

1. **Pattern** — choose an approved banking template, copy an existing configuration into a clean draft, or begin guided setup.
2. **Purpose** — name the assistant, accountable human owner, active banking journey, intended job, languages and minimum data scope.
3. **Boundaries** — reduce permitted actions; bind optional work plans, approved knowledge and separately governed memory; select the approved model, commercial plan and workload identity.
4. **Review** — read a plain-language scope and readiness summary before creating a pending installation.

Forward movement validates the current stage. Users may move backward without losing the in-page draft. A persistent summary shows pattern, owner, journey and action count. Submission moves the user to Operations and states that the assistant remains inactive and proposal-only.

Copying never copies approvals or activation. Guided setup never creates new authority. The selected template remains the maximum action envelope, active tenant journeys remain server-enforced and exact governance checks remain authoritative.

## Interaction and accessibility contract

- Native headings, landmarks, fieldsets, labels, descriptions and live regions provide a coherent screen-reader outline.
- Workspace navigation supports Left/Right and Up/Down arrow keys plus Home/End. Builder stages are real buttons with `aria-current="step"`.
- Every interactive control has visible keyboard focus. Reduced-motion preferences disable entrance and status transitions.
- Desktop uses a persistent rail and contextual utility bar. Narrow layouts use an intentionally scrollable workspace strip while the document itself has no horizontal overflow.
- Role filtering appears only in Operations and explicitly states that it changes the view, not server permissions.
- Review references, retirement reasons and suspension evidence use an in-product modal with labelled fields, Cancel and Confirm actions. Native browser prompts are prohibited.
- Success and failure feedback uses one dismissible live status surface. Restrictive/error states use the danger palette and never appear reassuring.
- Empty states explain what is absent and what will appear, instead of leaving blank containers.

## Control and maturity boundary

The redesigned interface does not change agent autonomy, approval, policy, tenant isolation or production admission:

- assistants remain proposal-only and cannot approve credit, set price, move funds or change policy;
- every material completed proposal still requires an authenticated human disposition;
- synthetic rehearsal proves configuration and release wiring, not live-model quality;
- a published version is immutable configuration evidence, not provider certification;
- repository admission controls do not replace external evidence authenticity, tenant UAT or institution production authorization;
- API and domain enforcement remain authoritative when the interface and server disagree.

## Verification and future evidence

`tests/agent-studio-ui.test.js` now syntax-checks the browser bundle and rejects duplicate critical handler declarations. Focused UI, domain and API coverage runs alongside browser checks at desktop and 390-pixel mobile widths. The responsive check requires one visible workspace and no horizontal document overflow.

Future usability evidence should measure time to find owned work, completion and correction rates per builder stage, abandonment caused by missing upstream approvals, keyboard-only completion, and comprehension of proposal-only versus production-ready states. Those observations may refine wording and sequencing, but cannot weaken the control boundaries above.
