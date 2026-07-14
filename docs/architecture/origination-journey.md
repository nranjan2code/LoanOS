# Governed Digital Origination Journey

## Scope

This slice closes the application-level gaps between an authenticated borrower
and the existing LOS decision, contracting, and disbursement workflow for an
unsecured personal term loan. The governed path is explicit: internal
operations ingestion remains available, while `POST /borrower/applications`
creates a borrower-self-service application whose identity is taken only from
the authenticated session and whose origination gates cannot be bypassed.

## Control flow

1. `GET /borrower/application-options` exposes only safe fields from active
   term-loan policies.
2. The borrower submits amount, tenor, destination-account identifiers,
   declaration evidence, source/attribution, and preferred journey language.
3. Product policy produces the required document checklist. Upload records
   retain type, size, MIME type, SHA-256, India residency and malware-engine,
   signature-version, timestamp and evidence metadata; infected files are
   retained only as quarantined evidence.
4. A registered credit actor independently verifies, marks deficient, or
   waives a document. Waiver requires policy reference, reason and a separate
   approver.
5. An approval proposal for the governed path fails closed until each required
   document is verified or waived.
6. Conditions precedent/subsequent retain policy, maker/checker and satisfaction
   evidence. An open condition precedent blocks disbursement.
7. Final approval attaches the policy-driven sanction-validity window.
   Disbursement fails closed after expiry.
8. KFS issuance records the borrower-understood language; a non-English KFS
   requires matching language-confirmation evidence at acceptance.

All transitions are tenant-local and emit audit events. The borrower can read
only their own application/readiness and may upload documents only to that
application.

## Application surfaces

- Borrower portal: product selection, amount/tenor, preferred language,
  destination-account identifiers, declaration and visible checklist progress.
- Operations API: document review/deficiency/waiver, conditions and readiness.
- Existing LOS: eligibility, KFS, human review, proposal, maker-checker approval,
  execution packet, eSign, vault and disbursement.

## Production boundaries still assigned to later bundles

- The API stores upload-control evidence and document metadata, not raw binary
  objects. Production needs presigned India-resident object upload, content-type
  inspection, authenticated malware-scanner callbacks, DLP/OCR and retention.
- Language selection and understanding evidence exist; translated legal/KFS
  template libraries and legal-language certification remain required.
- Destination-account identifiers are collected, but live bank-verification and
  payment-provider onboarding remain Bundle C.
- Product options cover active term-loan policy snapshots; eligibility offers,
  save-and-resume drafts, duplicate leads, abandonment and assisted-channel
  routing remain future acquisition depth.
- Staff use governed APIs and the existing task workspace. A dedicated
  underwriter document/condition desktop remains experience depth.

These boundaries keep the current controls fail-closed without representing
provider simulation or metadata capture as external production certification.
