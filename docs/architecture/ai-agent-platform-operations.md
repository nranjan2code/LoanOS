# AI-Agent Platform Operations

Status: Executable control-plane baseline; no external model or agent runtime is connected.

Last reviewed: 2026-07-15.

This runbook is the operational companion to [Agentic AI Digital Workers on AWS](agentic-ai-digital-workers.md). It defines how a regulated-entity tenant prices, installs, approves, authorizes, traces, meters, reports and suspends LoanOS digital workers. It does not authorize production use by itself.

## 1. Implemented marketplace baseline

| Template | Maximum autonomy | Approved outputs | Decision authority |
| --- | --- | --- | --- |
| `credit.cam` | A1 prepare | CAM draft; evidence-gap list | None |
| `credit.underwriting_review` | A1 prepare | Underwriting memo draft; policy-exception list | None |
| `operations.loan_fulfilment` | A2 bounded preparation | Document-request, task and checklist drafts | None |
| `service.borrower_support` | A2 bounded preparation | Response draft; human-handoff creation | None |

All templates are proposal-only. They cannot sanction or reject credit, set price or limit, move funds, approve a human control, file a regulatory report, close a grievance, or mutate policy/model/rules.

## 2. System-of-record boundaries

| Record | Source of truth | Important controls |
| --- | --- | --- |
| Model inventory and kill switch | `modelRegistry` / `model-governance.js` | Exact active model version, approved validation, independent evidence, global/model containment |
| Marketplace and tenant installations | `aiAgentPlatform` / `ai-agent-platform.js` | Tenant contract, immutable template lineage, narrowed action scope, India region, human sponsor |
| Human production authority | SaaS identity governance and FST-034 | Four distinct active human principals; agents never count |
| Business/action policy | Per-tenant isolated Rust business engine | Fresh `guardrail.model_consumption` and `guardrail.agent_action` traces |
| Staffing/activation authority | Separate per-tenant `ctrl-*` engine | Fresh `guardrail.platform_control.staffing` trace; never shared with business engine |
| Evidence | Tenant event chain plus hash-sealed agent records | Input/output hashes and references, model/prompt/configuration versions, decision traces, actor and time |

## 3. Commercial lifecycle

1. A tenant commercial maker calls `POST /ai/pricing-contracts` with contract ID, entitled template IDs, effective period and exact pricing dimensions.
2. LoanOS stores `pending_approval`; client-supplied actor IDs are ignored.
3. A different authenticated principal calls `POST /ai/pricing-contracts/{id}/approve` with the commercial approval reference.
4. Only an active, in-period contract can entitle an installation or authorize execution.

Pricing values are non-negative integer strings. Currency is fixed to INR.

| Dimension | Meaning |
| --- | --- |
| `monthly_platform_fee_paise` | Contracted monthly control-plane/platform fee |
| `included_executions` | Contracted monthly execution allowance |
| `included_input_tokens` / `included_output_tokens` | Contracted token allowances |
| `per_execution_paise` | Per-authorized-execution rate |
| `per_1k_input_tokens_paise` / `per_1k_output_tokens_paise` | Rounded-up thousand-token rates |

The current usage record calculates the per-execution variable charge. An invoice uses the contract's monthly fee and included allowances before applying overage rates. Credits/refunds, accounting export, IRP/e-invoicing submission and payment reconciliation remain external integrations.

### Budgets, quotas and invoice-ready records

Budgets are tenant-local, opt-in hard controls. A commercial maker proposes `POST /ai/usage-budgets`; a different authenticated commercial checker approves `POST /ai/usage-budgets/{id}/approve`. A budget contains exact integer limits for executions, input tokens, output tokens and paise. When an in-period active budget applies, the runtime must first call `POST /ai/usage-budgets/reservations` with conservative maximum input/output tokens. The reservation includes the calculated maximum paise and expires after 15 minutes. Execution authorization requires its matching unexpired reservation; final metering refuses actual usage above it. This keeps the budget decision ahead of an external model charge.

`POST /ai/invoices` creates a hash-sealed, tenant-local commercial record for one contract and billing period. It snapshots every usage ID and ledger record hash, applies included allowances and monthly platform fee deterministically, then calculates GST with integer paise and documented half-up rounding. The caller supplies GSTIN references and place-of-supply metadata; it never supplies tax totals. Intra-state records split the total GST between CGST and SGST (with any odd paise assigned deterministically to SGST); inter-state records use IGST. A separate authenticated checker approves `POST /ai/invoices/{id}/approve`.

An approved record is deliberately marked `commercial_record_pending_tax_validation`: it is not a statutory tax invoice, an IRP submission, proof of supply, payment demand, credit note or GST return. Tenant finance and tax controls must validate tax determination, invoice numbering, e-invoicing applicability, accounting export, collections and reconciliation before issuing any legal document.

### Demo mode

Demo mode exercises the same authorized-execution, provider-boundary, completion, metering, budget, audit and reporting paths without a network model call. It is disabled by default and is enabled only with `LOANOS_AI_DEMO_MODE=true`. An already authorized execution may then call `POST /ai/agents/executions/{id}/demo-run` with one declared scenario: `standard`, `needs_human_review`, or `incomplete_evidence`.

The deterministic demo provider accepts no raw borrower payload, emits only a proposal, always sets `simulated: true` and `commerciallyLive: false`, and produces fixed synthetic token usage. It cannot establish provider readiness, production activation, model quality, legal invoicing, regulatory compliance, or permission to process real borrower data. Demo tenants must use synthetic data and retain the normal tenant authorization, suspension, usage-budget and audit controls.

## 4. Installation and tenant customization

`POST /ai/agents/installations` creates a `pending_approval` installation. It requires:

- a same-tenant active pricing contract entitled to the marketplace template;
- exact registered `modelId` and `modelVersion`; aliases or silent provider upgrades are not accepted;
- workload principal and active human sponsor references;
- prompt reference and SHA-256, configuration reference, versioned knowledge references and hashes;
- tenant product, language and data scopes;
- an allowed-action subset of the platform template.

A tenant may narrow scope but cannot add actions, raise autonomy, grant decision authority, change the India data region, or enable cross-execution memory. A materially changed prompt, model, configuration, corpus or authority requires a new installation/version and approval cycle.

## 5. Human governance and activation

Each approval is a separate authenticated call:

`POST /ai/agents/installations/{id}/approvals/{role}`

Required roles are:

1. `model_owner`;
2. `model_validator`;
3. `human_reviewer`;
4. `model_risk_manager`.

The authenticated principal must hold the exact current canonical role under FST-034. The proposer cannot approve, one human cannot fill two required slots, and a workload/agent identity cannot approve.

Activation uses `POST /ai/agents/installations/{id}/activate` with evidence references for risk assessment, independent validation, fairness, explainability, red-team testing, monitoring, incident runbook and India residency. LoanOS rechecks the pinned model and obtains a fresh decision from the isolated platform-control engine. Local/off-mode authority is insufficient; an unavailable or untrusted production control engine denies activation.

## 6. Execution authorization

`POST /ai/agents/executions/authorize` does not invoke a model. It creates a permissioned, hash-sealed execution envelope only after all checks pass:

1. installation is active and same tenant;
2. pricing contract is active and in period;
3. requested action is within the approved tenant subset;
4. when an active usage budget applies, a matching unexpired reservation is present;
5. registered model is still active, validated, not kill-switched and still the exact pinned version;
6. customer-facing execution includes an AI disclosure reference;
7. the business engine returns `allow` for `guardrail.model_consumption` with model provenance;
8. the business engine returns `allow` for `guardrail.agent_action` covering installation, tenant, action scope, proposal-only authority, human-control separation, India region and disclosure.

Both decision traces and ruleset hashes are projected into the execution. Engine timeout, missing tenant routing, malformed response, unknown decision, missing trace or denial fails closed.

## 7. Completion, usage and reporting

`POST /ai/agents/executions/{id}/complete` accepts only an authorized execution and one of `proposal_created`, `human_handoff`, `no_action` or `failed`. The platform stores output reference/hash and citations, not raw prompts or large raw outputs in general logs.

`POST /ai/agents/usage` accepts one record per final execution. It stores model/version, Mumbai region, input/output token counts, tool-call count and exact variable charge:

`charge_paise = per_execution_paise + ceil(input_tokens / 1000) × input_rate + ceil(output_tokens / 1000) × output_rate`

`GET /ai/agents/governance-report?from=&to=` returns tenant-local installation, execution, handoff, token/tool, charge and lineage completeness measures. It is an operational evidence projection, not an invoice or regulatory return.

## 8. Suspension and incident response

`POST /ai/agents/installations/{id}/suspend` requires actor, reason and incident reference. Suspension is immediate and blocks new authorization. It does not erase prior traces or usage.

Operational response:

1. suspend the affected installation and, where model-wide risk exists, trigger the model/global kill switch;
2. stop or route open cases to named human queues;
3. preserve prompt/configuration/knowledge hashes, engine traces, execution records and provider evidence;
4. assess tenant, RBI, CERT-In and DPDP notification duties under the applicable incident process;
5. complete root cause, impact, remediation and independent validation;
6. create a new governed installation/version for restoration—do not silently reactivate changed artifacts.

## 9. Data protection and retention

- Tenant IDs, purpose and trusted workload identity come from authenticated context, never model text.
- PAN, Aadhaar, account numbers, names, prompts and secrets must not appear in resource names, metric dimensions or free-form logs.
- Raw prompts and responses belong in an approved India-resident evidence/data store with purpose, access, retention, legal hold and deletion controls; general audit records keep hashes/references.
- Memory is execution-scoped. Any future persistent memory is a separately inventoried personal-data store.
- Model, prompt, knowledge, configuration, decision and output lineage must survive the business-record retention period needed for replay and investigation.

## 10. Production admission and remaining work

The control plane is not a production digital-worker runtime. Production admission still requires:

- a provider-neutral `DigitalWorkerProvider` implementation and durable worker;
- approved Bedrock model/embedding endpoints and Strands/AgentCore proof in `ap-south-1`;
- evidence that prompts, outputs, traces, evaluations, memory, backups and support paths remain in India;
- workload IAM, VPC endpoints, network egress denial, KMS/HSM and secret custody;
- specialized domain guardrails are executable as platform-pack policy models for tenant-scoped data access/minimization, outbound communication, underwriting influence and case mutation; the future runtime adapter must call the applicable model before retrieval, dispatch or mutation. Collections contact is separately guarded today;
- representative Indian-language, fairness, hallucination, injection, exfiltration, cross-tenant, excessive-agency and denial-of-wallet evaluation corpora;
- continuous quality/drift/complaint/override monitoring and automated suspension thresholds;
- marketplace and tenant-administration UI;
- credits/refunds, accounting/IRP/e-invoicing integration, tax validation and payment/billing reconciliation;
- provider contracting, outsourcing due diligence, incident/BCP/DR, audit/RBI access, portability and exit evidence;
- tenant UAT, independent model validation, risk/board approval and a witnessed kill-switch/fallback drill.

Until these are evidenced, externally describe the feature as a **governed AI-agent control-plane first slice**, not as live autonomous digital workers.

## 11. Verification anchors

- Domain/API tests: `tests/ai-agent-platform.test.js`
- Domain controls: `packages/core/src/ai/ai-agent-platform.js`
- API boundary: `apps/api/src/routes/ai-agent-platform.js`
- Business guardrail: `rules/fixtures/guardrail-agent-action.json`
- Rust regression: `rules/crates/rules-service/tests/ai_control.rs`
- Canonical staffing: [Tenant roles, staffing and feature gating](tenant-role-staffing-and-feature-gating.md)
- Decision invariants: [Decision engine design](decision-engine-design.md)
