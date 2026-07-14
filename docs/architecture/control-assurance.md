# Compliance Control Assurance and Audit Workspace

## Purpose

This platform control plane turns the regulatory control library into a reviewable testing and assurance lifecycle. It governs test plans, populations and samples, workpapers/results, deficiencies and remediation, control-owner certification, internal/statutory/RBI engagements, evidence requests, and board/committee reporting. Current state is reconstructed from append-only platform audit events.

Implementation: `packages/core/src/control-assurance.js`; authenticated platform routes: `apps/api/src/server.js`.

## Control testing lifecycle

1. An assurance plan declares period, frequency, regulatory control ids, methodology, sample strategy and owner. Only ids present in `REGULATORY_CONTROLS` are accepted, and plan approval is maker-checker.
2. A test must belong to an active plan covering the control. It retains population/sample sizes, sample/procedure/workpaper references, evidence, tester/time and `effective` or `deficiency` result. A deficiency cannot be recorded without findings.
3. A deficiency issue must reference a deficient test and retains severity, accountable owner, due date and remediation plan.
4. Issues progress `open → in_remediation → remediated → verified → closed`. Change and remediation evidence are mandatory; verification must be independent of remediation; closure must be independent of verification.

## Certification and sign-off

A control owner certifies a completed period using tests and evidence for that exact control. An `effective` certification cannot contain a deficient test. An `exception` certification must name the related assurance issues. Certification remains pending until an independent actor signs it with an approval reference. Future periods cannot be certified.

## Audit and inspection workspace

Engagement types are internal audit, statutory audit, RBI inspection and regulatory review. Each engagement records authority, scope, period, owner and evidence requests with accountable owners and due dates. Requests require narrative response and evidence before fieldwork can complete. The lifecycle is:

`planned → in_progress → fieldwork_complete → responded → closed`

Closure requires an actor independent of management response, closure report and approval evidence, and every linked assurance issue must already be closed. Unknown issue links fail closed.

## Board and committee pack

The governance pack derives period metrics from the current assurance projection: test effectiveness/deficiencies, open and overdue issues, approved certifications, open engagements, and critical/high exceptions. It retains source evidence, independent approval and a SHA-256 digest over the normalized pack body. A future reporting period is rejected.

The pack is structured evidence, not a rendered board paper. Narrative commentary, risk appetite, trend analysis, financial/materiality context and meeting minutes remain governance responsibilities.

## Operating sequence

1. Approve the annual/quarterly plan against the canonical regulatory controls and institutional methodology.
2. Freeze the population and sample reference before testing; retain source evidence and workpaper.
3. Record deficiencies without suppressing them. Create an owned, dated issue for every material finding.
4. Track remediation through change evidence and independent retest/closure.
5. Obtain control-owner certification and independent compliance/risk sign-off after period end.
6. Run audit/inspection requests through the engagement workspace and preserve exact response evidence.
7. Generate and independently approve the committee pack; reconcile its checksum and source snapshot before circulation.

## Production completion gaps

Production still requires a configurable obligation/control hierarchy below the current regulatory-family ids, policy/risk/control mapping, recurring scheduler and reminders, statistically governed sampling, direct evidence connectors, document/workpaper repository and retention, materiality/risk-rating methodology, issue aging/escalation and risk acceptance, auditor segregation and confidential workspaces, regulator portal/correspondence integration, electronic signature, rendered packs and minutes/action tracking, trend/KRI dashboards, WORM/external timestamping, audit universe and annual planning, and operating-effectiveness validation by independent compliance/internal audit teams.
