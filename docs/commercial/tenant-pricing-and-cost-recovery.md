# Tenant Pricing and Cost Recovery — Operating Process

**Status:** draft for review · **Scope:** full loan lifecycle — origination, servicing, collections, closure · **Companion artefact:** [`loanos-tenant-cost-and-pricing-model.xlsx`](loanos-tenant-cost-and-pricing-model.xlsx)

This document defines how LoanOS decides what to charge a tenant, who approves it, and what we must build before we can bill it. The workbook is the calculator; this is the process around it.

**Everything numeric here derives from the workbook's shipped placeholder assumptions.** No figure in either artefact is a quoted vendor price. Read §9 before any number leaves the building.

---

## 1. Coverage

| Dimension | Covered |
| --- | --- |
| Product journeys | 21 / 21 |
| Lifecycle stages | 12 / 12 — `application_capture` through `closure` |
| Integrations (`INT-*`) | 115 / 115 — 96 carry an explicit priced driver; 19 are absorbed by the cloud, governance or service sheets, or are internal capabilities with no external unit price |
| Cost drivers priced | 107 — 63 unit, 37 recurring, 7 admission |

Sheet `16_Coverage_Map` lists every integration and how it is treated. Nothing is silently omitted; anything absorbed elsewhere states where and why.

### Three cost classes

- **Class U — unit.** Fires N times against a countable basis: application, loan-month, EMI, bounced EMI, loan-year, closure, collection event.
- **Class R — recurring.** Scales with a *quantity driver* — branches, field devices, staff seats, partners, empanelled vendors, bank accounts, languages, data feeds. **Not** with loan volume.
- **Class P — platform.** Cloud, governance and support, allocated across tenants.

Class R is the one most cost models miss, and it is decisive: a 25-branch, 120-device tenant carries roughly ₹70 lakh a year of recurring cost whether it originates 200 loans a month or 20,000.

---

## 2. Pricing architecture

Five meters plus a one-time fee:

| Component | Basis | Recovers | Metered at |
| --- | --- | --- | --- |
| **Platform fee** | ₹/month, by deployment model × support tier | The per-tenant cost floor, including Class R | Subscription |
| **Decision fee** | ₹ per decisioned application | Verification work on files that never fund | `credit_decision` transition |
| **Origination fee** | ₹ per funded loan, by journey band | Origination value delivered | `disbursement` transition |
| **Servicing fee** | ₹ per active loan per month | The whole servicing and collections tail | Monthly book snapshot |
| **Pass-through** | Provider cost + handling markup | Bureau, KYC, AA, eSign, NACH, payout, reporting rails | Each `INT-*` adapter call |
| **Onboarding** | One-time, by deployment model | Implementation + admission due diligence | Contract signature |

### Why this shape

- **Not pure per-funded-loan.** That puts 100% of the tenant's funnel risk on us. At a 32% funded rate we pay verification cost on roughly three files for every one we bill. The decision fee shares that risk.
- **Not origination-only.** Post-origination cost averages **36% of lifetime cost** across the 21 journeys and exceeds 60% on some. An origination-only price structurally under-recovers.
- **Not pure subscription.** No revenue scaling, and every bureau price rise lands on our margin.
- **Not basis points on disbursement.** Cost is per-file and per-loan-month, not per-rupee — the workbook shows lifetime cost ranging from 12 to 289 bps for comparable work. A bps price is also uncomfortably close to revenue-sharing in a regulated lending context.
- **Not per application created.** The tenant pays for junk leads, will fight every invoice, and the meter is gameable both ways.

`credit_decision` and `disbursement` are governed lifecycle stage transitions carrying evidence and independent approval. A billing event anchored to a stage transition is auditable and hard to dispute.

---

## 3. Journey banding — do not quote one blended price

Lifetime cost per funded loan spans roughly **48x** across the 21 journeys. Sheet `14_Journey_Economics` computes it live.

| Band | Lifetime ₹/funded loan | Journeys |
| --- | --- | --- |
| **A — Light** | ≤ ₹2,000 | `consumer_durable_finance` (526), `gold_loan` (693), `microfinance_group_lending` (1,301), `agriculture_allied_finance` (1,668), `supply_chain_finance` (1,776), `personal_loan` (1,821), `co_lending_programme` (1,977) |
| **B — Standard** | ₹2,000–5,000 | `invoice_discounting` (2,350), `purchase_order_finance` (2,775), `professional_practice_loan` (2,936), `trade_finance_workflow` (3,623), `msme_working_capital` (4,072) |
| **C — Business / asset** | ₹5,000–10,000 | `msme_term_loan` (5,400), `personal_vehicle_loan` (6,598), `commercial_vehicle_finance` (8,305), `green_equipment_finance` (9,162), `equipment_machinery_finance` (9,251), `education_loan` (9,354) |
| **D — Secured / long-tenor** | > ₹20,000 | `loan_against_property` (23,429), `secured_business_loan` (23,710), `home_loan` (25,395) |

### Three findings that should change how you sell

**1. Affordability is inverted from cost.** `microfinance_group_lending` sits near the bottom in absolute cost (₹1,301) yet consumes ~289 bps of a ₹45,000 loan. `home_loan` costs 20x more per loan and consumes ~56 bps. Small-ticket journeys cannot carry a full-stack verification and servicing chain. The answer is **a lighter check set and a lighter servicing playbook, not a discount** — and each of those is a compliance decision, routed through `compliance-control-change`, not the deal desk.

**2. The servicing share varies enormously.** Post-origination cost is 5–7% of lifetime cost for the short-tenor trade journeys (`invoice_discounting`, `supply_chain_finance`) but 50–63% for `consumer_durable_finance`, `personal_vehicle_loan` and `co_lending_programme`. **The same price structure cannot fit both.** Trade receivables should be priced almost entirely on origination; consumer durable and vehicle finance must be priced on the book.

**3. Every journey's servicing cost exceeds a ₹14 servicing fee.** Cost per active loan-month runs ₹27 (gold, microfinance) to ₹113 (commercial vehicle). At the shipped assumptions the modelled servicing fee is below cost for **all 21 journeys** — the book would lose money every month on every product. This is the single most consequential correction the full-lifecycle model makes.

---

## 4. Operating loops

| # | Loop | Cadence | Owner | Gate |
| --- | --- | --- | --- | --- |
| 1 | **Rate card refresh** — sheets 2 and 3 from signed vendor contracts | Quarterly, plus off-cycle on any >10% provider change | Vendor management | No line may sit at `Low` confidence two quarters running without an owner and a date |
| 2 | **Quantity driver review** — branches, devices, seats, partners, feeds | Quarterly and on any tenant expansion | Deal desk | Class R cost moves with these, not with volume |
| 3 | **Deal sizing** — Sales completes `1_Inputs`; deal desk validates | Per deal | Deal desk | **No quote without funnel AND lifetime calibration** |
| 4 | **Approval** — margin floor check | Per deal | Per §5 | Quote is void if it post-dates a rate card refresh |
| 5 | **Metering and invoicing** | Monthly close | Finance | Metered pass-through must reconcile to provider invoices within ±2% |
| 6 | **Margin review** — per-tenant cohort | Monthly | Head of Revenue | Reviewed on **software margin**, never blended margin (§7) |
| 7 | **Re-price** | On trigger (§8) | Deal desk | — |

### Calibration is mandatory, and it is now two things

Origination cost scales inversely with the **funded rate**. Servicing cost scales with **effective life**; collections cost scales with the **delinquency profile**. All three are tenant-specific. Before quoting, obtain per journey:

- funnel: applications started → KYC completed → bureau pulled → decisioned → approved → accepted → disbursed;
- book: contractual tenor, actual average closure age (this gives the life factor), instalment frequency, bounce rate;
- delinquency: share of active loan-months in 1-30 / 31-90 / 90+ DPD.

If the tenant cannot supply these, quote from the conservative preset and put a re-price trigger at month 3 against measured data. Say so in the contract.

---

## 5. Approval thresholds

Read **software margin** from `13_Price_Card`, not blended margin.

| Software margin at quote | Approver |
| --- | --- |
| ≥ target | Sales lead |
| 10 pp below target to target | Head of Revenue |
| 20–10 pp below target | CFO |
| More than 20 pp below target | CEO, with written time-boxed strategic rationale |

**Hard floors — no approval level waives these:**

1. Never price below variable cost per application.
2. **Never price the servicing fee below cost per active loan-month.** Sheet 13 carries an explicit check for this. A deal can look profitable at origination and bleed on the book for the next eight years — long-tenor journeys are exactly where this hides.
3. Where break-even headroom is under 1.5x, a minimum committed monthly volume is contractual, not aspirational.
4. Never absorb bureau/KYC/AA/NACH/reporting-rail cost as non-pass-through in a fixed-price contract longer than 12 months. Those are third-party administered prices we do not control.
5. Onboarding fee may be discounted but never below 50% of modelled onboarding cost, which now includes admission due diligence (`INT-ADM-*`).

---

## 6. What we must build before we can bill this way

**This is the blocking gap.** `packages/core/src/platform/tenant-product-entitlements.js` establishes *what a tenant may use*. It does not record *what they used*. The integration map is explicit — INT-ADM-08 reads "Commercial controls only; no billing/tax/payment provider". **There is no usage meter, so today none of this is billable.** The cost of building and running it is itself priced, as driver R37.

### Required billable events

Append-only, tenant-scoped, emitted from the lifecycle:

| Event | Emitted at | Bills |
| --- | --- | --- |
| `meter.application.created` | `application_capture` | Nothing — volume telemetry only |
| `meter.decision.evaluated` | `credit_decision` transition | Decision fee |
| `meter.loan.disbursed` | `disbursement` transition | Origination fee |
| `meter.book.snapshot` | Monthly, per active loan | Servicing fee |
| `meter.provider.invoked` | Each `INT-*` adapter call, success or billable failure | Pass-through, at cost |
| `meter.collection.event` | Each collections contact, visit, retry or legal action | Collections pass-through and cost attribution |
| `meter.agent.usage` | INT-RSK-07 token/action metering | AI usage |
| `meter.storage.snapshot` | Monthly | Retained-evidence storage |

### Design constraints

- **Tenant isolation applies unchanged** — app-layer partition plus RLS, as with every other tenant-scoped store.
- **Idempotent.** A retried disbursement callback must not double-bill. Key on the lifecycle transition ID, not the request.
- **Reconcilable.** `meter.provider.invoked` totals must tie to the provider's invoice monthly, with a variance threshold and an exception queue. A pass-through line we cannot reconcile is a line we cannot defend in a dispute.
- **Attributable and immutable.** Billing disputes need the same evidence discipline as the audit chain.
- **Metering must NOT be fail-closed.** This is the one deliberate exception to the platform's default posture and must be stated explicitly in the ADR. Fail-closed governs *lending decisions* (INV-5): a decision that cannot be evidenced lands on `refer`/`deny`. Billing is not a lending decision. **A metering outage must never block an origination, a disbursement or a collections contact.** Meter asynchronously through a durable queue, degrade to replay-from-lifecycle-history, and reconcile after. Inverting this would mean a billing failure denies a borrower credit — both a conduct problem and a regulatory one.

### Sequencing

1. Emit and persist meter events, with no billing behaviour. This establishes ground truth and lets the model be validated against reality.
2. Reconciliation and variance reporting against provider invoices.
3. Rating and invoice generation.
4. Tax treatment and payment provider (see §9 on GST).

Step 1 alone converts this workbook from a projection into a measured model. Run it for at least one full quarter before repricing anyone.

---

## 7. Margin metric — manage the right number

Sheet `15_Sensitivity` shows both gross profit and margin **rising** with volume and asymptoting:

| Monthly applications | Gross profit ₹/yr | Blended margin | Software margin |
| --- | --- | --- | --- |
| 250 | (12,97,000) | −14.2% | −21.6% |
| 1,000 | 8,44,000 | 5.1% | 8.3% |
| 4,000 | 94,05,000 | 20.3% | 35.1% |
| 25,000 | 6,93,38,000 | 27.2% | 48.4% |
| 100,000 | 28,33,82,000 | 28.4% | 50.7% |

Two separate points, often conflated:

- **The shape is a fixed-base effect.** The per-tenant floor — isolated decision runtime (ADR 0003), allocated compliance base, support tier, and the whole Class R block — is incurred at any volume. Below roughly 1,000 applications a month this tenant is loss-making at the quoted price, and the cause is almost never the per-loan fee.
- **The ceiling is a pass-through effect.** Blended margin asymptotes near 28% because rebilled cost carries only the handling markup and permanently dilutes the percentage however efficient the platform becomes. Software margin asymptotes near 51%.

Manage to **software margin** and to **gross profit in rupees**. Never set a commission, an OKR or a board metric on blended margin percentage.

---

## 8. Re-price triggers

1. Two consecutive months outside ±30% of committed volume.
2. Any pass-through line moving more than 10%.
3. Journey mix shifting more than 15 percentage points between bands.
4. Measured funded rate below 80% of the quoted funnel.
5. **Measured effective life or delinquency more than 20% worse than quoted** — this hits servicing and collections cost directly.
6. Any quantity driver (branches, devices, seats, partners) moving more than 25%.
7. A regulatory change adding a mandatory check or report.
8. A deployment model change.
9. Annual escalator at contract anniversary.

---

## 9. Known gaps — what this model still does not cover

1. **Rate card confidence is the largest weakness.** `docs/architecture/integration-vendor-procurement-catalog.md` (baseline 15 July 2026) publishes a dated price for only **three** of the 107 drivers: MSG91 (SMS), Finvu (Account Aggregator), Cashfree (payout rails). The workbook is aligned to those three; every other line is explicitly RFQ and flagged orange in the *Public price anchor* column. Many also correspond to integrations the platform-module map records as *Missing* or *Bound/Mock*, so there is no contract to cite because the integration does not exist yet. Closing the RFQ set is the highest-value action to make this model quotable.
2. **Funnel, lifetime and delinquency are unmeasured.** All three are industry-shaped guesses. They drive origination, servicing and collections cost respectively. Standing up the meter (§6) replaces all three with data.
3. **Collection agency success commission is not modelled as a percentage.** The workbook prices agency *oversight* per case-month; the commission on amounts recovered (typically 2–8% early, 10–25% in hard buckets) is a credit cost carried by the tenant, not a platform cost — but if LoanOS ever intermediates it, it must be added.
4. **Credit loss is deliberately absent.** This is a platform cost model, not a credit model. Provisioning, write-offs and recovery rates belong to the tenant's P&L.
5. **Cost of float on pass-through.** We pay providers before we invoice. At the modelled volume, pass-through runs about ₹1.95 crore a year; on net-30 terms that is real working capital we lend the tenant interest-free. Price it in or shorten terms.
6. **GST treatment of pass-through — get tax advice before the first invoice.** Whether recoveries are billed as *pure agent* (no GST on the recovery) or as principal (GST on the full amount) changes the tenant's effective cost by 18% on the single largest line. Pure-agent treatment carries strict conditions on authorisation, separate disclosure and no margin on the recovered amount — which the handling markup may itself defeat. This is a tax position to be taken, not a modelling assumption we can make.
7. **Support cost is a tier average**, not measured per tenant. Instrument it.
8. **CAC, churn and expansion are absent.** This is unit economics, not LTV.
9. **Multi-year escalation.** Retained-evidence storage compounds 8x from year 1 to year 8. Price multi-year contracts against the average year, not year 1.

---

## References

| Anchor | Location |
| --- | --- |
| 21 canonical journeys and maturity | `docs/product/product-journey-platform-depth.json` |
| Lifecycle stages and stage evidence | `docs/architecture/composed-product-journey-lifecycle.md` |
| All 115 `INT-*` integrations and their real status | `docs/architecture/platform-module-integration-api-map.md` |
| Vendor prices, RFQ status, procurement baseline | `docs/architecture/integration-vendor-procurement-catalog.md` |
| 4 deployment models, 17 required tenant components | `packages/core/src/platform/saas-deployment-blueprints.js` |
| Per-tenant isolated decision runtime (the cost floor) | `docs/decisions/0003-decision-engine-pure-rust-per-tenant.md` |
| Tenant entitlement and subscription surface | `packages/core/src/platform/tenant-product-entitlements.js` |
| Regulatory control families | `docs/compliance/india-regulatory-register.md` |
| Model generator and verification harness | `docs/commercial/model-src/` |
