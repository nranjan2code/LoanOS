# Completion Workstreams: Channel, Partner Finance, Identity, and Succession Operations

## Scope

This parallel delivery wave closes four application/control-plane gaps without weakening tenant isolation, exact-money handling, maker-checker controls, or external-provider boundaries.

## Executable controls

| Workstream | Controls now executable | Remaining production boundary |
| --- | --- | --- |
| Channel/CRM | Tenant-local partner onboarding and approval; expiring portal/API/PWA credentials and revocation; field hierarchy; territory/capacity allocation; complete active-access certification; evidence-bound conduct cases and suspension recommendation. | Partner-facing administration UX, database RLS evidence, IAM provisioning adapters, HR/territory feeds, independently sourced performance telemetry. |
| Partner finance | GST/TDS-evidenced commission invoices; exact integer-paise balanced payable/GL instructions; beneficiary-gated bank files; payment reconciliation; period statements; disputes; independently approved reversals with idempotency. | GSTN/bank/CBS adapters, e-invoice conformance, actual GL posting acknowledgement, payment signing, dispute workflow staffing and statutory tax filing. |
| Customer identity | Explicit per-field survivor/duplicate/manual decisions; external identity conflict/reassignment evidence; profile-version and review-checksum execution guard; snapshot-checksum rollback; idempotent merge/rollback; checksum-sealed outbox events. | Operator conflict-resolution UI, certified identity-provider adapters, durable broker dispatch/replay, expanded cross-domain reference migration and production concurrency testing. |
| Succession operations | Certified court/registrar/legal-document/mandate/notification instructions; payload checksum and idempotency; signature-verified callback reconciliation; assigned legal and external queues; SLA breach, escalation, capacity and utilization evidence. | Live court/registrar/provider contracts and schemas, callback signature verifier integration, workforce feeds, escalation delivery and witnessed legal operations. |

## API boundary

`GET /completion/operations` returns the tenant-local joined projection. Mutations under `/completion/channel/*`, `/completion/partner-finance/*`, `/completion/customer-identity/*`, and `/completion/succession/*` are role-gated and audit appended. `GET /completion/succession/queue` derives the current SLA/capacity view.

External instruction submission requires an active, unexpired provider certification for the exact connector family. Callback state cannot advance unless provider request reference, submitted payload checksum and signature-verification evidence all match.

## Verification

Focused suites cover channel governance, partner finance, customer identity, succession operations and HTTP persistence. The repository-wide dashboard command remains the release gate and regenerates the capability catalogue, trace and dashboard from their shared source.
