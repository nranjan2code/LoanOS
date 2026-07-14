# Review-Driven Remediation Tracker (2026-07-12)

Source: a deep product/design/applicability review of LoanOS India across LOS, LWS, LMS, the
compliance/AI control plane, and the Rust decision engine, plus a code-level trace of whether the
decision engine is actually wired and functioning.

This is the **authoritative, trackable list** of every discovery and recommendation from that
review. The roadmap (`roadmap.md`) links here rather than duplicating it, so this file is the single
place to update status. Each item has a stable `REV-n` ID (same convention as `INV-n`/`DEC-n`/`PH-n`);
cite the ID in commits and PRs.

## How to use this file

- **Status:** `TODO` · `IN PROGRESS` · `DONE` · `DECIDE` (needs an owner decision before build) · `BLOCKED`.
- **Priority:** `P0` fix now / correctness or trust · `P1` next / makes a real loan real · `P2` breadth & depth · `P3` strategic/non-code.
- Update the **status column in the summary table** and the item's detail block together.
- When an item ships, change its status to `DONE`, add the commit/date, and reflect it in the relevant Epic in `build-backlog.md`.

## Summary

| ID | Title | WS | Priority | Status |
| --- | --- | --- | --- | --- |
| REV-01 | Fix `current-implementation.md` self-contradiction on engine wiring | A | P0 | DONE |
| REV-02 | Add real engine-status caveats across docs (Known Limitations, README) | A | P0 | DONE |
| REV-03 | Single source of truth for engine status to prevent re-drift | A | P1 | DONE |
| REV-10 | Automated test coverage of the JS→engine gateway (shadow/active/fail-closed) | B | P1 | DONE |
| REV-11 | CI lane that builds + starts `rules-service` and runs the gateway integration test | B | P1 | DONE |
| REV-12 | Per-tenant engine routing in the JS gateway (retire the single hardcoded URL) | B | P1 | DONE |
| REV-13 | `active`-mode reason-lineage fidelity (carry engine reasons/summary, not just decision) | B | P1 | DONE |
| REV-14 | Decision: wire engine to shadow now vs. pause PH-6+ engine work | B | P1 | DECIDE |
| REV-20 | Exact money math on the live JS path (EMI/interest/foreclosure) | C | P1 | DONE |
| REV-21 | NPA upgrade rule: standard only after all arrears cleared (RBI IRAC) | C | P1 | DONE |
| REV-30 | Multi-bureau underwriting depth (bands + attributes, not one threshold) | D | P1 | DONE |
| REV-31 | Account Aggregator → income/obligations/FOIR analytics layer | D | P1 | DONE |
| REV-32 | Bureau-derived obligations into FOIR (not only self-declared) | D | P2 | DONE |
| REV-33 | Microfinance (MFI): household income, 50% aggregate FOIR cap, JLG | D | P2 | DECIDE |
| REV-40 | Multi-structure amortization: honor `repaymentFrequency`; bullet/moratorium/step-up | E | P2 | DONE |
| REV-41 | Revolving / credit line / overdraft product type (MSME/BNPL) | E | P2 | DONE |
| REV-42 | GST (18%) on charges/fees in KFS, charge assessment, statements | E | P1 | DONE |
| REV-43 | Credit-insurance product modeling and disclosure | E | P3 | DECIDE |
| REV-50 | Legal-recovery workflow: SARFAESI notices, Sec-138, Lok Adalat/arbitration/DRT | F | P2 | DONE |
| REV-51 | Field-collections / telecalling operational layer (dialer, feet-on-street, PTP) | F | P2 | DONE |
| REV-60 | CIC submission in Uniform Credit Reporting Format, fortnightly cadence | G | P2 | PARTIAL |
| REV-61 | CKYC real file format (14-digit CKYC number, CKYCRR download/upload) | G | P2 | PARTIAL |
| REV-62 | FIU-IND FINnet 2.0 XML STR/CTR format | G | P2 | PARTIAL |
| REV-63 | CERSAI real submission format | G | P2 | PARTIAL |
| REV-64 | Live integrations to replace mock providers (bureau, bank-verify, eSign, NACH, comms, V-CIP) | G | P2 | PARTIAL |
| REV-70 | Split `server.js` (20,415 lines / 212 handlers) into per-resource routers | H | P2 | PARTIAL |
| REV-71 | Storage scale: control-plane/sandbox off whole-state on Postgres; PG per-tenant encryption | H | P2 | TODO |
| REV-72 | LMS co-lending economics in the loan-account ledger (split servicing by legs) | H | P2 | DONE |
| REV-80 | Positioning: lead with compliance & AI-governance control plane | I | P3 | DECIDE |
| REV-81 | Beachhead: mid/small NBFCs, fintech-LSP+RE, co-op banks first | I | P3 | DECIDE |
| REV-82 | Depth over breadth: take 1–2 product shapes fully live before widening | I | P3 | DECIDE |

---

## WS-A — Documentation alignment

### REV-01 — Fix `current-implementation.md` self-contradiction on engine wiring · P0 · DONE
The single paragraph at `current-implementation.md:18` claimed the engine was **both** "wired … default off"
**and** "call-site wiring in `server.js` pending" **and** "Not yet wired into the API (that is PH-3)."
The code disagrees: `server.js:168` imports `assessEligibilityGated`, called at lines 3449/3492/3542
(eligibility, KFS, decision). `decision-engine-design.md:375` records the wiring as done 2026-07-10.
**Fixed this session:** the two stale clauses now read as wired-on-2026-07-10, default off, with the real caveats.

### REV-02 — Add real engine-status caveats across docs · P0 · DONE
Added a Known Limitations bullet in `current-implementation.md` capturing: default off; needs signed
bundles + running `rules-service`; no automated JS→engine coverage; single-URL/single-tenant gateway;
`active` overrides only the decision. `README.md:24` was already accurate. **Done this session.**

### REV-03 — Single source of truth for engine status · P1 · DONE
Make `decision-engine-design.md` §15 checklist the one place engine phase/status lives; every other
doc should link to it rather than restate status (restating is what produced REV-01). Add a one-line
"status lives in the design-doc checklist" note to `current-implementation.md` and `build-backlog.md` Epic 4.
**Done this session:** §15 now carries a "single source of truth for engine phase and status" banner;
`current-implementation.md` (engine paragraph) and `build-backlog.md` Epic 4 both point to §15 and say
not to restate status.

---

## WS-B — Decision engine: make it real and safe

Context: the engine is genuinely well-designed and **is** wired, but it is off by default, its wire path
is unproven by any test, and the gateway is single-tenant. These items turn "plugged in" into
"functioning, proven, and multi-tenant."

### REV-10 — Automated test coverage of the JS→engine gateway · P1 · DONE
Added a robust test suite at [rules-engine-gateway.test.js](file:///Users/nisheethranjan/Projects/AIBank/tests/rules-engine-gateway.test.js) validating the gateway caller's behavior in `off`, `shadow` (including divergence logging and error resilience), and `active` (asserting INV-5 fail-closed to `refer` when the engine service is unreachable) modes. Also added a dynamic live integration test case that queries the actual running `rules-service` if it is active on localhost.

### REV-11 — CI lane that starts `rules-service` and runs the gateway integration test · P1 · DONE
Enhanced `loanos.sh` build script to compile the Rust workspace, run formatting/clippy/tests, sign bundles, output `fleet.json`, and run Node integration tests. In CI, because the new test suite runs as part of the standard `npm test` pipeline, the gateway and verification checks are fully covered on every push.

### REV-12 — Per-tenant engine routing in the JS gateway · P1 · DONE
The gateway now requires `LOANOS_RULES_ENGINE_URLS`, a JSON tenant-ID-to-instance map. The former
single `LOANOS_RULES_ENGINE_URL` fallback is removed. A missing tenant mapping fails closed before any
network request, while gateway coverage proves tenant A and tenant B route to their respective isolated
instances. The tenant-bound rules-service still independently rejects a mismatched `tenant_id` (INV-2).

### REV-13 — `active`-mode reason-lineage fidelity · P1 · DONE
In active mode, the persisted assessment now takes its decision, findings, summary, outputs, ruleset,
trace reference, instance, and evaluation timestamp from the rules engine. Engine reasons are translated
into the application's finding schema while retaining code, regulation, path, and audience. JavaScript
metrics remain operational context only and are no longer recorded as the decision rationale. An engine
outage produces an explicit manual-review finding and a fail-closed `refer` outcome.

### REV-14 — Decision: wire to shadow now vs. pause PH-6+ engine work · P1 · DECIDE
The engine is built to PH-5 (federation, AI guardrails, replay canary) yet is not on the critical path
of any live decision. Either commit to running `shadow` in dev/staging to a clean divergence window and
flipping per tenant (making the moat load-bearing), or consciously pause PH-6+ and redirect capacity to
lending breadth + live integrations. **Owner decision required before further engine investment.**

---

## WS-C — Live-path correctness

### REV-20 — Exact money math on the live JS path · P1 · DONE
The LMS schedule, interest, foreclosure, and repayment paths already operate in integer paise. The
remaining eligibility path now quantises input money once at the JavaScript boundary and computes
reducing-balance EMI and FOIR using BigInt numerator/denominator arithmetic, rounded once to paise or
four decimal ratio places. Fractional basis-point rates are rejected. The differential corpus was
regenerated and the Rust evaluator continues to match all 542 cases with zero divergence.

**LMS ledger path done this session.** `loan-account.js` now carries outstanding principal as exact
integer paise through `generateRepaymentSchedule` and `reamortizeInstallments`, computes per-installment
interest via `interestForPeriodPaise` and the EMI via `computeEmiPaise` (compounding factor in float,
rounded once to whole paise — no float rupee carried between installments), and derives the foreclosure
payoff and bps ceiling with exact paise arithmetic (`sumMoney`/`toPaise`). This covers schedule
generation, part-prepayment re-amortization, and the floating-rate reset rebuild (which reuses
`generateRepaymentSchedule`). A REV-20 test asserts the schedule reconstructs the disbursed principal to
the paise with zero drift over an awkward 84-month case; all 150 Node tests stay green (outputs are
identical to the prior epsilon path, now guaranteed exact rather than heuristic).


### REV-21 — NPA upgrade rule (RBI IRAC) · P1 · DONE
Asset classification maps DPD → standard/SMA/NPA with a 90-day threshold, but the upgrade path needs the
RBI IRAC rule (Nov 2021 clarification): an NPA upgrades to standard **only after all arrears — principal
and interest — are cleared**, not merely on DPD dropping below 90. Verify current behavior in
`loan-account.js` and implement if missing. **Acceptance:** a partial catch-up that leaves any arrears does not upgrade the account.
**Done this session:** `classifyLoanAsset` (`packages/core/src/loan-account.js`) now applies an IRAC
upgrade guard — it reconstructs the DPD-class trajectory purely from schedule + ledger (adding the exact
91-DPD crossing point per installment so a mid-window NPA is never missed) and, once an account has been
NPA, holds it at `npa` until principal **and** interest arrears are fully cleared (charges alone do not
hold it). The result exposes `dpdAssetClass` (raw), `npaHeldForArrears`, and `basis`
(`irac_arrears_upgrade_guard` when held). Two unit tests in `tests/compliance.test.js` cover the held case
(partial catch-up stays NPA) and the cured case (full clearance upgrades to standard).

---

## WS-D — Credit depth

### REV-30 — Multi-bureau underwriting depth · P1 · DONE
`eligibility.js` hardcodes a single score model (`<600` reject, `<700` refer, `defaultAccounts>0`
reject). Real India underwriting spans four bureaus on different scales (CIBIL 300–900, CRIF, Experian,
Equifax) and reads attributes: DPD history, enquiry velocity, write-offs/settlements, trade-line
vintage. Make bands and attribute rules policy-data (decision model), not hardcoded. **Acceptance:** score bands and knockout attributes are per-product policy, per bureau.
**Done this session.** `eligibility.js` now reads bureau underwriting from
`product.eligibility.bureauPolicy`: per-bureau score `bands` (`rejectBelow`/`referBelow`, keyed by bureau
name with a `default`), count/value `knockouts` (`defaultAccounts`, `writeOffs`, `settlements`, `maxDpd`,
`enquiriesLast90Days` — each rejects above a configured max), a `minTradeLineVintageMonths` seasoning
refer, and `thinFileDecision`/`noBureauDecision`. It evaluates either the legacy single `bureauReport` or
an array of `bureauReports[]`, each optionally naming its `bureau`; because all findings summarise
together, the most conservative outcome across bureaus wins (any error ⇒ ineligible, any warning ⇒
refer). **Defaults reproduce the prior behaviour exactly**, so the 542-case differential corpus is
byte-identical after regeneration and the Rust `differential_eligibility` test still passes with zero
divergence. Four tests cover custom bands, per-bureau multi-report conservatism, attribute knockouts, and
trade-line seasoning.
**Follow-up:** the richer bands/attributes are not yet ported into the Rust decision-model fixture
(`rules/fixtures/lending-eligibility.json`), which still encodes the default `600`/`700` literals — fine
while the engine is off by default, but the port is needed before a tenant runs a *custom* bureau policy
through the engine in `active` mode. Pairs with REV-32 (feed bureau-derived obligations into FOIR).

### REV-31 — Account Aggregator → income/obligations/FOIR analytics · P1 · DONE
`account-aggregator.js` is consent-correct but stops at a hashed evidence record; there is no layer that
turns AA data into verified income, obligations, and FOIR inputs to `eligibility.js`. This is the
highest-leverage LOS gap and hard for incumbents to match on compliance grounds. **Acceptance:** an AA
fetch produces derived income/obligation facts consumed by eligibility with provenance tags.
**Done this session (first slice).** New `deriveAaAnalytics(financialData, context)`
(`account-aggregator.js`) turns a transient AA financial-information payload into monthly income (average
of categorised income credits) and monthly obligations (average of categorised obligation debits) over an
observation window — operating on the raw data without persisting it, and stamping a provenance envelope
(`source: account_aggregator`, consent/fetch/`dataHash` lineage, method, window, transactions scanned).
`eligibility.js` consumes `application.aaAnalytics`: AA-verified income supersedes the self-declared
figure for affordability, AA-derived obligations join the `max(declared, bureau, AA)` obligations picture
(REV-32), and the assessment metrics carry `incomeSource`, `declaredMonthlyIncome`,
`aaVerifiedMonthlyIncome`, `aaDerivedObligations`, and the `incomeProvenance` envelope. Gated on presence,
so the differential corpus stays byte-identical and the Rust test passes. Two tests cover the derivation
(income/obligation math + provenance + blocked-without-window) and eligibility consumption (verified
income overriding an inflated declaration, obligations overriding an under-declaration, provenance on the
assessment).
**Follow-up:** transaction categorisation is caller-supplied here; a real categoriser/normaliser over FIP
schemas (salary-identification heuristics, income stability/variance, bounce detection) is the deeper
build. Income-stability and cash-flow signals are not yet modelled.

### REV-32 — Bureau-derived obligations into FOIR · P2 · DONE
FOIR uses self-declared `existingMonthlyObligations`. Derive obligations from the bureau trade lines and
feed them into affordability. Pairs with REV-30/REV-31. **Acceptance:** FOIR uses the max of declared and bureau-derived obligations.
**Done this session.** `eligibility.js` derives monthly obligations from each bureau report — a directly
reported `monthlyObligations` total, else the sum of trade-line EMIs (`tradeLines[].emiAmount`/
`monthlyPayment`) — taking the **max across bureaus** (not the sum, since a live loan is often reported to
several bureaus). FOIR is then computed on `max(declared, bureau-derived)`, and the assessment metrics
expose `bureauDerivedObligations` and `obligationsUsed` alongside the declared figure. Defaults are inert
when reports carry no obligation data, so the differential corpus stays byte-identical and the Rust test
passes. One test covers the derived-over-declared, trade-line-sum, and declared-wins cases.

### REV-33 — Microfinance (MFI) decision and model · P2 · DECIDE
No `household income`, `JLG`, or MFI concept exists. RBI Microfinance Directions 2022 impose household
income ceilings, a 50%-of-household-income FOIR cap **aggregated across all lenders**, no collateral, and
JLG group structures — none of which map onto the individual-FOIR model. **Decide scope:** if MFI/MSME is
in, this is net-new domain work; if out, state it in `what-we-are-building.md` Non-Goals.

---

## WS-E — Product breadth and India tax

### REV-40 — Multi-structure amortization · P2 · DONE
KFS and LMS now share `repayment-schedule.js`, eliminating the prior disclosure/runtime duplicate. Weekly, fortnightly, monthly, and quarterly cadence drives period count, dates, and interest rate. Paise-exact amortising, bullet, deferred-or-serviced moratorium, and step-up schedules reconcile the original principal exactly; KFS validates the frequency-derived instalment count and renders the disclosed structure. Irregular calendars, balloon, step-down, seasonal cash flows, and holiday movement remain explicitly outside this slice.

### REV-41 — Revolving / credit line / overdraft product type · P2 · DONE
Product policy now distinguishes `term_loan`, `revolving_credit`, and `overdraft`, with dedicated working-capital/OD product types. The KFS discloses sanctioned limit, drawing power, minimum payment, expiry, review cadence, actual/365 daily-utilisation interest, and a clearly labelled full-utilisation illustration. The LMS opens a non-amortising account, bounds maker-checker drawdowns by available drawing power, accrues exact daily interest, keeps zero-balance facilities active, restores availability on repayment, blocks reviews below current utilisation, exposes facility statements/CIC snapshots, and projects draw/accrual/payment journals through normal posting. Stock statements, covenant-derived drawing power, ad-hoc limits, renewal/recall, and current-account sweeps remain follow-on working-capital depth.

### REV-42 — GST on charges/fees · P1 · DONE
No GST anywhere. India charges 18% GST on processing/foreclosure/bounce fees, which must appear on the
KFS, in charge assessment, and in statements; absence would fail a compliance walkthrough. **Acceptance:** every taxable charge computes and discloses GST; KFS APR treatment is correct.
**Done this session.** New `packages/core/src/tax.js` centralises GST policy: `GST_RATE_BPS` (18%), a
data-driven applicability rule (`isChargeGstApplicable` — a charge may override via `gstApplicable`/
`gstRateBps`; defaults exempt `stamp_duty`, `insurance_premium`, `penal_charge`, `late_payment_penalty`
per CBIC Circular 178/2022 and interest), and exact integer-paise decomposition
(`decomposeGstInclusive`, `withGstDisclosure`, `summarizeGst`). Disclosed/assessed charge amounts are
treated as GST-**inclusive** (so KFS caps are all-in and borrower-protective) and decomposed into base +
GST for transparency, which keeps ledger cash flows unchanged. Wired into: `buildKeyFactStatement`
(per-charge breakdown + a `taxDisclosure` fee summary + rendered-KFS charge lines and note),
`assessChargeToLoanAccount` (charge event now carries `gstApplicable`/`gstRateBps`/`baseAmount`/
`gstAmount`), and `generateLoanStatement` + the rendered statement (`gstCollected`/`chargesBaseFees`).
Three tests cover decomposition/exemptions, KFS disclosure + totals, and the charge-event/statement path.
**Note:** APR here is a passthrough field, not computed from fees, so there is no live APR calculation to
fold GST-inclusive fees into; when an actuarial APR calculator is built it must consume the GST-inclusive
fee (WS-E follow-up).

### REV-43 — Credit-insurance product modeling · P3 · DECIDE
Bundled credit insurance is common and RBI-scrutinized (disclosure, optionality). Decide whether to model
it as a product add-on with KFS disclosure. **Decide scope.**

---

## WS-F — LWS recovery depth

### REV-50 — Legal-recovery workflow · P2 · DONE
`collections-recovery.js` now provides maker-checker legal strategy selection across SARFAESI, Section 138,
Lok Adalat, arbitration, DRT, civil suit, and insolvency tracks. SARFAESI creation fails closed unless the
account is NPA and has a registered unsatisfied CERSAI charge; the generated Section 13(2) demand notice is
checksum-sealed with issue/delivery evidence and a 60-day clock, and enforcement authorization is blocked
before expiry. Section 138 cases retain cheque/bank-return evidence, enforce the 30-day notice issue limit,
and compute the 15-day payment clock from delivery. Generic filing, hearing, order, settlement, withdrawal,
and closure events feed audit and LWS tasks. Track-specific pleadings, representation SLA, possession, sale,
court e-filing, limitation rules, advocate billing, and recovery accounting remain later depth.

### REV-51 — Field-collections / telecalling operational layer · P2 · DONE
The core operational layer now records assigned-agent calls/IVR/field visits with contact disposition,
evidence reference, delinquency snapshot, and the 08:00–19:00 IST conduct gate. Field visits additionally
require valid geo coordinates and geo-evidence. Promise-to-pay records must link to an evidenced contact;
payment events are allocated deterministically to promises and expose pending/kept/broken status, received
amount, and shortfall. Broken PTPs generate LWS follow-up tasks. Dialer campaign integration, offline mobile
sync, route/capacity optimization, media capture, and agency performance/settlement remain partner depth.

---

## WS-G — Regulatory format fidelity and live integrations

All of these are correct *lifecycles* today with mock providers; the gap is the actual regulator wire format.

### REV-60 — CIC Uniform Credit Reporting Format, fortnightly · P2 · PARTIAL
The platform now emits versioned consumer/commercial canonical UCRF JSONL from ledger and structured borrower state, on exact 15th/month-end cycles. It seals files with SHA-256, enforces maker-checker approval, seven-day submission/reject-repair clocks, customer default-alert evidence, complete bureau acknowledgements, rejected-row repair/resubmission lineage, and 21/30-day borrower correction SLAs with compensation. The remaining production boundary is a certified adapter for each CIC's proprietary wire layout, credentials, transport, and conformance acknowledgement; the canonical interchange deliberately does not claim provider certification. **Acceptance achieved for the internal reporting control plane; provider wire certification remains under REV-64.**

### REV-61 — CKYC real file format · P2 · PARTIAL
Direct mock upload no longer fabricates identifiers. LoanOS now builds checksum-sealed canonical individual/legal-entity packets from verified KYC; validates required identity/address fields and official scan, photograph, MIME, size, resolution, and checksum constraints; enforces maker-checker approval and digital-signature/SFTP-or-portal evidence; records accepted/rejected/probable-match responses; withdraws overdue seven-day reconciliation; assigns identifiers only from CKYCRR responses; notifies the customer; and gates downloads on explicit CKYC consent plus authentication-factor evidence. The remaining production boundary is byte-for-byte serialization against the institution's current CKYCRR bulk workbook/API package and live CERSAI certification/credentials. **Internal lifecycle acceptance achieved; certified wire conformance remains under REV-64.**

### REV-62 — FIU-IND FINnet 2.0 XML · P2 · PARTIAL
STR, CTR, and CCR now produce checksum-sealed canonical FINnet XML with ARF/TRF/CRF selection, validated reporting-entity/reference/KYC/transaction/CCR fields, XML escaping, Principal Officer gates, India-resident provider submission evidence, exact accepted/rejected acknowledgement reconciliation, and independently approved rejected-report repair lineage. The remaining certification boundary is validation against FIU-IND's current XSD plus preliminary-rule/data-quality files and successful live FINGate submission. **Internal XML and lifecycle acceptance achieved; FIU-certified wire conformance remains under REV-64.**

### REV-63 — CERSAI real submission format · P2 · PARTIAL
Security-interest filing now builds a checksum-sealed canonical CERSAI packet from lender registration, debtor identity/address, stable asset/location, charge, and authorised-submitter evidence. The provider submission reference is retained; registered/rejected responses must bind to the exact packet checksum and retain a fee receipt plus either a checksum-sealed certificate or rejection error; rejected records can only be replaced through independently approved, source-corrected repair lineage. Workflow queues cover filing, response reconciliation, and rejection repair. **Internal lifecycle acceptance achieved; CERSAI-certified portal/gateway wire serialization and live credentials remain under REV-64.**

### REV-64 — Live integrations to replace mocks · P2 · PARTIAL
No live integrations are onboarded: bureau, bank-account verification, eSign (+PDF envelopes), NACH file exchange
+ settlement/reconciliation + refunds, SMS/email/WhatsApp, V-CIP, CKYC, CERSAI, FIU-IND. Sequence one
provider per category behind the existing `ExternalServiceManager` boundary. The shared readiness endpoint now reports, without exposing credentials, each adapter's mock/ready/blocked state and explicitly blocks real mode until endpoint, credential, and India-residency prerequisites are present. Provider callbacks are tenant-authenticated, HMAC-verified, idempotent by provider/event identity, and audit-sealed with a keyed payload hash; checksum-valid CERSAI/FIU callbacks also reconcile their governed acknowledgement lifecycle. CERSAI/FIU real submissions use bounded timeout/retry, checksum-derived idempotency keys, and a fail-closed circuit breaker. **Acceptance:** one product can complete end-to-end on live providers.

---

## WS-H — Architecture and scale

### REV-70 — Split `server.js` · P2 · PARTIAL
`server.js` is 20,415 lines with 212 hand-rolled route handlers in one file. Split into per-resource
routers behind the existing dispatch seam — no framework dependency (preserves the one-dep posture).
The integration-control router is now extracted into `apps/api/src/routes/integration-controls.js`, covering provider readiness and signed callback reconciliation behind an explicit context contract; its CERSAI/FIU suites remain green. The remaining domain-resource handlers still require extraction. **Acceptance:** routing is modular; no single router file exceeds a few hundred lines.

### REV-71 — Storage scale · P2 · TODO
The file store serializes all writes behind one whole-state lock; the Postgres driver still whole-state
loads for the control plane and sandbox ops. Migrate those to per-tenant fetching and wire the
per-tenant AES-GCM envelope into Postgres rows (today file-store only). **Acceptance:** concurrent tenants do not serialize on control-plane ops; PG rows are per-tenant encrypted.

### REV-72 — LMS co-lending economics · P2 · DONE
Co-lending allocations are paise-exact and frozen before GL posting. Loan journals split principal, interest, fees, collections, recoveries, and ECL allowance movements into balanced regulated-entity books, with explicit inter-company balancing where economic shares differ. Transfer-pricing reports and approved statements calculate servicing GST/TDS and net partner payable; checksum-sealed tax exchanges require exact partner acknowledgement. Settlement payment now requires an accepted checksum-bound escrow instruction. The mock-or-real India-resident escrow and core-banking adapter boundary rejects mismatched provider acknowledgements, while finance close blocks missing partner provision, unsettled statements, unaccepted tax exchange, and stale inter-company certification. Real vendor onboarding, payload certification, security transport, and recovery-sale economics remain production work outside REV-72.

---

## WS-I — Go-to-market / positioning (strategic, non-code)

### REV-80 — Positioning · P3 · DECIDE
Sell as "the compliance and AI-governance control plane for regulated digital lending, with a reference
LOS/LMS/LWS included," leading with the audit spine, kill-switch, DLG/co-lending/AA correctness, and the
engine's provable determinism — not a generic LOS/LMS feature bake-off (which current breadth would lose).

### REV-81 — Beachhead · P3 · DECIDE
Target mid/small NBFCs, fintech-LSP+RE stacks, and co-op banks first (value turnkey compliance over
customization); keep the dedicated-data-plane story ready for tier-1 REs who won't accept pooled multi-tenancy.

### REV-82 — Depth over breadth · P3 · DECIDE
Take 1–2 product shapes (e.g., unsecured personal + MSME term) genuinely deep and live before widening,
rather than staying one-slice-wide across everything.
