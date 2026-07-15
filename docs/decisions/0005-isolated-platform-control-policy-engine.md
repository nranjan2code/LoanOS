# ADR 0005: Isolated platform-control policy engine per tenant

- Status: Accepted
- Date: 2026-07-15
- Supersedes: no prior decision
- Extends: ADR 0003

## Context

LoanOS needs deterministic rules for identity administration, feature staffing, segregation of duties, immediate revocation, operational pause, and AI-agent authority. These rules protect the authority to configure and operate lending. Putting them in a tenant's lending/business rules instance would let the same policy authors, bundles, credentials, runtime failure, or compromise influence both a business decision and the control that decides who may change that decision.

The platform is greenfield. There is no compatibility requirement to preserve a shared rules runtime.

## Decision

Each tenant receives at least two physically and administratively distinct Rust runtime instances:

1. the business-decision instance from ADR 0003; and
2. a platform-control instance for `guardrail.platform_control.*` decisions.

The instances must not share a URL, process, pod/microVM, tenant bundle, service identity, signing/encryption key grant, mutable cache, audit sink partition, deployment approval, or runtime administrator. The Node gateways are separate: `apps/api/src/rules-engine.js` and `apps/api/src/control-rules-engine.js`.

Production requires `LOANOS_CONTROL_RULES_ENGINE=active`, `LOANOS_UNIVERSAL_STAFFING=active` and a per-tenant object in `LOANOS_CONTROL_RULES_ENGINE_URLS`. Every object contains a unique HTTPS URL and `ctrl-*` instance ID plus mTLS client/server/trust references and a KMS/HSM bundle-signing key reference. A response must attest matching mTLS workload/peer identities and verified signing-key lineage. Wrong instance/bundle/transport/key identity, unreachable or malformed response, a duplicate control address, or a URL equal to the business-engine URL is a denial.

All protected staff mutations are centrally classified into FST-001..034 before handler dispatch. In active mode an unknown mutation is denied, which turns endpoint addition into an explicit policy-maintenance obligation rather than a silent authorization bypass.

Identity-provider groups may request canonical roles, but only the isolated control path and LoanOS maker-checker workflow may grant them. Agents never count as human staffing and cannot be makers, checkers, accountable officers, access reviewers, or auditors.

## Consequences

- A control-plane outage pauses protected actions; it never silently falls back in production.
- Fleet and tenant provisioning must create, attest, monitor, back up, and decommission two runtime classes.
- Policy authorship and operational access for the two classes require separate approval assignments.
- Local development may use the JavaScript reference evaluator in `off` or `shadow`; that is not a production deployment mode.
- Runtime cost is higher, but the blast radius and collusion paths are materially smaller.

## Rejected alternatives

- One tenant runtime containing business and access models: rejected because the authority boundary would be self-governing.
- A shared multi-tenant platform-control engine: rejected because identity policy and traces would share an address space.
- Scattered application `if` statements only: rejected because policy would not be versioned, replayable, signed, or independently operated.
- IdP groups as direct LoanOS authorization: rejected because external directory administration would bypass LoanOS SoD, scope, staffing, and forensic controls.
