# Agent Studio and Workspace Production-Integration Review (2026-07-22)

Source: a code, architecture, API, workflow and focused-test review of Agent Studio,
the AI-agent control plane and the canonical role-specific operational workspaces.

This is the authoritative work-item list for moving these surfaces from an
executable governed first slice to a production-integrated digital-worker
platform. The roadmap and Epic 8 link here rather than restating item status.
`ASW-n` is a document-local identifier scheme and is not an engine `INV-n`
scheme.

## Baseline verdict

The current product is materially beyond a screen mock: it has tenant-scoped
installations, eleven bounded templates, exact-paise budgets, independent
approval, synthetic adverse rehearsals, immutable versions, proposal-review
queues, provider-admission metadata and fail-closed decision traces. Focused
Agent Studio, governance, rehearsal and workspace tests pass.

It is not yet a production digital-worker platform. There is no connected live
model/agent worker; specialized policies are callable but are not enforced at
retrieval, communication, credit-handoff and mutation call-sites; the browser
still gathers several specialist actions as raw JSON using client-maintained
contracts; knowledge and memory governance records do not yet operate a real
retrieval or personal-data plane; scheduled containment and notifications are
not deployed; and external evidence references are metadata rather than
authenticated artifact custody. The first production claim must therefore be a
single witnessed vertical slice, not a broad marketplace claim.

## Status and priority

- **Status:** `TODO` · `IN PROGRESS` · `DONE` · `DECIDE` · `BLOCKED`.
- **Priority:** `P0` trust/production blocker · `P1` required for the first live
  institutional slice · `P2` scale and commercial completion.
- Update the summary row and detail block together. `DONE` requires the named
  evidence, not only merged code or a passing simulator.
- Capability maturity remains owned by the capability catalogue and
  `add-capability`; completing an item here does not automatically make its
  linked capability `Implemented`.

## Summary

| ID | Work item | Surface | Priority | Wave | Status | Capability anchors |
| --- | --- | --- | --- | --- | --- | --- |
| ASW-01 | Deploy the live India-resident worker and provider adapter | Runtime | P0 | 0 | IN PROGRESS | AIG-022 |
| ASW-02 | Enforce specialized guardrails at every retrieval, dispatch, handoff and write | Runtime/domain | P0 | 0 | IN PROGRESS | AIG-020, AIG-024 |
| ASW-03 | Move AI records and jobs to transactional, concurrent, idempotent persistence | Platform | P0 | 0 | IN PROGRESS | AIG-021, AIG-022 |
| ASW-04 | Replace the broad Studio admin gate with operation-level RBAC and SoD | Security | P0 | 0 | IN PROGRESS | AIG-019, AIG-025 |
| ASW-05 | Build the governed knowledge ingestion, retrieval and citation plane | Resources | P1 | 1 | TODO | AIG-018, AIG-025 |
| ASW-06 | Build the privacy-rights-complete persistent memory plane | Resources | P1 | 2 | TODO | AIG-018, AIG-025 |
| ASW-07 | Run live-provider, multilingual and adversarial evaluation gates | Validate | P1 | 1 | TODO | AIG-006, AIG-023 |
| ASW-08 | Close the proposal-review-to-owning-domain-command loop | Studio/workspace | P1 | 1 | TODO | AIG-010, AIG-021, AIG-025 |
| ASW-09 | Replace metadata/raw-JSON operations with versioned forms, records and evidence viewers | Workspace | P1 | 1 | TODO | AIG-025, AUD-002 |
| ASW-10 | Deploy expiry, monitoring, containment and notification schedules | Operations | P1 | 2 | TODO | AIG-007, AIG-011, AIG-023 |
| ASW-11 | Add production SLOs, telemetry, incident impact and recovery drills | Operations | P1 | 2 | TODO | AIG-011, AIG-015, AIG-021 |
| ASW-12 | Bind admission to authenticated evidence artifacts and current external certification | Controls | P1 | 1 | TODO | AIG-005, AIG-022, AUD-003 |
| ASW-13 | Validate the complete staff experience with institution users and assistive technology | Experience | P1 | 2 | TODO | AIG-025, UX-005 |
| ASW-14 | Govern template authoring, promotion, deprecation and tenant impact | Marketplace | P2 | 3 | TODO | AIG-016, AIG-018 |
| ASW-15 | Complete billing, tax, accounting and cost-reconciliation integration | Commercial | P2 | 3 | TODO | AIG-017 |
| ASW-16 | Certify one end-to-end CAM worker as the production reference slice | Release | P1 | 3 | TODO | AIG-022, AIG-023, AIG-024, AIG-025 |

## Wave 0 — Production trust gates

### ASW-01 — Deploy the live India-resident worker and provider adapter · P0 · IN PROGRESS

**Implementation update (2026-07-22):** the Bedrock adapter now accepts only an
explicit injected live client in `ap-south-1`; the former fabricated-success
fallback is removed and unavailable, malformed and wrong-region paths fail
closed. Deployment, private-network/KMS evidence and a witnessed non-demo run
remain outstanding, so this item is not `DONE`.

**Current evidence/gap:** `DigitalWorkerProvider` constrains region, model,
authorization, output schema, timeout and metering, but the only executable
provider path is explicit demo mode. No live Bedrock/Strands/AgentCore worker is
connected or deployed.

**Scope:** select and pin an approved model/embedding profile in `ap-south-1`;
implement the LoanOS-owned live provider adapter; run a durable tenant-fenced
worker with workload identity, private endpoints, KMS/secret custody, egress
deny-by-default, cancellation, bounded retries, lease fencing and DLQ; prohibit
cross-region inference and silent provider/model fallback.

**Acceptance/evidence:** a non-demo execution runs through the same authorize →
invoke → complete → meter path; provider-native timeout, throttle, malformed
output, cancellation and unavailability all fail closed; duplicate delivery
cannot duplicate a model charge or proposal; deployed health/readiness,
multi-replica race, soak and recovery evidence is retained; India processing,
telemetry and backup paths are witnessed for the selected features and model.

### ASW-02 — Enforce specialized guardrails at every retrieval, dispatch, handoff and write · P0 · IN PROGRESS

**Implementation update (2026-07-22):** a versioned, provider-neutral tool
catalogue now maps retrieval, dispatch, underwriting handoff and case-change
proposal tools to exact specialized decision keys and validates tenant,
installation, workload, trace, ruleset and outcome before invoking a port.
Direct worker dispatch/write remains prohibited. Production domain ports still
need to adopt the catalogue before the no-bypass acceptance condition is met.

**Current evidence/gap:** `data_access`, `outbound_communication`,
`underwriting_influence` and `case_mutation` policies have deterministic corpora,
but the live provider/domain call-sites that must consume them do not yet exist.

**Scope:** create one versioned tool catalogue declaring input/output schema,
data classification, read/write authority, allowed workload identities and
required policy; call the applicable tenant engine immediately before retrieval,
message dispatch, credit-workflow handoff or case mutation; carry the exact trace
and ruleset into execution lineage. A model or sub-agent may narrow authority but
may never add a tool, tenant, purpose, data field or action.

**Acceptance/evidence:** every registered tool has a policy mapping and adverse
corpus; an unmapped tool or missing/malformed/stale/denied decision is
unexecutable; tests prove cross-tenant retrieval, prompt-injected tool choice,
unapproved outbound content, underwriting authority escalation and direct writes
are denied or require a human as defined by policy; no production call-site can
bypass the catalogue.

### ASW-03 — Move AI records and jobs to transactional, concurrent, idempotent persistence · P0 · IN PROGRESS

**Implementation update (2026-07-22):** runtime jobs now have content
idempotency, monotonic aggregate revision, lease fencing, bounded retry, DLQ,
independent replay, health projection and exactly-once execution completion plus
usage finalization. Scoped runtime endpoints are present. Entity-level
PostgreSQL/RLS records, CAS race tests, outbox custody and selected-environment
backup/PITR evidence remain outstanding.

**Current evidence/gap:** AI mutations currently load, replace and save the
tenant AI platform aggregate. This is adequate for the controlled slice but does
not establish entity-level concurrency, crash-safe job execution or a durable
event publication boundary under multiple replicas.

**Scope:** add tenant-RLS PostgreSQL records for installations, versions,
approvals, resources, evaluations, executions, reviews, usage and incidents;
require monotonic revisions/CAS and unique content-idempotency keys; atomically
commit state, audit and outbox events; implement lease-fenced execution jobs,
bounded retry, DLQ and independent replay; retain the file driver only as an
explicit non-production profile.

**Acceptance/evidence:** PostgreSQL race tests prove a single approval,
activation, invocation, review, rollback and usage finalization wins; stale
writers receive a conflict and cannot erase newer evidence; restart between
provider response and finalization recovers exactly once; RLS isolation and
backup/restore/PITR are exercised against the selected environment.

### ASW-04 — Replace the broad Studio admin gate with operation-level RBAC and SoD · P0 · IN PROGRESS

**Implementation update (2026-07-22):** the Studio route now owns an explicit
namespace and defaults unclassified operations to deny. Commercial, resource,
provider, evaluation, release, installation, review and runtime operations have
separate role/principal rules; auditors are read-only and workload identities
are limited to the declared runtime operations. The exhaustive endpoint matrix,
authentication-strength/stale-session cases and time-bound emergency review are
still required for `DONE`.

**Current evidence/gap:** the route boundary broadly permits tenant admin,
security admin or operator mutations, with finer role enforcement concentrated
on the four activation approvals. Commercial, resource, evaluation, provider,
release and incident duties therefore need an explicit operation matrix.

**Scope:** map every read/mutation to canonical roles, feature staffing,
authentication strength and maker/checker separation; distinguish interactive
human, worker, scheduler and evidence-verifier endpoints; default every
unclassified operation to deny; include time-bound emergency access and its
independent review without letting break-glass approve a release.

**Acceptance/evidence:** route-level tests cover every endpoint × principal type
× role class, including stale/revoked sessions; commercial actors cannot approve
models, builders cannot approve their resources or releases, operators cannot
approve provider evidence, service identities cannot perform human governance,
and auditors remain read-only; all denials and emergency use are audit-attributed.

## Wave 1 — One complete worker journey

### ASW-05 — Build the governed knowledge ingestion, retrieval and citation plane · P1 · TODO

**Current evidence/gap:** Studio can approve a source reference and checksum, but
does not yet ingest, scan, classify, index, retrieve or prove access to the
governed content used by a model.

**Scope:** add connector/upload ingestion into an India-resident immutable
evidence store; malware and content-type validation; OCR/normalization;
classification, purpose and entitlement checks; checksum/version-preserving
chunking and a tenant-isolated index; retrieval-time policy; citation projection;
expiry/revocation re-indexing and dependent-installation containment.

**Acceptance/evidence:** an answer citation resolves to exact source bytes,
version, page/section, checksum and access decision; deleted, expired,
superseded, cross-tenant or unauthorized content cannot be retrieved; index and
object-store isolation, deletion, re-index, injection and poisoned-document
tests pass; retrieval traces contain no raw borrower data in general logs.

### ASW-07 — Run live-provider, multilingual and adversarial evaluation gates · P1 · TODO

**Current evidence/gap:** rehearsals correctly prove configuration wiring and
restrictive paths, but are synthetic and cannot establish model quality.

**Scope:** govern representative task corpora and holdouts for English and the
institution's required Indian languages/dialects; measure groundedness,
completeness, factuality, refusal, human-handoff quality, fairness, latency and
cost; include prompt injection, exfiltration, cross-tenant, tool misuse,
excessive-agency, hallucination and denial-of-wallet attacks; calibrate automated
evaluators against independent human review.

**Acceptance/evidence:** the exact installation version runs against the live
provider in an isolated evaluation environment; release thresholds and
confidence intervals are approved before activation; failed safety cases block
release; scheduled cohorts detect regression and can suspend automatically;
datasets, evaluator versions, raw protected evidence and signed result packs are
reproducible under retention controls.

### ASW-08 — Close the proposal-review-to-owning-domain-command loop · P1 · TODO

**Current evidence/gap:** completed proposals create a human-review task and the
disposition removes it, but an accepted proposal is not yet a typed,
evidence-bound command in the owning loan workflow.

**Scope:** render proposal, supporting facts, source citations, configuration and
policy lineage side by side; support accept, reject and return-for-change with
reason codes and annotations; on acceptance, translate only allow-listed fields
into a server-versioned owning-domain command, then re-check human authority,
current case state, idempotency and deterministic policy. AI acceptance must not
become sanction, pricing, disbursement or policy approval.

**Acceptance/evidence:** one CAM proposal travels from an application trigger to
an authenticated credit reviewer and the canonical application action; the task
closes only after the owning API commits or records a visible rejection; stale
facts/version/policy or changed evidence block submission; the timeline links
execution, proposal, annotations, disposition, domain command and resulting
audit event without copying borrower data into general logs.

### ASW-09 — Replace metadata/raw-JSON operations with versioned forms, records and evidence viewers · P1 · TODO

**Current evidence/gap:** operational desks intentionally project safe metadata;
task actions rely on client-maintained field lists and an in-memory JSON editor.
Purpose-specific record history, governed document bytes and partner action
contracts remain absent.

**Scope:** let owning APIs publish checksum-bound display/action schemas with
classification, validation, help and conditional fields; render accessible typed
forms rather than raw JSON; add authorized record detail/history and
watermarked, malware-scanned document/evidence viewers; complete partner task
contracts; add cursor pagination, server search/filter/sort, stable deep links,
saved views and conflict-safe server drafts.

**Acceptance/evidence:** no production operator needs to construct JSON; the
client submits only the exact schema/version loaded from the task; field-level
redaction and download authorization are server enforced; stale schemas and
records fail closed; queues remain responsive at the selected tenant-volume
profile; browser tests cover task → evidence → form → result across every desk.

### ASW-12 — Bind admission to authenticated evidence artifacts and current external certification · P1 · TODO

**Current evidence/gap:** provider admission checks current approved metadata,
but references do not authenticate external artifact content or prove that the
selected provider/model/deployment was witnessed.

**Scope:** consume the governed evidence-artifact registry with immutable India
custody, checksum, trusted timestamp, source, witness, classification and expiry;
bind contracts, security/residency reviews, UAT, monitoring, incident/DR tests,
model endpoints, embeddings, guardrails and deployment checksum to the exact
installation; reassess on artifact suspension, expiry or configuration drift.

**Acceptance/evidence:** free-text references cannot satisfy admission; artifact
content hash and signer/custodian are verified; synthetic/demo evidence is
categorically ineligible for production; admission joins provider, deployment,
institution, model, resource and evaluation evidence and denies within the
documented expiry/drift SLA; an independent institution release record remains
mandatory.

## Wave 2 — Operate safely at institution scale

### ASW-06 — Build the privacy-rights-complete persistent memory plane · P1 · TODO

**Current evidence/gap:** memory-store governance captures purpose, fields,
residency, consent, retention, correction, deletion, hold and encryption
references, but there is no declared-field runtime store or rights-operation
execution.

**Scope:** implement an India-resident tenant-RLS memory adapter with envelope
encryption and field allowlists; purpose/consent checks on every read/write;
subject lookup, correction, export, expiry, erasure and legal-hold workflows;
prohibit borrower memory by default and prohibit cross-execution memory unless
the exact approved store is bound to the installation.

**Acceptance/evidence:** undeclared fields, tenants, purposes and workloads are
denied; consent withdrawal or store suspension immediately blocks new use;
expiry/erasure removes live, indexed and backup-accessible data under the
approved schedule while preserving value-free evidence; legal hold blocks
destruction without restoring operational access; privacy and RLS adverse tests
run against the selected database.

### ASW-10 — Deploy expiry, monitoring, containment and notification schedules · P1 · TODO

**Current evidence/gap:** containment functions exist, but knowledge expiry is a
manual API action and the repository does not demonstrate deployed schedules for
resource/provider expiry, evaluation cadence, budget reset, approval ageing or
operational notification delivery.

**Scope:** register tenant-fenced scheduled jobs for resource and evidence
expiry, evaluation/monitoring, budget periods, review SLAs and incident follow-up;
use leases, monotonic fences, idempotency, bounded retry, DLQ and escalation;
deliver role/queue notifications through governed communication adapters without
PII in message bodies or routing metadata.

**Acceptance/evidence:** duplicate schedulers have one winner; missed windows are
reconciled after restart; expiry containment blocks new work before notification;
alerts reach the correct current owners and escalate on non-acknowledgement;
stale/revoked recipients receive nothing; clock, retry, outage and replay tests
are deterministic and operationally witnessed.

### ASW-11 — Add production SLOs, telemetry, incident impact and recovery drills · P1 · TODO

**Current evidence/gap:** governance reports contain lineage and usage totals,
but do not yet constitute live runtime observability, service objectives or an
operated incident/recovery system.

**Scope:** publish tenant-safe metrics and traces for queue age, authorization,
provider latency/error/throttle, retrieval, tool use, human-review SLA, quality,
cost, drift and containment; define SLOs/error budgets and alert routing; export
security/audit events to governed SIEM/WORM custody; derive affected executions,
cases and customers from an incident; rehearse kill switch, provider fallback to
human work, replay, rollback and evidence preservation.

**Acceptance/evidence:** dashboards distinguish synthetic, evaluation and live
traffic; telemetry contains no prompts, documents or borrower identifiers;
alerts are tested end to end; an installation/model/provider incident produces a
bounded impact set and immediate authorization denial; witnessed drills meet
approved detection, containment and recovery objectives and retain immutable
evidence.

### ASW-13 — Validate the complete staff experience with institution users and assistive technology · P1 · TODO

**Current evidence/gap:** the six-workspace information architecture, syntax,
responsive contract and static accessibility markers are tested, but there is no
institution design acceptance, cross-browser certification or measured task
evidence.

**Scope:** test builders, model risk, information security, operations, finance,
auditors and proposal reviewers on realistic workflows; complete keyboard-only,
screen-reader, zoom/reflow, contrast, reduced-motion, browser/device and slow/error
path audits; add conflict-safe draft recovery and clear environment/simulation/
production labeling; validate translated operating content with native speakers.

**Acceptance/evidence:** representative users can find owned work, configure,
correct, evaluate, approve, contain and investigate without developer help;
critical tasks meet approved completion/error/comprehension targets; every P0/P1
accessibility issue is closed; performance budgets hold at target queue and
portfolio sizes; an independent accessibility/security/privacy report and tenant
UAT sign-off are retained.

## Wave 3 — Scale, commercial completion and reference release

### ASW-14 — Govern template authoring, promotion, deprecation and tenant impact · P2 · TODO

**Scope:** introduce a platform template authoring and review pipeline with
schema validation, risk classification, tool/policy mapping, prompt/configuration
checksums, test packs, signed release artifacts and independent promotion;
support tenant preview, impact analysis, opt-in upgrade, deprecation/withdrawal,
rollback and export/portability without copying approvals.

**Acceptance/evidence:** a template cannot publish without complete authority,
resource, evaluation, documentation and migration contracts; existing tenants
never move versions silently; affected installations and required re-approvals
are exact; revoked vulnerable templates are contained across tenants while
preserving tenant isolation and evidence.

### ASW-15 — Complete billing, tax, accounting and cost-reconciliation integration · P2 · TODO

**Scope:** integrate rated usage and reservations with invoice sequencing, tax
determination/validation, IRP/e-invoicing applicability, credits/refunds,
accounting export, collections, provider-bill reconciliation and finance dispute
workflow; separate business budget containment from billing-plumbing availability
in line with the usage-metering exception.

**Acceptance/evidence:** execution, provider bill, tenant charge, GST treatment,
credit and ledger instruction reconcile to the paise; duplicate/missing/late
provider usage is detected; finance maker/checker and legal invoice issuance are
distinct; failed billing infrastructure does not silently expand a hard approved
usage budget or misstate a legal invoice.

### ASW-16 — Certify one end-to-end CAM worker as the production reference slice · P1 · TODO

**Scope:** use `credit.cam` as the reference deployment and complete ASW-01..13
for one regulated-entity tenant, one approved model/provider, one product, one
knowledge corpus and one staffed human-review queue before widening template or
journey breadth.

**Acceptance/evidence:** an institution-witnessed case flows from eligible loan
application through live retrieval, bounded provider execution, specialized
guardrails, proposal review and the owning application command; cross-tenant,
injection, model outage, stale evidence, revocation, budget exhaustion,
notification failure and kill-switch scenarios are witnessed; DR/rollback and
audit replay succeed; operations, security, compliance/model risk and business
owners sign the exact release. Only this evidenced slice may be described as
production-ready.

## Sequence and exit gate

1. Complete ASW-01..04 before any production-provider activation.
2. Build ASW-05, ASW-07..09 and ASW-12 as one CAM vertical slice; do not split
   the runtime from the human and owning-domain completion loop.
3. Complete ASW-06, ASW-10, ASW-11 and ASW-13 before institution go-live.
4. Use ASW-16 as the witnessed release gate, then scale through ASW-14/15.

Bundle AQ exits only when ASW-16 is `DONE`. Repository controls, synthetic runs,
metadata-only evidence and a polished Studio UI cannot independently satisfy the
exit gate.
