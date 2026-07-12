// India GST (Goods and Services Tax) on lending fees and charges.
//
// GST (currently 18%) applies to the fee-based services a lender supplies —
// processing, documentation, valuation, foreclosure/prepayment charges, etc.
// It does NOT apply to:
//   - interest (a financial service, exempt);
//   - stamp_duty (a statutory levy collected for the state);
//   - insurance_premium (the insurer's supply; GST, if any, is charged by them);
//   - penal_charge / late_payment_penalty (liquidated damages for breach, treated
//     as outside the scope of GST per CBIC Circular 178/2022).
//
// Applicability is data-driven: a charge may override the default with an
// explicit boolean `gstApplicable` and/or a `gstRateBps`, so product policy —
// not engine code — decides (REV-42).
//
// Disclosure model: the charge amount that product policy discloses in the KFS
// and that is assessed to the loan account is the GST-INCLUSIVE amount the
// borrower pays. We decompose it into a base fee and the GST component so both
// appear on the KFS, the charge event, and the statement, without changing the
// cash flow through the ledger. All arithmetic is exact integer paise.

export const GST_RATE_BPS = 1800; // 18%

export const GST_EXEMPT_CHARGE_TYPES = new Set([
  "stamp_duty",
  "insurance_premium",
  "penal_charge",
  "late_payment_penalty"
]);

function toPaise(rupees) {
  return Math.round((Number(rupees) || 0) * 100);
}

function fromPaise(paise) {
  return paise / 100;
}

// Whether a charge attracts GST. An explicit `gstApplicable` on the charge wins;
// otherwise the charge type's default applies.
export function isChargeGstApplicable(charge = {}) {
  if (typeof charge.gstApplicable === "boolean") {
    return charge.gstApplicable;
  }
  const type = charge.type ?? charge.chargeType ?? null;
  return !GST_EXEMPT_CHARGE_TYPES.has(type);
}

// The effective GST rate (bps) for a charge — 0 when not applicable.
export function gstRateBpsForCharge(charge = {}) {
  if (!isChargeGstApplicable(charge)) {
    return 0;
  }
  return Number.isFinite(charge.gstRateBps) ? charge.gstRateBps : GST_RATE_BPS;
}

// Decompose a GST-INCLUSIVE charge amount into its base fee and GST component,
// in exact integer paise. Returns rupee-denominated fields plus the treatment.
// A non-finite/zero amount yields a zeroed breakdown carrying the treatment.
export function decomposeGstInclusive(inclusiveAmount, charge = {}) {
  const applicable = isChargeGstApplicable(charge);
  const rateBps = gstRateBpsForCharge(charge);
  const totalPaise = Number.isFinite(inclusiveAmount) ? toPaise(inclusiveAmount) : 0;
  // base = total * 10000 / (10000 + rateBps); gst = total - base, so base + gst
  // reconstructs the disclosed amount to the paise regardless of rounding.
  const basePaise = rateBps > 0 ? Math.round((totalPaise * 10000) / (10000 + rateBps)) : totalPaise;
  const gstPaise = totalPaise - basePaise;
  return {
    gstApplicable: applicable,
    gstRateBps: rateBps,
    baseAmount: fromPaise(basePaise),
    gstAmount: fromPaise(gstPaise),
    totalAmount: fromPaise(totalPaise)
  };
}

// Enrich a charge with its GST breakdown for disclosure, preserving the original
// fields. `amount` (the GST-inclusive total) is left untouched.
export function withGstDisclosure(charge = {}) {
  const breakdown = decomposeGstInclusive(charge.amount, charge);
  return {
    ...charge,
    gstApplicable: breakdown.gstApplicable,
    gstRateBps: breakdown.gstRateBps,
    baseAmount: Number.isFinite(charge.amount) ? breakdown.baseAmount : null,
    gstAmount: Number.isFinite(charge.amount) ? breakdown.gstAmount : null,
    totalAmount: Number.isFinite(charge.amount) ? breakdown.totalAmount : null
  };
}

// Aggregate the base/GST/total across a list of charges with numeric amounts,
// in exact integer paise.
export function summarizeGst(charges = []) {
  let basePaise = 0;
  let gstPaise = 0;
  let totalPaise = 0;
  for (const charge of charges) {
    if (!Number.isFinite(charge?.amount)) {
      continue;
    }
    const breakdown = decomposeGstInclusive(charge.amount, charge);
    basePaise += toPaise(breakdown.baseAmount);
    gstPaise += toPaise(breakdown.gstAmount);
    totalPaise += toPaise(breakdown.totalAmount);
  }
  return {
    gstRateBps: GST_RATE_BPS,
    totalBaseFees: fromPaise(basePaise),
    totalGst: fromPaise(gstPaise),
    totalPayable: fromPaise(totalPaise)
  };
}
