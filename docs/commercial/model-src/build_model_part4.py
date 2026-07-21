"""
Phase 3: recurring subscriptions (Class R) and the platform-side modules
(INT-LWS-*, INT-REG-*, INT-FIN-*, INT-PRT-*, INT-PLT-*, INT-ADM-*), plus the
coverage map that makes "did we cover everything?" answerable inside the model.

Class R costs scale with a QUANTITY DRIVER (devices, branches, seats, partners,
feeds, bank accounts), not with loan volume. That distinction is the reason a
small tenant with a large branch network can cost more to serve than a large
digital-only one at ten times the origination volume.
"""

# (id, name, INT ids, quantity basis, low, base, high, confidence, pass_through, note)
RECURRING_DRIVERS = [
 # --- customer channel and field ---
 ("R01","Mobile device management licence","INT-CUS-06","field_devices_month",80,150,400,"Low","No",
  "Per enrolled field device per month. MDM enrol/attest/compliance/wipe. Live adapter missing today."),
 ("R02","Device attestation and certificate lifecycle","INT-PLT-13","field_devices_month",20,35,90,"Low","No",
  "Certificate issue/rotate/revoke per managed device. Often bundled with R01 — check before adding both."),
 ("R03","Branch, agent and territory master sync","INT-CUS-03","branches_month",100,250,700,"Low","No",
  "Agent/branch/territory/credential/capacity master sync with change and revoke totals."),
 ("R04","Vernacular content production and approval","INT-CUS-08","languages_year",15000,35000,90000,"Low","No",
  "Per approved language per product version per year. RBI requires KFS and key notices in a language the "
  "borrower understands — this is a regulatory cost, not a UX nicety. Dispatch is separately metered (D27)."),
 # --- risk and model operations ---
 ("R05","Reference data feeds (benchmarks, calendars, indices)","INT-RSK-06","reference_feeds_year",50000,150000,450000,"Low","Yes",
  "Benchmark rates, business calendars, geography, industry and collateral indices with effective date and checksum."),
 ("R06","Model operations: drift, bias and performance feeds","INT-RSK-05","governed_models_year",40000,90000,250000,"Low","No",
  "Per governed model per year. Registry/artifact/feature feed plus drift and bias metrics."),
 ("R07","Agent knowledge index storage and refresh","INT-RSK-08","vector_gb_month",150,300,800,"Low","No",
  "Per GB-month of approved knowledge index, including re-embedding on source change."),
 # --- lending workspaces and staff ---
 ("R08","HRMS worker, position and JML feed","INT-LWS-01","staff_seats_month",15,30,80,"Low","No",
  "Worker/position/manager/branch/leave/delegation deltas that drive staff authority and routing."),
 ("R09","Enterprise IdP and SCIM provisioning","INT-LWS-02","staff_seats_month",40,110,300,"Medium","No",
  "Per active user per month, plus MFA/conditional-access and governance tier. Procurement catalogue marks this RFQ."),
 ("R10","Task and escalation notifications (staff)","INT-LWS-03","staff_seats_month",10,20,60,"Low","No",
  "Email/SMS/WhatsApp/voice/pager to staff, with delivery callbacks. Distinct from borrower communications."),
 ("R11","Evidence, committee and minutes vault","INT-LWS-04","staff_seats_month",20,40,120,"Low","No",
  "DMS upload/version/download, legal hold, signed minutes and manifest."),
 ("R12","External work-order routing platform","INT-LWS-05","vendor_panel_month",100,200,600,"Low","No",
  "Per empanelled valuer/advocate/agency/custodian/insurer per month. The orders themselves are metered elsewhere."),
 ("R13","Complaints and Ombudsman handling (RBI CMS)","INT-LWS-06;INT-REG-07","tenant_month",5000,12000,35000,"Low","No",
  "Complaint intake/export, RBI CMS reference/status/closure evidence and response packs."),
 ("R14","Court and regulator task tracking","INT-LWS-07","tenant_month",3000,7000,20000,"Low","No",
  "Filing accepted/rejected, hearing/order, response and due-date tracking."),
 # --- regulatory reporting rails ---
 ("R15","CKYCRR submission channel and AMC","INT-REG-01","tenant_month",8000,18000,50000,"Low","Yes",
  "Upload/update, signed submit, accept/reject/probable-match repair."),
 ("R16","CIC membership and annual minimums (4 bureaus)","INT-REG-02","tenant_year",200000,400000,900000,"Medium","Yes",
  "Membership, setup and annual minimum commitments across TransUnion CIBIL, Experian, Equifax and CRIF. "
  "SEPARATE from the per-enquiry price in D14/D15 — a commonly missed fixed cost."),
 ("R17","FIU-IND FINnet submission channel","INT-REG-03","tenant_month",5000,10000,30000,"Low","Yes",
  "STR/CTR XML validate/sign/submit/poll/repair/acknowledge."),
 ("R18","CERSAI membership and AMC","INT-REG-04","tenant_year",50000,100000,300000,"Low","Yes",
  "Registry membership. Per-filing fees are metered separately (D30, S15)."),
 ("R19","RBI CRILC / SMA transmission","INT-REG-05","tenant_month",4000,9000,25000,"Low","Yes",
  "Extract/validate/sign/transmit/acknowledge/amend."),
 ("R20","CIMS / XBRL / PSL / DLA reporting","INT-REG-06","tenant_month",8000,16000,45000,"Low","Yes",
  "Taxonomy sync, generate/validate/sign/submit/reject/acknowledge."),
 ("R21","Evidence anchoring and trusted timestamping","INT-REG-08;INT-PLT-04","tenant_month",3000,7000,20000,"Low","No",
  "WORM/object-lock, legal hold, external timestamp/anchor and verification. Underpins INV-8/INV-12 replayability."),
 ("R22","Regulatory change and circular feed","INT-REG-09","tenant_year",100000,250000,700000,"Low","No",
  "Circular/legal update feed with obligation mapping evidence. Also consumed at platform level."),
 # --- finance and accounting ---
 ("R23","CBS / GL connector licence","INT-FIN-01","tenant_month",15000,35000,100000,"Low","No",
  "Master/chart sync, journal, ack/reject, reversal and trial-balance totals against the incumbent core."),
 ("R24","Bank reconciliation feed (MT940 / BAI / API)","INT-FIN-02","bank_accounts_month",500,1200,4000,"Low","No",
  "Per operating/escrow/collection account per month."),
 ("R25","Rail settlement reconciliation","INT-FIN-03","tenant_month",5000,11000,30000,"Low","No",
  "Settlement, fees/tax, refund/chargeback/return, payout and invoice reconciliation."),
 ("R26","Escrow and co-lender statement / split","INT-FIN-04","tenant_month",8000,18000,50000,"Low","No",
  "Co-lending arrangements only. Balance/statement, funding/settlement/split, partner GL and acknowledgement."),
 ("R27","GST / e-invoice (GSP-ASP)","INT-FIN-05","tenant_month",5000,10000,30000,"Medium","No",
  "GSTIN auth, IRN/invoice/credit note, return/challan/reject/acknowledge."),
 ("R28","TDS and income-tax filing","INT-FIN-06","tenant_month",4000,8000,22000,"Low","No",
  "Deduction/challan/return/correction/certificate and acknowledgement."),
 ("R29","Treasury / ALM benchmark and yield feeds","INT-FIN-07","tenant_year",150000,300000,800000,"Low","Yes",
  "Bank balances, facilities, benchmark/yield/FX and maturity feeds."),
 ("R30","Vendor and partner payables (ERP connector)","INT-FIN-08","tenant_month",5000,9000,25000,"Low","No",
  "ERP invoice, beneficiary validation, payout and reconciliation."),
 # --- partner / LSP ---
 ("R31","Partner onboarding, identity and entitlements","INT-PRT-01;INT-PRT-03","partners_month",150,300,800,"Low","No",
  "Per active partner per month: KYB refresh, partner IdP/SCIM or user feed, territory/role/credential revoke."),
 ("R32","Partner lead and service exchange","INT-PRT-02","partners_month",100,200,600,"Low","No",
  "Lead/application/status/document/consent exchange and dedupe."),
 ("R33","Partner commission, invoice and settlement","INT-PRT-04;INT-PRT-05","partners_month",200,400,1000,"Low","No",
  "Event/statement, GST/TDS, dispute, approval, beneficiary validation, payout and reconciliation."),
 ("R34","Partner oversight and SLA telemetry","INT-PRT-06","partners_month",80,150,400,"Low","No",
  "Incident/complaint/conduct/capacity/exit telemetry and evidence."),
 # --- platform data and billing ---
 ("R35","CDC, warehouse and lake pipeline","INT-PLT-09","tenant_month",10000,22000,70000,"Low","No",
  "Log CDC, schema, checkpoint/backfill, sink, data quality, lineage and marts."),
 ("R36","BI datasets, dashboards and row-level access","INT-PLT-10","bi_seats_month",800,1500,4000,"Low","No",
  "Per BI seat per month with row-level tenant access enforcement."),
 ("R37","Tenant billing: meter, invoice, tax, payment","INT-PLT-12;INT-ADM-08","tenant_month",6000,12000,35000,"Low","No",
  "DOES NOT EXIST YET. INT-ADM-08 records 'Commercial controls only; no billing/tax/payment provider'. "
  "This line is what it will cost to run the meter this whole model depends on."),
]

# One-time per-tenant admission costs (INT-ADM-*) — these flow into onboarding cost.
ADMISSION_DRIVERS = [
 ("A01","Signup contact verification and invitations","INT-ADM-01",500,1200,4000,"Low",
  "Work-email and mobile OTP, invite/expiry, DLT template, delivery/bounce."),
 ("A02","Legal-entity and tax identity verification","INT-ADM-02",2000,4500,12000,"Low",
  "MCA company/LLP master, CIN/LLPIN, directors/signatories, GSTIN, PAN/TAN, Udyam status and change evidence."),
 ("A03","Regulated-entity authority verification","INT-ADM-03",1000,2500,8000,"Low",
  "RBI and other-authority current/cancelled lists, licence/CoR category and layer."),
 ("A04","Representative authority and signature validation","INT-ADM-04",3000,7000,20000,"Low",
  "Director/DIN/signatory match, board resolution, DSC/eSign chain, CRL/OCSP and long-term validation."),
 ("A05","Corporate domain and contact assurance","INT-ADM-05",500,1200,4000,"Low",
  "DNS TXT challenge, RDAP/WHOIS, MX/mailbox, domain age and reputation."),
 ("A06","Signup abuse and fraud defence","INT-ADM-06",200,600,2500,"Low",
  "WAF/rate-limit/bot challenge, IP/device/email/phone/SIM and velocity intelligence at admission."),
 ("A07","Contract and outsourcing due diligence","INT-ADM-07",15000,35000,90000,"Low",
  "NDA/MSA/DPA/SLA/order-form eSign, questionnaire and evidence exchange, subprocessor/BCP/DR/exit approval."),
]

# Quantity drivers the tenant supplies on the inputs sheet.
QUANTITY_BASES = [
 ("field_devices_month",  "Field devices under management",        120, "per device / month"),
 ("branches_month",       "Branches / territories",                 25, "per branch / month"),
 ("staff_seats_month",    "Staff seats (all workspaces)",          260, "per seat / month"),
 ("bi_seats_month",       "BI / analytics seats",                   15, "per seat / month"),
 ("partners_month",       "Active partners / LSPs / DSAs",          40, "per partner / month"),
 ("vendor_panel_month",   "Empanelled valuers, advocates, agencies",35, "per vendor / month"),
 ("bank_accounts_month",  "Operating, escrow and collection accounts",8,"per account / month"),
 ("languages_year",       "Approved vernacular languages",           6, "per language / year"),
 ("reference_feeds_year", "Reference data feeds subscribed",         4, "per feed / year"),
 ("governed_models_year", "Governed models under monitoring",        7, "per model / year"),
 ("vector_gb_month",      "Agent knowledge index (GB)",             40, "per GB / month"),
 ("tenant_month",         "Tenant (flat)",                           1, "per tenant / month"),
 ("tenant_year",          "Tenant (flat)",                           1, "per tenant / year"),
]

# ---------------------------------------------------------------------------
# COVERAGE CLASSIFICATION for INT IDs not carried by any priced driver.
# Every one of the 115 IDs must land in exactly one bucket, and "NOT COSTED"
# must remain visible rather than quietly absorbed.
# ---------------------------------------------------------------------------

COVERED_ELSEWHERE = {
 # absorbed by the per-tenant cloud infrastructure sheet
 "INT-PLT-02": ("Cloud sheet", "keys_secrets component"),
 "INT-PLT-05": ("Cloud sheet", "database_isolation component"),
 "INT-PLT-06": ("Cloud sheet", "queue_workers component"),
 "INT-PLT-07": ("Cloud sheet", "network_domain_certificates component"),
 "INT-PLT-14": ("Cloud sheet", "portability_exit component"),
 "INT-LWS-08": ("Cloud sheet", "queue_workers component"),
 "INT-ADM-09": ("Cloud sheet", "all 17 provisioning components + onboarding"),
 "INT-PLT-03": ("Cloud sheet", "monitoring_siem component"),
 # absorbed by the platform governance sheet
 "INT-PLT-01": ("Governance sheet", "our own workforce identity, not the tenant's"),
 "INT-PLT-11": ("Governance sheet", "CI, signing, SBOM, scans, canary evidence"),
 "INT-ADM-10": ("Governance sheet", "workforce federation and re-verification"),
 # absorbed by the service and support sheet
 "INT-PLT-08": ("Service sheet", "observability, on-call, incident and SLA"),
 # internal capability with no external unit price
 "INT-CUS-02": ("Internal", "lead dedupe is internal; external CRM priced at D02"),
 "INT-RSK-01": ("Internal", "fact assembly from feeds already priced individually"),
 "INT-RSK-02": ("Internal", "screening execution priced at D11 and S10"),
 "INT-RSK-03": ("Internal", "transaction monitoring evaluation is internal compute"),
 "INT-RSK-04": ("Internal", "consortium lookup priced at D05"),
 "INT-LMS-02": ("Priced at origination", "mandate registration is D35 at LOS→LMS handoff"),
 "INT-COLAT-02": ("Priced at origination", "valuation is D21; revaluation is S11"),
 "INT-COLAT-03": ("Priced at origination", "legal/title is D22"),
 "INT-COLAT-05": ("Priced at origination", "insurance bind is D31; renewal is S11"),
}
