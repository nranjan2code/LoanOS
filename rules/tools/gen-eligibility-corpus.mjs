// Generates the differential corpus for the lending.eligibility port (PH-1).
//
// Runs the incumbent JS implementation (packages/core/src/lending/eligibility.js)
// over a deterministic, seeded case sample and records each case's facts (in
// the engine's contract shape) alongside the JS decision. The Rust test
// rules-eval/tests/differential_eligibility.rs replays the corpus against the
// ported decision model and requires identical outcomes.
//
// Deterministic by construction: fixed seed, fixed `now`. Regenerate with:
//   node rules/tools/gen-eligibility-corpus.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateEligibility } from "@loanos/core/lending/eligibility.js";

const NOW = new Date("2026-07-10T00:00:00.000Z");

// SplitMix64 over BigInt: deterministic across platforms and Node versions.
function makeRng(seed) {
  let state = BigInt(seed);
  const MASK = (1n << 64n) - 1n;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return Number((z ^ (z >> 31n)) & 0xffffffffn) / 0x100000000;
  };
}

const amounts = [null, 50000, 100000, 300000, 800000, 1000000, 1200000];
const tenors = [null, 3, 6, 24, 60, 72];
const incomes = [null, 0, 15000, 20000, 30000, 60000, 85000, 200000];
const obligations = [null, 0, 5000, 20000, 40000];
const dobs = [null, "2010-01-01", "2004-08-01", "1991-04-02", "1968-01-15", "1963-06-30"];
const bureaus = [
  undefined,
  { score: 550 },
  { score: 650 },
  { score: 742 },
  {},
  { score: 742, defaultAccounts: 1 },
];
const rates = [
  { annualInterestRateBps: 1850 },
  { aprBps: 2000 },
  {},
  { annualInterestRateBps: 0 },
];

const product = {
  minAmount: 100000,
  maxAmount: 1000000,
  minTenorMonths: 6,
  maxTenorMonths: 60,
  eligibility: { minAgeYears: 21, maxAgeYears: 65, minMonthlyIncome: 20000, maxFoir: 0.5 },
};

const money = (v) => (v == null ? undefined : v.toFixed(2));

function buildCase(params) {
  const application = {
    product: {
      ...product,
      requestedAmount: params.amount ?? undefined,
      requestedTenorMonths: params.tenor ?? undefined,
      ...params.rate,
    },
    borrower: { dateOfBirth: params.dob ?? undefined },
    economicProfile: {
      monthlyIncome: params.income ?? undefined,
      existingMonthlyObligations: params.obligation ?? undefined,
    },
    bureauReport: params.bureau,
  };

  const facts = {
    product: {
      requested_amount: money(params.amount),
      min_amount: money(product.minAmount),
      max_amount: money(product.maxAmount),
      requested_tenor_months: params.tenor ?? undefined,
      min_tenor_months: product.minTenorMonths,
      max_tenor_months: product.maxTenorMonths,
      annual_interest_rate_bps: params.rate.annualInterestRateBps,
      apr_bps: params.rate.aprBps,
      eligibility: {
        min_age_years: product.eligibility.minAgeYears,
        max_age_years: product.eligibility.maxAgeYears,
        min_monthly_income: money(product.eligibility.minMonthlyIncome),
        max_foir: String(product.eligibility.maxFoir),
      },
    },
    borrower: { date_of_birth: params.dob ?? undefined },
    economic_profile: {
      monthly_income: money(params.income),
      existing_monthly_obligations: money(params.obligation),
    },
    bureau_report: params.bureau && {
      score: params.bureau.score,
      default_accounts: params.bureau.defaultAccounts,
    },
  };

  const { assessment } = evaluateEligibility(application, { now: NOW });
  return { facts, expected: assessment.decision };
}

const cases = [];

// Structured sweep: vary each dimension against a healthy base case, so every
// rule fires somewhere.
const base = {
  amount: 300000,
  tenor: 24,
  income: 85000,
  obligation: 5000,
  dob: "1991-04-02",
  bureau: { score: 742 },
  rate: { annualInterestRateBps: 1850 },
};
for (const amount of amounts) cases.push(buildCase({ ...base, amount }));
for (const tenor of tenors) cases.push(buildCase({ ...base, tenor }));
for (const income of incomes) cases.push(buildCase({ ...base, income }));
for (const obligation of obligations) cases.push(buildCase({ ...base, obligation }));
for (const dob of dobs) cases.push(buildCase({ ...base, dob }));
for (const bureau of bureaus) cases.push(buildCase({ ...base, bureau }));
for (const rate of rates) cases.push(buildCase({ ...base, rate }));

// Seeded random combinations across the full grid.
const rng = makeRng(0x5eed20260710n);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
for (let i = 0; i < 500; i++) {
  cases.push(
    buildCase({
      amount: pick(amounts),
      tenor: pick(tenors),
      income: pick(incomes),
      obligation: pick(obligations),
      dob: pick(dobs),
      bureau: pick(bureaus),
      rate: pick(rates),
    })
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "fixtures", "eligibility-corpus.json");
writeFileSync(
  out,
  JSON.stringify({ now: NOW.toISOString(), case_count: cases.length, cases }, null, 1)
);
const tally = {};
for (const c of cases) tally[c.expected] = (tally[c.expected] ?? 0) + 1;
console.log(`wrote ${cases.length} cases to ${out}`, tally);
