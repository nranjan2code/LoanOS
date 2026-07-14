# Secure SDLC and Vulnerability Assurance

## Control objective

LoanOS release approval must be based on artifact-bound security evidence rather than an opaque scan URL. The security-assurance control plane records scan completeness, signed SBOM metadata, vulnerability SLA and remediation state, tightly bounded risk exceptions, and a deterministic release gate. Records are projected from the append-only platform audit chain.

Implementation: `packages/core/src/security-assurance.js`; authenticated routes and release-approval enforcement: `apps/api/src/server.js`.

## Required evidence for release approval

For the exact release artifact SHA-256 and source revision, the gate requires:

- one complete bundle containing exactly one SAST, DAST, dependency, container, IaC, and secret scan;
- scanner name/version, ruleset, run/evidence reference, start/end time, status, and severity counts for every scan;
- no scanner execution failure or error;
- a CycloneDX or SPDX SBOM record bound to the artifact and SBOM document SHA-256, with format/version, component count, generator, evidence and signature references;
- a vulnerability record for every reported critical/high finding;
- no unresolved critical vulnerability;
- no unresolved high vulnerability unless it has an active, independently approved exception; and
- no overdue unresolved lower-severity vulnerability without an active exception.

`POST /platform/delivery/releases/:id/approval` now evaluates this gate before the normal four-eyes release approval. Missing or failed evidence returns `release_security_gate_blocked`; there is no compatibility bypass. The evaluated gate and evidence ids are retained on the approved release projection.

## Vulnerability lifecycle and SLA

Severity deadlines are 1 day for critical, 7 days for high, 30 days for medium, and 90 days for low. The lifecycle is:

`open → triaged → in_remediation → remediated → verified → closed`

Triage requires an owner and evidence. Remediation requires a plan and change ticket, then fixed-version and implementation evidence. Verification requires a retest scan/evidence and an actor independent of the remediator. Closure requires another independent actor and an approval reference. Invalid transitions fail closed; due dates and overdue state remain visible.

## Risk exceptions

Critical vulnerabilities cannot be excepted. Other severities require a specific rationale, compensating controls, maker/checker actors, approval evidence, and an expiry no more than 90 days away. Expired exceptions stop satisfying the release gate automatically. An exception does not close or erase the vulnerability.

## Operating sequence

1. Build once and calculate the deployable artifact digest.
2. Run all six scanner classes against the appropriate source, artifact and deployed test target.
3. Generate, checksum and sign the SBOM for that artifact.
4. Record the scan bundle and SBOM metadata. Register all critical/high findings as vulnerabilities; reconcile reported counts.
5. Remediate and independently retest findings. Use a time-bound exception only through approved risk governance; never except critical findings.
6. Query the release gate and resolve every blocker before requesting release approval.
7. Track vulnerability deadlines continuously after release; expired exceptions and overdue items require escalation.

## Production completion gaps

This slice governs evidence but does not execute scanners or validate external report/signature content. Production still requires independently managed SAST/DAST/SCA/secret/container/IaC tooling, authenticated pipeline-to-API submission, signed provenance and SBOM signature verification, CVE/KEV and vendor advisory feeds, exploitability/VEX handling, duplicate normalization, asset ownership and reachability analysis, automated ticketing/escalation, emergency patch deployment, scanner/ruleset administration, false-positive review, metrics and board reporting, penetration testing/red-team providers, and operating evidence that remediation SLAs are met.
