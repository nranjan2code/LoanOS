# LoanOS Guide and Academy

The LoanOS Guide and Academy is the platform-owned, task-based user guidance surface at `/help/`. It translates the repository's technical, product and compliance sources into role-aware operating guidance without replacing those sources of truth.

## Current boundary

The first release is a canonical LoanOS experience for regulated-entity staff and LoanOS operators. It includes searchable guides, role entry points, learning paths, control-impact labels and sandbox-first guidance. Content is shipped with the application and does not accept tenant-authored material.

Borrower guidance remains part of the customer-channel experience and must not be mixed with institutional operating instructions.

## Content contract

Every published guide records:

- stable identifier, title, summary and category;
- intended roles;
- platform availability and environment boundary;
- control or approval impact;
- estimated completion time and last verification date;
- task steps, expected evidence, exceptions and production boundaries.

The existing product, architecture, compliance and decision-record documents remain authoritative. User guidance must use the maturity language from `product/product-journey-support-matrix.md`; a guide existing is not evidence of production readiness.

## Future tenant and regulated-entity customization

Customization is intentionally deferred. A future overlay must:

1. resolve content by tenant and regulated entity without cross-tenant reads;
2. distinguish immutable LoanOS control guidance from tenant-authored operating notes;
3. require role-based authoring and maker-checker publication;
4. retain version, effective date, approval, supersession and audit lineage;
5. filter by entitled modules and staffed roles;
6. fail closed to canonical guidance when an overlay is missing, expired or unauthorized;
7. prevent tenant text from weakening platform or regulatory controls;
8. provide a preview and sandbox validation step before publication.

Formal assessment, certification expiry and external LMS interoperability may be added later. They should consume the same governed content identifiers rather than create a second manual.

## Definition of done

A user-visible workflow change is incomplete until its relevant guide is updated or explicitly marked unavailable. Compliance-sensitive guidance requires control-owner review, and release validation should check links, metadata, maturity labels and verification dates.
