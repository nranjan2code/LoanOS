# Role-specific operational workspaces

Status: controlled application/UI slice · last verified 2026-07-18

## Decision

LoanOS exposes one canonical tenant-scoped staff surface at `/t/{tenantId}/staff/workspaces`. It reuses the existing workflow-task authority and explicit tenant registries instead of creating separate servicing, collections, control or partner applications with their own state.

There is no backward-compatible `/dashboard/` entry point. This is a greenfield system: tenant identity is mandatory in every application URL, assets resolve beneath the tenant staff path, and new HTTP behavior belongs in a route module rather than an inline `server.js` handler.

## Implemented boundary

The workspace has five server-projected desks:

| Desk | Governed projection |
| --- | --- |
| Origination | Applications, journey capture, composed lifecycle, specialist cases/exceptions, disbursement tranches and application/KYC/credit/disbursement tasks. |
| Servicing | Loan accounts, service changes/documents, succession actions, complaints, privacy requests, closure releases and servicing/grievance tasks. |
| Collections & field | Treatment, portfolio allocation, legal recovery, repossession, auction, agency settlement, recovery accounting and collections tasks. |
| Control functions | AML, fraud, portfolio risk, RCSA, model monitoring, finance/reconciliation exceptions, regulatory/tax returns, CIC/CKYCRR/FIU and data-quality work. |
| Partner operations | Partner onboarding, credentials, conduct, finance disputes, leads, commission/oversight and LSP incidents. |

`GET /operational-workspaces?view={id}` derives the authenticated actor from the tenant session. The response lists only desks authorized by the actor's roles and queues; a direct request for another desk is denied. A workflow task is returned only when the actor has its required role and queue, can assign that queue, or holds the governed administrative/workflow-admin authority. Non-task registries are reduced to bounded scalar identifiers, status, owner and time metadata; raw records, nested objects and customer fields are never serialized through this projection.

The browser can call only the canonical task lifecycle endpoints:

- `POST /workflow/tasks/{id}/assignments`
- `POST /workflow/tasks/{id}/start`
- `POST /workflow/tasks/{id}/release`
- `POST /workflow/tasks/{id}/comments`

The authenticated session supplies actor authority. The client cannot name itself as another actor. Eligible assignees come from the non-admin-sensitive `/staff/actors` projection. A task's declared domain action is shown as method/path guidance, but the workspace does not manufacture an evidence payload or treat task state as domain completion.

## Service ownership and server cleanup

- `apps/api/src/routes/operational-workspaces.js` owns privacy-safe desk projection and the non-admin-sensitive staff-assignee projection.
- `apps/api/src/routes/workflow-tasks.js` owns task list/read/lifecycle HTTP behavior extracted from `server.js`.
- `packages/core/src/journeys/workflow-tasks.js` remains the domain source for derived tasks, SLA state and lifecycle transitions.
- `apps/dashboard/workspaces.*` owns the accessible browser experience.
- `apps/api/src/server.js` retains authentication, tenant resolution, mutation staffing enforcement and route dispatch; it must not regain domain handlers extracted into route modules.

Remaining inline LOS/LMS/compliance handlers in `server.js` are migration debt. Because no compatibility period is required, each extraction deletes the old handler in the same change and tests only the canonical route. Aliases, duplicate-read periods and fallback dispatch are prohibited.

## Privacy, accessibility and failure behavior

- No local storage, session storage, IndexedDB, service worker or browser business-data cache is used.
- Offline state disables mutations; work is never queued with browser-held PII.
- UI content is constructed through `textContent`/DOM APIs, not HTML injection sinks.
- Tables, live status, keyboard-selectable rows, visible focus, responsive layout and reduced-motion behavior are part of the checked UI contract.
- Service identities and staff without authority for the requested desk cannot open the workspace projection. Missing or invalid tenant-human authority returns `403`.
- Unknown desks return `422`; unavailable data leaves the screen visibly failed rather than empty-successful.
- Screen activity emits bounded screen/action identifiers only, never task comments, customer values or record payloads.

## Evidence

- `tests/operational-workspaces.test.js` covers static accessibility/privacy contracts, tenant-human authorization, role-filtered task and safe-record projection, non-leakage, assignment/start/comment lifecycle, canonical static routing and absence of the legacy dashboard alias.
- Existing workflow tests continue to cover role, queue, actor binding, SLA, release and domain completion behavior.
- `apps/help/help.js#work-queues` is the canonical operating guide and records the remaining production boundary.

## Remaining boundary

This closes a deeper reusable UI slice, not all UX or production readiness. Remaining work includes specialist evidence forms for each declared domain action, complete case timelines and document panels, institution design validation, translated operating content, independent accessibility/security/privacy certification, durable multi-replica queue metrics, and JD-05 generated browser/API/PostgreSQL happy/adverse/recovery execution for every current journey version. JD-06 live providers and production operations remain separate.
