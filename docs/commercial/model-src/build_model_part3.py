"""
Phase 1 + 2 extension: the LOS coverage gaps, and the full loan-lifetime
(LMS / servicing / collections / closure) cost surface.

COST CLASSES
------------
Class U — unit cost, fires N times against a countable basis.
Class R — recurring subscription, scales with a QUANTITY driver (devices,
          branches, partners, feeds), not with loan volume. New in this phase.

UNIT BASES
----------
per_application      once per application STARTED, then scaled by funnel reach   (LOS)
per_loan_month       once per active loan per month of effective life            (LMS)
per_emi              once per scheduled instalment                               (LMS)
per_bounced_emi      once per failed presentment                                 (LMS)
per_loan_year        once per active loan per year                               (LMS)
per_closure          once at closure/release                                     (LMS/COLAT)
per_collection_event derived from the delinquency profile x attempt matrix       (COL)

The book model matters: servicing cost is driven by the STOCK of active loans,
which at steady state is (annual funded loans x effective life in years), not by
this year's origination flow.
"""

# ---------------------------------------------------------------------------
# PHASE 1 — the eight LOS coverage gaps found in the audit
# (id, name, INT id, basis, unit, low, base, high, confidence, pass_through, note)
# ---------------------------------------------------------------------------

LOS_GAP_DRIVERS = [
    ("D36", "Offline field work-pack sync and replay", "INT-CUS-07", "application_capture", "per work pack", 0.50, 2.00, 6.00, "Low", "No",
     "Encrypted work-pack lease, mutation/media replay and conflict resolution. Field journeys only; internal envelope controls exist, no external adapter."),
    ("D37", "Asset registry verification (VAHAN/RC, depository lien)", "INT-COLAT-01", "specialist_assessment", "per asset", 10.00, 30.00, 80.00, "Low", "Yes",
     "Vehicle RC/VAHAN, depository lien or invoice validation at origination. Distinct from the physical inspection in D23."),
    ("D38", "Agent knowledge retrieval (vector query)", "INT-RSK-08", "multiple", "per application", 0.50, 3.00, 12.00, "Low", "No",
     "Retrieval queries against the approved knowledge index. No retrieval or vector runtime exists yet; index storage is recurring (see R-series)."),
]

# ---------------------------------------------------------------------------
# PHASE 2 — servicing and closure (INT-LMS-*, INT-COLAT-*)
# ---------------------------------------------------------------------------

SERVICING_DRIVERS = [
    ("S01", "CBS / GL posting and acknowledgement", "INT-LMS-01", "per_loan_month", "per loan-month", 0.50, 1.50, 4.00, "Low", "No",
     "Journal submit, ack/reject, reversal and trial-balance totals against the tenant's core system."),
    ("S02", "NACH / eNACH presentment", "INT-LMS-03", "per_emi", "per presentment", 1.00, 3.00, 6.00, "Medium", "Yes",
     "NPCI charge plus sponsor-bank markup. Re-presentment after a bounce is charged again — see the bounce multiplier."),
    ("S03", "Bounce / return handling", "INT-LMS-03", "per_bounced_emi", "per return", 10.00, 25.00, 60.00, "Medium", "Yes",
     "Return processing and ops handling. The borrower-facing bounce charge is tenant REVENUE and is deliberately not netted here."),
    ("S04", "Receipt matching and reconciliation (UTR)", "INT-LMS-04", "per_emi", "per receipt", 0.30, 0.80, 2.00, "Low", "No",
     "Rail callback/file, bank statement and UTR match. Unmatched receipts drive an exception queue this model does not size."),
    ("S05", "Servicing notices (EMI, rate, penal, statement)", "INT-LMS-06", "per_loan_month", "per loan-month", 0.40, 1.00, 2.50, "Medium", "No",
     "2-3 regulated communications per loan-month across SMS/email/WhatsApp. Volume is regulatory, not discretionary."),
    ("S06", "Statement render, vault store and retention", "INT-LMS-07", "per_loan_month", "per loan-month", 0.20, 0.50, 1.50, "Low", "No",
     "DMS render/store/version. Retention compounds — the storage tail is modelled on the cloud sheet."),
    ("S07", "CIC credit furnishing (monthly submission)", "INT-LMS-08", "per_loan_month", "per account-submission", 0.30, 0.80, 2.00, "Medium", "Yes",
     "Monthly submission to all four CICs plus row-reject correction and resubmit. Mandatory, per account, for the whole life of the loan."),
    ("S08", "Ongoing KYC refresh / AA re-consent", "INT-LMS-09", "per_loan_year", "per loan-year", 8.00, 15.00, 40.00, "Low", "Yes",
     "Periodic CKYC/identity refresh and AA consent renewal. AA consents expire — re-consent is not optional."),
    ("S09", "Portfolio bureau review", "INT-LMS-09", "per_loan_year", "per review pull", 20.00, 35.00, 70.00, "Medium", "Yes",
     "Account-review enquiries are cheaper than origination pulls but are charged per account per cycle."),
    ("S10", "Ongoing AML rescreen", "INT-LMS-09", "per_loan_year", "per rescreen", 2.00, 5.00, 12.00, "Medium", "Yes",
     "Delta rescreen against updated sanctions/PEP/adverse-media lists."),
    ("S11", "Insurance renewal / collateral revaluation", "INT-LMS-10", "per_loan_year", "per loan-year", 150.00, 700.00, 2500.00, "Low", "Yes",
     "Secured journeys only. Renewal/lapse tracking, periodic revaluation and covenant status."),
    ("S12", "Refund / excess / failed-disbursement reversal", "INT-LMS-05", "per_loan_year", "per loan-year", 0.50, 2.00, 6.00, "Low", "No",
     "Cooling-off refunds and excess reversals. Low frequency, non-zero."),
    ("S13", "Restructure / transfer instruction", "INT-LMS-11", "per_loan_year", "per loan-year", 20.00, 60.00, 200.00, "Low", "No",
     "CBS/GL, mandate and assignee instruction. Modelled as an expected value across the book, not per event."),
    ("S14", "Closure: mandate cancel, NOC generation and delivery", "INT-LMS-12", "per_closure", "per closure", 20.00, 45.00, 120.00, "Medium", "No",
     "Mandate cancellation, NOC production and proof of delivery. Regulatorily time-bound."),
    ("S15", "Security registry satisfaction (CERSAI / ROC / RTO)", "INT-COLAT-04", "per_closure", "per filing", 50.00, 80.00, 200.00, "Medium", "Yes",
     "Charge satisfaction filing at closure. Secured journeys only. Statutory fee."),
    ("S16", "Custody return and release acknowledgement", "INT-COLAT-06", "per_closure", "per release", 50.00, 100.00, 250.00, "Low", "Yes",
     "Gold and other physical custody: dual-control release, inventory and acknowledgement."),
]

# ---------------------------------------------------------------------------
# PHASE 2 — collections and recovery (INT-COL-*)
# Units are derived: delinquent loan-months per bucket x attempts per month.
# ---------------------------------------------------------------------------

COLLECTION_DRIVERS = [
    ("C01", "Tele-collections (dialer, IVR, agent, recording)", "INT-COL-01", "per_collection_event", "per contact attempt", 3.00, 8.00, 20.00, "Low", "No",
     "Dialer/IVR platform plus agent handling minutes. DNC and recording retention obligations apply."),
    ("C02", "Digital collection retry (UPI / link / NACH)", "INT-COL-02", "per_collection_event", "per retry", 1.00, 2.50, 6.00, "Medium", "Yes",
     "Payment link or re-presentment attempt, status, settlement and receipt."),
    ("C03", "Field collection visit", "INT-COL-03", "per_collection_event", "per visit", 80.00, 150.00, 400.00, "Low", "No",
     "Agent time, travel, geo/photo/receipt capture and offline sync. Conduct rules constrain frequency and timing."),
    ("C04", "Agency oversight, roster and invoice handling", "INT-COL-04", "per_collection_event", "per case-month", 15.00, 40.00, 100.00, "Low", "No",
     "Agency capacity, conduct monitoring, SLA and invoice reconciliation. Excludes the agency's own success commission."),
    ("C05", "Legal case filing and eCourts tracking", "INT-COL-05", "per_collection_event", "per case", 1500.00, 5000.00, 20000.00, "Low", "Yes",
     "Advocate assignment, filing, cause-list/hearing/order tracking. Only the deepest bucket reaches this."),
    ("C06", "Security enforcement (notice, possession, custodian)", "INT-COL-06", "per_collection_event", "per enforcement", 2000.00, 8000.00, 30000.00, "Low", "Yes",
     "SARFAESI/notice delivery, possession, valuer and custodian orders. Secured journeys only."),
    ("C07", "Auction (publish, bidder KYC, certificate)", "INT-COL-07", "per_collection_event", "per auction", 1500.00, 5000.00, 15000.00, "Low", "Yes",
     "Publication, bidder KYC/deposit, bid register and sale certificate."),
    ("C08", "Recovery proceeds handling and GL posting", "INT-COL-08", "per_collection_event", "per recovery", 20.00, 60.00, 150.00, "Low", "No",
     "Payment/escrow/bank posting, expense invoice, surplus/refund and GL entry."),
    ("C09", "Repossession and yard management", "INT-COLAT-07", "per_collection_event", "per repossession", 3000.00, 9000.00, 25000.00, "Low", "Yes",
     "Asset-finance journeys: work order, inventory/condition, movement, yard fees and release."),
]

# Attempts per DELINQUENT LOAN-MONTH, by bucket. Shared across journeys; the
# journey-specific part is the delinquency distribution, not the playbook.
DPD_BUCKETS = ["1-30 DPD", "31-90 DPD", "90+ DPD"]
COLLECTION_ATTEMPTS = {
    #        1-30   31-90   90+
    "C01": [ 2.50,  4.00,   3.00],   # tele contact attempts per delinquent month
    "C02": [ 1.80,  2.20,   1.50],   # digital retries
    "C03": [ 0.05,  0.60,   0.90],   # field visits
    "C04": [ 0.20,  1.00,   1.00],   # agency case-months
    "C05": [ 0.00,  0.00,   0.020],  # legal cases initiated per delinquent month
    "C06": [ 0.00,  0.00,   0.015],  # enforcement actions (secured only, gated by journey)
    "C07": [ 0.00,  0.00,   0.008],  # auctions
    "C08": [ 0.10,  0.25,   0.30],   # recovery postings
    "C09": [ 0.00,  0.00,   0.012],  # repossessions (asset finance only, gated by journey)
}

# ---------------------------------------------------------------------------
# LOAN LIFETIME PROFILE per journey
# tenor_months, life_factor (prepayment/foreclosure), emi_per_year,
# bounce_rate, dpd share of active loan-months in each bucket
# ---------------------------------------------------------------------------

LIFETIME = {
    #                              tenor  life_f  emi/yr  bounce   1-30   31-90    90+
    "personal_loan":              (  36,  0.85,   12,     0.055,  0.040, 0.015, 0.025),
    "co_lending_programme":       (  36,  0.85,   12,     0.055,  0.042, 0.016, 0.026),
    "msme_working_capital":       (  12,  1.00,   12,     0.060,  0.050, 0.020, 0.030),
    "msme_term_loan":             (  48,  0.80,   12,     0.060,  0.050, 0.020, 0.030),
    "professional_practice_loan": (  60,  0.75,   12,     0.040,  0.030, 0.012, 0.018),
    "secured_business_loan":      ( 120,  0.55,   12,     0.045,  0.035, 0.014, 0.022),
    "loan_against_property":      ( 144,  0.50,   12,     0.040,  0.030, 0.012, 0.020),
    "home_loan":                  ( 240,  0.45,   12,     0.020,  0.015, 0.005, 0.008),
    "equipment_machinery_finance":(  60,  0.75,   12,     0.055,  0.045, 0.018, 0.028),
    "green_equipment_finance":    (  60,  0.75,   12,     0.050,  0.040, 0.016, 0.024),
    "personal_vehicle_loan":      (  60,  0.70,   12,     0.050,  0.040, 0.016, 0.024),
    "commercial_vehicle_finance": (  48,  0.75,   12,     0.080,  0.070, 0.030, 0.040),
    "gold_loan":                  (  12,  0.80,    4,     0.030,  0.020, 0.005, 0.003),
    "education_loan":             (  84,  0.70,   12,     0.035,  0.028, 0.012, 0.020),
    "agriculture_allied_finance": (  12,  1.00,    2,     0.070,  0.060, 0.025, 0.030),
    "microfinance_group_lending": (  24,  0.95,   12,     0.040,  0.030, 0.010, 0.015),
    "consumer_durable_finance":   (  12,  0.90,   12,     0.060,  0.050, 0.020, 0.025),
    "invoice_discounting":        (   3,  1.00,    1,     0.045,  0.035, 0.015, 0.020),
    "purchase_order_finance":     (   4,  1.00,    1,     0.050,  0.040, 0.018, 0.025),
    "supply_chain_finance":       (   3,  1.00,    1,     0.040,  0.030, 0.012, 0.018),
    "trade_finance_workflow":     (   6,  1.00,    2,     0.045,  0.035, 0.015, 0.022),
}

# Servicing driver units per basis-unit, by journey. 1.0 = the driver applies at
# its natural frequency; 0 = not applicable to this journey.
_BASE_SERV = {"S01":1,"S02":1,"S03":1,"S04":1,"S05":1,"S06":1,"S07":1,
              "S08":1,"S09":1,"S10":1,"S11":0,"S12":1,"S13":1,"S14":1,"S15":0,"S16":0}
def _serv(**over):
    d = dict(_BASE_SERV); d.update(over); return d

SERVICING_UNITS = {
    "personal_loan":               _serv(),
    "co_lending_programme":        _serv(S13=1.5),
    "msme_working_capital":        _serv(S11=0.5, S13=1.5),
    "msme_term_loan":              _serv(S11=0.4),
    "professional_practice_loan":  _serv(),
    "secured_business_loan":       _serv(S11=1, S15=1),
    "loan_against_property":       _serv(S11=1, S15=1),
    "home_loan":                   _serv(S11=1, S15=1),
    "equipment_machinery_finance": _serv(S11=1, S15=1),
    "green_equipment_finance":     _serv(S11=1, S15=1),
    "personal_vehicle_loan":       _serv(S11=1, S15=0.3),
    "commercial_vehicle_finance":  _serv(S11=1, S15=1),
    "gold_loan":                   _serv(S07=1, S09=0.3, S16=1, S13=0.2),
    "education_loan":              _serv(S11=0.4, S15=0.4),
    "agriculture_allied_finance":  _serv(S11=0.5, S15=0.5),
    "microfinance_group_lending":  _serv(S06=0.3, S09=1, S11=0),
    "consumer_durable_finance":    _serv(S08=0.3, S11=0),
    "invoice_discounting":         _serv(S11=0),
    "purchase_order_finance":      _serv(S11=0),
    "supply_chain_finance":        _serv(S11=0),
    "trade_finance_workflow":      _serv(S11=0.3),
}

# Which collection drivers are even available to a journey (secured enforcement,
# repossession and auction do not exist for an unsecured personal loan).
_ALL_COL = {c[0]: 1 for c in COLLECTION_DRIVERS}
def _col(**over):
    d = dict(_ALL_COL); d.update(over); return d

COLLECTION_APPLICABILITY = {
    "personal_loan":               _col(C06=0, C07=0, C09=0),
    "co_lending_programme":        _col(C06=0, C07=0, C09=0),
    "msme_working_capital":        _col(C06=0.5, C07=0.3, C09=0),
    "msme_term_loan":              _col(C06=0.4, C07=0.3, C09=0),
    "professional_practice_loan":  _col(C06=0, C07=0, C09=0),
    "secured_business_loan":       _col(C06=1, C07=1, C09=0),
    "loan_against_property":       _col(C06=1, C07=1, C09=0),
    "home_loan":                   _col(C06=1, C07=1, C09=0),
    "equipment_machinery_finance": _col(C06=0.5, C07=1, C09=1),
    "green_equipment_finance":     _col(C06=0.5, C07=1, C09=1),
    "personal_vehicle_loan":       _col(C06=0, C07=1, C09=1),
    "commercial_vehicle_finance":  _col(C06=0.3, C07=1, C09=1),
    "gold_loan":                   _col(C03=0.2, C05=0.1, C06=0, C07=1, C09=0),
    "education_loan":              _col(C06=0.3, C07=0.3, C09=0),
    "agriculture_allied_finance":  _col(C06=0.2, C07=0.2, C09=0),
    "microfinance_group_lending":  _col(C03=1.5, C05=0.1, C06=0, C07=0, C09=0),
    "consumer_durable_finance":    _col(C03=0.3, C05=0.2, C06=0, C07=0, C09=0),
    "invoice_discounting":         _col(C06=0.3, C07=0, C09=0),
    "purchase_order_finance":      _col(C06=0.3, C07=0, C09=0),
    "supply_chain_finance":        _col(C06=0.2, C07=0, C09=0),
    "trade_finance_workflow":      _col(C06=0.4, C07=0.2, C09=0),
}


# Attempts per successful unit for the drivers added in this phase.
ATTEMPTS_EXT = {
    "D36": 1.15, "D37": 1.05, "D38": 1.00,
    "S01": 1.00, "S02": 1.00, "S03": 1.00, "S04": 1.00, "S05": 1.00, "S06": 1.00,
    "S07": 1.05, "S08": 1.15, "S09": 1.02, "S10": 1.02, "S11": 1.05, "S12": 1.00,
    "S13": 1.00, "S14": 1.10, "S15": 1.05, "S16": 1.00,
    "C01": 1.00, "C02": 1.00, "C03": 1.00, "C04": 1.00, "C05": 1.00,
    "C06": 1.00, "C07": 1.00, "C08": 1.00, "C09": 1.00,
}

# Basis -> how many basis-units one funded loan generates over its life.
BASIS_QUANTITY = [
    ("per_loan_month",   "effective life in months"),
    ("per_emi",          "scheduled instalments over effective life"),
    ("per_bounced_emi",  "instalments x bounce rate"),
    ("per_loan_year",    "effective life in years"),
    ("per_closure",      "one per loan"),
]
