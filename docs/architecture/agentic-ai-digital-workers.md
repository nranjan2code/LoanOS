# Agentic AI Digital Workers on AWS

Status: Architecture investigation plus implemented control-plane baseline; worker runtime and AWS production deployment are not yet implemented or certified.

Research baseline: 2026-07-15.

Owners: Product, Architecture, Compliance, Model Risk, Security, and the tenant Regulated Entity (RE).

Classification: Internal — restricted.

This document describes where agentic AI can create useful digital workers in LoanOS, which actions those workers may take, the recommended AWS and application framework, and the controls required for an Indian lending platform. It is not legal advice. Each RE must approve its use cases, risk classification, model-risk framework, customer disclosures, data locations, and operating procedures before production activation.

## 1. Recommendation

LoanOS should adopt **bounded digital workers**, not autonomous lenders.

The recommended implementation baseline is:

- **Strands Agents SDK for TypeScript** for the model/tool loop, matching the repository's Node/ESM runtime.
- **Amazon Bedrock AgentCore Runtime** for isolated agent execution, with AgentCore Gateway, Identity, Policy, Observability, and Evaluations adopted only after an India-region capability and data-flow review.
- **Amazon Bedrock** for approved foundation models and embeddings, invoked through an explicitly India-resident endpoint in `ap-south-1` (Mumbai). Geographic or global cross-region inference is off by default.
- **LoanOS workflow runtime** (and AWS Step Functions/SQS/EventBridge where durable cloud orchestration is needed) for timers, retries, approvals, idempotency, compensation, and long-running case state. A language model must not be the durable workflow engine.
- **The existing per-tenant Rust decision engine** as the final policy-enforcement point for every proposed regulated or borrower-impacting action. The agent proposes; the decision engine disposes.
- **The existing model-governance service** as the source of truth for model/agent inventory, validation, monitoring, incidents, and kill switches.

This is a framework choice, not approval to add a dependency or deploy AWS services. A thin proof of concept should validate the TypeScript SDK, Mumbai service/model availability, data flows, latency, cost, and guardrail integration before an ADR and production dependency are accepted.

### 1.1 Implemented baseline (2026-07-15)

The repository now implements the provider-neutral governance and commercial boundary that must exist before an SDK or Bedrock model is connected:

- four versioned marketplace templates: CAM preparation, underwriting review, loan fulfilment, and borrower support;
- per-tenant pricing contracts in INR using exact non-negative integer paise/token/execution dimensions;
- tenant-specific installation records with pinned model/prompt/configuration/knowledge versions, India region, workload identity, human sponsor, action allow-list, product/data scopes, and execution-scoped memory;
- FST-034 activation requiring distinct human model owner, model validator, human reviewer, and model-risk manager approvals, governance evidence, and an isolated control-engine trace;
- local model-registry and global/model kill-switch checks plus isolated business-engine decisions for `guardrail.model_consumption` and `guardrail.agent_action` before every execution;
- hash-sealed input/output/configuration lineage, proposal-only outcomes, append-only audit events, usage/cost records, emergency suspension, and tenant governance reports.

The implementation anchors are `packages/core/src/ai-agent-platform.js`, `apps/api/src/routes/ai-agent-platform.js`, and `rules/fixtures/guardrail-agent-action.json`. It intentionally does **not** call an LLM yet. The Bedrock/Strands provider adapter, durable worker, India-region AWS infrastructure, evaluation service, tenant UI, invoice integration, and live-provider conformance remain production gaps.

Operational lifecycle, API sequence, pricing semantics, incident procedure and production-admission evidence are maintained in [AI-Agent Platform Operations](ai-agent-platform-operations.md).

## 2. Why Digital Workers Fit LoanOS

LoanOS already contains the controls that most agent projects attempt to add later:

- tenant-scoped identity, data partitions, and audit chains;
- versioned workflows, tasks, maker-checker approvals, and exception evidence;
- deterministic lending and agent guardrail decisions;
- model inventory, independent validation, monitoring, incidents, and kill switches;
- customer-facing AI disclosure and human handoff;
- consent, purpose limitation, retention/deletion, data residency, and provider governance.

The valuable role for an LLM is therefore perception and coordination: reading unstructured material, preparing a case, selecting an approved tool, drafting a communication, explaining a deterministic result, and escalating uncertainty. The LLM must not become a second, hidden loan-policy engine.

## 3. Operating Model and Autonomy Levels

Every digital worker is registered as a governed AI application composed of one or more model versions, prompts, tools, knowledge sources, and workflow versions. It receives a non-human workload identity, an RE tenant, a declared purpose, and a bounded tool allow-list.

| Level | Permitted behaviour | Default approval | Example |
| --- | --- | --- | --- |
| A0 — assist | Search, summarize, translate, explain, and draft; no state mutation | Human uses or discards output | Summarize an underwriting file with citations to source documents |
| A1 — prepare | Classify, extract, reconcile, create a draft task or proposed mutation | Human confirms the material result | Prepare a KYC discrepancy task or draft grievance response |
| A2 — execute bounded | Perform reversible, low-impact actions after deterministic guardrail approval | Straight-through only within an approved policy envelope | Request a missing document through an approved template and channel |
| A3 — execute controlled | Propose a material action; execute only after named human maker-checker approval and a fresh guardrail decision | Mandatory human approval | Apply an approved hardship-plan configuration or collection settlement |
| A4 — prohibited autonomy | Independently make or conceal a regulated, financial, legal, or rights-affecting determination | Never delegated to an agent | Sanction/decline credit, set price, move funds, file an STR, close a grievance, classify fraud, or waive a control |

An agent may calculate or recommend only when the authoritative calculation or decision is recomputed by deterministic LoanOS code. Confidence scores never turn a prohibited action into a permitted action.

## 4. Candidate Digital Workers

### 4.1 First wave — lower risk, high value

| Worker | Useful work | Maximum autonomy | Required evidence and guardrail |
| --- | --- | --- | --- |
| Operations knowledge worker | Answer staff questions from approved policies, runbooks, product configuration, and regulatory material with source citations | A0 | Tenant- and role-filtered retrieval; source/version references; no borrower data unless purpose-authorized |
| Document intake worker | Classify uploaded documents, extract fields, identify missing/contradictory data, and prepare review tasks | A1 | Original-document hash, extracted field lineage, confidence, model/prompt version, human verification for KYC/financial facts |
| Application completeness worker | Compare the case against product document/condition rules and request missing information | A2 for approved reminders | `guardrail.data_access`, approved communication template/channel, consent/preferences, rate limits, no eligibility statement |
| Support triage worker | Classify intent, retrieve account-safe information, draft answers, create a grievance or human-handoff task | A2 for informational responses | AI disclosure, authenticated borrower scope, masked data, grievance detection, immediate human option, no fabricated account facts |
| Communication drafting worker | Draft multilingual notices from canonical event data and approved templates | A1 | Template/version, translation approval, exact source fields, human approval for adverse/material notices |
| Reconciliation investigation worker | Explain mismatches across ledger, bank, provider, or reporting files and prepare exception cases | A1 | Read-only source lineage, exact-paise recomputation by domain code, no autonomous posting or write-off |
| Compliance evidence worker | Assemble control evidence, regulatory obligation packs, audit responses, and committee drafts | A1 | Evidence hashes, completeness checks, no invented evidence, control-owner and compliance approval |

### 4.2 Second wave — controlled operational execution

| Worker | Useful work | Maximum autonomy | Required evidence and guardrail |
| --- | --- | --- | --- |
| Underwriting case-preparation worker | Summarize bureau/AA/KYC/documents, detect conflicts, and present policy-derived reason codes | A1 | Model facts provenance-tagged; deterministic eligibility/affordability rerun; underwriter owns decision |
| Servicing worker | Explain schedules, prepare change requests, gather evidence, and execute approved non-financial requests | A2/A3 | Account state/version lock, entitlement, fresh policy evaluation, maker-checker for material changes |
| Collections workbench worker | Prioritize human queues, suggest treatments, draft compliant contact, and record outcomes | A1; A2 only for approved reminders | `guardrail.collections_contact`, 08:00–19:00 IST window, frequency/conduct controls, vulnerability and dispute stops, human escalation |
| Fraud/AML investigation worker | Correlate alerts, summarize linked events, and propose investigation steps | A1 | Read access by declared purpose; explainable source links; human investigator; no autonomous fraud classification, freeze, FIU filing, or customer accusation |
| Regulatory reporting worker | Validate completeness, explain rejects, and prepare corrected submission packs | A1/A3 | Deterministic schema/totals, maker-checker, signed-file controls, human filing authority |
| Vendor/integration incident worker | Diagnose callbacks/files, suggest runbook steps, create replay proposals, and assemble incident evidence | A2/A3 | Idempotency key, replay guard, incident/change approval, no credential exposure |

### 4.3 Do not deploy as autonomous workers

The following remain human-accountable and deterministically controlled even if AI prepares the file:

- credit sanction, rejection, pricing, limit, restructuring, settlement, waiver, write-off, NPA classification, or disbursement;
- KYC verification, suspicious-transaction determination/filing, fraud classification, account freeze, legal notice, repossession, or auction decision;
- movement of borrower or RE funds, creation/change of beneficiary accounts, or release of collateral;
- final grievance rejection/closure, statutory/customer-rights response, or adverse customer communication;
- policy/model/rule authoring approval, kill-switch clearance, access grant, audit closure, or production release;
- unrestricted browser, shell, SQL, email, messaging, or arbitrary HTTP access.

## 5. Framework Decision

| Option | Strength | Concern for LoanOS | Decision |
| --- | --- | --- | --- |
| Strands Agents TypeScript + AgentCore | Thin, model-agnostic tool loop; TypeScript support; MCP; structured outputs; AWS-native deployment and observability | Young and fast-moving dependency; model-driven routing must remain inside deterministic boundaries | **Preferred agent SDK/runtime baseline**, after a bounded proof of concept |
| Amazon Bedrock Agents | Managed orchestration, knowledge bases, action groups, and guardrails | More vendor-shaped orchestration and less control over complex LoanOS workflow semantics | Acceptable for a narrow informational assistant; not the platform-wide abstraction |
| LangGraph | Explicit state graph, checkpoints, and human interrupts; broad ecosystem | Adds another orchestration/state layer that overlaps LoanOS LWS and increases validation surface | Exception option for a complex research prototype; not the default |
| CrewAI/AutoGen-style multi-agent teams | Rapid role-based experiments | Emergent handoffs, larger prompt/tool attack surface, harder lineage and replay | Sandbox/research only unless separately justified and validated |
| Custom model loop | Minimal dependency and maximum control | LoanOS would own protocol, tool-loop, streaming, tracing, and upgrade burden | Keep an internal adapter boundary so this remains possible; do not build first |
| AWS Step Functions | Durable retries, waits, approvals, compensation, and observable state | Not an agent SDK and cannot interpret unstructured work by itself | Use alongside the worker runtime for durable processes |

The platform-facing abstraction should be LoanOS-owned (`DigitalWorkerProvider`), not a Strands or Bedrock type. It should accept a versioned work request and return a structured proposal/evidence envelope so the provider can be replaced without changing domain policy.

## 6. Target AWS Architecture

```text
borrower/staff/system event
          |
          v
LoanOS API + identity + tenant/purpose context
          |
          v
durable LoanOS workflow / Step Functions
          |
          v
AgentCore Gateway -------- IAM / workload identity / tool allow-list
          |
          v
AgentCore Runtime (Strands TypeScript worker, tenant-scoped session)
     |             |                 |
     |             |                 +--> approved tenant knowledge index
     |             +--> Bedrock model + input/output guardrails
     +--> tool request
              |
              v
      LoanOS guardrail API -> per-tenant Rust decision engine
              |                 allow | deny | require_human
              v
      narrow idempotent LoanOS command API
              |
              v
 audit chain + workflow task + human approval + outcome/incident monitoring
```

### 6.1 Three independent enforcement layers

1. **AWS authorization layer:** IAM, AgentCore Identity/Gateway/Policy, VPC endpoints, network egress restrictions, and per-tool schemas decide whether this workload identity can attempt a tool call.
2. **Model interaction layer:** Bedrock Guardrails and application filters detect prompt attacks, denied topics, sensitive information, and ungrounded content. They protect what enters/leaves the model but are not lending-policy controls.
3. **LoanOS domain layer:** `guardrail.*` decisions check tenant policy, consent, account state, amounts, contact windows, workflow state, kill-switch state, and human approval. Only a narrow LoanOS command API can mutate domain state.

No layer substitutes for another. In particular, prompt instructions such as "never approve a loan" are not controls.

### 6.2 Tool design

Each tool must be a narrow business capability, for example `prepare_document_request`, `create_handoff`, or `propose_reconciliation_replay`; never `execute_sql`, `call_url`, or `update_record`.

Every mutation tool requires:

- `tenant_id`, authenticated principal/workload identity, declared purpose, and case ID supplied by trusted context rather than model text;
- a canonical, schema-validated payload and bounded values;
- a guardrail decision ID and unexpired decision inputs/version;
- an idempotency key, expected record version, and dry-run/proposal mode;
- human approval reference where the action class requires it;
- append-only audit evidence linking worker, model, prompt, knowledge, tool, policy, decision, and outcome versions.

Workers have no direct database access. Retrieval and tools must enforce the same tenant and role filters as normal APIs. A worker cannot delegate more authority to a sub-agent than it holds.

### 6.3 Tenant isolation and memory

- Use a separate workload identity, tool grant, knowledge namespace, encryption context, and audit partition per tenant.
- Do not share long-term agent memory across REs. Default to **no long-term memory** for borrower-facing and regulated workflows; retrieve current canonical state for each turn.
- If memory is justified, register it as a personal-data store with purpose, fields, India location, retention/expiry, access, correction, erasure, legal hold, and deletion evidence. Conversation history must not become an undeclared customer profile.
- High-risk workers should use a dedicated per-tenant runtime or equivalent demonstrable isolation. Shared runtime optimization requires an isolation threat model and adversarial test evidence.
- Never place PAN, Aadhaar number, account number, prompts, borrower names, or secrets in resource names, tags, metrics dimensions, or free-form diagnostic fields.

### 6.4 India residency on AWS

The default deployment is Mumbai (`ap-south-1`) with India-resident storage, logs, backups, keys, vector data, prompts, outputs, traces, and memory. Use PrivateLink/VPC endpoints and deny unapproved cross-region calls with organization/IAM policy where supported.

AWS documents that some AgentCore Memory, Policy, Evaluations, and Bedrock model modes can perform geographic or global cross-region inference. An Asia-Pacific geography is **not** equivalent to India: it can include Singapore, Sydney, Tokyo, and other regions. Therefore:

- use in-region inference profiles/endpoints only;
- do not enable geographic/global cross-region inference, automatic model fallback, or an out-of-India evaluation/telemetry service by default;
- maintain an allow-list by service, feature, model ID/version, endpoint, storage location, processing location, log location, and sub-processor;
- fail closed or route to a human/deterministic path if the India-resident model/service is unavailable;
- treat any proposed outside-India processing as a compliance exception requiring RE approval, counsel review of RBI paragraph 13(iv), proof of deletion outside India, and return to India within 24 hours. The preferred architecture does not rely on this exception.

Mumbai availability of AgentCore does not prove every AgentCore feature, Bedrock model, guardrail, evaluation, or logging path remains in Mumbai. Production admission is per feature and per model, not per product name.

## 7. Indian Regulatory and Policy Framework

### 7.1 Status hierarchy

| Instrument | Status at research baseline | Design consequence |
| --- | --- | --- |
| RBI Digital Lending Directions, 2025 | Binding direction for covered REs | RE remains responsible for LSP acts; need-based explicit-consent collection with audit trail; customer rights; grievance route; India storage and controlled processing; AI worker cannot become an ungoverned LSP/DLA side channel |
| RBI IT Outsourcing Directions, 2023 and financial-services outsourcing rules | Binding according to RE/applicability | RE accountability, due diligence, audit/RBI access, sub-outsourcing, incident, BCP/DR, concentration, continuity, and exit rights apply to LoanOS/AWS/model providers |
| DPDP Act, 2023 and DPDP Rules, 2025 | Law/rules under a phased commencement schedule; tenant and provision applicability must be tracked | Build now for notice/legal basis, purpose limitation, data minimization, security safeguards, breach response, processor contracts, principal rights, retention/erasure, and verifiable consent where relied on; do not misstate a future commencement date as already operative |
| CERT-In Directions, 2022 | Binding for covered entities | Six-hour reporting for specified cyber incidents, 180-day India log retention, time synchronization, and evidence preservation include agent systems |
| RBI FREE-AI Committee report, 2025 | Expert committee recommendations, not by itself a binding direction | Adopt the seven sutras and recommended board policy, risk classification, validation, consumer protection, security, monitoring, incident, and kill-switch controls as the platform baseline |
| India AI Governance Guidelines, 2025 | Government guidance, not a standalone AI statute | People-first/human oversight, fairness, accountability, understandable-by-design, safety/resilience, risk-based controls, audit trails, incident reporting, and techno-legal enforcement |
| RBI draft Guidance on Regulatory Principles for Model Risk Management, 2026 | **Draft under public consultation**, not final at baseline | Build toward inventory, tiering, independent validation, board/RMCB oversight, third-party accountability, explainability, hallucination/bias/drift controls, red teaming, prompt-injection defense, customer disclosure/handoff, human oversight, kill switch, BCP, and ten-year decommissioned-model inventory; track final changes |

The general India AI Guidelines expressly favor applying existing law and sector-regulator rules to AI applications. For LoanOS, RBI directions, DPDP, consumer protection, IT/cyber law, contract/outsourcing requirements, and the RE's board policies are the operative envelope; there is no single framework certification that makes an agent compliant.

### 7.2 Required LoanOS control framework

Every digital worker must pass these lifecycle gates:

1. **Use-case admission:** documented purpose, benefit, affected persons, prohibited uses, autonomy level, alternatives, data classes, jurisdictions, and accountable business/model owners.
2. **Risk tiering:** consider customer/financial/legal materiality, autonomy, unstructured/sensitive data, explainability, reversibility, scale, third-party opacity, and provider concentration. Customer-facing, collections, AML/fraud, underwriting, and any fund-adjacent worker are high risk unless the RE's approved framework demonstrates otherwise.
3. **Inventory:** register agent application, every model/provider/version, embedding model, prompt/policy version, tool, knowledge corpus, memory store, downstream dependency, owner/developer/validator/approver, risk tier, approvals, observations, and decommissioning. Model/provider aliases that can change silently are prohibited in production.
4. **Independent validation:** validate intended use, Indian languages/dialects, source grounding, factuality, refusal, fairness, protected/vulnerable groups, hallucination, prompt injection, data exfiltration, tool misuse, cross-tenant attacks, excessive agency, fallback, and human handoff. Third-party assurance does not replace RE validation.
5. **Approval:** high-risk deployment requires the tenant's competent board/risk authority under its MRMF; development and validation/approval must be independent. Exceptions are time-bound with mitigants and remediation.
6. **Production enforcement:** least privilege, India-region allow-list, deterministic action guardrail, exact schema, idempotency/version checks, maker-checker, AI disclosure, accessible human channel, and fail-closed kill switch.
7. **Continuous monitoring:** task success, grounding/citation rate, hallucination/unsupported claims, false allow/deny/escalation, bias slices, complaints, human overrides, near misses, prompt attacks, data leakage, tool denials, drift, latency, cost, and provider/model changes.
8. **Incident and continuity:** global/model/worker/tool switches, manual/deterministic fallback, open-case routing, evidence preservation, tenant/CERT-In/DPDP/RBI notification assessment, post-incident review, and independently approved restoration.
9. **Change and exit:** immutable versioning, impact assessment, regression corpus, canary/shadow deployment, rollback, provider substitution, export/deletion evidence, and retention of decommissioned inventory/documentation in line with the final applicable MRMF (the 2026 draft proposes at least ten years).

## 8. Decision and Evidence Contracts

The platform should introduce a provider-neutral work envelope before implementing a worker:

```json
{
  "work_request_id": "work_...",
  "tenant_id": "tenant_...",
  "worker_id": "support_triage",
  "worker_version": "1.0.0",
  "purpose": "borrower_support",
  "case_id": "case_...",
  "actor": { "type": "workload", "id": "agent_...", "on_behalf_of": "user_..." },
  "input_refs": [{ "ref": "document_...", "sha256": "...", "classification": "financial" }],
  "requested_output_schema": "support_triage.v1",
  "constraints": { "autonomy": "A1", "expires_at": "..." }
}
```

The worker returns a proposal, never an implicit side effect:

```json
{
  "proposal_id": "proposal_...",
  "model": { "id": "...", "version": "...", "region": "ap-south-1" },
  "prompt_version": "...",
  "knowledge_refs": [{ "ref": "policy_...", "version": "...", "passage_hash": "..." }],
  "facts": {},
  "fact_provenance": {},
  "proposed_action": { "type": "create_handoff", "arguments": {} },
  "confidence": null,
  "limitations": [],
  "guardrail_findings": [],
  "generated_at": "..."
}
```

LoanOS validates the schema, converts accepted model outputs into provenance-tagged facts, calls `guardrail.*`, and only then opens a human task or invokes an idempotent command. The audit record must preserve hashes or approved references for large prompts/documents without leaking their contents into general logs.

## 9. Delivery Plan

### Phase DW-0 — governance and platform boundary

Status: **partially implemented**. Marketplace/installations, pricing dimensions, approval evidence, proposal-only execution envelope, model/action guardrails, lineage, usage, suspension, and reporting are present. AWS/provider execution and several specialized domain guardrails remain open.

- Approve an RE-owned digital-worker policy and risk taxonomy aligned to the final RBI MRM guidance when issued.
- Add agent application/prompt/tool/knowledge/memory inventory fields to model governance.
- Define `DigitalWorkerProvider`, work/proposal/evidence schemas, and the tool-risk catalogue.
- Add India-region service/model admission and cross-region-deny controls.
- Add `guardrail.data_access`, `guardrail.communication_dispatch`, `guardrail.case_mutation`, and worker kill-switch decisions/corpus.
- Establish offline evaluation, red-team, incident, human-override, and decommissioning procedures.

### Phase DW-1 — read-only pilot

Pilot the internal operations knowledge worker and document-intake worker using synthetic data. Require citations, structured output, no memory, no mutation tools, and full trace/evaluation evidence. Compare at least two approved Bedrock models for quality, Indian-language behavior, latency, and cost without making the domain layer model-specific.

### Phase DW-2 — prepare-only production pilot

Enable support triage or application completeness for one tenant and product. The worker may create draft tasks only. Run shadow evaluation, sample human review, complaint/override monitoring, and a kill-switch drill before increasing scope.

### Phase DW-3 — bounded actions

Allow only reversible low-risk actions through narrow tools after deterministic guardrail evaluation. Add idempotency, concurrency, maker-checker where applicable, canary rollout, and automatic suspension thresholds.

### Phase DW-4 — high-risk decision support

Only after the RE's MRMF, independent validation, board/risk approval, external assurance, staffed human oversight, and production evidence are mature, introduce underwriting/collections/AML decision support. These workers remain A1/A3 and never receive A4 autonomy.

## 10. Production Admission Checklist

A worker is not production-ready unless all answers are evidenced:

- Is its purpose, owner, RE tenant, autonomy level, risk tier, and prohibited action list approved?
- Are model, prompt, tools, knowledge, memory, dependencies, data locations, and provider versions inventoried?
- Does every data access have a purpose/legal-basis/consent check and tenant/role filtering?
- Are all storage, processing, logs, traces, evaluations, backups, and support paths admitted for India residency?
- Has the RE independently validated the complete system, including third-party models and provider-driven changes?
- Are Indian language, accessibility, vulnerable-customer, fairness, and hallucination tests representative of the use case?
- Are prompt injection, indirect injection, memory poisoning, tool abuse, exfiltration, cross-tenant access, and denial-of-wallet tested?
- Does every action pass through a deterministic guardrail and narrow idempotent API?
- Are customer AI disclosure, limitations, grievance route, and immediate human handoff available and tested?
- Can operations suspend the model, worker, tool, or all tenant AI, and does failover route open cases safely?
- Are audit lineage, human interventions/overrides, incidents, near misses, monitoring, retention, and deletion demonstrable?
- Do AWS/model/provider contracts provide due diligence material, audit/RBI access, incident support, sub-processor transparency, continuity, portability, and exit?

## 11. Implemented API surface and pricing calculation

Tenant-scoped authenticated endpoints are:

- `GET /ai/marketplace`, `GET /ai/agents`, and `GET /ai/agents/governance-report?from=&to=`;
- `POST /ai/pricing-contracts`, `/pricing-contracts/{id}/approve`, and `/ai/agents/installations`;
- `POST /ai/agents/installations/{id}/approvals/{role}`, `/activate`, and `/suspend`;
- `POST /ai/agents/executions/authorize`, `/executions/{id}/complete`, and `/usage`.

All mutations classify under FST-034. Commercial contracts use separate authenticated proposal and approval calls. Each FST-034 role approval is also a separate call bound to the authenticated human and their effective canonical role; clients cannot submit a bundle of approver identities. Activation consumes those stored approvals and obtains a fresh isolated control-engine decision. The execution route additionally obtains fresh isolated business-engine traces; a missing or untrusted engine returns a denial.

Commercial rates are contract data, not source-code list prices. The initial calculation is intentionally auditable:

`charge_paise = per_execution_paise + ceil(input_tokens / 1000) × input_rate + ceil(output_tokens / 1000) × output_rate`

Monthly fees and included quotas are represented in the contract schema but invoice-cycle aggregation and quota offsets are not yet implemented. Sales therefore must not claim automated invoicing or a fixed published price.

## 12. Source Baseline

Primary regulatory and policy sources:

- RBI, `Reserve Bank of India (Digital Lending) Directions, 2025`, May 8, 2025: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12848&Mode=0
- RBI, `Master Direction on Outsourcing of Information Technology Services`, April 10, 2023: https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12486
- RBI, `Framework for Responsible and Ethical Enablement of Artificial Intelligence (FREE-AI)`, August 13, 2025: https://rbidocs.rbi.org.in/rdocs/PublicationReport/Pdfs/FREEAIR130820250A24FF2D4578453F824C72ED9F5D5851.PDF
- RBI, draft `Guidance on Regulatory Principles for Model Risk Management`, June 24, 2026 (public-consultation draft at this baseline): https://rbidocs.rbi.org.in/rdocs/Content/PDFs/DRAFTGUIDANCE24062026FF12A4FF7BC84E8887009D5C5365F8BF.PDF
- MeitY/IndiaAI, `India AI Governance Guidelines`, November 2025: https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc2025115685601.pdf
- MeitY, `The Digital Personal Data Protection Act, 2023`: https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
- MeitY, `Digital Personal Data Protection Rules, 2025`: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025
- CERT-In, directions under section 70B(6), April 28, 2022: https://www.cert-in.org.in/Directions70B.jsp

Primary AWS/framework sources (capabilities and availability change; re-check during admission):

- AgentCore overview, supported frameworks, regions, Gateway, Policy, and services: https://aws.amazon.com/bedrock/agentcore/faqs/
- AgentCore runtime security best practices: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html
- AgentCore cross-region inference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/cross-region-inference.html
- AgentCore data encryption: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/data-encryption.html
- AgentCore Memory creation/retention: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-create-a-memory-store.html
- Bedrock data protection: https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html
- Bedrock regional model availability: https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html
- Bedrock Guardrails: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html
- Bedrock prompt-attack protection: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-prompt-attack.html
- AgentCore TypeScript/Strands deployment: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html
- Strands Agents TypeScript SDK: https://github.com/strands-agents/sdk-typescript
