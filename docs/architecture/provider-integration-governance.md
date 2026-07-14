# Provider Integration Governance

## Purpose

LoanOS separates a provider adapter being technically configurable from that
provider being authorised for live regulated traffic. Real mode now fails
closed unless endpoint, credential, India-residency posture, operational
health, and a current production certification are all present.

The control covers SMS, email, WhatsApp, credit bureau, V-CIP, bank-account
verification, payment rails, eSign, CERSAI, FIU-IND, CIC reporting, CKYCRR,
Account Aggregator, escrow, and core banking.

## Certification lifecycle

A tenant certification records provider name, contract reference,
certification reference, evidence SHA-256, production environment, India data
residency, certification/expiry timestamps, and independent maker-checker
approval. A current certification cannot be silently replaced. Suspension
requires a reason and separate approver and blocks live readiness immediately.

`GET /integrations/readiness` exposes only safe posture fields. It never returns
credentials. A real integration is `ready` only when configuration and
certification are both valid; missing, expired, suspended, non-India, or
operationally degraded providers remain visibly blocked/degraded.

## Transport and reconciliation

- Real transports use bounded timeouts, bounded retries, stable idempotency
  keys, and circuit breakers. Mock mode stays explicit for sandboxes.
- CIC and CKYCRR now execute through the provider boundary rather than trusting
  client-declared transport references. Submitted checksums remain bound to the
  provider evidence.
- AA fetches execute through the provider boundary after consent/frequency
  preflight. Raw FI data is not persisted by this layer; the consent ledger
  retains provider reference, count, residency, and payload hash.
- CERSAI, FIU, CIC, and CKYCRR responses can enter through HMAC-authenticated,
  idempotent callbacks. Domain reconciliation occurs before callback evidence
  is committed.

## Production boundary

The repository supplies the governance, contracts, failure behavior, audit
state, and mock implementations. It cannot create a regulator/vendor
certification, commercial agreement, production credential, allow-list, mTLS
certificate, or provider-specific conformance result. Each adopting regulated
entity must complete those external steps and record their evidence before
enabling real mode. Until then the affected integration remains Mock or
Partial/Mock in the capability catalogue.
