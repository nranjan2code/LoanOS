"""
LoanOS India — Tenant Cost & Pricing Model (LOS-first)
Generator for docs/commercial/loanos-tenant-cost-and-pricing-model.xlsx

Design notes
------------
Grounded in the repo, not generic SaaS pricing:
  * 21 canonical product journeys      -> docs/product/product-journey-platform-depth.json
  * LOS lifecycle stages               -> docs/architecture/composed-product-journey-lifecycle.md
  * External integration cost drivers  -> docs/architecture/platform-module-integration-api-map.md (INT-* IDs)
  * 4 SaaS deployment models + 17      -> packages/core/src/platform/saas-deployment-blueprints.js
    required tenant components
  * Entitlement/subscription surface   -> packages/core/src/platform/tenant-product-entitlements.js

Every rupee figure is an ASSUMPTION placeholder to be replaced with the tenant's real
vendor contracts. Confidence is declared per line on the rate card.
"""

# ---------------------------------------------------------------------------
# DRIVERS: the LOS external / unit cost drivers, mapped to INT-* integration IDs
# (id, name, INT id, stage, unit, low, base, high, confidence, pass_through, note)
# ---------------------------------------------------------------------------

DRIVERS = [
    ("D01", "Mobile/email OTP + delivery (DLT SMS / WhatsApp)", "INT-CUS-01", "application_capture", "per OTP sent", 0.16, 0.20, 0.30, "High", "No", "MSG91 public list: Rs 0.25 at 5k/mo, Rs 0.18 at 30k, Rs 0.16 at ~1m, +18% GST. Add DLT/operator charge."),
    ("D02", "Lead capture, dedupe and CRM sync", "INT-CUS-02", "application_capture", "per lead", 0.00, 0.50, 2.00, "Low", "No", "Zero if internal-only; priced if an external CRM seat/API is in the path."),
    ("D03", "Document upload + malware/DLP scan", "INT-CUS-04", "application_capture", "per document", 0.20, 0.60, 1.50, "Medium", "No", "Object storage PUT + AV/DLP scan. Excludes long-run retention (see 6_Cloud_Cost)."),
    ("D04", "DigiLocker consent + issued-document fetch", "INT-CUS-05", "application_capture", "per fetch", 2.00, 6.00, 12.00, "Medium", "Yes", "Aggregator fee. INT-CUS-05 is currently Missing in the integration map."),
    ("D05", "Device / SIM / IP fraud signal", "INT-LOS-09", "application_capture", "per check", 3.00, 7.00, 15.00, "Medium", "Yes", "Fraud intelligence vendor; priced per device fingerprint lookup."),
    ("D06", "PAN verification (Protean/NSDL)", "INT-LOS-01", "kyc_aml", "per verification", 1.50, 3.00, 6.00, "High", "Yes", "Well-benchmarked; aggregator markup over Protean base."),
    ("D07", "Aadhaar offline XML / QR / KUA eKYC", "INT-LOS-01", "kyc_aml", "per eKYC", 3.00, 8.00, 20.00, "Medium", "Yes", "UIDAI auth/eKYC fee plus AUA/KUA aggregator markup. Permitted-use only."),
    ("D08", "CKYC search + record download (CERSAI)", "INT-LOS-02", "kyc_aml", "per record", 0.50, 1.50, 3.00, "Medium", "Yes", "CERSAI download charge; low unit cost, high volume."),
    ("D09", "V-CIP session (platform + agent handling time)", "INT-LOS-03", "kyc_aml", "per session", 40.00, 85.00, 160.00, "Medium", "Yes", "Largest single KYC cost. Agent minutes usually exceed the platform fee."),
    ("D10", "Liveness / face match / spoof detection", "INT-LOS-03", "kyc_aml", "per check", 3.00, 7.00, 15.00, "Medium", "Yes", "Bundled into V-CIP by some vendors — avoid double counting."),
    ("D11", "AML / PEP / sanctions / adverse media screen", "INT-LOS-09", "kyc_aml", "per screen", 2.00, 6.00, 15.00, "Medium", "Yes", "Per subject screened; joint applicants and UBOs multiply this."),
    ("D12", "KYB — GSTIN / Udyam / MCA entity verification", "INT-LOS-04", "kyc_aml", "per entity", 5.00, 18.00, 45.00, "Low", "Yes", "INT-LOS-04 is Missing today; assumption is aggregator list price."),
    ("D13", "Director / signatory / UBO verification", "INT-LOS-04", "kyc_aml", "per person", 8.00, 20.00, 50.00, "Low", "Yes", "Scales with the number of directors/partners on the entity."),
    ("D14", "Credit bureau — consumer (CIBIL/Experian/Equifax/CRIF)", "INT-LOS-06", "specialist_assessment", "per pull", 30.00, 55.00, 90.00, "High", "Yes", "Volume-tiered. Multi-bureau strategy multiplies units, not unit price."),
    ("D15", "Credit bureau — commercial (CMR / CCR)", "INT-LOS-06", "specialist_assessment", "per pull", 150.00, 350.00, 700.00, "Medium", "Yes", "Commercial reports are 5-10x consumer. Dominates MSME cost per file."),
    ("D16", "Account Aggregator consent + FI data fetch", "INT-LOS-07", "specialist_assessment", "per successful fetch", 0.20, 3.00, 8.00, "Medium", "Yes", "Finvu public list: Rs 0.20-2.50 per fetch (or Rs 3-6 per active user-account), EXCLUDING FIP charges. Upper band carries the unknown FIP fee. Real driver is the retry multiplier, not the unit price."),
    ("D17", "Bank statement analysis (parse, tamper, categorise)", "INT-LOS-08", "specialist_assessment", "per analysis", 12.00, 35.00, 80.00, "Medium", "Yes", "INT-LOS-08 is Missing today. Priced per statement set, not per page."),
    ("D18", "Income / employment evidence (EPFO, ITR, 26AS, GST)", "INT-LOS-05", "specialist_assessment", "per fetch", 5.00, 15.00, 40.00, "Low", "Yes", "INT-LOS-05 is Missing today. Assumption is aggregator list price."),
    ("D19", "OCR / document extraction + authenticity", "INT-LOS-10", "specialist_assessment", "per page", 0.80, 2.50, 6.00, "Medium", "No", "Per page, not per document. Secured files run 40+ pages."),
    ("D20", "Field investigation / personal discussion visit", "-", "specialist_assessment", "per visit", 150.00, 350.00, 800.00, "Low", "Yes", "Human cost. Not an INT integration; included because it is real LOS cost."),
    ("D21", "Property valuation report", "INT-LOS-13", "specialist_assessment", "per report", 1500.00, 3000.00, 6000.00, "Medium", "Yes", "Empanelled valuer. Two valuations are common above a ticket threshold."),
    ("D22", "Legal / title search report", "INT-LOS-13", "specialist_assessment", "per report", 1500.00, 3500.00, 8000.00, "Medium", "Yes", "Empanelled advocate. Search period drives price."),
    ("D23", "Asset / vehicle inspection and valuation", "INT-LOS-13", "specialist_assessment", "per inspection", 300.00, 700.00, 1500.00, "Low", "Yes", "New asset = invoice check only; used asset = physical inspection."),
    ("D24", "Gold assay + dual-control custody handling", "INT-LOS-13", "specialist_assessment", "per pledge", 100.00, 250.00, 500.00, "Low", "Yes", "Assayer time + vault/custody handling, not the storage cost itself."),
    ("D25", "Decision engine evaluation (per-tenant Rust runtime)", "-", "credit_decision", "per evaluation", 0.05, 0.15, 0.40, "Medium", "No", "Marginal compute only. The runtime's fixed cost sits in 6_Cloud_Cost."),
    ("D26", "Governed AI / agent tokens and actions", "INT-RSK-07", "multiple", "per application", 1.00, 6.00, 25.00, "Low", "No", "Metered per INT-RSK-07. Rises steeply if agents summarise documents."),
    ("D27", "KFS + sanction letter generation and dispatch", "INT-LOS-17", "kfs_acceptance", "per dispatch", 0.30, 1.20, 3.00, "Medium", "No", "Multi-language dispatch + proof of delivery. Regulatorily mandatory."),
    ("D28", "eSign signature (Aadhaar eSign / DSC)", "INT-LOS-11", "contracting", "per signature", 8.00, 18.00, 35.00, "High", "Yes", "PER SIGNATURE, not per document. Co-borrowers/guarantors multiply."),
    ("D29", "eStamp facilitation fee (duty itself excluded)", "INT-LOS-11", "contracting", "per instrument", 10.00, 25.00, 60.00, "Medium", "Yes", "Statutory stamp duty is the borrower's/lender's, not a platform cost."),
    ("D30", "CERSAI security-interest registration", "INT-LOS-14", "contracting", "per filing", 50.00, 100.00, 250.00, "Medium", "Yes", "Statutory filing fee varies by loan amount and security type."),
    ("D31", "Insurance bind / policy issuance handling", "INT-LOS-14", "contracting", "per policy", 20.00, 60.00, 150.00, "Low", "Yes", "Handling fee only; premium is a borrower cost, not platform cost."),
    ("D32", "Penny-drop / penny-less bank account verification", "INT-LOS-12", "disbursement", "per verification", 2.00, 5.00, 10.00, "High", "Yes", "Re-run on every beneficiary change; retries matter."),
    ("D33", "Disbursement payout (NEFT / RTGS / IMPS API)", "INT-LOS-15", "disbursement", "per payout", 2.00, 10.00, 20.00, "Medium", "Yes", "Cashfree public list: virtual-account IMPS/NEFT/RTGS Rs 20/transaction. Negotiated payout rails run lower. INT-LOS-15 adapter is Missing today."),
    ("D34", "Escrow / co-lending funding instruction", "INT-LOS-16", "disbursement", "per instruction", 5.00, 20.00, 50.00, "Low", "Yes", "Co-lending only. Exact-paise split adds a reconciliation instruction."),
    ("D35", "eNACH / eMandate registration (UMRN)", "INT-LMS-02", "disbursement", "per mandate", 5.00, 14.00, 30.00, "Medium", "Yes", "Set up at LOS->LMS handoff; NPCI + sponsor bank fee."),
]

STAGES = [
    "application_capture",
    "kyc_aml",
    "specialist_assessment",
    "credit_decision",
    "kfs_acceptance",
    "contracting",
    "disbursement",
    "multiple",
]

# ---------------------------------------------------------------------------
# FUNNEL PRESETS: cumulative reach from 100 applications started.
# The disbursement row IS the funded rate. This is the single most
# leverage-heavy assumption in the whole model.
# ---------------------------------------------------------------------------

FUNNELS = ["Digital_Unsecured", "MSME_Business", "Secured_HighTouch", "Field_Group", "POS_Instant"]

FUNNEL_REACH = {
    "application_capture":   [1.00, 1.00, 1.00, 1.00, 1.00],
    "kyc_aml":               [0.78, 0.85, 0.92, 0.95, 0.94],
    "specialist_assessment": [0.68, 0.76, 0.88, 0.92, 0.90],
    "credit_decision":       [0.62, 0.70, 0.82, 0.90, 0.88],
    "kfs_acceptance":        [0.40, 0.48, 0.62, 0.80, 0.75],
    "contracting":           [0.35, 0.43, 0.56, 0.76, 0.70],
    "disbursement":          [0.32, 0.40, 0.52, 0.74, 0.68],
    "multiple":              [0.75, 0.80, 0.90, 0.93, 0.92],
}

# Attempts per successful unit (retries, re-pulls, provider failure).
ATTEMPTS = {
    "D01": 1.60, "D02": 1.00, "D03": 1.05, "D04": 1.20, "D05": 1.02,
    "D06": 1.05, "D07": 1.25, "D08": 1.10, "D09": 1.30, "D10": 1.20,
    "D11": 1.02, "D12": 1.08, "D13": 1.05, "D14": 1.02, "D15": 1.02,
    "D16": 1.45, "D17": 1.10, "D18": 1.20, "D19": 1.05, "D20": 1.10,
    "D21": 1.05, "D22": 1.05, "D23": 1.05, "D24": 1.02, "D25": 1.00,
    "D26": 1.00, "D27": 1.10, "D28": 1.20, "D29": 1.05, "D30": 1.05,
    "D31": 1.05, "D32": 1.15, "D33": 1.05, "D34": 1.05, "D35": 1.25,
}

ATTEMPT_NOTE = {
    "D01": "OTP resends are the norm on Indian mobile networks.",
    "D16": "AA fetch success rates remain well below 100%; each retry is billable.",
    "D09": "Dropped/rescheduled V-CIP sessions are charged.",
    "D35": "eNACH registration failure and re-attempt is common.",
    "D07": "Biometric/OTP failure and re-attempt.",
}


# ---------------------------------------------------------------------------
# PUBLIC PRICE ANCHORS
# docs/architecture/integration-vendor-procurement-catalog.md (baseline 15 Jul 2026)
# is the authoritative procurement record. It carries a DATED PUBLIC PRICE for only
# three of these lines; every other line there is explicitly RFQ. That is why most
# of this rate card is Medium/Low confidence: there is no published number to anchor to.
# ---------------------------------------------------------------------------

ANCHORS = {
    "D01": "MSG91 published list price (procurement catalogue §C)",
    "D16": "Finvu published pricing (procurement catalogue §B)",
    "D33": "Cashfree published pricing (procurement catalogue §C)",
}
DEFAULT_ANCHOR = "RFQ — no public price; placeholder pending vendor quotation"
