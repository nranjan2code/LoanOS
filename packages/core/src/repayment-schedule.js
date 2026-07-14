import { createFinding, summarizeFindings } from "./compliance-controls.js";

const FREQUENCIES = {
  weekly: { periodsPerYear: 52, add: (date, index) => addDays(date, index * 7) },
  fortnightly: { periodsPerYear: 26, add: (date, index) => addDays(date, index * 14) },
  monthly: { periodsPerYear: 12, add: addMonths },
  quarterly: { periodsPerYear: 4, add: (date, index) => addMonths(date, index * 3) }
};
const STRUCTURES = new Set(["amortizing", "bullet", "moratorium", "step_up"]);
const toPaise = (value) => Math.round(Number(value) * 100);
const fromPaise = (value) => value / 100;

export function periodsForTenor(tenorMonths, repaymentFrequency = "monthly") {
  if (repaymentFrequency === "weekly") return Math.max(1, Math.round((tenorMonths * 52) / 12));
  if (repaymentFrequency === "fortnightly") return Math.max(1, Math.round((tenorMonths * 26) / 12));
  if (repaymentFrequency === "quarterly") return Math.max(1, Math.ceil(tenorMonths / 3));
  return tenorMonths;
}

export function periodsPerYearForFrequency(repaymentFrequency = "monthly") {
  return FREQUENCIES[repaymentFrequency]?.periodsPerYear ?? null;
}

export function generateContractualSchedule(input = {}) {
  const principalAmount = Number(input.principalAmount);
  const annualInterestRateBps = input.annualInterestRateBps ?? 0;
  const tenorMonths = input.tenorMonths;
  const repaymentFrequency = input.repaymentFrequency ?? "monthly";
  const repaymentStructure = input.repaymentStructure ?? "amortizing";
  const moratoriumPeriods = input.moratoriumPeriods ?? 0;
  const moratoriumInterestTreatment = input.moratoriumInterestTreatment ?? "serviced";
  const stepUpBps = input.stepUpBps ?? 0;
  const stepUpEveryPeriods = input.stepUpEveryPeriods ?? FREQUENCIES[repaymentFrequency]?.periodsPerYear ?? 12;
  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  const findings = [];
  if (!Number.isFinite(principalAmount) || principalAmount <= 0 || Math.abs(principalAmount * 100 - Math.round(principalAmount * 100)) >= 1e-8) findings.push(createFinding("error", "RBI-DL-2025", "principalAmount must be positive and paise-exact.", "principalAmount"));
  if (!Number.isInteger(tenorMonths) || tenorMonths <= 0) findings.push(createFinding("error", "RBI-DL-2025", "tenorMonths must be a positive integer.", "tenorMonths"));
  if (!Number.isInteger(annualInterestRateBps) || annualInterestRateBps < 0) findings.push(createFinding("error", "RBI-KFS-2024", "annualInterestRateBps must be a non-negative integer.", "annualInterestRateBps"));
  if (Number.isNaN(startDate.getTime())) findings.push(createFinding("error", "RBI-IT-GRC", "startDate must be a valid timestamp.", "startDate"));
  if (!FREQUENCIES[repaymentFrequency]) findings.push(createFinding("error", "RBI-KFS-2024", "repaymentFrequency must be weekly, fortnightly, monthly, or quarterly.", "repaymentFrequency"));
  if (!STRUCTURES.has(repaymentStructure)) findings.push(createFinding("error", "RBI-KFS-2024", "repaymentStructure is invalid.", "repaymentStructure"));
  const periodCount = Number.isInteger(tenorMonths) && FREQUENCIES[repaymentFrequency] ? periodsForTenor(tenorMonths, repaymentFrequency) : 0;
  if (repaymentStructure === "moratorium" && (!Number.isInteger(moratoriumPeriods) || moratoriumPeriods <= 0 || moratoriumPeriods >= periodCount || !["serviced", "deferred"].includes(moratoriumInterestTreatment))) findings.push(createFinding("error", "RBI-KFS-2024", "Moratorium requires a valid period count below tenor and serviced/deferred interest treatment.", "moratoriumPeriods"));
  if (repaymentStructure === "step_up" && (!Number.isInteger(stepUpBps) || stepUpBps <= 0 || stepUpBps > 10000 || !Number.isInteger(stepUpEveryPeriods) || stepUpEveryPeriods <= 0)) findings.push(createFinding("error", "RBI-KFS-2024", "Step-up schedule requires valid stepUpBps and stepUpEveryPeriods.", "stepUpBps"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { schedule: [], findings, summary };

  const frequency = FREQUENCIES[repaymentFrequency]; const periodRate = annualInterestRateBps / 10000 / frequency.periodsPerYear; const principalPaise = toPaise(principalAmount); let openingPaise = principalPaise; let deferredInterestPaise = 0; const schedule = [];
  const repaymentPeriods = periodCount - (repaymentStructure === "moratorium" ? moratoriumPeriods : 0);
  const emiPaise = computeEmiPaise(principalPaise, periodRate, repaymentPeriods);
  const stepWeights = repaymentStructure === "step_up" ? Array.from({ length: periodCount }, (_, index) => (1 + stepUpBps / 10000) ** Math.floor(index / stepUpEveryPeriods)) : null;
  const weightTotal = stepWeights?.reduce((sum, value) => sum + value, 0) ?? 0; let allocatedPrincipalPaise = 0;
  for (let index = 1; index <= periodCount; index += 1) {
    const interestPaise = Math.round(openingPaise * periodRate); let principalDuePaise = 0; let interestDuePaise = interestPaise; let deferredThisPeriodPaise = 0;
    if (repaymentStructure === "bullet") principalDuePaise = index === periodCount ? openingPaise : 0;
    else if (repaymentStructure === "moratorium" && index <= moratoriumPeriods) { principalDuePaise = 0; if (moratoriumInterestTreatment === "deferred") { deferredThisPeriodPaise = interestPaise; deferredInterestPaise += interestPaise; interestDuePaise = 0; } }
    else if (repaymentStructure === "step_up") { principalDuePaise = index === periodCount ? openingPaise : Math.min(openingPaise, Math.round((principalPaise * stepWeights[index - 1]) / weightTotal)); allocatedPrincipalPaise += principalDuePaise; }
    else { const repaymentIndex = repaymentStructure === "moratorium" ? index - moratoriumPeriods : index; principalDuePaise = repaymentIndex === repaymentPeriods ? openingPaise : Math.min(openingPaise, Math.max(0, emiPaise - interestPaise)); }
    if (repaymentStructure === "moratorium" && index === moratoriumPeriods + 1 && deferredInterestPaise) { interestDuePaise += deferredInterestPaise; deferredInterestPaise = 0; }
    const closingPaise = Math.max(0, openingPaise - principalDuePaise);
    schedule.push({ installmentNumber: index, dueDate: frequency.add(startDate, index).toISOString().slice(0, 10), repaymentFrequency, repaymentStructure, openingPrincipal: fromPaise(openingPaise), principalDue: fromPaise(principalDuePaise), interestDue: fromPaise(interestDuePaise), deferredInterest: fromPaise(deferredThisPeriodPaise), totalDue: fromPaise(principalDuePaise + interestDuePaise), closingPrincipal: fromPaise(closingPaise), status: "scheduled" }); openingPaise = closingPaise;
  }
  if (openingPaise !== 0 || allocatedPrincipalPaise > principalPaise) throw new Error("Schedule did not reconcile to principal.");
  return { schedule, findings, summary };
}

function computeEmiPaise(principalPaise, rate, periods) { if (rate === 0) return Math.round(principalPaise / periods); const factor = (1 + rate) ** periods; return Math.round((principalPaise * rate * factor) / (factor - 1)); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function addMonths(date, months) { const next = new Date(date); const day = next.getUTCDate(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + months); const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate(); next.setUTCDate(Math.min(day, last)); return next; }
