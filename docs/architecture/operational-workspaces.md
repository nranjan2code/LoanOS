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

The browser loads an authoritative task detail through `GET /workflow/tasks/{id}` and refuses specialist execution if its method/path differs from the queue projection. Tenant-user task list/detail reads are themselves role/queue filtered and return privacy-safe not-found for unauthorized task IDs. Task ownership remains on the canonical lifecycle endpoints:

- `POST /workflow/tasks/{id}/assignments`
- `POST /workflow/tasks/{id}/start`
- `POST /workflow/tasks/{id}/release`
- `POST /workflow/tasks/{id}/comments`

The authenticated session supplies actor authority. The client cannot name itself as another actor. Eligible assignees come from the non-admin-sensitive `/staff/actors` projection.

For a task with a mutable declared domain action, the specialist panel provides task-type guidance, a contract-key skeleton and an in-memory JSON editor. Submission is disabled until authoritative detail is loaded, the projected and detailed contracts match exactly, JSON is a bounded object, the network is available and the operator explicitly attests that they reviewed the evidence boundary. The request goes only to the same-origin method/path declared by the task; the owning API performs all validation and can reject it. The workspace never marks domain completion itself.

The inspector also renders a task timeline from authoritative timestamps, allow-listed evidence/reference/checksum scalars from task context, regulatory references, and assignment/start/release/comment audit events. Metadata-only records expose none of their payload, document bytes, history or domain actions.

## Service ownership and server cleanup

- `apps/api/src/routes/operational-workspaces.js` owns privacy-safe desk projection and the non-admin-sensitive staff-assignee projection.
- `apps/api/src/routes/workflow-tasks.js` owns role/queue-filtered task list/read and lifecycle HTTP behavior extracted from `server.js`.
- `packages/core/src/journeys/workflow-tasks.js` remains the domain source for derived tasks, SLA state and lifecycle transitions.
- `apps/dashboard/workspaces.*` owns the accessible browser experience.
- `/status/` exposes the generated repository capability/build dashboard and is linked from staff, borrower, partner and tenant portal headers; it must not be described as production uptime or tenant-readiness evidence.
- `apps/api/src/server.js` retains authentication, tenant resolution, mutation staffing enforcement and route dispatch; it must not regain domain handlers extracted into route modules.

Remaining inline LMS/compliance handlers in `server.js` are migration debt; the loan-origination handlers are now fully extracted across intake, underwriting, contracting and channel route modules. Because no compatibility period is required, each extraction deletes the old handler in the same change and tests only the canonical route. Aliases, duplicate-read periods and fallback dispatch are prohibited.

## Privacy, accessibility and failure behavior

- No local storage, session storage, IndexedDB, service worker or browser business-data cache is used.
- Offline state disables mutations; work is never queued with browser-held PII.
- Specialist payload drafts and attestations exist only in page memory and reset on authoritative reload.
- UI content is constructed through `textContent`/DOM APIs, not HTML injection sinks.
- Tables, live status, keyboard-selectable rows, visible focus, responsive layout and reduced-motion behavior are part of the checked UI contract.
- Service identities and staff without authority for the requested desk cannot open the workspace projection. Missing or invalid tenant-human authority returns `403`.
- Unknown desks return `422`; unavailable data leaves the screen visibly failed rather than empty-successful.
- Screen activity emits bounded screen/action identifiers only, never task comments, customer values or record payloads.

## Evidence

- `tests/operational-workspaces.test.js` covers static accessibility/privacy contracts, tenant-human authorization, role-filtered task list/detail and safe-record projection, non-leakage, assignment/start/comment lifecycle, canonical static routing and absence of the legacy dashboard alias.
- `tests/operational-workspaces-ui.test.js` pins authoritative contract matching, reviewed in-memory JSON submission, representative domain contracts, timeline/evidence/audit panels, safe DOM, offline blocking and responsive/reduced-motion behavior.
- Existing workflow tests continue to cover role, queue, actor binding, SLA, release and domain completion behavior.
- `apps/help/help.js#work-queues` is the canonical operating guide and records the remaining production boundary.

## Remaining boundary

This closes the reusable specialist-action, task-timeline and task-evidence UI slice, not all UX or production readiness. Metadata-only domain records still require purpose-specific record-detail/history APIs and governed document-byte viewers; partner operations needs derived workflow action contracts; contract guidance remains client-maintained rather than a versioned server form schema. Institution design validation, translated operating content, independent accessibility/security/privacy certification and durable multi-replica queue metrics remain. JD-05 now has a 1,071-case generated matrix plus file/API, static-browser-contract and optional PostgreSQL/RLS execution, but interactive browser lifecycle and downstream policy/accounting/reporting/repayment/closure/rollback executors remain. JD-06 live providers and production operations remain separate.
