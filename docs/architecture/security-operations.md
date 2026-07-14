# SIEM, SOC, and Security Investigation Operations

## Purpose

This audit-backed platform control plane governs detection rules, security alerts, SOC triage, investigations, evidence preservation, response transitions, and log-source coverage. It accepts references and checksums from a SIEM/evidence vault; it does not replace those production systems. Tenant incident ids and platform support-case ids are retained as lineage, while regulatory notification and service workflows remain governed by their own state machines.

Implementation: `packages/core/src/security-operations.js`; authenticated routes: `apps/api/src/server.js`.

## Detection and alert controls

- A rule version requires name, description, severity, covered log sources, detection/query reference, playbook, owner, test evidence and independent maker-checker approval.
- Supported source families are identity, application, audit, database, cloud, network, endpoint, provider and decision engine.
- An alert must reference an active rule version and one of its declared sources. Severity is inherited from the rule, not supplied by the alert producer.
- Each alert retains tenant/entity references, source event checksum, evidence reference, observed time and deduplication key. A duplicate unresolved signal fails closed.
- Acknowledgement targets are 15 minutes for critical, 30 for high, 120 for medium and 480 for low; late triage remains visibly breached.
- Benign/false-positive dismissal requires independent review and approval evidence. Suspicious/confirmed signals escalate and cannot be cleared by dismissal fields.

## Investigation and evidence lifecycle

An investigation must reference one or more escalated alerts. It may link an existing tenant incident and support case, but does not mutate either. Severity is derived as the most restrictive linked-alert severity.

The response lifecycle is:

`investigating → contained → eradicated → recovered → closed`

Containment and eradication require action lists and evidence. Recovery requires restoration and monitoring evidence. Closure requires root cause, lessons, detection-rule changes, closure evidence, approval, and an actor independent of recovery. Recovery may return to eradication if monitoring detects recurrence.

Preserved evidence requires source, India-resident storage reference, content SHA-256, collector/time, retention date and optional legal hold. Evidence entries are hash-linked in collection order using the prior evidence hash. This detects local record alteration; production WORM custody and external timestamping remain separate controls.

## Detection and logging coverage

A four-eyes coverage assessment declares required source families and tests each for active ingestion, at least 180 days retention and trusted-time evidence. Missing, inactive, short-retention or unsynchronized sources become explicit gaps. Any gap requires remediation actions. This supports CERT-In logging readiness but does not itself retain logs or operate NTP.

## Operating sequence

1. Approve and test a detection rule against its documented playbook and expected sources.
2. Ingest an alert with the immutable source-event checksum and evidence reference.
3. Acknowledge/triage within severity SLA. Independently review any dismissal.
4. Escalate suspicious/confirmed alerts into an investigation; open/link the governed tenant incident when regulatory or customer impact may apply.
5. Preserve original evidence before containment. Use India-resident immutable custody and legal hold where required.
6. Record containment, eradication and recovery evidence in order. Continue monitoring before independent closure.
7. Feed lessons into detection-rule changes, vulnerability/problem records, and coverage remediation.
8. Periodically assess every required log source for ingestion, retention and time synchronization.

## Production completion gaps

Bundle E can now certify supported log-source families for authenticated schema-bound collection, encryption, centralized trusted time, searchable immutable India custody and at least 180 days' retention. Production still requires the actual India-hosted SIEM/log lake, collectors, NTP, WORM/eDiscovery tooling, telemetry, correlation/UEBA and threat-intelligence feeds, alert routing, SOAR, forensics, vault access controls, SOC staffing/quality, hunting, exercises, and demonstrated effectiveness.
