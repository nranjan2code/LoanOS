# Audit Integrity and Data Governance

## Scope

Bundle D adds tenant-local controls around the existing hash-chained audit spine
and statutory erasure workflow. It covers external-anchor evidence, business
event completeness, evidence custody and legal holds, transformation lineage,
and declarative data-quality certification.

## Audit anchor and completeness

- An anchor can be recorded only over a verified tenant audit chain. The
  external timestamp/WORM record must match the exact head hash and event count,
  use immutable India storage, carry a future retention date and evidence
  SHA-256, and have independent approval. Anchors retain predecessor lineage.
- Completeness reconciliation compares source-of-truth records with required
  creation events for governed loan applications, disbursed accounts, CIC
  batches, CKYCRR submissions, and provider certifications. Missing events or a
  broken chain produce a failed reconciliation and cannot be certified away.

## Evidence custody and retention

Evidence admission requires a content checksum, source lineage, custodian,
India-resident immutable storage, retention date and maker-checker approval.
Custody records are hash-linked. Legal holds require authority and independent
approval, can extend retention, and block deletion until independently
released. Deletion is possible only after retention and all holds expire; it
removes the live storage reference while preserving a checksum-bound proof of
what was deleted and under whose authority.

The existing borrower-retention cleanup remains the personal-data execution
path: active/statutory holds block erasure and eligible profiles/KYC/beneficial
owners are irreversibly redacted with audit events.

## Lineage and data quality

- Field lineage binds one or more named source fields to a versioned,
  checksum-bound transformation and output field, with purpose, regulatory
  field identifiers, owner and independent approval.
- Data-quality rules are declarative (`required`, `pattern`, `enum`, `unique`,
  `reference`) and operate over tenant-local collections without arbitrary
  code. Assessments retain hash-only failed-value evidence. Critical/high
  failures block certification; lower-risk certification requires explicit
  exception references. Unknown collection names become failures rather than
  silently certifying an empty population.

## Production boundary

LoanOS records and verifies external timestamp/WORM evidence but does not
itself operate an external TSA, immutable object-lock service, regulator vault,
or enterprise data catalogue. An adopting RE must configure and independently
assure those services, automate schedules, expand completeness mappings to its
full institutional inventory, and operate data-steward remediation. The
capability catalogue therefore remains conservative (`Partial`) for those
external and enterprise-depth legs.
