# Implementation, Migration, and Go-Live Governance

Status date: 2026-07-14

## Implemented scope

`packages/core/src/implementation-governance.js` and the tenant route module `apps/api/src/routes/implementation-controls.js` provide one auditable control chain from approved configuration through hypercare exit:

1. An implementation project freezes products, source systems, operating roles, target environment, configuration workbook/checksum, owner, data-freeze time, rollback plan, and maker-checker approval.
2. Source inventory and mapping retain every customer/application/loan/ledger/document/audit source, target, record count/checksum, required fields, versioned transformation checksum, cleansing exceptions, reconciliation method, and independent approval. A mapping with unresolved cleansing issues cannot drive a migration run.
3. Mock, dress-rehearsal, and final migration evidence reconciles source count to accepted plus rejected count and exact-paise source/target control totals. Unmapped entities, rejected records, total differences, reversed timestamps, or missing lineage fail visibly.
4. Opening-balance validation compares principal, interest, fees, ledger debits/credits, installment counts, and schedule checksums account by account. Any difference blocks the gate.
5. Parallel-run evidence requires at least five days and exact finance, regulatory, and portfolio count, amount, checksum, and unexplained-difference reconciliation.
6. UAT requires product, role, exception, and regulatory-control coverage, passed scenarios, and no unresolved high/critical defect. Role training retains modules, SOPs, assessment score, expiry, and approval; certification requires at least 80%.
7. Go-live readiness resolves the passed dress rehearsal, its balance validation, parallel run, UAT, every project-role certification, DR, security, provider readiness, and operations/finance/compliance sign-offs. Missing or expired evidence leaves readiness blocked.
8. Cutover requires a ready assessment and evidenced freeze, export, import, reconciliation, and switch. A failed step cannot be represented as success and requires rollback evidence. Hypercare exit requires at least seven days, no unresolved severe issue, and no issue SLA breach.

All records are stored inside the authenticated tenant partition, all mutation routes are role-gated, the authenticated actor must be the declared checker, and every mutation is added to the tenant audit chain with its evidence checksum.

## External operating boundary

The module governs evidence supplied by migration and implementation tooling; it does not extract a bank's legacy databases, cleanse source records, execute ETL, move document binaries, operate bank UAT, train staff, switch DNS/traffic, or run a production command. Those actions remain customer/vendor operations and must provide independently controlled source evidence. Production adoption also needs source-specific mapping packs, scale and performance validation, privacy/retention approval, rehearsal calendars, command-centre staffing, communications, and witnessed rollback/continuity exercises.

## API and verification

`GET /implementation/controls` returns the complete tenant projection. POST resources cover projects, mappings, migration runs, opening-balance validations, parallel runs, UAT campaigns, training certifications, go-live readiness, cutovers, and hypercare reviews. `tests/implementation-governance.test.js` proves configuration/mapping lineage, exact-paise failures, complete parallel/UAT evidence, joined readiness, rollback and hypercare gates, and authenticated tenant persistence.
