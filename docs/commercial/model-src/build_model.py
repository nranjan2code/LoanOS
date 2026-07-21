#!/usr/bin/env python3
"""Build the LoanOS full-lifecycle tenant cost & pricing model workbook."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

from build_model_part1 import (DRIVERS as LOS_BASE, STAGES, FUNNELS, FUNNEL_REACH,
                               ATTEMPTS, ATTEMPT_NOTE, ANCHORS, DEFAULT_ANCHOR)
from build_model_part2 import (JOURNEYS, UNITS, DEPLOY_MODELS, CLOUD_FIXED,
                               CLOUD_VARIABLE_PER_1K, STORAGE, GOVERNANCE,
                               REG_DIRECT_MONTHLY, REG_DIRECT_PER_1K_LOANS,
                               SUPPORT_TIERS, SUPPORT_MONTHLY, ONBOARDING_BY_MODEL)
from build_model_part3 import (LOS_GAP_DRIVERS, SERVICING_DRIVERS, COLLECTION_DRIVERS,
                               DPD_BUCKETS, COLLECTION_ATTEMPTS, LIFETIME, SERVICING_UNITS,
                               COLLECTION_APPLICABILITY, ATTEMPTS_EXT, BASIS_QUANTITY)
from build_model_part4 import (RECURRING_DRIVERS, ADMISSION_DRIVERS, QUANTITY_BASES,
                               COVERED_ELSEWHERE)

OUT = sys.argv[1] if len(sys.argv) > 1 else "loanos-tenant-cost-and-pricing-model.xlsx"

LOS_DRIVERS = LOS_BASE + LOS_GAP_DRIVERS
ATT = dict(ATTEMPTS); ATT.update(ATTEMPTS_EXT)
NJ = len(JOURNEYS)
JCOL = [get_column_letter(3 + i) for i in range(NJ)]
LASTJ = JCOL[-1]

S_README, S_IN, S_RCU, S_RCR = "0_README", "1_Inputs", "2_RateCard_Unit", "3_RateCard_Recurring"
S_JLOS, S_JSVC, S_FUN = "4_Journey_Units_LOS", "5_Journey_Units_Service", "6_Funnel_And_Lifetime"
S_ORIG, S_SVC, S_CLOUD = "7_Cost_Origination", "8_Cost_Servicing", "9_Cloud_Cost"
S_GOV, S_SUP, S_PNL = "10_Governance_Cost", "11_Service_Cost", "12_Tenant_PnL"
S_PRICE, S_JE, S_SENS, S_COV = "13_Price_Card", "14_Journey_Economics", "15_Sensitivity", "16_Coverage_Map"

FONT = "Arial"
BLUE  = Font(name=FONT, size=10, color="0000FF")
BLACK = Font(name=FONT, size=10)
GREEN = Font(name=FONT, size=10, color="008000")
BOLD  = Font(name=FONT, size=10, bold=True)
TITLE = Font(name=FONT, size=14, bold=True, color="1F3864")
SUB   = Font(name=FONT, size=9, italic=True, color="595959")
HDR   = Font(name=FONT, size=10, bold=True, color="FFFFFF")
SECT  = Font(name=FONT, size=10, bold=True, color="1F3864")
GREY  = Font(name=FONT, size=10, color="BFBFBF")

HDRFILL = PatternFill("solid", fgColor="1F3864")
YELLOW  = PatternFill("solid", fgColor="FFFF00")
LIGHT   = PatternFill("solid", fgColor="EDF2F9")
TOTFILL = PatternFill("solid", fgColor="D9E2F3")
WARN    = PatternFill("solid", fgColor="FCE4D6")
OKFILL  = PatternFill("solid", fgColor="E2EFDA")

THIN = Side(style="thin", color="B4C6E7")
BOX  = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

INR, INR2 = '"₹"#,##0;("₹"#,##0);-', '"₹"#,##0.00;("₹"#,##0.00);-'
PCT, PCT2 = '0.0%;(0.0%);-', '0.00%;(0.00%);-'
NUM, NUM2, NUM3 = '#,##0;(#,##0);-', '#,##0.00;(#,##0.00);-', '#,##0.000;(#,##0.000);-'

wb = Workbook()


def sheet(name, title, subtitle=None, widths=None):
    ws = wb.create_sheet(name)
    ws["A1"] = title; ws["A1"].font = TITLE
    if subtitle:
        ws["A2"] = subtitle; ws["A2"].font = SUB
    for col, w in (widths or {}).items():
        ws.column_dimensions[col].width = w
    ws.sheet_view.showGridLines = False
    return ws


def header_row(ws, row, values, start_col=1, height=32):
    for i, v in enumerate(values):
        c = ws.cell(row=row, column=start_col + i, value=v)
        c.font = HDR; c.fill = HDRFILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    ws.row_dimensions[row].height = height


def put(ws, addr, value, font=BLACK, fmt=None, fill=None, border=False, align=None, comment=None):
    c = ws[addr]; c.value = value; c.font = font
    if fmt: c.number_format = fmt
    if fill: c.fill = fill
    if border: c.border = BOX
    if align: c.alignment = Alignment(horizontal=align, wrap_text=(align == "left"))
    if comment:
        cm = Comment(comment, "LoanOS cost model"); cm.width, cm.height = 360, 130
        c.comment = cm
    return c


def section(ws, row, text, span=14):
    c = ws.cell(row=row, column=1, value=text); c.font = SECT
    for col in range(1, span + 1):
        ws.cell(row=row, column=col).fill = LIGHT


def jheaders(ws, row, first_label="Driver ID", second_label="Cost driver"):
    put(ws, f"A{row}", first_label, HDR, fill=HDRFILL, border=True, align="center")
    put(ws, f"B{row}", second_label, HDR, fill=HDRFILL, border=True, align="center")
    for i, (jt, *_x) in enumerate(JOURNEYS):
        c = put(ws, f"{JCOL[i]}{row}", jt, HDR, fill=HDRFILL, border=True)
        c.alignment = Alignment(horizontal="center", vertical="bottom", textRotation=90)
    ws.row_dimensions[row].height = 128
    for i in range(NJ):
        ws.column_dimensions[JCOL[i]].width = 15


# =========================================================== 0_README
ws = sheet(S_README, "LoanOS India — Tenant Cost & Pricing Model (full loan lifecycle)",
           "Bottom-up unit economics for a multi-tenant, RBI-compliance-first lending platform. "
           "Origination, servicing, collections and closure across all 21 journeys and all 115 integrations.",
           {"A": 30, "B": 112})
r = 4
for head, lines in [
 ("What this model answers", [
   "1. What does it cost to run one tenant for one month, to originate one loan, and to SERVICE it to closure?",
   "2. How does that change across the 21 journeys? Sheet 14 computes it live.",
   "3. What must we charge to hit a target gross margin — on origination AND on the book?",
   "4. At what volume does a tenant break even, and how does year 1 differ from the steady-state book?",
 ]),
 ("Cost classes", [
   "Class U — unit cost, fires N times against a countable basis (application, loan-month, EMI, closure, collection event).",
   "Class R — recurring subscription, scales with a QUANTITY driver (devices, branches, seats, partners, feeds).",
   "          This class is why a branch-heavy tenant can cost more than a digital one at ten times the volume.",
   "Class P — platform fixed cost, allocated across tenants (cloud, governance, support).",
 ]),
 ("Coverage", [
   "All 21 canonical product journeys.",
   "All 115 INT-* integrations: 96 carry an explicit priced driver; 19 are deliberately absorbed by the cloud,",
   "governance or service sheets, or are internal capabilities with no external unit price.",
   "Sheet 16 lists every one of the 115 with its treatment. Nothing is silently omitted.",
   "LOS lifecycle stages 1-12: application_capture through closure.",
 ]),
 ("How to use it", [
   "Step 1  Fill only the BLUE cells on 1_Inputs. That includes the quantity drivers that size the recurring class.",
   "Step 2  Replace 2_RateCard_Unit and 3_RateCard_Recurring with signed vendor prices. Nothing else matters as much.",
   "Step 3  Calibrate 6_Funnel_And_Lifetime — conversion, tenor, prepayment, delinquency — to the tenant's own history.",
   "Step 4  Read 12_Tenant_PnL for margin and break-even, and 13_Price_Card for the quote.",
   "Step 5  Use 14_Journey_Economics to price journey by journey. Never quote one blended price across the spread.",
 ]),
 ("Colour legend", [
   "BLUE text   = hardcoded input or scenario lever. Safe to edit.",
   "BLACK text  = formula on this sheet.  GREEN text = link to another sheet. Do not overwrite either.",
   "YELLOW fill = key assumption you are expected to challenge.",
   "ORANGE fill = no published price anchor exists; the number is a placeholder pending a vendor quotation.",
 ]),
 ("Honesty note — read before quoting anyone", [
   "Every rupee figure here is a PLACEHOLDER ASSUMPTION. Only three priced drivers have a dated public price in",
   "docs/architecture/integration-vendor-procurement-catalog.md (MSG91, Finvu, Cashfree). Every other line there",
   "is explicitly RFQ, which is why most of this rate card is Medium or Low confidence.",
   "",
   "The funnel, tenor, prepayment and delinquency profiles are industry-shaped guesses, not measured LoanOS data.",
   "Origination cost scales inversely with the funded rate; servicing cost scales with effective life; collections",
   "cost scales with the delinquency profile. All three are unmeasured. Stand up the usage meter before repricing.",
 ]),
 ("Repo anchors", [
   "21 journeys and maturity        docs/product/product-journey-platform-depth.json",
   "LOS lifecycle stages            docs/architecture/composed-product-journey-lifecycle.md",
   "All 115 INT-* integrations      docs/architecture/platform-module-integration-api-map.md",
   "Vendor prices and RFQ status    docs/architecture/integration-vendor-procurement-catalog.md",
   "4 deployment models,            packages/core/src/platform/saas-deployment-blueprints.js",
   "17 required tenant components",
   "Per-tenant isolated runtime     docs/decisions/0003-decision-engine-pure-rust-per-tenant.md (ADR 0003)",
   "Billing gap (no meter yet)      INT-ADM-08 / INT-PLT-12 — priced as driver R37",
 ]),
]:
    put(ws, f"A{r}", head, SECT)
    for col in (1, 2): ws.cell(row=r, column=col).fill = LIGHT
    r += 1
    for ln in lines:
        put(ws, f"B{r}", ln, BLACK, align="left"); r += 1
    r += 1

# =========================================================== 1_Inputs
ws = sheet(S_IN, "1 — Deal inputs", "Edit BLUE cells only. Everything downstream recalculates from here.",
           {"A": 52, "B": 24, "C": 74, "D": 22})
IR = {}
r = 4
for label, val, kind, note in [
    ("SECTION", "Deal identity", None, None),
    ("Tenant / regulated entity name", "Example NBFC Ltd", "text", "Free text — appears on the price card."),
    ("Regulated entity type", "NBFC-ICC", "text", "NBFC / NBFC-MFI / HFC / SFB / Bank / LSP. Drives regulatory scope."),
    ("Contract term (months)", 36, "num", "Amortises onboarding cost and fee."),
    ("Live tenants on platform", 12, "num", "Denominator for equal-share governance allocation."),
    ("Platform annual funded loans (all tenants)", 900000, "num", "Denominator for volume-weighted governance allocation."),
    ("SECTION", "Deployment and service", None, None),
    ("Deployment model", "shared_multi_tenant", "dv_model", "SAAS_DEPLOYMENT_MODELS in saas-deployment-blueprints.js."),
    ("Support tier", "Standard", "dv_tier", "Drives sheet 11."),
    ("Governance allocation basis", "Blended 50/50", "dv_alloc", "How platform compliance cost spreads across tenants."),
    ("SECTION", "Journey, volume and book", None, None),
    ("Primary journey", "personal_loan", "dv_journey", "One of the 21 canonical journeys. Price each separately."),
    ("Monthly applications STARTED", 4000, "num", "Entering application_capture — not approved or funded loans."),
    ("Rate card scenario", "Base", "dv_scen", "Low / Base / High column on both rate cards."),
    ("Book maturity", "Steady state", "dv_book", "Year 1 = ramping book, little servicing cost or revenue. Steady state = "
                                                 "originations equal closures. Quote multi-year deals on steady state."),
    ("Average ticket override (₹, 0 = journey default)", 0, "num", "Set only if this tenant's ticket differs."),
    ("SECTION", "Commercial levers", None, None),
    ("Target gross margin %", 0.62, "pct", "Sheet 13 solves for the per-funded-loan fee that achieves this."),
    ("Pass-through handling markup %", 0.08, "pct", "Markup on rebilled provider cost. 0% = pure pass-through."),
    ("Platform fee (₹ per month)", 350000, "inr", "Fixed subscription. Recovers the per-tenant cost floor."),
    ("Fee per DECISIONED application (₹)", 12, "inr", "Metered at credit_decision — resistant to junk-lead gaming."),
    ("Fee per FUNDED loan (₹)", 900, "inr", "Origination fee, charged on disbursement."),
    ("LMS fee per ACTIVE loan per month (₹)", 14, "inr", "Servicing fee on the book — what pays for the loan's whole life."),
    ("One-time onboarding fee charged (₹)", 750000, "inr", "Compare against modelled onboarding cost on sheet 11."),
]:
    if label == "SECTION":
        section(ws, r, val); r += 2; continue
    put(ws, f"A{r}", label, BLACK, align="left")
    put(ws, f"B{r}", val, BLUE, {"inr": INR, "pct": PCT, "num": NUM}.get(kind), YELLOW, border=True, align="center")
    put(ws, f"C{r}", note, SUB, align="left")
    IR[label] = r; r += 1

R_TERM, R_TEN, R_PVOL = IR["Contract term (months)"], IR["Live tenants on platform"], IR["Platform annual funded loans (all tenants)"]
R_MODEL, R_TIER, R_ALLOC = IR["Deployment model"], IR["Support tier"], IR["Governance allocation basis"]
R_JOUR, R_APPS, R_SCEN = IR["Primary journey"], IR["Monthly applications STARTED"], IR["Rate card scenario"]
R_BOOK, R_TICKOV = IR["Book maturity"], IR["Average ticket override (₹, 0 = journey default)"]
R_GM, R_MARKUP = IR["Target gross margin %"], IR["Pass-through handling markup %"]
R_PFEE, R_DFEE, R_LFEE = IR["Platform fee (₹ per month)"], IR["Fee per DECISIONED application (₹)"], IR["Fee per FUNDED loan (₹)"]
R_MFEE, R_ONBFEE = IR["LMS fee per ACTIVE loan per month (₹)"], IR["One-time onboarding fee charged (₹)"]

r += 1
section(ws, r, "Quantity drivers — these size the RECURRING cost class (sheet 3)"); r += 1
put(ws, f"A{r}", "Recurring cost does not scale with loan volume. It scales with these. A tenant with 25 branches and 120 field "
                 "devices carries that cost whether it originates 200 loans a month or 20,000.", SUB, align="left")
r += 2
header_row(ws, r, ["Basis key", "Quantity driver", "Quantity", "Unit"], height=20)
r += 1
QTY_TOP = r
for key, label, default, unit in QUANTITY_BASES:
    put(ws, f"A{r}", key, GREY, border=True, align="center")
    put(ws, f"B{r}", label, BLACK, border=True, align="left")
    put(ws, f"C{r}", default, BLUE, NUM, YELLOW, border=True, align="center")
    put(ws, f"D{r}", unit, SUB, border=True, align="left")
    r += 1
QTY_BOT = r - 1

r += 1
section(ws, r, "Derived — do not edit"); r += 1
DR = {}
for label, f in [
    ("Deployment model index", f"=IFERROR(MATCH($B${R_MODEL},'{S_CLOUD}'!$C$4:$F$4,0),1)"),
    ("Support tier index", f"=IFERROR(MATCH($B${R_TIER},'{S_SUP}'!$B$5:$B$7,0),1)"),
    ("Rate card scenario index", f'=IF($B${R_SCEN}="Low",1,IF($B${R_SCEN}="High",3,2))'),
    ("Journey column index", f"=IFERROR(MATCH($B${R_JOUR},'{S_JLOS}'!$C$3:${LASTJ}$3,0),1)"),
]:
    put(ws, f"A{r}", label, BLACK, align="left")
    put(ws, f"B{r}", f, GREEN, NUM, border=True, align="center")
    DR[label] = r; r += 1
put(ws, f"A{r}", "Effective average ticket (₹)", BLACK, align="left")
put(ws, f"B{r}", f"=IF($B${R_TICKOV}>0,$B${R_TICKOV},INDEX('{S_JLOS}'!$C$6:${LASTJ}$6,$B${DR['Journey column index']}))",
    GREEN, INR, border=True, align="center")
DR["Effective average ticket"] = r
R_MODELIDX, R_TIERIDX = DR["Deployment model index"], DR["Support tier index"]
R_SCENIDX, R_JCOL, R_TICKET = DR["Rate card scenario index"], DR["Journey column index"], DR["Effective average ticket"]

for cell, src in [(f"B{R_MODEL}", f"'{S_CLOUD}'!$C$4:$F$4"), (f"B{R_TIER}", f"'{S_SUP}'!$B$5:$B$7"),
                  (f"B{R_ALLOC}", '"Equal per tenant,Volume weighted,Blended 50/50"'),
                  (f"B{R_JOUR}", f"'{S_JLOS}'!$C$3:${LASTJ}$3"), (f"B{R_SCEN}", '"Low,Base,High"'),
                  (f"B{R_BOOK}", '"Year 1,Steady state"')]:
    dv = DataValidation(type="list", formula1=src, allow_blank=False, showDropDown=False)
    ws.add_data_validation(dv); dv.add(ws[cell])

# =========================================================== 2_RateCard_Unit
UNIT_ROWS = LOS_DRIVERS + SERVICING_DRIVERS + COLLECTION_DRIVERS
ws = sheet(S_RCU, "2 — Unit cost rate card (Class U)",
           "One row per per-event cost driver across the whole loan lifecycle, mapped to its INT-* integration ID.",
           {"A": 10, "B": 50, "C": 14, "D": 23, "E": 20, "F": 11, "G": 11, "H": 11,
            "I": 11, "J": 11, "K": 12, "L": 62, "M": 50})
header_row(ws, 4, ["Driver ID", "Cost driver", "INT ID", "Fires at (LOS stage / lifetime basis)", "Unit",
                   "Low ₹", "Base ₹", "High ₹", "Attempts", "Confidence", "Pass-through?",
                   "Vendor / assumption note", "Public price anchor"])
r = 5
RCU_TOP = r
for (did, name, intid, basis, unit, lo, base, hi, conf, pt, note) in UNIT_ROWS:
    grp = OKFILL if did[0] == "D" else (LIGHT if did[0] == "S" else WARN)
    put(ws, f"A{r}", did, BOLD, fill=grp, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    put(ws, f"C{r}", intid, BLACK, border=True, align="center")
    put(ws, f"D{r}", basis, BLACK, border=True, align="center")
    put(ws, f"E{r}", unit, BLACK, border=True, align="center")
    for col, v in (("F", lo), ("G", base), ("H", hi)):
        put(ws, f"{col}{r}", v, BLUE, INR2, YELLOW, border=True, align="center")
    put(ws, f"I{r}", ATT[did], BLUE, NUM2, YELLOW, border=True, align="center",
        comment=ATTEMPT_NOTE.get(did, "Attempts (incl. retries and provider failures) per successful unit."))
    cc = put(ws, f"J{r}", conf, BLACK, border=True, align="center")
    if conf == "Low": cc.fill = WARN
    put(ws, f"K{r}", pt, BLACK, border=True, align="center")
    put(ws, f"L{r}", note, SUB, border=True, align="left")
    ac = put(ws, f"M{r}", ANCHORS.get(did, DEFAULT_ANCHOR), SUB, border=True, align="left")
    if did in ANCHORS: ac.font = Font(name=FONT, size=9, bold=True, color="008000")
    else: ac.fill = WARN
    r += 1
RCU_BOT = r - 1
NLOS, NSVC, NCOL = len(LOS_DRIVERS), len(SERVICING_DRIVERS), len(COLLECTION_DRIVERS)
LOS_R0, SVC_R0, COL_R0 = RCU_TOP, RCU_TOP + NLOS, RCU_TOP + NLOS + NSVC
put(ws, f"B{r+1}", "Row groups — green = origination (LOS), blue = servicing (LMS/closure), orange = collections and recovery.", BOLD, align="left")
put(ws, f"B{r+2}", "SOURCE OF TRUTH: docs/architecture/integration-vendor-procurement-catalog.md carries a dated public price for only "
                   "three lines below; every other line there is explicitly RFQ. Do not quote from an orange anchor cell.", BOLD, align="left")

# =========================================================== 3_RateCard_Recurring
ws = sheet(S_RCR, "3 — Recurring cost rate card (Class R)",
           "Subscriptions and per-seat / per-device / per-partner costs. These scale with the QUANTITY DRIVERS on sheet 1, "
           "not with loan volume — which is why they decide whether a small tenant is viable.",
           {"A": 8, "B": 48, "C": 24, "D": 22, "E": 10, "F": 12, "G": 12, "H": 12, "I": 11,
            "J": 11, "K": 8, "L": 16, "M": 62})
header_row(ws, 4, ["ID", "Recurring cost driver", "INT ID(s)", "Quantity basis", "Qty",
                   "Low ₹", "Base ₹", "High ₹", "Confidence", "Pass-through?",
                   "Periods / yr", "₹ per year", "Note"])
r = 5
RCR_TOP = r
for (rid, name, intids, basis, lo, base, hi, conf, pt, note) in RECURRING_DRIVERS:
    put(ws, f"A{r}", rid, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    put(ws, f"C{r}", intids.replace(";", ", "), BLACK, border=True, align="center")
    put(ws, f"D{r}", basis, BLACK, border=True, align="center")
    put(ws, f"E{r}", f"=IFERROR(INDEX('{S_IN}'!$C${QTY_TOP}:$C${QTY_BOT},"
                     f"MATCH($D{r},'{S_IN}'!$A${QTY_TOP}:$A${QTY_BOT},0)),0)", GREEN, NUM, border=True, align="center")
    for col, v in (("F", lo), ("G", base), ("H", hi)):
        put(ws, f"{col}{r}", v, BLUE, INR, YELLOW, border=True, align="center")
    cc = put(ws, f"I{r}", conf, BLACK, border=True, align="center")
    if conf == "Low": cc.fill = WARN
    put(ws, f"J{r}", pt, BLACK, border=True, align="center")
    put(ws, f"K{r}", 12 if basis.endswith("_month") else 1, BLACK, NUM, border=True, align="center")
    put(ws, f"L{r}", f"=E{r}*INDEX($F{r}:$H{r},'{S_IN}'!$B${R_SCENIDX})*K{r}", BLACK, INR, border=True, align="center")
    put(ws, f"M{r}", note, SUB, border=True, align="left")
    r += 1
RCR_BOT = r - 1
put(ws, f"B{r}", "TOTAL recurring ₹ per year", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"L{r}", f"=SUM(L{RCR_TOP}:L{RCR_BOT})", BOLD, INR, TOTFILL, border=True, align="center")
RCR_TOTAL = r
put(ws, f"B{r+1}", "  of which pass-through", BLACK, border=True, align="left")
put(ws, f"L{r+1}", f'=SUMIF($J${RCR_TOP}:$J${RCR_BOT},"Yes",L{RCR_TOP}:L{RCR_BOT})', BLACK, INR, border=True, align="center")
RCR_PASS = r + 1
put(ws, f"B{r+2}", "  of which platform-borne", BLACK, border=True, align="left")
put(ws, f"L{r+2}", f'=SUMIF($J${RCR_TOP}:$J${RCR_BOT},"No",L{RCR_TOP}:L{RCR_BOT})', BLACK, INR, border=True, align="center")
RCR_PLAT = r + 2

r += 4
section(ws, r, "One-time admission cost (INT-ADM-*) — flows into onboarding", 13); r += 1
header_row(ws, r, ["ID", "Admission cost driver", "INT ID", "", "", "Low ₹", "Base ₹", "High ₹",
                   "Confidence", "", "", "₹ one-time", "Note"], height=20)
r += 1
ADM_TOP = r
for (aid, name, intid, lo, base, hi, conf, note) in ADMISSION_DRIVERS:
    put(ws, f"A{r}", aid, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    put(ws, f"C{r}", intid, BLACK, border=True, align="center")
    for col, v in (("F", lo), ("G", base), ("H", hi)):
        put(ws, f"{col}{r}", v, BLUE, INR, YELLOW, border=True, align="center")
    cc = put(ws, f"I{r}", conf, BLACK, border=True, align="center")
    if conf == "Low": cc.fill = WARN
    put(ws, f"L{r}", f"=INDEX($F{r}:$H{r},'{S_IN}'!$B${R_SCENIDX})", BLACK, INR, border=True, align="center")
    put(ws, f"M{r}", note, SUB, border=True, align="left")
    r += 1
ADM_BOT = r - 1
put(ws, f"B{r}", "TOTAL admission ₹ (one time)", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"L{r}", f"=SUM(L{ADM_TOP}:L{ADM_BOT})", BOLD, INR, TOTFILL, border=True, align="center")
ADM_TOTAL = r

# =========================================================== 4_Journey_Units_LOS
ws = sheet(S_JLOS, "4 — Journey unit matrix: origination",
           "Units consumed per APPLICATION STARTED, before funnel attrition. This is where the 21 journeys stop being "
           "one product and become 21 different cost structures.", {"A": 10, "B": 50})
jheaders(ws, 3)
for label, idx in [("Archetype", 1), ("Funnel preset", 2), ("Avg ticket (₹)", 3)]:
    row = 3 + idx
    put(ws, f"B{row}", label, BOLD, fill=LIGHT, border=True, align="left")
    ws[f"A{row}"].fill = LIGHT
    for i, j in enumerate(JOURNEYS):
        put(ws, f"{JCOL[i]}{row}", j[idx], BLUE, INR if idx == 3 else None, YELLOW, border=True, align="center")
put(ws, "B7", "Units per application started  ▼", SECT, fill=LIGHT, border=True, align="left")
r = 8
JLOS_TOP = r
for (did, name, *_x) in LOS_DRIVERS:
    put(ws, f"A{r}", did, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    for i, (jt, *_y) in enumerate(JOURNEYS):
        v = UNITS[jt].get(did, 0)
        c = put(ws, f"{JCOL[i]}{r}", v, BLUE, NUM2, border=True, align="center")
        if v == 0: c.font = GREY
    r += 1
JLOS_BOT = r - 1

# =========================================================== 5_Journey_Units_Service
ws = sheet(S_JSVC, "5 — Journey unit matrix: servicing, closure and collections",
           "Servicing units are per basis-unit (loan-month, EMI, loan-year, closure). Collections rows are APPLICABILITY "
           "multipliers — repossession and auction simply do not exist for an unsecured personal loan.",
           {"A": 10, "B": 50})
jheaders(ws, 3)
put(ws, "B5", "Servicing units per basis-unit  ▼", SECT, fill=LIGHT, border=True, align="left")
r = 6
JSVC_TOP = r
for (sid, name, *_x) in SERVICING_DRIVERS:
    put(ws, f"A{r}", sid, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    for i, (jt, *_y) in enumerate(JOURNEYS):
        v = SERVICING_UNITS[jt].get(sid, 0)
        c = put(ws, f"{JCOL[i]}{r}", v, BLUE, NUM2, border=True, align="center")
        if v == 0: c.font = GREY
    r += 1
JSVC_BOT = r - 1
r += 1
put(ws, f"B{r}", "Collections applicability multiplier  ▼", SECT, fill=LIGHT, border=True, align="left")
r += 1
JCOLL_TOP = r
for (cid, name, *_x) in COLLECTION_DRIVERS:
    put(ws, f"A{r}", cid, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    for i, (jt, *_y) in enumerate(JOURNEYS):
        v = COLLECTION_APPLICABILITY[jt].get(cid, 0)
        c = put(ws, f"{JCOL[i]}{r}", v, BLUE, NUM2, border=True, align="center")
        if v == 0: c.font = GREY
    r += 1
JCOLL_BOT = r - 1

# =========================================================== 6_Funnel_And_Lifetime
ws = sheet(S_FUN, "6 — Funnel, loan lifetime and derived quantities",
           "The three assumption sets that move the answer most: origination conversion, effective loan life, and the "
           "delinquency profile. Everything below the profile blocks is derived — do not edit it.",
           {"A": 30, "B": 46, "H": 18, "I": 18, "J": 12, "K": 12, "L": 12,
            "M": 16, "N": 16, "O": 16, "P": 17, "Q": 17, "R": 17, "S": 17, "T": 14})
header_row(ws, 4, ["Seq", "LOS stage"] + FUNNELS + ["Note"])
SNOTE = {
 "application_capture": "Everything that starts. Junk leads live here — never meter revenue on this.",
 "kyc_aml": "Drop-off from abandoned KYC, failed liveness and AML referrals.",
 "specialist_assessment": "Where bureau, AA and BSA cost is incurred — on files that may never fund.",
 "credit_decision": "Recommended revenue meter #1: real engine work, hard to game.",
 "kfs_acceptance": "The approval cliff. The gap from credit_decision is your approval rate.",
 "contracting": "eSign and eStamp drop-off.",
 "disbursement": "FUNDED RATE. Origination cost per funded loan scales inversely with this.",
 "multiple": "Blended reach for drivers firing across several stages (AI/agent tokens, retrieval).",
}
r = 5
STG_TOP = r
for i, st in enumerate(STAGES):
    put(ws, f"A{r}", i + 1, BLACK, border=True, align="center")
    put(ws, f"B{r}", st, BOLD, border=True, align="left")
    for k in range(5):
        c = put(ws, f"{get_column_letter(3+k)}{r}", FUNNEL_REACH[st][k], BLUE, PCT, YELLOW, border=True, align="center")
        if st == "disbursement": c.font = Font(name=FONT, size=10, bold=True, color="0000FF")
    put(ws, f"H{r}", SNOTE[st], SUB, border=True, align="left")
    r += 1
STG_BOT = r - 1
STG_DISB = STG_TOP + STAGES.index("disbursement")
STG_DEC = STG_TOP + STAGES.index("credit_decision")
r += 1
put(ws, f"B{r}", "Funded rate (= disbursement reach)", BOLD, fill=TOTFILL, border=True, align="left")
for k in range(5):
    cl = get_column_letter(3+k)
    put(ws, f"{cl}{r}", f"={cl}{STG_DISB}", BLACK, PCT, TOTFILL, border=True, align="center")
r += 1
put(ws, f"B{r}", "Applications per funded loan", BOLD, border=True, align="left")
for k in range(5):
    cl = get_column_letter(3+k)
    put(ws, f"{cl}{r}", f"=IFERROR(1/{cl}{STG_DISB},0)", BLACK, NUM2, border=True, align="center")
put(ws, f"H{r}", "You pay verification cost on every one of these, but bill an origination fee on only the one that funds.",
    SUB, border=True, align="left")

r += 3
section(ws, r, "LOS driver reach lookup (derived)", 8); r += 1
header_row(ws, r, ["Driver ID", "LOS stage"] + FUNNELS, height=20)
r += 1
REACH_TOP = r
for (did, name, intid, stage, *_x) in LOS_DRIVERS:
    put(ws, f"A{r}", did, BLACK, border=True, align="center")
    put(ws, f"B{r}", stage, BLACK, border=True, align="left")
    for k in range(5):
        cl = get_column_letter(3+k)
        put(ws, f"{cl}{r}", f"=INDEX({cl}${STG_TOP}:{cl}${STG_BOT},MATCH($B{r},$B${STG_TOP}:$B${STG_BOT},0))",
            BLACK, PCT, border=True, align="center")
    r += 1
REACH_BOT = r - 1

r += 3
section(ws, r, "Loan lifetime profile — tenor, prepayment and delinquency (EDIT the blue cells)", 20); r += 1
LT_HDR = r
header_row(ws, r, ["Journey", "Archetype", "Tenor (months)", "Life factor", "Effective life (months)",
                   "Effective life (years)", "EMI per year", "EMI count", "Bounce rate", "Bounced EMIs",
                   "DPD 1-30", "DPD 31-90", "DPD 90+", "Delinq months 1-30", "Delinq months 31-90",
                   "Delinq months 90+", "per_loan_month", "per_emi", "per_bounced_emi", "per_loan_year", "per_closure"])
r += 1
LT_TOP = r
for (jt, arch, fun, tick) in JOURNEYS:
    tenor, lifef, emiyr, bounce, d1, d2, d3 = LIFETIME[jt]
    put(ws, f"A{r}", jt, BOLD, border=True, align="left")
    put(ws, f"B{r}", arch, BLACK, border=True, align="left")
    put(ws, f"C{r}", tenor, BLUE, NUM, YELLOW, border=True, align="center")
    put(ws, f"D{r}", lifef, BLUE, PCT, YELLOW, border=True, align="center")
    put(ws, f"E{r}", f"=C{r}*D{r}", BLACK, NUM2, border=True, align="center")
    put(ws, f"F{r}", f"=E{r}/12", BLACK, NUM2, border=True, align="center")
    put(ws, f"G{r}", emiyr, BLUE, NUM, YELLOW, border=True, align="center")
    put(ws, f"H{r}", f"=F{r}*G{r}", BLACK, NUM2, border=True, align="center")
    put(ws, f"I{r}", bounce, BLUE, PCT, YELLOW, border=True, align="center")
    put(ws, f"J{r}", f"=H{r}*I{r}", BLACK, NUM2, border=True, align="center")
    put(ws, f"K{r}", d1, BLUE, PCT, YELLOW, border=True, align="center")
    put(ws, f"L{r}", d2, BLUE, PCT, YELLOW, border=True, align="center")
    put(ws, f"M{r}", d3, BLUE, PCT, YELLOW, border=True, align="center")
    put(ws, f"N{r}", f"=$E{r}*K{r}", BLACK, NUM3, border=True, align="center")
    put(ws, f"O{r}", f"=$E{r}*L{r}", BLACK, NUM3, border=True, align="center")
    put(ws, f"P{r}", f"=$E{r}*M{r}", BLACK, NUM3, border=True, align="center")
    put(ws, f"Q{r}", f"=E{r}", GREY, NUM2, border=True, align="center")
    put(ws, f"R{r}", f"=H{r}", GREY, NUM2, border=True, align="center")
    put(ws, f"S{r}", f"=J{r}", GREY, NUM2, border=True, align="center")
    put(ws, f"T{r}", f"=F{r}", GREY, NUM2, border=True, align="center")
    put(ws, f"U{r}", 1, GREY, NUM, border=True, align="center")
    r += 1
LT_BOT = r - 1
# fix the basis-name header positions (they must sit above Q..U)
for off, nm in enumerate(["per_loan_month", "per_emi", "per_bounced_emi", "per_loan_year", "per_closure"]):
    c = ws.cell(row=LT_HDR, column=17 + off, value=nm)
    c.font = HDR; c.fill = HDRFILL; c.border = BOX
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
for off, nm in enumerate(["Delinq months 1-30", "Delinq months 31-90", "Delinq months 90+"]):
    c = ws.cell(row=LT_HDR, column=14 + off, value=nm)
    c.font = HDR; c.fill = HDRFILL; c.border = BOX
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
BASIS_HDR = f"$Q${LT_HDR}:$U${LT_HDR}"
BASIS_BLK = f"$Q${LT_TOP}:$U${LT_BOT}"
DELINQ_BLK = f"$N${LT_TOP}:$P${LT_BOT}"
JNAMES = f"$A${LT_TOP}:$A${LT_BOT}"
r += 1
put(ws, f"A{r}", "Life factor = the share of contractual tenor a loan actually survives, after prepayment and foreclosure. "
                 "A 240-month home loan that typically closes in year 8-10 has a life factor near 0.45. Servicing cost and "
                 "servicing revenue both scale with effective life, so this number cuts both ways.", SUB, align="left")

r += 3
section(ws, r, "Collection attempts per delinquent loan-month, by bucket (EDIT)", 8); r += 1
header_row(ws, r, ["Driver ID", "Collections driver"] + DPD_BUCKETS, height=20)
r += 1
ATTB_TOP = r
for (cid, name, *_x) in COLLECTION_DRIVERS:
    put(ws, f"A{r}", cid, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    for k in range(3):
        put(ws, f"{get_column_letter(3+k)}{r}", COLLECTION_ATTEMPTS[cid][k], BLUE, NUM3, YELLOW, border=True, align="center")
    r += 1
ATTB_BOT = r - 1
put(ws, f"A{r}", "One shared playbook across journeys. The journey-specific part is the delinquency distribution and the "
                 "applicability multiplier on sheet 5, not the collections playbook itself.", SUB, align="left")

r += 3
section(ws, r, "Servicing basis quantity per driver per journey (derived — do not edit)", 23); r += 1
jheaders(ws, r, "Driver ID", "Basis")
SQ_HDRROW = r
r += 1
SQ_TOP = r
for (sid, name, intid, basis, *_x) in SERVICING_DRIVERS:
    put(ws, f"A{r}", sid, BLACK, border=True, align="center")
    put(ws, f"B{r}", basis, BLACK, border=True, align="left")
    for i in range(NJ):
        put(ws, f"{JCOL[i]}{r}",
            f"=IFERROR(INDEX({BASIS_BLK},MATCH({JCOL[i]}${SQ_HDRROW},{JNAMES},0),MATCH($B{r},{BASIS_HDR},0)),0)",
            BLACK, NUM2, border=True, align="center")
    r += 1
SQ_BOT = r - 1

r += 2
section(ws, r, "Collection events per funded loan per driver per journey (derived — do not edit)", 23); r += 1
jheaders(ws, r, "Driver ID", "Collections driver")
CE_HDRROW = r
r += 1
CE_TOP = r
for k, (cid, name, *_x) in enumerate(COLLECTION_DRIVERS):
    arow = ATTB_TOP + k
    put(ws, f"A{r}", cid, BLACK, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    for i in range(NJ):
        put(ws, f"{JCOL[i]}{r}",
            f"=IFERROR('{S_JSVC}'!{JCOL[i]}{JCOLL_TOP+k}*"
            f"SUMPRODUCT(INDEX({DELINQ_BLK},MATCH({JCOL[i]}${CE_HDRROW},{JNAMES},0),0),$C${arow}:$E${arow}),0)",
            BLACK, NUM3, border=True, align="center")
    r += 1
CE_BOT = r - 1

# =========================================================== 7_Cost_Origination
ws = sheet(S_ORIG, "7 — Origination cost engine",
           "Effective units = units per application x attempts per success x reach at the stage where the driver fires.",
           {"A": 10, "B": 50, "C": 14, "D": 23, "E": 12, "F": 11, "G": 12, "H": 14,
            "I": 12, "J": 15, "K": 17, "L": 13})
r = 3
OCTX = {}
for label, f, fmt in [
    ("Journey", f"='{S_IN}'!$B${R_JOUR}", None),
    ("Journey column index", f"='{S_IN}'!$B${R_JCOL}", NUM),
    ("Funnel preset", f"=INDEX('{S_JLOS}'!$C$5:${LASTJ}$5,$B$4)", None),
    ("Funnel column index", f"=IFERROR(MATCH($B$5,'{S_FUN}'!$C$4:$G$4,0),1)", NUM),
    ("Average ticket (₹)", f"='{S_IN}'!$B${R_TICKET}", INR),
    ("Rate card scenario index", f"='{S_IN}'!$B${R_SCENIDX}", NUM),
    ("Funded rate", f"=INDEX('{S_FUN}'!$C${STG_DISB}:$G${STG_DISB},$B$6)", PCT),
    ("Decisioned rate", f"=INDEX('{S_FUN}'!$C${STG_DEC}:$G${STG_DEC},$B$6)", PCT),
]:
    put(ws, f"A{r}", label, BOLD, align="left")
    put(ws, f"B{r}", f, GREEN, fmt, LIGHT, border=True, align="center")
    OCTX[label] = r; r += 1
O_JCOL, O_FCOL = OCTX["Journey column index"], OCTX["Funnel column index"]
O_TICKET, O_SCEN = OCTX["Average ticket (₹)"], OCTX["Rate card scenario index"]
O_FUND, O_DEC = OCTX["Funded rate"], OCTX["Decisioned rate"]

hr = 12
header_row(ws, hr, ["Driver ID", "Cost driver", "INT ID", "Fires at stage", "Units per app", "Attempts",
                    "Stage reach", "Effective units / app", "Unit cost ₹", "₹ per application",
                    "₹ per FUNDED loan", "Pass-through?"])
r = hr + 1
OENG_TOP = r
for i, (did, name, intid, stage, *_x) in enumerate(LOS_DRIVERS):
    jr, rr, fr = JLOS_TOP + i, LOS_R0 + i, REACH_TOP + i
    put(ws, f"A{r}", did, BOLD, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    put(ws, f"C{r}", intid, BLACK, border=True, align="center")
    put(ws, f"D{r}", stage, BLACK, border=True, align="center")
    put(ws, f"E{r}", f"=INDEX('{S_JLOS}'!$C${jr}:${LASTJ}${jr},$B${O_JCOL})", GREEN, NUM2, border=True, align="center")
    put(ws, f"F{r}", f"='{S_RCU}'!$I${rr}", GREEN, NUM2, border=True, align="center")
    put(ws, f"G{r}", f"=INDEX('{S_FUN}'!$C${fr}:$G${fr},$B${O_FCOL})", GREEN, PCT, border=True, align="center")
    put(ws, f"H{r}", f"=E{r}*F{r}*G{r}", BLACK, NUM3, border=True, align="center")
    put(ws, f"I{r}", f"=INDEX('{S_RCU}'!$F${rr}:$H${rr},$B${O_SCEN})", GREEN, INR2, border=True, align="center")
    put(ws, f"J{r}", f"=H{r}*I{r}", BLACK, INR2, border=True, align="center")
    put(ws, f"K{r}", f"=IFERROR(J{r}/$B${O_FUND},0)", BLACK, INR2, border=True, align="center")
    put(ws, f"L{r}", f"='{S_RCU}'!$K${rr}", GREEN, border=True, align="center")
    r += 1
OENG_BOT = r - 1
r += 1
put(ws, f"B{r}", "TOTAL ORIGINATION EXTERNAL COST", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"J{r}", f"=SUM(J{OENG_TOP}:J{OENG_BOT})", BOLD, INR2, TOTFILL, border=True, align="center")
put(ws, f"K{r}", f"=SUM(K{OENG_TOP}:K{OENG_BOT})", BOLD, INR2, TOTFILL, border=True, align="center")
O_TOT = r
put(ws, f"B{r+1}", "  of which platform-borne", BLACK, border=True, align="left")
put(ws, f"J{r+1}", f'=SUMIF($L${OENG_TOP}:$L${OENG_BOT},"No",J{OENG_TOP}:J{OENG_BOT})', BLACK, INR2, border=True, align="center")
put(ws, f"K{r+1}", f'=SUMIF($L${OENG_TOP}:$L${OENG_BOT},"No",K{OENG_TOP}:K{OENG_BOT})', BLACK, INR2, border=True, align="center")
O_PLAT = r + 1
put(ws, f"B{r+2}", "  of which pass-through", BLACK, border=True, align="left")
put(ws, f"J{r+2}", f'=SUMIF($L${OENG_TOP}:$L${OENG_BOT},"Yes",J{OENG_TOP}:J{OENG_BOT})', BLACK, INR2, border=True, align="center")
put(ws, f"K{r+2}", f'=SUMIF($L${OENG_TOP}:$L${OENG_BOT},"Yes",K{OENG_TOP}:K{OENG_BOT})', BLACK, INR2, border=True, align="center")
O_PASS = r + 2
r += 4
put(ws, f"B{r}", "Origination cost per funded loan as bps of ticket", BOLD, align="left")
put(ws, f"K{r}", f"=IFERROR(K{O_TOT}/$B${O_TICKET}*10000,0)", BOLD, NUM2, TOTFILL, border=True, align="center")
put(ws, f"B{r+1}", "Largest single driver", BLACK, align="left")
put(ws, f"D{r+1}", f"=INDEX($B${OENG_TOP}:$B${OENG_BOT},MATCH(MAX(K{OENG_TOP}:K{OENG_BOT}),K{OENG_TOP}:K{OENG_BOT},0))",
    BLACK, border=True, align="left")
put(ws, f"K{r+1}", f"=MAX(K{OENG_TOP}:K{OENG_BOT})", BLACK, INR2, border=True, align="center")
put(ws, f"B{r+3}", "The gap between column J and column K is the funnel tax: verification you pay for on applications that never fund.",
    SUB, align="left")

# =========================================================== 8_Cost_Servicing
ws = sheet(S_SVC, "8 — Servicing, closure and collections cost engine",
           "Cost per funded loan over its WHOLE LIFE. Servicing units are multiplied by the basis quantity the loan "
           "generates (loan-months, EMIs, loan-years, one closure); collections events come from the delinquency profile.",
           {"A": 10, "B": 50, "C": 14, "D": 21, "E": 13, "F": 14, "G": 11, "H": 12, "I": 17, "J": 13})
r = 3
SCTX = {}
for label, f, fmt in [
    ("Journey", f"='{S_IN}'!$B${R_JOUR}", None),
    ("Journey column index", f"='{S_IN}'!$B${R_JCOL}", NUM),
    ("Lifetime row index", f"=IFERROR(MATCH($B$3,'{S_FUN}'!{JNAMES},0),1)", NUM),
    ("Rate card scenario index", f"='{S_IN}'!$B${R_SCENIDX}", NUM),
    ("Effective life (months)", f"=INDEX('{S_FUN}'!$E${LT_TOP}:$E${LT_BOT},$B$5)", NUM2),
    ("Effective life (years)", f"=INDEX('{S_FUN}'!$F${LT_TOP}:$F${LT_BOT},$B$5)", NUM2),
    ("EMI count over life", f"=INDEX('{S_FUN}'!$H${LT_TOP}:$H${LT_BOT},$B$5)", NUM2),
    ("Bounced EMIs over life", f"=INDEX('{S_FUN}'!$J${LT_TOP}:$J${LT_BOT},$B$5)", NUM2),
    ("Delinquent loan-months (all buckets)",
     f"=INDEX('{S_FUN}'!$N${LT_TOP}:$N${LT_BOT},$B$5)+INDEX('{S_FUN}'!$O${LT_TOP}:$O${LT_BOT},$B$5)"
     f"+INDEX('{S_FUN}'!$P${LT_TOP}:$P${LT_BOT},$B$5)", NUM2),
]:
    put(ws, f"A{r}", label, BOLD, align="left")
    put(ws, f"B{r}", f, GREEN, fmt, LIGHT, border=True, align="center")
    SCTX[label] = r; r += 1
V_JCOL, V_LTROW, V_SCEN = SCTX["Journey column index"], SCTX["Lifetime row index"], SCTX["Rate card scenario index"]
V_LIFEM, V_LIFEY = SCTX["Effective life (months)"], SCTX["Effective life (years)"]

hr = 14
header_row(ws, hr, ["Driver ID", "Cost driver", "INT ID", "Basis", "Units per basis-unit",
                    "Basis qty over life", "Attempts", "Unit cost ₹", "₹ per FUNDED loan (lifetime)", "Pass-through?"])
r = hr + 1
SENG_TOP = r
for i, (sid, name, intid, basis, unit, *_x) in enumerate(SERVICING_DRIVERS):
    rr, jr, qr = SVC_R0 + i, JSVC_TOP + i, SQ_TOP + i
    put(ws, f"A{r}", sid, BOLD, fill=LIGHT, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    put(ws, f"C{r}", intid, BLACK, border=True, align="center")
    put(ws, f"D{r}", basis, BLACK, border=True, align="center")
    put(ws, f"E{r}", f"=INDEX('{S_JSVC}'!$C${jr}:${LASTJ}${jr},$B${V_JCOL})", GREEN, NUM2, border=True, align="center")
    put(ws, f"F{r}", f"=INDEX('{S_FUN}'!$C${qr}:${LASTJ}${qr},$B${V_JCOL})", GREEN, NUM2, border=True, align="center")
    put(ws, f"G{r}", f"='{S_RCU}'!$I${rr}", GREEN, NUM2, border=True, align="center")
    put(ws, f"H{r}", f"=INDEX('{S_RCU}'!$F${rr}:$H${rr},$B${V_SCEN})", GREEN, INR2, border=True, align="center")
    put(ws, f"I{r}", f"=E{r}*F{r}*G{r}*H{r}", BLACK, INR2, border=True, align="center")
    put(ws, f"J{r}", f"='{S_RCU}'!$K${rr}", GREEN, border=True, align="center")
    r += 1
SENG_BOT = r - 1
put(ws, f"B{r}", "Lifetime SERVICING cost per funded loan", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"I{r}", f"=SUM(I{SENG_TOP}:I{SENG_BOT})", BOLD, INR2, TOTFILL, border=True, align="center")
V_SVCTOT = r

r += 2
header_row(ws, r, ["Driver ID", "Collections driver", "INT ID", "Basis", "Applicability",
                   "Events per funded loan", "Attempts", "Unit cost ₹", "₹ per FUNDED loan (lifetime)", "Pass-through?"])
r += 1
CENG_TOP = r
for i, (cid, name, intid, basis, unit, *_x) in enumerate(COLLECTION_DRIVERS):
    rr, jr, er = COL_R0 + i, JCOLL_TOP + i, CE_TOP + i
    put(ws, f"A{r}", cid, BOLD, fill=WARN, border=True, align="center")
    put(ws, f"B{r}", name, BLACK, border=True, align="left")
    put(ws, f"C{r}", intid, BLACK, border=True, align="center")
    put(ws, f"D{r}", basis, BLACK, border=True, align="center")
    put(ws, f"E{r}", f"=INDEX('{S_JSVC}'!$C${jr}:${LASTJ}${jr},$B${V_JCOL})", GREEN, NUM2, border=True, align="center")
    put(ws, f"F{r}", f"=INDEX('{S_FUN}'!$C${er}:${LASTJ}${er},$B${V_JCOL})", GREEN, NUM3, border=True, align="center")
    put(ws, f"G{r}", f"='{S_RCU}'!$I${rr}", GREEN, NUM2, border=True, align="center")
    put(ws, f"H{r}", f"=INDEX('{S_RCU}'!$F${rr}:$H${rr},$B${V_SCEN})", GREEN, INR2, border=True, align="center")
    put(ws, f"I{r}", f"=F{r}*G{r}*H{r}", BLACK, INR2, border=True, align="center")
    put(ws, f"J{r}", f"='{S_RCU}'!$K${rr}", GREEN, border=True, align="center")
    r += 1
CENG_BOT = r - 1
put(ws, f"B{r}", "Lifetime COLLECTIONS cost per funded loan", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"I{r}", f"=SUM(I{CENG_TOP}:I{CENG_BOT})", BOLD, INR2, TOTFILL, border=True, align="center")
V_COLTOT = r
put(ws, f"E{r}", "Applicability is shown for information; it is already baked into the events column.", SUB, align="left")

r += 2
put(ws, f"B{r}", "TOTAL POST-ORIGINATION COST PER FUNDED LOAN", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"I{r}", f"=I{V_SVCTOT}+I{V_COLTOT}", BOLD, INR2, TOTFILL, border=True, align="center")
V_TOT = r
put(ws, f"B{r+1}", "  of which platform-borne", BLACK, border=True, align="left")
put(ws, f"I{r+1}", f'=SUMIF($J${SENG_TOP}:$J${SENG_BOT},"No",I{SENG_TOP}:I{SENG_BOT})'
                   f'+SUMIF($J${CENG_TOP}:$J${CENG_BOT},"No",I{CENG_TOP}:I{CENG_BOT})', BLACK, INR2, border=True, align="center")
V_PLAT = r + 1
put(ws, f"B{r+2}", "  of which pass-through", BLACK, border=True, align="left")
put(ws, f"I{r+2}", f'=SUMIF($J${SENG_TOP}:$J${SENG_BOT},"Yes",I{SENG_TOP}:I{SENG_BOT})'
                   f'+SUMIF($J${CENG_TOP}:$J${CENG_BOT},"Yes",I{CENG_TOP}:I{CENG_BOT})', BLACK, INR2, border=True, align="center")
V_PASS = r + 2
put(ws, f"B{r+3}", "Cost per ACTIVE LOAN-MONTH", BOLD, align="left")
put(ws, f"I{r+3}", f"=IFERROR(I{V_TOT}/$B${V_LIFEM},0)", BOLD, INR2, TOTFILL, border=True, align="center")
V_PERMONTH = r + 3
put(ws, f"B{r+5}", "Compare the per-active-loan-month figure against the LMS fee on sheet 1. A servicing fee below this number "
                   "means every month the loan stays on the book destroys value — and long-tenor journeys stay a long time.", SUB, align="left")

# =========================================================== 9_Cloud_Cost
ws = sheet(S_CLOUD, "9 — Cloud infrastructure cost per tenant",
           "The 17 REQUIRED_DEPLOYMENT_COMPONENTS from saas-deployment-blueprints.js across the 4 SAAS_DEPLOYMENT_MODELS. "
           "₹ per month, per tenant, volume-independent.",
           {"A": 34, "B": 10, "C": 22, "D": 26, "E": 22, "F": 24, "G": 72})
header_row(ws, 4, ["Deployment component", "Tier"] + DEPLOY_MODELS + ["Note"])
r = 5
for (comp, vals, note) in CLOUD_FIXED:
    put(ws, f"A{r}", comp, BOLD if comp == "decision_runtime" else BLACK, border=True, align="left")
    put(ws, f"B{r}", "", BLACK, border=True)
    for k, v in enumerate(vals):
        c = put(ws, f"{get_column_letter(3+k)}{r}", v, BLUE, INR, YELLOW, border=True, align="center")
        if comp == "decision_runtime": c.font = Font(name=FONT, size=10, bold=True, color="0000FF")
    nc = put(ws, f"G{r}", note, SUB, border=True, align="left")
    if comp == "decision_runtime": nc.fill = WARN
    r += 1
CF_TOP, CF_BOT = 5, r - 1
put(ws, f"A{r}", "Subtotal — fixed ₹ per month", BOLD, fill=TOTFILL, border=True, align="left")
ws[f"B{r}"].fill = TOTFILL
for k in range(4):
    cl = get_column_letter(3+k)
    put(ws, f"{cl}{r}", f"=SUM({cl}{CF_TOP}:{cl}{CF_BOT})", BOLD, INR, TOTFILL, border=True, align="center")
CF_FIXED = r
r += 2
put(ws, f"A{r}", "Variable ₹ per 1,000 applications", BOLD, border=True, align="left")
for k, v in enumerate(CLOUD_VARIABLE_PER_1K):
    put(ws, f"{get_column_letter(3+k)}{r}", v, BLUE, INR, YELLOW, border=True, align="center")
put(ws, f"G{r}", "Marginal compute, DB IOPS, egress and log ingest. Excludes retained storage (below).", SUB, border=True, align="left")
CF_VAR = r
r += 2
section(ws, r, "Selected deployment model", 7); r += 1
put(ws, f"A{r}", "Selected model", BOLD, align="left")
put(ws, f"C{r}", f"='{S_IN}'!$B${R_MODEL}", GREEN, None, LIGHT, border=True, align="center")
r += 1
put(ws, f"A{r}", "Model index", BLACK, align="left")
put(ws, f"C{r}", f"='{S_IN}'!$B${R_MODELIDX}", GREEN, NUM, border=True, align="center")
CF_IDX = r
r += 1
put(ws, f"A{r}", "Fixed cloud ₹/month (selected)", BOLD, align="left")
put(ws, f"C{r}", f"=INDEX($C${CF_FIXED}:$F${CF_FIXED},$C${CF_IDX})", BOLD, INR, TOTFILL, border=True, align="center")
CF_SELFIX = r
r += 1
put(ws, f"A{r}", "Variable cloud ₹ per 1,000 apps (selected)", BOLD, align="left")
put(ws, f"C{r}", f"=INDEX($C${CF_VAR}:$F${CF_VAR},$C${CF_IDX})", BOLD, INR, TOTFILL, border=True, align="center")
CF_SELVAR = r

r += 3
section(ws, r, "Retained-evidence storage — this cost COMPOUNDS", 7); r += 1
put(ws, f"A{r}", "RBI/PMLA retention means documents, V-CIP recordings, statements and the audit hash chain accumulate. "
                 "Storage cost rises every year even at flat volume, and servicing adds a monthly statement stream for the "
                 "whole life of every loan.", SUB, align="left")
r += 2
SP = {}
for label, val, fmt, note in [
    ("MB retained per dropped application", STORAGE["mb_per_dropped_application"], NUM, "Docs and bureau reports pulled on files that never funded — still retained."),
    ("MB retained per funded loan (origination)", STORAGE["mb_per_funded_loan"], NUM, "Dominated by the V-CIP recording and the signed contract packet."),
    ("MB retained per active loan-year (servicing)", 6, NUM, "Statements, notices, receipts, CIC submissions and collections evidence."),
    ("Retention years", STORAGE["retention_years"], NUM, "Model the longest applicable obligation, not the shortest."),
    ("₹ per GB-month (blended hot→archive)", STORAGE["inr_per_gb_month_blended"], INR2, "Blended across S3 Standard, IA and Glacier with Object Lock."),
]:
    put(ws, f"A{r}", label, BLACK, align="left")
    put(ws, f"C{r}", val, BLUE, fmt, YELLOW, border=True, align="center")
    put(ws, f"G{r}", note, SUB, align="left")
    SP[label] = r; r += 1
S_DROP, S_FUND = SP["MB retained per dropped application"], SP["MB retained per funded loan (origination)"]
S_SVCMB, S_YRS, S_RATE = SP["MB retained per active loan-year (servicing)"], SP["Retention years"], SP["₹ per GB-month (blended hot→archive)"]
put(ws, f"A{r}", "Annual applications started", BLACK, align="left")
put(ws, f"C{r}", f"='{S_IN}'!$B${R_APPS}*12", GREEN, NUM, border=True, align="center")
S_APPS = r; r += 1
put(ws, f"A{r}", "Annual funded loans", BLACK, align="left")
put(ws, f"C{r}", f"=$C${S_APPS}*'{S_ORIG}'!$B${O_FUND}", GREEN, NUM, border=True, align="center")
S_LOANS = r; r += 1
put(ws, f"A{r}", "Active loans (from the book model)", BLACK, align="left")
put(ws, f"C{r}", f"='{S_PNL}'!$B${'{ACTIVE_ROW}'}", GREEN, NUM, border=True, align="center")
S_ACTIVE = r; r += 1
put(ws, f"A{r}", "GB added per year", BOLD, align="left")
put(ws, f"C{r}", f"=(($C${S_APPS}-$C${S_LOANS})*$C${S_DROP}+$C${S_LOANS}*$C${S_FUND}+$C${S_ACTIVE}*$C${S_SVCMB})/1024",
    BOLD, NUM, border=True, align="center")
S_GBYR = r
r += 2
header_row(ws, r, ["Year", "Cumulative GB retained", "Storage ₹ per year", "Storage ₹ per month"], height=20)
r += 1
YR_TOP = r
for y in range(1, STORAGE["retention_years"] + 1):
    put(ws, f"A{r}", y, BLACK, NUM, border=True, align="center")
    put(ws, f"B{r}", f"=$C${S_GBYR}*A{r}", BLACK, NUM, border=True, align="center")
    put(ws, f"C{r}", f"=B{r}*$C${S_RATE}*12", BLACK, INR, border=True, align="center")
    put(ws, f"D{r}", f"=C{r}/12", BLACK, INR, border=True, align="center")
    r += 1
YR_BOT = r - 1
put(ws, f"A{r+1}", "Year 1 storage ₹/year", BOLD, align="left")
put(ws, f"C{r+1}", f"=C{YR_TOP}", BOLD, INR, TOTFILL, border=True, align="center")
S_Y1 = r + 1
put(ws, f"A{r+2}", f"Year {STORAGE['retention_years']} storage ₹/year", BOLD, align="left")
put(ws, f"C{r+2}", f"=C{YR_BOT}", BOLD, INR, TOTFILL, border=True, align="center")
put(ws, f"A{r+3}", "Multiple, year 1 → final year", BLACK, align="left")
put(ws, f"C{r+3}", f"=IFERROR(C{YR_BOT}/C{YR_TOP},0)", BLACK, '0.0"x"', border=True, align="center")
put(ws, f"G{r+3}", "Price a multi-year contract against the AVERAGE of these years, not year 1.", SUB, align="left")

# =========================================================== 10_Governance_Cost
ws = sheet(S_GOV, "10 — Governance, compliance and regulatory cost",
           "Platform-level fixed cost that exists because we are a compliance-first lending platform. It must be "
           "allocated; the basis materially changes which tenants look profitable.",
           {"A": 52, "B": 20, "C": 76})
header_row(ws, 4, ["Governance / regulatory cost item", "₹ per year (platform)", "Note"])
r = 5
for (item, cost, note) in GOVERNANCE:
    put(ws, f"A{r}", item, BLACK, border=True, align="left")
    put(ws, f"B{r}", cost, BLUE, INR, YELLOW, border=True, align="center")
    put(ws, f"C{r}", note, SUB, border=True, align="left")
    r += 1
G_TOP, G_BOT = 5, r - 1
put(ws, f"A{r}", "TOTAL platform governance cost ₹/year", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"B{r}", f"=SUM(B{G_TOP}:B{G_BOT})", BOLD, INR, TOTFILL, border=True, align="center")
G_TOTAL = r
r += 2
section(ws, r, "Allocation to this tenant", 3); r += 1
A_START = r
for label, f, fmt, note in [
 ("Live tenants on platform", f"='{S_IN}'!$B${R_TEN}", NUM, "More tenants = lower fixed cost each. Early tenants are structurally expensive."),
 ("Platform annual funded loans (all tenants)", f"='{S_IN}'!$B${R_PVOL}", NUM, "Denominator for volume-weighted allocation."),
 ("This tenant annual funded loans", f"='{S_CLOUD}'!$C${S_LOANS}", NUM, "From the funnel and volume inputs."),
 ("Equal-share allocation ₹/yr", f"=IFERROR($B${G_TOTAL}/$B${r},0)", INR, "Compliance effort is largely per-tenant, not per-loan."),
 ("Volume-weighted allocation ₹/yr", f"=IFERROR($B${G_TOTAL}*$B${r+2}/$B${r+1},0)", INR, "Reporting and monitoring effort scales with loan count."),
 ("Allocation basis", f"='{S_IN}'!$B${R_ALLOC}", None, "Blended 50/50 is the recommended default — neither pure basis is honest alone."),
]:
    put(ws, f"A{r}", label, BLACK, align="left")
    put(ws, f"B{r}", f, GREEN, fmt, border=True, align="center")
    put(ws, f"C{r}", note, SUB, align="left")
    r += 1
A_EQ, A_VOL, A_BASIS = A_START + 3, A_START + 4, A_START + 5
put(ws, f"A{r}", "Allocated governance cost ₹/yr", BOLD, align="left")
put(ws, f"B{r}", f'=IF($B${A_BASIS}="Equal per tenant",$B${A_EQ},IF($B${A_BASIS}="Volume weighted",$B${A_VOL},'
                 f'0.5*$B${A_EQ}+0.5*$B${A_VOL}))', BOLD, INR, TOTFILL, border=True, align="center")
G_ALLOC = r
r += 2
section(ws, r, "Direct regulatory operating cost caused by this tenant", 3); r += 1
put(ws, f"A{r}", "Direct regulatory ops ₹/month", BLACK, align="left")
put(ws, f"B{r}", REG_DIRECT_MONTHLY, BLUE, INR, YELLOW, border=True, align="center")
put(ws, f"C{r}", "Tenant-specific report runs, submissions, regulator queries and evidence packs. "
                 "The reporting RAILS themselves are priced as recurring drivers R15-R22 on sheet 3.", SUB, align="left")
RD_M = r; r += 1
put(ws, f"A{r}", "Direct regulatory ₹ per 1,000 funded loans", BLACK, align="left")
put(ws, f"B{r}", REG_DIRECT_PER_1K_LOANS, BLUE, INR, YELLOW, border=True, align="center")
put(ws, f"C{r}", "Submission, acknowledgement and reconciliation effort that scales with volume.", SUB, align="left")
RD_K = r; r += 1
put(ws, f"A{r}", "Direct regulatory cost ₹/yr", BOLD, align="left")
put(ws, f"B{r}", f"=$B${RD_M}*12+$B${RD_K}*$B${A_START+2}/1000", BOLD, INR, border=True, align="center")
RD_TOT = r
r += 2
put(ws, f"A{r}", "TOTAL governance + regulatory ₹/yr for this tenant", BOLD, fill=TOTFILL, border=True, align="left")
put(ws, f"B{r}", f"=$B${G_ALLOC}+$B${RD_TOT}", BOLD, INR, TOTFILL, border=True, align="center")
GOV_TENANT = r

# =========================================================== 11_Service_Cost
ws = sheet(S_SUP, "11 — Service, support and onboarding cost",
           "Human cost of running the tenant. Onboarding is the most commonly under-recovered line in lending SaaS.",
           {"A": 6, "B": 34, "C": 22, "D": 78})
header_row(ws, 4, ["#", "Support tier", "₹ per month", "Included scope"])
scope = [
 "Business-hours L1/L2, shared queue, 8-hour P1 response, quarterly review.",
 "Extended-hours L1/L2/L3, named CSM, 2-hour P1 response, monthly review, 4 policy config changes/quarter.",
 "24x7 dedicated pod, 30-minute P1 response, embedded solution engineer, unlimited policy config changes.",
]
r = 5
for i, t in enumerate(SUPPORT_TIERS):
    put(ws, f"A{r}", i + 1, BLACK, border=True, align="center")
    put(ws, f"B{r}", t, BOLD, border=True, align="center")
    put(ws, f"C{r}", SUPPORT_MONTHLY[i], BLUE, INR, YELLOW, border=True, align="center")
    put(ws, f"D{r}", scope[i], SUB, border=True, align="left")
    r += 1
ST_TOP = 5
r += 1
header_row(ws, r, ["#", "Deployment model", "Implementation cost ₹ (one time)", "Note"], height=20)
r += 1
ON_TOP = r
onote = [
 "Provision into the shared plane; tenant config, policy bundle, entitlements, UAT.",
 "Adds dedicated database provisioning, isolation evidence and restore rehearsal.",
 "Full dedicated environment build, network, domains, DR design and acceptance.",
 "Customer-managed install: their infra, our runbooks — heaviest coordination cost.",
]
for i, m in enumerate(DEPLOY_MODELS):
    put(ws, f"A{r}", i + 1, BLACK, border=True, align="center")
    put(ws, f"B{r}", m, BLACK, border=True, align="left")
    put(ws, f"C{r}", ONBOARDING_BY_MODEL[i], BLUE, INR, YELLOW, border=True, align="center")
    put(ws, f"D{r}", onote[i], SUB, border=True, align="left")
    r += 1
ON_BOT = r - 1
r += 2
section(ws, r, "Selected for this deal", 4); r += 1
put(ws, f"B{r}", "Selected support tier", BOLD, align="left")
put(ws, f"C{r}", f"='{S_IN}'!$B${R_TIER}", GREEN, None, LIGHT, border=True, align="center")
r += 1
put(ws, f"B{r}", "Support ₹/month", BOLD, align="left")
put(ws, f"C{r}", f"=INDEX($C${ST_TOP}:$C${ST_TOP+2},'{S_IN}'!$B${R_TIERIDX})", BOLD, INR, TOTFILL, border=True, align="center")
SV_MON = r; r += 1
put(ws, f"B{r}", "Implementation cost ₹", BLACK, align="left")
put(ws, f"C{r}", f"=INDEX($C${ON_TOP}:$C${ON_BOT},'{S_IN}'!$B${R_MODELIDX})", BLACK, INR, border=True, align="center")
SV_IMPL = r; r += 1
put(ws, f"B{r}", "Admission / due-diligence cost ₹ (INT-ADM-*)", BLACK, align="left")
put(ws, f"C{r}", f"='{S_RCR}'!$L${ADM_TOTAL}", GREEN, INR, border=True, align="center")
put(ws, f"D{r}", "Entity, authority, representative, domain and contract due diligence at admission.", SUB, align="left")
SV_ADM = r; r += 1
put(ws, f"B{r}", "TOTAL onboarding cost ₹ (one time)", BOLD, align="left")
put(ws, f"C{r}", f"=$C${SV_IMPL}+$C${SV_ADM}", BOLD, INR, TOTFILL, border=True, align="center")
SV_ONB = r; r += 1
put(ws, f"B{r}", "Contract term (months)", BLACK, align="left")
put(ws, f"C{r}", f"='{S_IN}'!$B${R_TERM}", GREEN, NUM, border=True, align="center")
SV_TERM = r; r += 1
put(ws, f"B{r}", "Onboarding amortised ₹/yr", BOLD, align="left")
put(ws, f"C{r}", f"=IFERROR($C${SV_ONB}/$C${SV_TERM}*12,0)", BOLD, INR, TOTFILL, border=True, align="center")
SV_ONB_YR = r; r += 1
put(ws, f"B{r}", "Onboarding recovered by fee?", BLACK, align="left")
put(ws, f"C{r}", f'=IF(\'{S_IN}\'!$B${R_ONBFEE}>=$C${SV_ONB},"Yes","No — shortfall")', BLACK, border=True, align="center")
put(ws, f"D{r}", f"=IFERROR('{S_IN}'!$B${R_ONBFEE}-$C${SV_ONB},0)", BLACK, INR, border=True, align="center")

# =========================================================== 12_Tenant_PnL
ws = sheet(S_PNL, "12 — Tenant P&L (annual)",
           "Full bottom-up build across origination, the servicing book, collections, recurring subscriptions and "
           "platform cost. Pass-through appears in both cost and revenue — margin is earned on the handling markup only.",
           {"A": 54, "B": 22, "C": 78})
P = {}
def pnl(label, formula, fmt=INR, note="", bold=False, fill=None):
    global r
    put(ws, f"A{r}", label, BOLD if bold else BLACK, align="left")
    put(ws, f"B{r}", formula, BOLD if bold else GREEN, fmt, fill, border=True, align="center")
    if note: put(ws, f"C{r}", note, SUB, align="left")
    P[label] = r; r += 1

r = 4
section(ws, r, "Origination volume", 3); r += 1
pnl("Monthly applications started", f"='{S_IN}'!$B${R_APPS}", NUM)
pnl("Annual applications started", f"=$B${P['Monthly applications started']}*12", NUM)
pnl("Decisioned rate", f"='{S_ORIG}'!$B${O_DEC}", PCT)
pnl("Annual decisioned applications", f"=$B${P['Annual applications started']}*$B${P['Decisioned rate']}", NUM)
pnl("Funded rate", f"='{S_ORIG}'!$B${O_FUND}", PCT)
pnl("Annual funded loans", f"=$B${P['Annual applications started']}*$B${P['Funded rate']}", NUM)
pnl("Average ticket (₹)", f"='{S_ORIG}'!$B${O_TICKET}", INR)
pnl("Annual disbursement (₹)", f"=$B${P['Annual funded loans']}*$B${P['Average ticket (₹)']}", INR,
    "The denominator the tenant's CFO thinks in.")

r += 1
section(ws, r, "The book — servicing economics depend on STOCK, not flow", 3); r += 1
pnl("Book maturity", f"='{S_IN}'!$B${R_BOOK}", None, "Year 1 = ramping. Steady state = originations equal closures.")
pnl("Effective life (years)", f"='{S_SVC}'!$B${V_LIFEY}", NUM2, "Contractual tenor after prepayment and foreclosure.")
pnl("Steady-state active loans", f"=$B${P['Annual funded loans']}*$B${P['Effective life (years)']}", NUM,
    "At equilibrium the book holds one full effective life of originations.")
pnl("Year-1 average active loans", f"=$B${P['Annual funded loans']}*MIN($B${P['Effective life (years)']},1)/2", NUM,
    "Loans accumulate through the year, so the average is roughly half.")
pnl("ACTIVE LOANS (selected)",
    f'=IF($B${P["Book maturity"]}="Steady state",$B${P["Steady-state active loans"]},$B${P["Year-1 average active loans"]})',
    NUM, "", bold=True, fill=TOTFILL)
pnl("Servicing ramp factor",
    f'=IF($B${P["Book maturity"]}="Steady state",1,MIN(1,0.5/MAX($B${P["Effective life (years)"]},0.0001)))', NUM3,
    "At steady state each year incurs one full lifetime of servicing across the book, because closures equal originations.")

r += 1
section(ws, r, "Cost", 3); r += 1
pnl("Origination external — platform-borne", f"='{S_ORIG}'!$J${O_PLAT}*$B${P['Annual applications started']}", INR,
    "Absorbed inside the platform fee. Vendor price rises hit margin directly.")
pnl("Origination external — pass-through", f"='{S_ORIG}'!$J${O_PASS}*$B${P['Annual applications started']}", INR,
    "Rebilled at cost + markup. Usually the largest single cost line.")
pnl("Servicing + collections — platform-borne",
    f"='{S_SVC}'!$I${V_PLAT}*$B${P['Annual funded loans']}*$B${P['Servicing ramp factor']}", INR,
    "The loan-lifetime cost tail. Absent from an origination-only model — and often larger than origination.")
pnl("Servicing + collections — pass-through",
    f"='{S_SVC}'!$I${V_PASS}*$B${P['Annual funded loans']}*$B${P['Servicing ramp factor']}", INR)
pnl("Recurring subscriptions — platform-borne", f"='{S_RCR}'!$L${RCR_PLAT}", INR,
    "Scales with branches, devices, seats, partners and feeds — NOT with loan volume.")
pnl("Recurring subscriptions — pass-through", f"='{S_RCR}'!$L${RCR_PASS}", INR)
pnl("Cloud — fixed", f"='{S_CLOUD}'!$C${CF_SELFIX}*12", INR,
    "Volume-independent. Includes the per-tenant isolated decision runtime (ADR 0003).")
pnl("Cloud — variable", f"='{S_CLOUD}'!$C${CF_SELVAR}*$B${P['Annual applications started']}/1000", INR)
pnl("Cloud — retained storage (year 1)", f"='{S_CLOUD}'!$C${S_Y1}", INR, "Rises every year of the contract — see sheet 9.")
pnl("Governance + regulatory", f"='{S_GOV}'!$B${GOV_TENANT}", INR)
pnl("Support", f"='{S_SUP}'!$C${SV_MON}*12", INR)
pnl("Onboarding amortised", f"='{S_SUP}'!$C${SV_ONB_YR}", INR)
pnl("TOTAL COST", f"=SUM($B${P['Origination external — platform-borne']}:$B${P['Onboarding amortised']})", INR,
    "", bold=True, fill=TOTFILL)
pnl("Total PASS-THROUGH cost",
    f"=$B${P['Origination external — pass-through']}+$B${P['Servicing + collections — pass-through']}"
    f"+$B${P['Recurring subscriptions — pass-through']}", INR, "Rebilled at cost plus the handling markup.")
pnl("Total cost excluding pass-through", f"=$B${P['TOTAL COST']}-$B${P['Total PASS-THROUGH cost']}", INR,
    "The cost base the platform, origination and servicing fees must actually cover.")

r += 1
section(ws, r, "Revenue", 3); r += 1
pnl("Platform fee", f"='{S_IN}'!$B${R_PFEE}*12", INR, "Fixed. Recovers the per-tenant cost floor.")
pnl("Per-decisioned-application fee", f"='{S_IN}'!$B${R_DFEE}*$B${P['Annual decisioned applications']}", INR,
    "Shares funnel risk: you get paid for work done on files that do not fund.")
pnl("Per-funded-loan fee", f"='{S_IN}'!$B${R_LFEE}*$B${P['Annual funded loans']}", INR, "Origination fee.")
pnl("LMS fee on the active book", f"='{S_IN}'!$B${R_MFEE}*$B${P['ACTIVE LOANS (selected)']}*12", INR,
    "The annuity. This is what makes a lending SaaS a good business — and what an origination-only model misses.")
pnl("Pass-through recovery", f"=$B${P['Total PASS-THROUGH cost']}*(1+'{S_IN}'!$B${R_MARKUP})", INR)
pnl("Onboarding fee amortised", f"=IFERROR('{S_IN}'!$B${R_ONBFEE}/'{S_IN}'!$B${R_TERM}*12,0)", INR)
pnl("TOTAL REVENUE", f"=SUM($B${P['Platform fee']}:$B${P['Onboarding fee amortised']})", INR, "", bold=True, fill=TOTFILL)

r += 1
section(ws, r, "Margin", 3); r += 1
pnl("Gross profit", f"=$B${P['TOTAL REVENUE']}-$B${P['TOTAL COST']}", INR, "", bold=True, fill=TOTFILL)
pnl("Gross margin %", f"=IFERROR($B${P['Gross profit']}/$B${P['TOTAL REVENUE']},0)", PCT, "", bold=True, fill=TOTFILL)
pnl("Software margin % (pass-through stripped at cost)",
    f"=IFERROR(($B${P['TOTAL REVENUE']}-$B${P['Total PASS-THROUGH cost']}-$B${P['Total cost excluding pass-through']})"
    f"/($B${P['TOTAL REVENUE']}-$B${P['Total PASS-THROUGH cost']}),0)", PCT,
    "Strips rebilled cost from both sides but keeps the handling markup as earned margin. Manage the deal to this line.")
pnl("Revenue per funded loan (₹)", f"=IFERROR($B${P['TOTAL REVENUE']}/$B${P['Annual funded loans']},0)", INR2)
pnl("Cost per funded loan (₹)", f"=IFERROR($B${P['TOTAL COST']}/$B${P['Annual funded loans']},0)", INR2)
pnl("Contribution per funded loan (₹)",
    f"=$B${P['Revenue per funded loan (₹)']}-$B${P['Cost per funded loan (₹)']}", INR2, "", bold=True)
pnl("Effective cost to tenant (bps of disbursement)",
    f"=IFERROR($B${P['TOTAL REVENUE']}/$B${P['Annual disbursement (₹)']}*10000,0)", NUM2,
    "Quote this to a CFO. Small-ticket journeys look alarming here — that is real, not a modelling artefact.")
pnl("Revenue per active loan per month (₹)",
    f"=IFERROR($B${P['LMS fee on the active book']}/MAX($B${P['ACTIVE LOANS (selected)']},1)/12,0)", INR2)
pnl("Cost per active loan per month (₹)", f"='{S_SVC}'!$I${V_PERMONTH}", INR2,
    "If this exceeds the line above, every month a loan stays on the book destroys value.")

r += 1
section(ws, r, "Break-even", 3); r += 1
pnl("Annual fixed cost (₹)",
    f"=$B${P['Cloud — fixed']}+$B${P['Cloud — retained storage (year 1)']}+$B${P['Governance + regulatory']}"
    f"+$B${P['Support']}+$B${P['Onboarding amortised']}+$B${P['Recurring subscriptions — platform-borne']}"
    f"+$B${P['Recurring subscriptions — pass-through']}", INR,
    "Incurred whether the tenant originates one loan or one hundred thousand.")
pnl("  of which truly volume-independent (₹)",
    f"=$B${P['Cloud — fixed']}+$B${P['Support']}+$B${P['Onboarding amortised']}"
    f"+$B${P['Recurring subscriptions — platform-borne']}+$B${P['Recurring subscriptions — pass-through']}", INR,
    "Storage and the volume-weighted part of governance do scale — sheet 15 recomputes both.")
pnl("Variable cost per application (₹)",
    f"=IFERROR(($B${P['TOTAL COST']}-$B${P['Annual fixed cost (₹)']})/$B${P['Annual applications started']},0)", INR2)
pnl("Recurring pass-through recovery (volume-independent)",
    f"=$B${P['Recurring subscriptions — pass-through']}*(1+'{S_IN}'!$B${R_MARKUP})", INR,
    "Recurring cost is fixed, so the revenue that recovers it is fixed too. Keeping this on the variable side "
    "would overstate margin at high volume and understate it at low volume.")
pnl("Fixed revenue per year (₹)",
    f"=$B${P['Platform fee']}+$B${P['Onboarding fee amortised']}"
    f"+$B${P['Recurring pass-through recovery (volume-independent)']}", INR)
pnl("Revenue per application (₹)",
    f"=IFERROR(($B${P['TOTAL REVENUE']}-$B${P['Fixed revenue per year (₹)']})/$B${P['Annual applications started']},0)", INR2)
pnl("Contribution per application (₹)",
    f"=$B${P['Revenue per application (₹)']}-$B${P['Variable cost per application (₹)']}", INR2, "", bold=True)
pnl("Break-even annual applications",
    f"=IFERROR(MAX(0,($B${P['Annual fixed cost (₹)']}-$B${P['Fixed revenue per year (₹)']})"
    f"/$B${P['Contribution per application (₹)']}),0)", NUM)
pnl("Break-even MONTHLY applications", f"=$B${P['Break-even annual applications']}/12", NUM,
    "Below this the deal loses money at the quoted price. Make it a contractual minimum.", bold=True, fill=WARN)
pnl("Headroom vs. plan volume",
    f'=IF($B${P["Break-even annual applications"]}<=0,"n/a — fixed fees already cover fixed cost",'
    f'TEXT($B${P["Annual applications started"]}/$B${P["Break-even annual applications"]},"0.00")&"x")', None,
    "Under 1.0x = loss-making. 'n/a' means the platform fee alone carries the fixed base.", bold=True)
PNL = P
ACTIVE_ROW = P["ACTIVE LOANS (selected)"]
# resolve the forward reference left on the cloud sheet
wb[S_CLOUD][f"C{S_ACTIVE}"] = f"='{S_PNL}'!$B${ACTIVE_ROW}"

# =========================================================== 13_Price_Card
ws = sheet(S_PRICE, "13 — Price card and margin solve",
           "Solves for the per-funded-loan fee that hits the target gross margin, then states the quote.",
           {"A": 56, "B": 22, "C": 78})
Q = {}
def q(label, formula, fmt=INR, note="", bold=False, fill=None):
    global r
    put(ws, f"A{r}", label, BOLD if bold else BLACK, align="left")
    put(ws, f"B{r}", formula, BOLD if bold else GREEN, fmt, fill, border=True, align="center")
    if note: put(ws, f"C{r}", note, SUB, align="left")
    Q[label] = r; r += 1

r = 4
section(ws, r, "Margin solve", 3); r += 1
q("Target gross margin %", f"='{S_IN}'!$B${R_GM}", PCT)
q("Total cost ₹/yr", f"='{S_PNL}'!$B${PNL['TOTAL COST']}", INR)
q("Required total revenue ₹/yr", f"=IFERROR($B${Q['Total cost ₹/yr']}/(1-$B${Q['Target gross margin %']}),0)", INR)
q("Revenue already fixed (platform + onboarding + pass-through + LMS)",
  f"='{S_PNL}'!$B${PNL['Platform fee']}+'{S_PNL}'!$B${PNL['Onboarding fee amortised']}"
  f"+'{S_PNL}'!$B${PNL['Pass-through recovery']}+'{S_PNL}'!$B${PNL['LMS fee on the active book']}", INR)
q("Revenue from per-decisioned-application fee", f"='{S_PNL}'!$B${PNL['Per-decisioned-application fee']}", INR)
q("REQUIRED fee per funded loan ₹",
  f"=IFERROR(MAX(0,($B${Q['Required total revenue ₹/yr']}-$B${Q['Revenue already fixed (platform + onboarding + pass-through + LMS)']}"
  f"-$B${Q['Revenue from per-decisioned-application fee']})/'{S_PNL}'!$B${PNL['Annual funded loans']}),0)", INR2,
  "The floor the deal desk must not go below without approval.", bold=True, fill=TOTFILL)
q("Current fee per funded loan ₹", f"='{S_IN}'!$B${R_LFEE}", INR2)
q("Gap ₹ per funded loan", f"=$B${Q['REQUIRED fee per funded loan ₹']}-$B${Q['Current fee per funded loan ₹']}", INR2)
q("Verdict", f'=IF($B${Q["Gap ₹ per funded loan"]}<=0,"AT OR ABOVE TARGET MARGIN",'
             f'"BELOW TARGET — raise a fee, raise the platform fee, or change journey mix")', None, "", bold=True, fill=WARN)
r += 1
q("Servicing fee sanity check",
  f'=IF(\'{S_PNL}\'!$B${PNL["Revenue per active loan per month (₹)"]}>='
  f'\'{S_PNL}\'!$B${PNL["Cost per active loan per month (₹)"]},"LMS fee covers servicing cost",'
  f'"LMS FEE BELOW SERVICING COST — the book loses money every month")', None,
  "Independent of origination margin. A deal can look profitable at origination and still bleed on the book.",
  bold=True, fill=WARN)

r += 1
section(ws, r, "The quote", 3); r += 1
q("Tenant", f"='{S_IN}'!$B${IR['Tenant / regulated entity name']}", None)
q("Journey priced", f"='{S_IN}'!$B${R_JOUR}", None, "Quote each journey separately — costs differ by orders of magnitude.")
q("Deployment model", f"='{S_IN}'!$B${R_MODEL}", None)
q("Support tier", f"='{S_IN}'!$B${R_TIER}", None)
q("Platform fee ₹/month", f"='{S_IN}'!$B${R_PFEE}", INR, "", bold=True)
q("Fee per decisioned application ₹", f"='{S_IN}'!$B${R_DFEE}", INR2, "", bold=True)
q("Fee per funded loan ₹", f"='{S_IN}'!$B${R_LFEE}", INR2, "", bold=True)
q("LMS fee per active loan per month ₹", f"='{S_IN}'!$B${R_MFEE}", INR2, "", bold=True)
q("Pass-through handling markup", f"='{S_IN}'!$B${R_MARKUP}", PCT,
  "Bureau, KYC, AA, eSign, payout, NACH and reporting rails rebilled at cost + this markup, itemised monthly.", bold=True)
q("One-time onboarding fee ₹", f"='{S_IN}'!$B${R_ONBFEE}", INR, "", bold=True)
q("Minimum committed monthly applications",
  f"=CEILING('{S_PNL}'!$B${PNL['Break-even MONTHLY applications']},100)", NUM,
  "Contractual floor. Without it the tenant's funnel risk becomes your loss.", bold=True, fill=WARN)
q("Effective cost to tenant (bps of disbursement)",
  f"='{S_PNL}'!$B${PNL['Effective cost to tenant (bps of disbursement)']}", NUM2, "", bold=True)
q("Resulting gross margin %", f"='{S_PNL}'!$B${PNL['Gross margin %']}", PCT, "", bold=True, fill=TOTFILL)
q("Resulting software margin %", f"='{S_PNL}'!$B${PNL['Software margin % (pass-through stripped at cost)']}", PCT,
  "Manage the deal to this line, not the blended margin above.", bold=True, fill=TOTFILL)

# =========================================================== 14_Journey_Economics
ws = sheet(S_JE, "14 — Full-lifetime economics across all 21 journeys",
           "Origination, servicing and collections for every journey at the current rate cards, funnel and lifetime "
           "profile. This is the sheet that decides packaging.",
           {"A": 5, "B": 30, "C": 25, "D": 19, "E": 15, "F": 11, "G": 13, "H": 17, "I": 19,
            "J": 19, "K": 19, "L": 20, "M": 20, "N": 15, "O": 15})
header_row(ws, 4, ["#", "Journey", "Archetype", "Funnel preset", "Avg ticket ₹", "Funded rate",
                   "Eff. life (yrs)", "Origination ₹/app", "Origination ₹/funded loan",
                   "Servicing ₹/loan (life)", "Collections ₹/loan (life)", "TOTAL lifetime ₹/loan",
                   "₹ per active loan-month", "Total as bps", "Apps per funded loan"])
ATT_LOS = f"'{S_RCU}'!$I${LOS_R0}:$I${LOS_R0+NLOS-1}"
COST_LOS = f"'{S_RCU}'!$F${LOS_R0}:$H${LOS_R0+NLOS-1}"
ATT_SVC = f"'{S_RCU}'!$I${SVC_R0}:$I${SVC_R0+NSVC-1}"
COST_SVC = f"'{S_RCU}'!$F${SVC_R0}:$H${SVC_R0+NSVC-1}"
ATT_COL = f"'{S_RCU}'!$I${COL_R0}:$I${COL_R0+NCOL-1}"
COST_COL = f"'{S_RCU}'!$F${COL_R0}:$H${COL_R0+NCOL-1}"
REACH_BLK = f"'{S_FUN}'!$C${REACH_TOP}:$G${REACH_BOT}"
SCEN = f"'{S_IN}'!$B${R_SCENIDX}"
r = 5
JE_TOP = r
for i, (jt, arch, fun, tick) in enumerate(JOURNEYS):
    jc, ltr = JCOL[i], LT_TOP + i
    fidx = f"MATCH($D{r},'{S_FUN}'!$C$4:$G$4,0)"
    reach = f"INDEX({REACH_BLK},0,{fidx})"
    put(ws, f"A{r}", i + 1, BLACK, border=True, align="center")
    put(ws, f"B{r}", jt, BOLD, border=True, align="left")
    put(ws, f"C{r}", arch, BLACK, border=True, align="left")
    put(ws, f"D{r}", fun, BLACK, border=True, align="center")
    put(ws, f"E{r}", f"='{S_JLOS}'!{jc}$6", GREEN, INR, border=True, align="center")
    put(ws, f"F{r}", f"=INDEX('{S_FUN}'!$C${STG_DISB}:$G${STG_DISB},{fidx})", GREEN, PCT, border=True, align="center")
    put(ws, f"G{r}", f"='{S_FUN}'!$F${ltr}", GREEN, NUM2, border=True, align="center")
    put(ws, f"H{r}", f"=SUMPRODUCT('{S_JLOS}'!{jc}${JLOS_TOP}:{jc}${JLOS_BOT},{ATT_LOS},{reach},"
                     f"INDEX({COST_LOS},0,{SCEN}))", BLACK, INR2, border=True, align="center")
    put(ws, f"I{r}", f"=IFERROR(H{r}/F{r},0)", BOLD, INR2, border=True, align="center")
    put(ws, f"J{r}", f"=SUMPRODUCT('{S_JSVC}'!{jc}${JSVC_TOP}:{jc}${JSVC_BOT},'{S_FUN}'!{jc}${SQ_TOP}:{jc}${SQ_BOT},"
                     f"{ATT_SVC},INDEX({COST_SVC},0,{SCEN}))", BLACK, INR2, border=True, align="center")
    put(ws, f"K{r}", f"=SUMPRODUCT('{S_FUN}'!{jc}${CE_TOP}:{jc}${CE_BOT},{ATT_COL},INDEX({COST_COL},0,{SCEN}))",
        BLACK, INR2, border=True, align="center")
    put(ws, f"L{r}", f"=I{r}+J{r}+K{r}", BOLD, INR2, TOTFILL, border=True, align="center")
    put(ws, f"M{r}", f"=IFERROR((J{r}+K{r})/('{S_FUN}'!$E${ltr}),0)", BLACK, INR2, border=True, align="center")
    put(ws, f"N{r}", f"=IFERROR(L{r}/E{r}*10000,0)", BOLD, NUM2, border=True, align="center")
    put(ws, f"O{r}", f"=IFERROR(1/F{r},0)", BLACK, NUM2, border=True, align="center")
    r += 1
JE_BOT = r - 1
r += 1
for label, col, fmt in [("Cheapest lifetime cost per funded loan", "L", INR2),
                        ("Most expensive lifetime cost per funded loan", "L", INR2)]:
    put(ws, f"B{r}", label, BOLD, align="left")
    fn = "MIN" if "Cheapest" in label else "MAX"
    put(ws, f"C{r}", f"=INDEX($B${JE_TOP}:$B${JE_BOT},MATCH({fn}(L{JE_TOP}:L{JE_BOT}),L{JE_TOP}:L{JE_BOT},0))",
        BLACK, border=True, align="left")
    put(ws, f"L{r}", f"={fn}(L{JE_TOP}:L{JE_BOT})", BOLD, fmt, border=True, align="center")
    r += 1
put(ws, f"B{r}", "Spread (max / min)", BOLD, align="left")
put(ws, f"L{r}", f"=IFERROR(MAX(L{JE_TOP}:L{JE_BOT})/MIN(L{JE_TOP}:L{JE_BOT}),0)", BOLD, '0.0"x"', TOTFILL, border=True, align="center")
r += 1
put(ws, f"B{r}", "Servicing + collections as a share of lifetime cost", BOLD, align="left")
put(ws, f"L{r}", f"=IFERROR(SUM(J{JE_TOP}:K{JE_BOT})/SUM(L{JE_TOP}:L{JE_BOT}),0)", BOLD, PCT, TOTFILL, border=True, align="center")
put(ws, f"M{r}", "If this is large, an origination-only price is structurally wrong.", SUB, align="left")
r += 1
put(ws, f"B{r}", "Worst affordability (highest bps)", BOLD, align="left")
put(ws, f"C{r}", f"=INDEX($B${JE_TOP}:$B${JE_BOT},MATCH(MAX(N{JE_TOP}:N{JE_BOT}),N{JE_TOP}:N{JE_BOT},0))", BLACK, border=True, align="left")
put(ws, f"N{r}", f"=MAX(N{JE_TOP}:N{JE_BOT})", BOLD, NUM2, WARN, border=True, align="center")
r += 2
put(ws, f"B{r}", "Column N is the affordability test. A journey whose whole-life cost runs to hundreds of bps of the loan "
                 "cannot carry a full-stack verification and servicing chain — it needs a cheaper check set and a lighter "
                 "servicing playbook, not a discount.", SUB, align="left")

# =========================================================== 15_Sensitivity
ws = sheet(S_SENS, "15 — Volume sensitivity",
           "Same price card, varying monthly application volume. Governance, storage and the active book are recomputed "
           "at each volume. Recurring subscriptions are held constant — they follow branches and seats, not loans.",
           {"A": 17, "B": 15, "C": 15, "D": 15, "E": 18, "F": 16, "G": 18, "H": 18, "I": 18,
            "J": 14, "K": 15, "L": 19, "M": 13, "N": 13})
header_row(ws, 4, ["Monthly applications", "Annual applications", "Annual funded loans", "Active loans",
                   "Governance ₹/yr", "Storage ₹/yr", "Total cost ₹/yr", "Total revenue ₹/yr",
                   "Gross profit ₹/yr", "Blended margin %", "Software margin %", "Cost per funded loan ₹",
                   "Effective bps", "Verdict"])
FIXBASE = f"'{S_PNL}'!$B${PNL['  of which truly volume-independent (₹)']}"
VARC = f"'{S_PNL}'!$B${PNL['Variable cost per application (₹)']}"
FIXR = f"'{S_PNL}'!$B${PNL['Fixed revenue per year (₹)']}"
VARR = f"'{S_PNL}'!$B${PNL['Revenue per application (₹)']}"
FR = f"'{S_PNL}'!$B${PNL['Funded rate']}"
TICK = f"'{S_PNL}'!$B${PNL['Average ticket (₹)']}"
LIFEY = f"'{S_PNL}'!$B${PNL['Effective life (years)']}"
BOOKSEL = f"'{S_IN}'!$B${R_BOOK}"
PASSTOT = f"'{S_PNL}'!$B${PNL['Total PASS-THROUGH cost']}"
ANNAPPS = f"'{S_PNL}'!$B${PNL['Annual applications started']}"
GEQ, GTOT = f"'{S_GOV}'!$B${A_EQ}", f"'{S_GOV}'!$B${G_TOTAL}"
PLOANS, BASIS = f"'{S_IN}'!$B${R_PVOL}", f"'{S_IN}'!$B${R_ALLOC}"
RDMv, RDKv = f"'{S_GOV}'!$B${RD_M}", f"'{S_GOV}'!$B${RD_K}"
MBD, MBF = f"'{S_CLOUD}'!$C${S_DROP}", f"'{S_CLOUD}'!$C${S_FUND}"
MBS, SRATE = f"'{S_CLOUD}'!$C${S_SVCMB}", f"'{S_CLOUD}'!$C${S_RATE}"
r = 5
SEN_TOP = r
for v in [250, 500, 1000, 2500, 5000, 10000, 25000, 50000]:
    put(ws, f"A{r}", v, BLUE, NUM, YELLOW, border=True, align="center")
    put(ws, f"B{r}", f"=A{r}*12", BLACK, NUM, border=True, align="center")
    put(ws, f"C{r}", f"=B{r}*{FR}", BLACK, NUM, border=True, align="center")
    put(ws, f"D{r}", f'=C{r}*IF({BOOKSEL}="Steady state",{LIFEY},MIN({LIFEY},1)/2)', BLACK, NUM, border=True, align="center")
    put(ws, f"E{r}", f'=IF({BASIS}="Equal per tenant",{GEQ},IF({BASIS}="Volume weighted",IFERROR({GTOT}*C{r}/{PLOANS},0),'
                     f'0.5*{GEQ}+0.5*IFERROR({GTOT}*C{r}/{PLOANS},0)))+{RDMv}*12+{RDKv}*C{r}/1000',
        BLACK, INR, border=True, align="center")
    put(ws, f"F{r}", f"=((B{r}-C{r})*{MBD}+C{r}*{MBF}+D{r}*{MBS})/1024*{SRATE}*12", BLACK, INR, border=True, align="center")
    put(ws, f"G{r}", f"={FIXBASE}+E{r}+F{r}+{VARC}*B{r}", BLACK, INR, border=True, align="center")
    put(ws, f"H{r}", f"={FIXR}+{VARR}*B{r}", BLACK, INR, border=True, align="center")
    put(ws, f"I{r}", f"=H{r}-G{r}", BOLD, INR, border=True, align="center")
    put(ws, f"J{r}", f"=IFERROR(I{r}/H{r},0)", BLACK, PCT, border=True, align="center")
    put(ws, f"K{r}", f"=IFERROR(I{r}/(H{r}-IFERROR({PASSTOT}/{ANNAPPS},0)*B{r}),0)", BOLD, PCT, border=True, align="center")
    put(ws, f"L{r}", f"=IFERROR(G{r}/C{r},0)", BLACK, INR2, border=True, align="center")
    put(ws, f"M{r}", f"=IFERROR(H{r}/(C{r}*{TICK})*10000,0)", BLACK, NUM2, border=True, align="center")
    put(ws, f"N{r}", f'=IF(I{r}<=0,"LOSS",IF(I{r}<{FIXBASE}+E{r},"Sub-scale","Scaled"))', BLACK, None, border=True, align="center")
    r += 1
SEN_BOT = r - 1
r += 1
for line in [
 "How to read this table:",
 "",
 "1. Both gross PROFIT (column I) and margin (columns J and K) RISE with volume, and both asymptote. That is the "
 "classic fixed-base shape: the per-tenant floor — the isolated decision runtime (ADR 0003), the allocated compliance "
 "base, the support tier and the whole RECURRING class — is incurred at any volume and does not shrink.",
 "2. Below the break-even row this tenant LOSES money at the quoted price. The cause is almost never the per-loan fee; "
 "it is that the fixed base was sized for a bigger book. Recurring cost in particular follows branches, devices, seats "
 "and partners, so a small branch-heavy tenant can carry a larger fixed base than a much bigger digital one.",
 "3. The CEILING on blended margin (column J) is set by pass-through mix, not by inefficiency. Rebilled bureau, KYC, "
 "eSign, NACH and reporting-rail cost carries only the handling markup, so it permanently dilutes the blended "
 "percentage however efficient the platform becomes. Software margin (column K) is the real measure — manage to it, "
 "and never set a commission or an OKR on column J.",
 "4. 'Sub-scale' means gross profit does not yet exceed this tenant's own fixed cost — the deal works on paper but "
 "leaves no room for the unmodelled human cost of a real customer relationship.",
 "",
 "The commercial conclusion: the platform fee, not the per-loan fee, is what makes a small tenant safe to sign. Size it "
 "against the quantity drivers on sheet 1, not against the tenant's expected loan volume.",
]:
    put(ws, f"A{r}", line, SUB, align="left")
    r += 1

# =========================================================== 16_Coverage_Map
import re as _re
_mapfile = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                        "architecture", "platform-module-integration-api-map.md")
_txt = open(_mapfile, encoding="utf-8").read()
_seen, _rows = set(), []
for iid, nm in _re.findall(r"^\| (INT-[A-Z]+-\d+) \| ([^|]+)\|", _txt, _re.M):
    if iid in _seen: continue
    _seen.add(iid); _rows.append((iid, nm.strip()))
_priced = {}
for d in LOS_DRIVERS + SERVICING_DRIVERS + COLLECTION_DRIVERS:
    for x in d[2].split(";"): _priced.setdefault(x.strip(), []).append(d[0])
for d in RECURRING_DRIVERS:
    for x in d[2].split(";"): _priced.setdefault(x.strip(), []).append(d[0])
for d in ADMISSION_DRIVERS:
    _priced.setdefault(d[2].strip(), []).append(d[0])

MODNAME = {"CUS": "Customer channels & CRM", "LOS": "Loan origination", "RSK": "Decision / risk / AML",
           "LWS": "Lending workspaces", "LMS": "Loan management", "COL": "Collections", "COLAT": "Collateral",
           "FIN": "Finance & accounting", "REG": "Regulatory reporting", "PRT": "Partner / LSP",
           "ADM": "SaaS org admission", "PLT": "Platform"}

ws = sheet(S_COV, "16 — Integration coverage map",
           "Every one of the 115 INT-* integrations in platform-module-integration-api-map.md and exactly how this model "
           "treats it. Nothing is silently omitted; anything not priced by a driver states where it is absorbed instead.",
           {"A": 15, "B": 27, "C": 46, "D": 26, "E": 30, "F": 60})
header_row(ws, 4, ["INT ID", "Module", "Capability", "Treatment", "Priced driver(s)", "If not priced — where it is absorbed"])
r = 5
COV_TOP = r
for iid, nm in _rows:
    mod = MODNAME.get(iid.split("-")[1], iid.split("-")[1])
    if iid in _priced:
        treat, drv, note = "Priced driver", ", ".join(_priced[iid]), ""
        fill = OKFILL
    elif iid in COVERED_ELSEWHERE:
        where, why = COVERED_ELSEWHERE[iid]
        treat, drv, note = where, "", why
        fill = LIGHT
    else:
        treat, drv, note = "NOT COSTED", "", "No driver and no absorbing sheet — this is a real gap."
        fill = WARN
    put(ws, f"A{r}", iid, BOLD, fill=fill, border=True, align="center")
    put(ws, f"B{r}", mod, BLACK, border=True, align="left")
    put(ws, f"C{r}", nm, BLACK, border=True, align="left")
    put(ws, f"D{r}", treat, BLACK, fill=fill, border=True, align="center")
    put(ws, f"E{r}", drv, BOLD if drv else BLACK, border=True, align="center")
    put(ws, f"F{r}", note, SUB, border=True, align="left")
    r += 1
COV_BOT = r - 1
r += 1
put(ws, f"B{r}", "Total integrations in the map", BOLD, align="left")
put(ws, f"D{r}", len(_rows), BOLD, NUM, TOTFILL, border=True, align="center"); r += 1
put(ws, f"B{r}", "Carrying an explicit priced driver", BOLD, align="left")
put(ws, f"D{r}", f'=COUNTIF($D${COV_TOP}:$D${COV_BOT},"Priced driver")', BOLD, NUM, OKFILL, border=True, align="center"); r += 1
put(ws, f"B{r}", "Absorbed by cloud / governance / service sheets or internal", BOLD, align="left")
put(ws, f"D{r}", f'={COV_BOT-COV_TOP+1}-COUNTIF($D${COV_TOP}:$D${COV_BOT},"Priced driver")'
                 f'-COUNTIF($D${COV_TOP}:$D${COV_BOT},"NOT COSTED")', BOLD, NUM, LIGHT, border=True, align="center"); r += 1
put(ws, f"B{r}", "NOT COSTED (real gaps)", BOLD, align="left")
put(ws, f"D{r}", f'=COUNTIF($D${COV_TOP}:$D${COV_BOT},"NOT COSTED")', BOLD, NUM, WARN, border=True, align="center"); r += 2
put(ws, f"B{r}", "Absorbed is not the same as free. A component in the cloud or governance sheet still costs money — it is "
                 "just priced there as part of a bundle rather than metered per event. If any of those becomes separately "
                 "billable by a vendor, promote it to its own driver on sheet 2 or 3.", SUB, align="left")

# =========================================================== finalise
if "Sheet" in wb.sheetnames: del wb["Sheet"]
FREEZE = {S_README: "A4", S_IN: "A4", S_JLOS: "C8", S_JSVC: "C6", S_FUN: "C5",
          S_RCU: "B5", S_RCR: "B5", S_ORIG: "B13", S_SVC: "B15", S_JE: "C5",
          S_COV: "A5", S_SENS: "A5"}
for s in wb.worksheets:
    s.freeze_panes = FREEZE.get(s.title, "A5")
wb[S_IN].sheet_view.tabSelected = True
wb.active = wb.sheetnames.index(S_IN)
wb.save(OUT)
print("WROTE", OUT)
print(f"unit drivers={len(UNIT_ROWS)} (LOS {NLOS} / servicing {NSVC} / collections {NCOL})  "
      f"recurring={len(RECURRING_DRIVERS)}  admission={len(ADMISSION_DRIVERS)}  sheets={len(wb.worksheets)}")
