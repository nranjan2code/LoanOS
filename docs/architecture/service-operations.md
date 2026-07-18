# Service Operations and Vendor Oversight

## Purpose and scope

This control-plane slice gives LoanOS operators an auditable system of record for support, on-call ownership, escalation, recurring-problem remediation, vendor reviews, service-level measurement, and dependency concentration. It complements tenant incidents and runtime monitoring: alerts can lead to a support case, and a case may reference an existing incident, but neither workflow silently changes the other.

The implementation is in `packages/core/src/operations/service-operations.js`; authenticated platform routes are in `apps/api/src/server.js`. Current state is projected deterministically from append-only `controlPlane.platformEvents`, so each mutation also participates in the platform audit hash chain.

## Support-case lifecycle

1. Create a case with severity (`sev1`–`sev4`), category, tenant/incident references where applicable, affected services, channel, narrative, and a runbook reference.
2. Default acknowledgement/restoration/resolution clocks are severity-specific. An explicit ordered SLA may be supplied for a contracted service.
3. Assignment records the on-call owner, support team, escalation policy, assigning actor, and time.
4. Acknowledgement, investigation, monitoring/restoration, resolution, and closure are explicit transitions. Invalid transitions fail closed.
5. Escalation levels must increase from 1 through 3 and retain target, reason, actor, and time.
6. Resolution requires a specific summary and evidence reference. Closure requires an independent actor and approval reference.
7. Read projection calculates each SLA leg as `pending`, `met`, or `breached`; it never hides a missed deadline after resolution.

Severity defaults are intentionally policy data exposed by the core module: sev1 is 15 minutes to acknowledge, 4 hours to restore, and 24 hours to resolve; sev2 is 30 minutes/8 hours/48 hours; sev3 is 4 hours/24 hours/5 days; sev4 is 8 hours/48 hours/10 days. A production operating policy must approve any different contractual targets.

## Problem management

A problem record must reference at least one known support case and retains related incident lineage. It moves through `investigating`, `known_error`, `remediation_in_progress`, `resolved`, and `closed`. Root cause is mandatory before known-error/remediation states; resolution requires corrective actions and verification evidence; closure requires independent approval. This separates immediate restoration from systemic correction.

## Vendor controls

Each active vendor profile records dependency type and tier, services, affected tenants, owner, contract, SLA targets, due-diligence and exit-plan evidence, review cadence, residency, and alternate-provider posture. A sub-processor profile must reference the standing sub-processor register. Non-India processing is not silently prohibited, but it fails validation without an explicit cross-border approval reference.

Periodic review evidence covers due diligence, security assessment, BCP test, exit readiness, approval, findings, and actions. Findings without actions fail closed. SLA assessments retain the observation window, targets, measured availability/response/restoration, incident count, evidence, and a derived `met` or `breached` outcome.

Concentration assessment groups active vendors by dependent service and calculates each vendor's share of the declared tenant universe. It flags threshold breaches, critical vendors without an alternate, and overdue reviews. This is an operational exposure signal, not a substitute for portfolio-value, geographic, fourth-party, or legal concentration assessment.

## Access and operating procedure

- Platform admin and security roles may create or transition records; auditors have read-only access.
- Actor fields are bound to the authenticated platform principal for support, problem, review, and assessment actions.
- Use `GET /platform/service-operations` for the current projection and SLA state.
- Open a tenant incident separately when regulatory notification or security response clocks apply, then retain its id on the support case/problem.
- Treat an SLA breach or concentration `action_required` outcome as an input to governance. This slice records evidence; it does not alter vendor contracts or reroute production traffic.

## Production follow-ons

- ITSM/help-desk intake, email/portal channels, paging schedules, roster handover, acknowledgement and suppression integrations.
- Status-page and tenant communication workflow linked to incident command.
- Procurement/contract repository, invoice/service-credit tracking, vendor-risk feeds, fourth-party register, and automated review reminders.
- Telemetry-fed SLA measures instead of operator-supplied evidence, plus independent assurance of calculations.
- Portfolio-value, transaction-volume, region, cloud, telecom, bank, and common fourth-party concentration models with approved risk appetite.
- Tested 24x7 staffing, runbooks, escalation drills, service reviews, and contractual enforcement.
