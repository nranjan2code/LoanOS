"""Journey unit matrix + cloud / governance / service cost tables."""

# (journeyType, archetype, funnel preset, avg ticket INR)
JOURNEYS = [
    ("personal_loan",              "unsecured_term",             "Digital_Unsecured", 250000),
    ("co_lending_programme",       "co_lending",                 "Digital_Unsecured", 300000),
    ("msme_working_capital",       "revolving_working_capital",  "MSME_Business",    1500000),
    ("msme_term_loan",             "business_term",              "MSME_Business",    1200000),
    ("professional_practice_loan", "business_term",              "MSME_Business",    1500000),
    ("secured_business_loan",      "property_secured",           "Secured_HighTouch",5000000),
    ("loan_against_property",      "property_secured",           "Secured_HighTouch",6000000),
    ("home_loan",                  "property_secured",           "Secured_HighTouch",4500000),
    ("equipment_machinery_finance","asset_finance",              "MSME_Business",    2500000),
    ("green_equipment_finance",    "asset_finance",              "MSME_Business",    3000000),
    ("personal_vehicle_loan",      "asset_finance",              "Digital_Unsecured", 800000),
    ("commercial_vehicle_finance", "asset_finance",              "MSME_Business",    1800000),
    ("gold_loan",                  "gold_custody",               "Field_Group",       150000),
    ("education_loan",             "priority_term",              "Secured_HighTouch",1000000),
    ("agriculture_allied_finance", "seasonal_field",             "Field_Group",       200000),
    ("microfinance_group_lending", "group_field",                "Field_Group",        45000),
    ("consumer_durable_finance",   "merchant_pos",               "POS_Instant",        35000),
    ("invoice_discounting",        "trade_receivables",          "MSME_Business",     800000),
    ("purchase_order_finance",     "trade_receivables",          "MSME_Business",    1500000),
    ("supply_chain_finance",       "trade_receivables",          "MSME_Business",    1000000),
    ("trade_finance_workflow",     "trade_receivables",          "MSME_Business",    3000000),
]

# Units consumed per APPLICATION STARTED (before funnel attrition is applied).
# Absent driver = 0. Fractional units express "applies to a fraction of files".
UNITS = {
"personal_loan": {
    "D01":1,"D02":1,"D03":4,"D04":1,"D05":1,"D06":1,"D07":1,"D08":1,"D09":1,"D10":1,"D11":1,
    "D14":1,"D16":1,"D17":1,"D18":1,"D19":6,"D25":3,"D26":1,"D27":1,"D28":2,"D29":1,
    "D32":1,"D33":1,"D35":1},
"co_lending_programme": {
    "D01":1,"D02":1,"D03":5,"D04":1,"D05":1,"D06":1,"D07":1,"D08":1,"D09":1,"D10":1,"D11":1,
    "D14":1,"D16":1,"D17":1,"D18":1,"D19":7,"D25":5,"D26":1,"D27":1,"D28":2,"D29":1,
    "D32":1,"D33":2,"D34":2,"D35":1},
"msme_working_capital": {
    "D01":2,"D02":1,"D03":16,"D04":1,"D05":1,"D06":3,"D07":2,"D08":2,"D09":2,"D10":2,"D11":4,
    "D12":1,"D13":2,"D14":2,"D15":1,"D16":2,"D17":2,"D18":1,"D19":45,"D20":1,"D25":6,"D26":1,
    "D27":1,"D28":4,"D29":1,"D30":1,"D31":0.5,"D32":1,"D33":1,"D35":1},
"msme_term_loan": {
    "D01":2,"D02":1,"D03":14,"D04":1,"D05":1,"D06":3,"D07":2,"D08":2,"D09":2,"D10":2,"D11":4,
    "D12":1,"D13":2,"D14":2,"D15":1,"D16":2,"D17":2,"D18":1,"D19":40,"D20":1,"D25":5,"D26":1,
    "D27":1,"D28":4,"D29":1,"D32":1,"D33":1,"D35":1},
"professional_practice_loan": {
    "D01":2,"D02":1,"D03":10,"D04":1,"D05":1,"D06":2,"D07":1,"D08":1,"D09":1,"D10":1,"D11":2,
    "D12":1,"D13":1,"D14":1,"D15":0.5,"D16":1,"D17":1,"D18":1,"D19":24,"D20":0.5,"D25":4,
    "D26":1,"D27":1,"D28":2,"D29":1,"D32":1,"D33":1,"D35":1},
"secured_business_loan": {
    "D01":2,"D02":1,"D03":18,"D04":1,"D05":1,"D06":3,"D07":2,"D08":2,"D09":2,"D10":2,"D11":4,
    "D12":1,"D13":2,"D14":2,"D15":1,"D16":2,"D17":2,"D18":2,"D19":55,"D20":1,"D21":1.3,"D22":1.2,
    "D25":6,"D26":1,"D27":1,"D28":4,"D29":1,"D30":1,"D31":1,"D32":1,"D33":1.2,"D35":1},
"loan_against_property": {
    "D01":2,"D02":1,"D03":18,"D04":1,"D05":1,"D06":2,"D07":2,"D08":2,"D09":2,"D10":2,"D11":3,
    "D14":2,"D16":2,"D17":2,"D18":2,"D19":55,"D20":1,"D21":1.3,"D22":1.2,"D25":6,"D26":1,
    "D27":1,"D28":4,"D29":1,"D30":1,"D31":1,"D32":1,"D33":1.2,"D35":1},
"home_loan": {
    "D01":2,"D02":1,"D03":20,"D04":1,"D05":1,"D06":2,"D07":2,"D08":2,"D09":2,"D10":2,"D11":3,
    "D14":2,"D16":2,"D17":2,"D18":2,"D19":60,"D20":1,"D21":1.2,"D22":1.2,"D25":6,"D26":1,
    "D27":1,"D28":4,"D29":1,"D30":1,"D31":1,"D32":1,"D33":2.5,"D35":1},
"equipment_machinery_finance": {
    "D01":2,"D02":1,"D03":16,"D04":1,"D05":1,"D06":3,"D07":2,"D08":2,"D09":2,"D10":2,"D11":4,
    "D12":1,"D13":2,"D14":2,"D15":1,"D16":2,"D17":2,"D18":1,"D19":42,"D20":1,"D23":1,"D25":5,
    "D26":1,"D27":1,"D28":4,"D29":1,"D30":1,"D31":1,"D32":1,"D33":1,"D35":1},
"green_equipment_finance": {
    "D01":2,"D02":1,"D03":18,"D04":1,"D05":1,"D06":3,"D07":2,"D08":2,"D09":2,"D10":2,"D11":4,
    "D12":1,"D13":2,"D14":2,"D15":1,"D16":2,"D17":2,"D18":1,"D19":48,"D20":1,"D23":1,"D25":5,
    "D26":1.5,"D27":1,"D28":4,"D29":1,"D30":1,"D31":1,"D32":1,"D33":1,"D35":1},
"personal_vehicle_loan": {
    "D01":1,"D02":1,"D03":6,"D04":1,"D05":1,"D06":1,"D07":1,"D08":1,"D09":1,"D10":1,"D11":1,
    "D14":1,"D16":1,"D17":1,"D18":1,"D19":10,"D23":1,"D25":4,"D26":1,"D27":1,"D28":2,"D29":1,
    "D30":0.2,"D31":1,"D32":1,"D33":1,"D35":1},
"commercial_vehicle_finance": {
    "D01":2,"D02":1,"D03":14,"D04":1,"D05":1,"D06":2,"D07":2,"D08":2,"D09":1,"D10":1,"D11":3,
    "D12":1,"D13":1,"D14":2,"D15":1,"D16":2,"D17":2,"D18":1,"D19":35,"D20":1,"D23":1,"D25":5,
    "D26":1,"D27":1,"D28":3,"D29":1,"D30":1,"D31":1,"D32":1,"D33":1,"D35":1},
"gold_loan": {
    "D01":1,"D02":1,"D03":2,"D06":1,"D07":1,"D08":1,"D10":1,"D11":1,"D14":0.3,"D19":2,"D24":1,
    "D25":2,"D26":0.3,"D27":1,"D28":1,"D29":0.2,"D32":1,"D33":1,"D35":0.2},
"education_loan": {
    "D01":2,"D02":1,"D03":14,"D04":1,"D05":1,"D06":2,"D07":2,"D08":2,"D09":2,"D10":2,"D11":2,
    "D14":1,"D16":1,"D17":1,"D18":1,"D19":30,"D20":0.6,"D21":0.4,"D22":0.4,"D25":4,"D26":1,
    "D27":1,"D28":4,"D29":1,"D30":0.4,"D32":1,"D33":1.6,"D35":1},
"agriculture_allied_finance": {
    "D01":1,"D02":1,"D03":6,"D04":1,"D06":1,"D07":1,"D08":1,"D10":1,"D11":1,"D14":1,"D19":8,
    "D20":1,"D25":3,"D26":0.5,"D27":1,"D28":2,"D29":1,"D30":0.5,"D31":0.5,"D32":1,"D33":1,"D35":0.5},
"microfinance_group_lending": {
    "D01":1,"D02":1,"D03":3,"D06":0.6,"D07":1,"D08":1,"D10":1,"D11":1,"D14":1,"D19":3,"D20":1,
    "D25":2,"D26":0.2,"D27":1,"D28":1,"D29":0.1,"D32":0.8,"D33":1,"D35":0.3},
"consumer_durable_finance": {
    "D01":1,"D02":1,"D03":2,"D05":1,"D06":1,"D07":1,"D08":1,"D10":1,"D11":1,"D14":1,"D19":1,
    "D25":2,"D26":0.5,"D27":1,"D28":1,"D29":0.1,"D32":0.5,"D33":1,"D35":1},
"invoice_discounting": {
    "D01":2,"D02":1,"D03":12,"D05":1,"D06":2,"D07":1,"D08":1,"D09":1,"D10":1,"D11":4,"D12":2,
    "D13":2,"D14":1,"D15":1.5,"D16":2,"D17":2,"D18":2,"D19":30,"D25":6,"D26":2,"D27":1,"D28":3,
    "D29":1,"D32":2,"D33":1,"D35":1},
"purchase_order_finance": {
    "D01":2,"D02":1,"D03":14,"D05":1,"D06":2,"D07":1,"D08":1,"D09":1,"D10":1,"D11":4,"D12":2,
    "D13":2,"D14":1,"D15":1.5,"D16":2,"D17":2,"D18":2,"D19":34,"D20":0.5,"D25":6,"D26":2,
    "D27":1,"D28":3,"D29":1,"D32":2,"D33":1,"D35":1},
"supply_chain_finance": {
    "D01":2,"D02":1,"D03":8,"D05":1,"D06":2,"D07":1,"D08":1,"D09":1,"D10":1,"D11":3,"D12":2,
    "D13":1,"D14":1,"D15":1,"D16":1,"D17":1,"D18":2,"D19":20,"D25":5,"D26":1.5,"D27":1,"D28":2,
    "D29":1,"D32":1,"D33":1,"D35":1},
"trade_finance_workflow": {
    "D01":2,"D02":1,"D03":24,"D05":1,"D06":2,"D07":1,"D08":1,"D09":1,"D10":1,"D11":6,"D12":2,
    "D13":3,"D14":1,"D15":2,"D16":2,"D17":2,"D18":2,"D19":60,"D20":0.5,"D25":8,"D26":3,"D27":1,
    "D28":4,"D29":1,"D30":0.5,"D31":0.5,"D32":2,"D33":1.5,"D35":1},
}

# ---------------------------------------------------------------------------
# CLOUD COST — the 17 REQUIRED_DEPLOYMENT_COMPONENTS from
# packages/core/src/platform/saas-deployment-blueprints.js, across the 4
# SAAS_DEPLOYMENT_MODELS. INR/month, per tenant, fixed (volume-independent).
# ---------------------------------------------------------------------------

DEPLOY_MODELS = ["shared_multi_tenant", "dedicated_tenant_data_plane",
                 "dedicated_environment", "customer_managed_private"]

# component -> [shared, dedicated_data_plane, dedicated_env, customer_managed], note
CLOUD_FIXED = [
 ("tenant_namespace",             [    0,     0,      0,     0], "Logical only; no standalone infrastructure charge."),
 ("app_partition",                [ 1200,  2600,  22000,     0], "Share of the app fleet; dedicated ASG in dedicated_environment."),
 ("data_partition",               [  400,  1200,   3000,     0], "Schema/partition overhead and per-tenant object prefixes."),
 ("database_isolation",           [ 2500, 32000,  55000,     0], "Shared RDS+RLS allocation vs a dedicated Multi-AZ instance."),
 ("decision_runtime",             [ 9000, 12000,  18000,  9000], "ADR 0003: one ISOLATED Rust runtime per tenant. Never shared -> a true per-tenant floor even at zero volume."),
 ("keys_secrets",                 [  700,  1100,   2200,   700], "Per-tenant KMS CMKs + secret scopes."),
 ("network_domain_certificates",  [  600,  1400,   6500,   400], "Routes, custom domain, TLS certificates, WAF share."),
 ("storage_worm",                 [    0,     0,      0,     0], "Driven by the retention model below, not a flat fee."),
 ("queue_workers",                [  900,  1800,   7000,     0], "Per-tenant queues and worker capacity floor."),
 ("integrations",                 [  500,   900,   2500,   500], "NAT/egress, allowlists, provider connection floor."),
 ("monitoring_siem",              [ 1800,  3200,   9000,  2500], "Log ingest and retention. Usually underestimated."),
 ("backups_pitr_dr",              [ 1500,  4500,  16000,     0], "PITR window, cross-AZ/region copies, restore tests."),
 ("capacity_slo",                 [  400,  1000,   5000,     0], "Reserved headroom to hold the SLO."),
 ("release_upgrade",              [  300,   600,   2500,  3500], "Release ring, canary and rollback capacity; higher when customer-managed."),
 ("support_operations",           [    0,     0,      0,     0], "Priced in 8_Service_Cost, not here."),
 ("data_residency",               [  200,   400,   1200,   200], "India residency controls and evidence."),
 ("portability_exit",             [  300,   600,   1500,   600], "Export tooling and exit rehearsal capacity."),
]

# INR per 1,000 applications processed (compute, IOPS, egress, log volume).
CLOUD_VARIABLE_PER_1K = [1100, 1400, 1900, 150]

# Retention-compounding storage: RBI/PMLA retention means storage ACCUMULATES.
STORAGE = {
    "mb_per_dropped_application": 8,
    "mb_per_funded_loan": 45,
    "retention_years": 8,
    "inr_per_gb_month_blended": 1.20,
}

# ---------------------------------------------------------------------------
# GOVERNANCE, COMPLIANCE AND REGULATORY — platform-level annual fixed cost
# that must be allocated across tenants. INR per year.
# ---------------------------------------------------------------------------

GOVERNANCE = [
 ("VAPT and application security testing",            800000,  "Annual + per-major-release retest."),
 ("ISO 27001 + SOC 2 Type II certification",         1400000,  "Audit fees, tooling and internal effort."),
 ("RBI IS / system audit support",                    600000,  "Evidence packs and auditor response for regulated tenants."),
 ("DPDP compliance, consent manager and DPO",        1800000,  "Digital Personal Data Protection Act obligations."),
 ("Compliance officer + regulatory change tracking", 3600000,  "RBI Digital Lending Directions change absorption."),
 ("Model governance, validation, bias and drift",    2400000,  "DEC-4 provenance + kill-switch operation."),
 ("Audit hash chain and evidence retention tooling",  600000,  "INV-8/INV-12 replayability infrastructure."),
 ("Regulatory reporting ops (CIC/CKYC/FIU/CERSAI)",  2000000,  "Submission, acknowledgement and reconciliation runs."),
 ("Business continuity and DR drills",                500000,  "Documented restore and failover rehearsals."),
 ("Cyber and professional indemnity insurance",       900000,  "Scales with tenant count and data volume."),
]

# Per-tenant DIRECT regulatory operating cost (not allocated - caused by the tenant).
REG_DIRECT_MONTHLY = 18000        # INR/month: tenant-specific report runs, submissions, queries
REG_DIRECT_PER_1K_LOANS = 4500    # INR per 1,000 funded loans: CIC/CKYC/CERSAI submission effort

# ---------------------------------------------------------------------------
# SERVICE AND SUPPORT
# ---------------------------------------------------------------------------

SUPPORT_TIERS = ["Standard", "Enhanced", "Dedicated"]
SUPPORT_MONTHLY = [35000, 90000, 240000]
ONBOARDING_BY_MODEL = [400000, 900000, 1800000, 2500000]
