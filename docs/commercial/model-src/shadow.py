"""Independent re-implementation of the whole model, used to reconcile the workbook's formulas.

Deliberately written from the source data rather than by reading the workbook, so that a wiring
mistake in the spreadsheet shows up as a mismatch instead of being faithfully reproduced.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_model_part1 import DRIVERS as LOS_BASE, STAGES, FUNNELS, FUNNEL_REACH, ATTEMPTS
from build_model_part2 import (JOURNEYS, UNITS, DEPLOY_MODELS, CLOUD_FIXED, CLOUD_VARIABLE_PER_1K,
                               STORAGE, GOVERNANCE, REG_DIRECT_MONTHLY, REG_DIRECT_PER_1K_LOANS,
                               SUPPORT_TIERS, SUPPORT_MONTHLY, ONBOARDING_BY_MODEL)
from build_model_part3 import (LOS_GAP_DRIVERS, SERVICING_DRIVERS, COLLECTION_DRIVERS,
                               COLLECTION_ATTEMPTS, LIFETIME, SERVICING_UNITS,
                               COLLECTION_APPLICABILITY, ATTEMPTS_EXT)
from build_model_part4 import RECURRING_DRIVERS, ADMISSION_DRIVERS, QUANTITY_BASES

LOS_DRIVERS = LOS_BASE + LOS_GAP_DRIVERS
ATT = dict(ATTEMPTS); ATT.update(ATTEMPTS_EXT)
FIDX = {f: i for i, f in enumerate(FUNNELS)}
QTY = {k: v for k, _l, v, _u in QUANTITY_BASES}
MB_SVC_PER_LOAN_YEAR = 6          # mirrors the cloud sheet input


def _c(d, scen):
    return d[5 + scen]


def origination(jt, scen=1):
    j = next(x for x in JOURNEYS if x[0] == jt)
    fi = FIDX[j[2]]
    per_app = plat = pas = 0.0
    for d in LOS_DRIVERS:
        did, stage, pt = d[0], d[3], d[9]
        u = UNITS[jt].get(did, 0)
        if not u:
            continue
        v = u * ATT[did] * FUNNEL_REACH[stage][fi] * _c(d, scen)
        per_app += v
        if pt == "Yes": pas += v
        else: plat += v
    fr = FUNNEL_REACH["disbursement"][fi]
    return dict(journey=jt, funnel=j[2], ticket=j[3], funded_rate=fr,
                dec_rate=FUNNEL_REACH["credit_decision"][fi], per_app=per_app,
                per_loan=per_app / fr, plat_per_app=plat, pass_per_app=pas)


def lifetime_profile(jt):
    tenor, lifef, emiyr, bounce, d1, d2, d3 = LIFETIME[jt]
    eff_m = tenor * lifef
    eff_y = eff_m / 12
    emi = eff_y * emiyr
    return dict(tenor=tenor, life_factor=lifef, eff_months=eff_m, eff_years=eff_y,
                emi=emi, bounced=emi * bounce, delinq=[eff_m * d1, eff_m * d2, eff_m * d3])


def servicing(jt, scen=1):
    lp = lifetime_profile(jt)
    qty = {"per_loan_month": lp["eff_months"], "per_emi": lp["emi"],
           "per_bounced_emi": lp["bounced"], "per_loan_year": lp["eff_years"], "per_closure": 1.0}
    svc = plat = pas = 0.0
    for d in SERVICING_DRIVERS:
        did, basis, pt = d[0], d[3], d[9]
        u = SERVICING_UNITS[jt].get(did, 0)
        if not u:
            continue
        v = u * qty[basis] * ATT[did] * _c(d, scen)
        svc += v
        if pt == "Yes": pas += v
        else: plat += v
    col, events = 0.0, {}
    for d in COLLECTION_DRIVERS:
        did, pt = d[0], d[9]
        appl = COLLECTION_APPLICABILITY[jt].get(did, 0)
        ev = appl * sum(lp["delinq"][b] * COLLECTION_ATTEMPTS[did][b] for b in range(3))
        events[did] = ev
        v = ev * ATT[did] * _c(d, scen)
        col += v
        if pt == "Yes": pas += v
        else: plat += v
    return dict(servicing=svc, collections=col, total=svc + col, plat=plat, passthru=pas,
                events=events, per_active_month=(svc + col) / lp["eff_months"] if lp["eff_months"] else 0,
                **lp)


def recurring(scen=1):
    tot = plat = pas = 0.0
    for (rid, name, intids, basis, lo, base, hi, conf, pt, note) in RECURRING_DRIVERS:
        v = QTY.get(basis, 0) * [lo, base, hi][scen] * (12 if basis.endswith("_month") else 1)
        tot += v
        if pt == "Yes": pas += v
        else: plat += v
    return dict(total=tot, plat=plat, passthru=pas)


def admission(scen=1):
    return sum([d[3], d[4], d[5]][scen] for d in ADMISSION_DRIVERS)


def pnl(jt="personal_loan", monthly=4000, model=0, tier=0, basis="Blended 50/50",
        book="Steady state", term=36, tenants=12, plat_loans=900000, gm_target=0.62,
        markup=0.08, pfee=350000, dfee=12, lfee=900, mfee=14, onb_fee=750000, scen=1):
    o, s, rec = origination(jt, scen), servicing(jt, scen), recurring(scen)
    apps = monthly * 12
    dec = apps * o["dec_rate"]
    F = apps * o["funded_rate"]
    disb = F * o["ticket"]
    L = s["eff_years"]
    active = F * L if book == "Steady state" else F * min(L, 1) / 2
    ramp = 1.0 if book == "Steady state" else min(1.0, 0.5 / max(L, 1e-4))

    orig_plat, orig_pass = o["plat_per_app"] * apps, o["pass_per_app"] * apps
    svc_plat, svc_pass = s["plat"] * F * ramp, s["passthru"] * F * ramp
    cloud_fix = sum(v[1][model] for v in CLOUD_FIXED) * 12
    cloud_var = CLOUD_VARIABLE_PER_1K[model] * apps / 1000
    gb_yr = ((apps - F) * STORAGE["mb_per_dropped_application"]
             + F * STORAGE["mb_per_funded_loan"] + active * MB_SVC_PER_LOAN_YEAR) / 1024
    stor_y1 = gb_yr * STORAGE["inr_per_gb_month_blended"] * 12
    gov_total = sum(g[1] for g in GOVERNANCE)
    eq, vol = gov_total / tenants, gov_total * F / plat_loans
    alloc = {"Equal per tenant": eq, "Volume weighted": vol}.get(basis, 0.5 * eq + 0.5 * vol)
    gov = alloc + REG_DIRECT_MONTHLY * 12 + REG_DIRECT_PER_1K_LOANS * F / 1000
    support = SUPPORT_MONTHLY[tier] * 12
    onb_cost = ONBOARDING_BY_MODEL[model] + admission(scen)
    onb_amort = onb_cost / term * 12

    cost = (orig_plat + orig_pass + svc_plat + svc_pass + rec["plat"] + rec["passthru"]
            + cloud_fix + cloud_var + stor_y1 + gov + support + onb_amort)
    pass_total = orig_pass + svc_pass + rec["passthru"]
    cost_ex_pass = cost - pass_total

    rev_p, rev_d, rev_l = pfee * 12, dfee * dec, lfee * F
    rev_m = mfee * active * 12
    rev_pass = pass_total * (1 + markup)
    rev_onb = onb_fee / term * 12
    rev = rev_p + rev_d + rev_l + rev_m + rev_pass + rev_onb

    fixed_cost = cloud_fix + stor_y1 + gov + support + onb_amort + rec["plat"] + rec["passthru"]
    fixed_indep = cloud_fix + support + onb_amort + rec["plat"] + rec["passthru"]
    var_per_app = (cost - fixed_cost) / apps
    rec_pass_recovery = rec["passthru"] * (1 + markup)
    fixed_rev = rev_p + rev_onb + rec_pass_recovery
    rev_per_app = (rev - fixed_rev) / apps
    contrib = rev_per_app - var_per_app
    be_apps = max(0.0, (fixed_cost - fixed_rev) / contrib) if contrib else 0.0
    req_lfee = max(0.0, (cost / (1 - gm_target) - rev_p - rev_onb - rev_pass - rev_m - rev_d) / F)
    soft_margin = (rev - pass_total - cost_ex_pass) / (rev - pass_total)
    return dict(**locals())
