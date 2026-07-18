import { createHash } from "node:crypto";

const SCREENING_TYPES = new Set(["un_sanctions", "uapa", "pep", "internal_negative", "mule"]);
const TM_RULE_TYPES = new Set(["single_amount", "daily_velocity", "structuring", "high_risk_geography", "counterparty_watchlist"]);
const FRAUD_SIGNAL_TYPES = new Set(["device", "ip", "velocity", "location", "identity_link", "bank_account", "address", "employer", "negative_list", "mule", "early_warning"]);

export function registerScreeningList(registry = {}, input = {}, now = new Date()) {
  requireText(input.listId, "listId"); if (registry[input.listId]) fail("screening_list_duplicate", "listId already exists.");
  if (!SCREENING_TYPES.has(input.listType)) fail("screening_list_invalid", "listType is invalid.");
  requireDigest(input.contentChecksumSha256, "contentChecksumSha256"); fourEyes(input);
  const publishedAt = pastIso(input.publishedAt, now, "publishedAt"); const validUntil = futureIso(input.validUntil, now, "validUntil");
  const list = { listId: String(input.listId), listType: input.listType, provider: requiredString(input.provider, "provider"), version: requiredString(input.version, "version"), contentChecksumSha256: input.contentChecksumSha256.toLowerCase(), recordCount: nonNegativeInteger(input.recordCount, "recordCount"), storageCountry: oneOf(input.storageCountry, ["IN"], "storageCountry"), evidenceRef: requiredString(input.evidenceRef, "evidenceRef"), publishedAt, validUntil, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", registeredAt: now.toISOString() };
  return { registry: { ...registry, [list.listId]: list }, list };
}

export function conductOngoingCddReview(state = {}, input = {}, now = new Date()) {
  requireText(input.reviewId, "reviewId"); requireText(input.borrowerId, "borrowerId"); fourEyes(input);
  if (!state.borrowerProfiles?.[input.borrowerId]) fail("cdd_borrower_missing", "Borrower does not exist.");
  const activeLists = Object.values(state.screeningLists ?? {}).filter((list) => list.status === "active" && Date.parse(list.validUntil) > now.getTime());
  const requiredTypes = ["un_sanctions", "uapa", "pep", "internal_negative"];
  if (requiredTypes.some((type) => !activeLists.some((list) => list.listType === type))) fail("cdd_screening_list_missing", "Current sanctions, UAPA, PEP, and internal-negative lists are required.");
  const screenings = array(input.screenings, "screenings", true).map((screening) => {
    if (!activeLists.some((list) => list.listId === screening.listId)) fail("cdd_screening_list_invalid", "Every screening must use an active current list.");
    return { listId: screening.listId, outcome: oneOf(screening.outcome, ["clear", "potential_match", "confirmed_match"], "screenings.outcome"), evidenceRef: requiredString(screening.evidenceRef, "screenings.evidenceRef") };
  });
  if (requiredTypes.some((type) => !screenings.some((screening) => activeLists.find((list) => list.listId === screening.listId)?.listType === type))) fail("cdd_screening_incomplete", "All mandatory screening families must be evaluated.");
  const transactionProfile = { expectedMonthlyCreditsPaise: money(input.transactionProfile?.expectedMonthlyCreditsPaise, "expectedMonthlyCreditsPaise"), observedMonthlyCreditsPaise: money(input.transactionProfile?.observedMonthlyCreditsPaise, "observedMonthlyCreditsPaise"), cashIntensityPct: percentage(input.transactionProfile?.cashIntensityPct, "cashIntensityPct"), geographyRisk: oneOf(input.transactionProfile?.geographyRisk, ["low", "medium", "high"], "geographyRisk") };
  const escalations = []; if (screenings.some((item) => item.outcome !== "clear")) escalations.push("screening_match"); if (transactionProfile.observedMonthlyCreditsPaise > transactionProfile.expectedMonthlyCreditsPaise * 2n) escalations.push("profile_deviation"); if (transactionProfile.geographyRisk === "high") escalations.push("high_risk_geography");
  const nextReviewAt = futureIso(input.nextReviewAt, now, "nextReviewAt");
  return { reviewId: String(input.reviewId), borrowerId: String(input.borrowerId), riskRating: oneOf(input.riskRating, ["low", "medium", "high"], "riskRating"), purposeAndNatureRef: requiredString(input.purposeAndNatureRef, "purposeAndNatureRef"), sourceOfFundsRef: requiredString(input.sourceOfFundsRef, "sourceOfFundsRef"), beneficialOwnershipRef: requiredString(input.beneficialOwnershipRef, "beneficialOwnershipRef"), screenings, transactionProfile: stringifyMoney(transactionProfile), escalations, status: escalations.length ? "enhanced_due_diligence_required" : "clear", nextReviewAt, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reviewedAt: now.toISOString(), evidenceChecksumSha256: digest({ screenings, transactionProfile: stringifyMoney(transactionProfile), escalations }) };
}

export function createTransactionMonitoringRule(registry = {}, input = {}, now = new Date()) {
  requireText(input.ruleId, "ruleId"); if (registry[input.ruleId]) fail("tm_rule_duplicate", "ruleId already exists."); fourEyes(input);
  if (!TM_RULE_TYPES.has(input.ruleType)) fail("tm_rule_invalid", "ruleType is invalid.");
  const thresholdPaise = ["single_amount", "daily_velocity", "structuring"].includes(input.ruleType) ? money(input.thresholdPaise, "thresholdPaise").toString() : null;
  const rule = { ruleId: String(input.ruleId), name: requiredString(input.name, "name"), ruleType: input.ruleType, thresholdPaise, countThreshold: input.countThreshold == null ? null : positiveInteger(input.countThreshold, "countThreshold"), values: stringList(input.values, "values"), severity: oneOf(input.severity, ["low", "medium", "high", "critical"], "severity"), owner: requiredString(input.owner, "owner"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", approvedAt: now.toISOString() };
  return { registry: { ...registry, [rule.ruleId]: rule }, rule };
}

export function evaluateTransactions(state = {}, input = {}, now = new Date()) {
  requireText(input.assessmentId, "assessmentId"); requireText(input.borrowerId, "borrowerId"); requireText(input.assessedBy, "assessedBy");
  if (!state.borrowerProfiles?.[input.borrowerId]) fail("tm_borrower_missing", "Borrower does not exist.");
  const rules = Object.values(state.transactionMonitoringRules ?? {}).filter((rule) => rule.status === "active"); if (!rules.length) fail("tm_rules_missing", "At least one active transaction-monitoring rule is required.");
  const transactions = array(input.transactions, "transactions", true).map((item) => ({ transactionId: requiredString(item.transactionId, "transactionId"), amountPaise: money(item.amountPaise, "amountPaise"), occurredAt: pastIso(item.occurredAt, now, "occurredAt"), geography: requiredString(item.geography, "geography"), counterpartyRef: requiredString(item.counterpartyRef, "counterpartyRef"), direction: oneOf(item.direction, ["credit", "debit"], "direction") }));
  const alerts = [];
  for (const rule of rules) {
    let matched = [];
    if (rule.ruleType === "single_amount") matched = transactions.filter((item) => item.amountPaise >= BigInt(rule.thresholdPaise));
    if (rule.ruleType === "daily_velocity") matched = transactions.filter((item) => transactions.filter((candidate) => candidate.occurredAt.slice(0, 10) === item.occurredAt.slice(0, 10)).reduce((sum, candidate) => sum + candidate.amountPaise, 0n) >= BigInt(rule.thresholdPaise));
    if (rule.ruleType === "structuring") matched = transactions.filter((item) => item.amountPaise < BigInt(rule.thresholdPaise) && item.amountPaise >= BigInt(rule.thresholdPaise) * 8n / 10n); if (rule.ruleType === "structuring" && matched.length < (rule.countThreshold ?? 2)) matched = [];
    if (rule.ruleType === "high_risk_geography") matched = transactions.filter((item) => rule.values.includes(item.geography));
    if (rule.ruleType === "counterparty_watchlist") matched = transactions.filter((item) => rule.values.includes(item.counterpartyRef));
    if (matched.length) alerts.push({ alertId: `aml_${digest(`${input.assessmentId}:${rule.ruleId}`).slice(0, 20)}`, assessmentId: input.assessmentId, borrowerId: input.borrowerId, ruleId: rule.ruleId, severity: rule.severity, transactionIds: [...new Set(matched.map((item) => item.transactionId))], status: "open", tippingOffRestricted: true, createdAt: now.toISOString(), evidenceChecksumSha256: digest(matched.map((item) => ({ ...item, amountPaise: item.amountPaise.toString() }))) });
  }
  return { assessment: { assessmentId: input.assessmentId, borrowerId: input.borrowerId, transactionCount: transactions.length, alertCount: alerts.length, status: alerts.length ? "alerts_generated" : "clear", assessedBy: input.assessedBy, assessedAt: now.toISOString(), evidenceChecksumSha256: digest(transactions.map((item) => ({ ...item, amountPaise: item.amountPaise.toString() }))) }, alerts };
}

export function registerFraudRiskPolicy(registry = {}, input = {}, now = new Date()) {
  requireText(input.policyId, "policyId"); if (registry[input.policyId]) fail("fraud_policy_duplicate", "policyId already exists."); fourEyes(input);
  const weights = Object.fromEntries(Object.entries(input.weights ?? {}).map(([type, weight]) => { if (!FRAUD_SIGNAL_TYPES.has(type)) fail("fraud_policy_invalid", `Unknown signal type ${type}.`); return [type, boundedInteger(weight, 1, 100, `weights.${type}`)]; })); if (!Object.keys(weights).length) fail("fraud_policy_invalid", "At least one signal weight is required.");
  const referThreshold = boundedInteger(input.referThreshold, 1, 1000, "referThreshold"); const blockThreshold = boundedInteger(input.blockThreshold, referThreshold + 1, 2000, "blockThreshold");
  const policy = { policyId: input.policyId, version: positiveInteger(input.version, "version"), weights, referThreshold, blockThreshold, owner: requiredString(input.owner, "owner"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", approvedAt: now.toISOString() };
  return { registry: { ...registry, [policy.policyId]: policy }, policy };
}

export function assessFraudSignals(state = {}, input = {}, now = new Date()) {
  requireText(input.assessmentId, "assessmentId"); requireText(input.subjectId, "subjectId"); requireText(input.assessedBy, "assessedBy");
  const policy = state.fraudRiskPolicies?.[input.policyId]; if (!policy || policy.status !== "active") fail("fraud_policy_missing", "An active fraud policy is required.");
  const signals = array(input.signals, "signals", true).map((signal) => ({ signalId: requiredString(signal.signalId, "signalId"), type: oneOf(signal.type, [...FRAUD_SIGNAL_TYPES], "signals.type"), confidencePct: percentage(signal.confidencePct, "confidencePct"), linkedSubjectRefs: stringList(signal.linkedSubjectRefs, "linkedSubjectRefs"), evidenceRef: requiredString(signal.evidenceRef, "evidenceRef") }));
  const score = signals.reduce((sum, signal) => sum + Math.round((policy.weights[signal.type] ?? 0) * signal.confidencePct / 100), 0); const outcome = score >= policy.blockThreshold ? "block" : score >= policy.referThreshold ? "refer" : "clear";
  return { assessmentId: input.assessmentId, subjectId: input.subjectId, policyId: policy.policyId, policyVersion: policy.version, signals, score, outcome, status: outcome === "clear" ? "closed_clear" : "investigation_required", assessedBy: input.assessedBy, assessedAt: now.toISOString(), evidenceChecksumSha256: digest({ policyId: policy.policyId, signals, score, outcome }) };
}

export function buildPortfolioRiskSnapshot(input = {}, now = new Date()) {
  requireText(input.snapshotId, "snapshotId"); fourEyes(input);
  const exposures = array(input.exposures, "exposures", true).map((item) => ({ exposureId: requiredString(item.exposureId, "exposureId"), borrowerId: requiredString(item.borrowerId, "borrowerId"), connectedGroup: requiredString(item.connectedGroup ?? item.borrowerId, "connectedGroup"), product: requiredString(item.product, "product"), segment: requiredString(item.segment, "segment"), geography: requiredString(item.geography, "geography"), channel: requiredString(item.channel, "channel"), partner: requiredString(item.partner ?? "direct", "partner"), vintage: requiredString(item.vintage, "vintage"), assetClass: oneOf(item.assetClass, ["standard", "sma_0", "sma_1", "sma_2", "npa"], "assetClass"), exposurePaise: money(item.exposurePaise, "exposurePaise") }));
  const total = exposures.reduce((sum, item) => sum + item.exposurePaise, 0n); if (total <= 0n) fail("portfolio_snapshot_invalid", "Total exposure must be positive.");
  const limits = array(input.limits, "limits", true).map((limit) => ({ dimension: oneOf(limit.dimension, ["product", "segment", "geography", "channel", "partner", "connectedGroup"], "limits.dimension"), value: requiredString(limit.value, "limits.value"), maximumPct: percentage(limit.maximumPct, "maximumPct") }));
  const breaches = limits.flatMap((limit) => { const amount = exposures.filter((item) => item[limit.dimension] === limit.value).reduce((sum, item) => sum + item.exposurePaise, 0n); const pct = Number(amount * 10000n / total) / 100; return pct > limit.maximumPct ? [{ ...limit, actualPct: pct, amountPaise: amount.toString(), status: "breached" }] : []; });
  if (breaches.length && stringList(input.remediationActions, "remediationActions").length === 0) fail("portfolio_remediation_missing", "Limit breaches require remediation actions.");
  const grouped = {}; for (const dimension of ["product", "segment", "geography", "channel", "partner", "vintage", "assetClass", "connectedGroup"]) grouped[dimension] = groupExposure(exposures, dimension, total);
  return { snapshotId: input.snapshotId, asOf: pastIso(input.asOf, now, "asOf"), totalExposurePaise: total.toString(), accountCount: exposures.length, grouped, limits, breaches, status: breaches.length ? "limit_breach" : "within_appetite", remediationActions: stringList(input.remediationActions, "remediationActions"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, evidenceChecksumSha256: digest({ exposures: exposures.map((item) => ({ ...item, exposurePaise: item.exposurePaise.toString() })), limits }), createdAt: now.toISOString() };
}

export function stressPortfolio(snapshot, input = {}, now = new Date()) {
  if (!snapshot) fail("stress_snapshot_missing", "Portfolio snapshot is required."); requireText(input.stressTestId, "stressTestId"); fourEyes(input);
  const scenarios = array(input.scenarios, "scenarios", true).map((scenario) => { const lossRateBps = boundedInteger(scenario.lossRateBps, 0, 10000, "lossRateBps"); const stressedLoss = BigInt(snapshot.totalExposurePaise) * BigInt(lossRateBps) / 10000n; const capitalBuffer = money(scenario.capitalBufferPaise, "capitalBufferPaise"); return { name: requiredString(scenario.name, "name"), lossRateBps, stressedLossPaise: stressedLoss.toString(), capitalBufferPaise: capitalBuffer.toString(), status: stressedLoss <= capitalBuffer ? "within_buffer" : "buffer_breach" }; });
  const status = scenarios.every((item) => item.status === "within_buffer") ? "passed" : "breached"; if (status === "breached" && !input.managementActionRef) fail("stress_action_missing", "A breached stress test requires a management action reference.");
  return { stressTestId: input.stressTestId, snapshotId: snapshot.snapshotId, scenarios, status, managementActionRef: input.managementActionRef ?? null, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, testedAt: now.toISOString(), evidenceChecksumSha256: digest({ snapshotId: snapshot.snapshotId, scenarios }) };
}

export function createRcsaAssessment(input = {}, now = new Date()) {
  requireText(input.assessmentId, "assessmentId"); fourEyes(input);
  const risks = array(input.risks, "risks", true).map((risk) => { const inherent = boundedInteger(risk.inherentScore, 1, 25, "inherentScore"); const controlEffectivenessPct = percentage(risk.controlEffectivenessPct, "controlEffectivenessPct"); const residual = Math.max(1, Math.ceil(inherent * (100 - controlEffectivenessPct) / 100)); const actions = stringList(risk.actions, "actions"); if (residual >= 10 && !actions.length) fail("rcsa_action_missing", "High residual risk requires an action."); return { riskId: requiredString(risk.riskId, "riskId"), process: requiredString(risk.process, "process"), category: oneOf(risk.category, ["operational", "conduct", "fraud", "vendor", "cyber", "credit"], "category"), inherentScore: inherent, controls: stringList(risk.controls, "controls", true), controlEffectivenessPct, residualScore: residual, kris: array(risk.kris, "kris").map((kri) => { const value = finiteNumber(kri.value, "kri.value"); const threshold = finiteNumber(kri.threshold, "kri.threshold"); return { name: requiredString(kri.name, "kri.name"), value, threshold, status: value <= threshold ? "within" : "breached" }; }), lossEvents: array(risk.lossEvents, "lossEvents").map((loss) => ({ lossEventId: requiredString(loss.lossEventId, "lossEventId"), amountPaise: money(loss.amountPaise, "amountPaise").toString(), rootCause: requiredString(loss.rootCause, "rootCause") })), actions }; });
  return { assessmentId: input.assessmentId, period: requiredString(input.period, "period"), risks, status: risks.some((risk) => risk.residualScore >= 10 || risk.kris.some((kri) => kri.status === "breached")) ? "actions_required" : "within_appetite", proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, assessedAt: now.toISOString(), evidenceChecksumSha256: digest(risks) };
}

export function createRecurringModelReport(state = {}, input = {}, now = new Date()) {
  requireText(input.reportId, "reportId"); requireText(input.modelId, "modelId"); fourEyes(input);
  const model = state.modelRegistry?.models?.[input.modelId]; if (!model || model.status !== "active") fail("model_monitoring_model_inactive", "An active model is required.");
  const cohorts = array(input.cohorts, "cohorts", true).map((cohort) => ({ name: requiredString(cohort.name, "cohort.name"), sampleSize: positiveInteger(cohort.sampleSize, "sampleSize"), approvalRatePct: percentage(cohort.approvalRatePct, "approvalRatePct"), badRatePct: percentage(cohort.badRatePct, "badRatePct") }));
  const approvalSpread = Math.max(...cohorts.map((item) => item.approvalRatePct)) - Math.min(...cohorts.map((item) => item.approvalRatePct)); const badRate = percentage(input.performance?.badRatePct, "badRatePct"); const driftValue = finiteNumber(input.performance?.driftValue, "driftValue"); if (driftValue < 0) fail("model_monitoring_invalid", "driftValue must be non-negative.");
  const thresholds = { maximumApprovalSpreadPct: percentage(input.thresholds?.maximumApprovalSpreadPct, "maximumApprovalSpreadPct"), maximumBadRatePct: percentage(input.thresholds?.maximumBadRatePct, "maximumBadRatePct"), maximumDriftValue: finiteNumber(input.thresholds?.maximumDriftValue, "maximumDriftValue") }; if (thresholds.maximumDriftValue < 0) fail("model_monitoring_invalid", "maximumDriftValue must be non-negative.");
  const breaches = []; if (approvalSpread > thresholds.maximumApprovalSpreadPct) breaches.push("fairness_spread"); if (badRate > thresholds.maximumBadRatePct) breaches.push("bad_rate"); if (driftValue > thresholds.maximumDriftValue) breaches.push("drift");
  if (breaches.length && !input.remediationRef) fail("model_monitoring_remediation_missing", "Monitoring breaches require remediation evidence.");
  return { reportId: input.reportId, modelId: input.modelId, modelVersion: model.version, period: requiredString(input.period, "period"), cohorts, performance: { badRatePct: badRate, driftValue, approvalSpreadPct: Number(approvalSpread.toFixed(2)) }, thresholds, breaches, status: breaches.length ? "breached" : "passed", remediationRef: input.remediationRef ?? null, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, reportedAt: now.toISOString(), evidenceChecksumSha256: digest({ cohorts, badRate, driftValue, breaches }) };
}

export function buildRiskCommitteePack(state = {}, input = {}, now = new Date()) {
  requireText(input.packId, "packId"); fourEyes(input); const refs = { portfolioSnapshotIds: stringList(input.portfolioSnapshotIds, "portfolioSnapshotIds", true), stressTestIds: stringList(input.stressTestIds, "stressTestIds", true), rcsaAssessmentIds: stringList(input.rcsaAssessmentIds, "rcsaAssessmentIds", true), modelReportIds: stringList(input.modelReportIds, "modelReportIds", true), amlAlertIds: stringList(input.amlAlertIds, "amlAlertIds") };
  const missing = [...refs.portfolioSnapshotIds.filter((id) => !state.portfolioRiskSnapshots?.[id]), ...refs.stressTestIds.filter((id) => !state.portfolioStressTests?.[id]), ...refs.rcsaAssessmentIds.filter((id) => !state.rcsaAssessments?.[id]), ...refs.modelReportIds.filter((id) => !state.modelMonitoringReports?.[id]), ...refs.amlAlertIds.filter((id) => !state.amlAlerts?.[id])]; if (missing.length) fail("risk_pack_reference_missing", `Missing risk evidence: ${missing.join(", ")}.`);
  return { packId: input.packId, committee: requiredString(input.committee, "committee"), period: requiredString(input.period, "period"), refs, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "sealed", sealedAt: now.toISOString(), packChecksumSha256: digest(refs) };
}

function groupExposure(exposures, field, total) { const map = new Map(); for (const item of exposures) map.set(item[field], (map.get(item[field]) ?? 0n) + item.exposurePaise); return [...map.entries()].map(([value, amount]) => ({ value, amountPaise: amount.toString(), pct: Number(amount * 10000n / total) / 100 })).sort((a, b) => b.pct - a.pct); }
function stringifyMoney(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => typeof item === "bigint" ? [key, item.toString()] : [key, item])); }
function money(value, field) { if (typeof value !== "string" || !/^\d+$/.test(value)) fail("risk_money_invalid", `${field} must be a non-negative integer paise string.`); return BigInt(value); }
function fourEyes(input) { requireText(input.proposedBy, "proposedBy"); requireText(input.approvedBy, "approvedBy"); requireText(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("risk_four_eyes_required", "Independent approval is required."); }
function requiredString(value, field) { requireText(value, field); return String(value); }
function requireText(value, field) { if (typeof value !== "string" || !value.trim()) fail("risk_control_invalid", `${field} is required.`); }
function requireDigest(value, field) { if (!/^[a-fA-F0-9]{64}$/.test(value ?? "")) fail("risk_control_invalid", `${field} must be a SHA-256 digest.`); }
function digest(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function array(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value) || (required && !value.length)) fail("risk_control_invalid", `${field} must be a${required ? " non-empty" : "n"} array.`); return value; }
function stringList(value, field, required = false) { const result = [...new Set(array(value, field, required).map(String).map((item) => item.trim()).filter(Boolean))]; if (required && !result.length) fail("risk_control_invalid", `${field} requires values.`); return result; }
function oneOf(value, allowed, field) { if (!allowed.includes(value)) fail("risk_control_invalid", `${field} is invalid.`); return value; }
function percentage(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) fail("risk_control_invalid", `${field} must be 0-100.`); return value; }
function finiteNumber(value, field) { if (typeof value !== "number" || !Number.isFinite(value)) fail("risk_control_invalid", `${field} must be a finite number.`); return value; }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value <= 0) fail("risk_control_invalid", `${field} must be a positive integer.`); return value; }
function nonNegativeInteger(value, field) { if (!Number.isInteger(value) || value < 0) fail("risk_control_invalid", `${field} must be a non-negative integer.`); return value; }
function boundedInteger(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("risk_control_invalid", `${field} must be between ${min} and ${max}.`); return value; }
function pastIso(value, now, field) { const time = Date.parse(value); if (!Number.isFinite(time) || time > now.getTime()) fail("risk_control_invalid", `${field} must be a non-future date.`); return new Date(time).toISOString(); }
function futureIso(value, now, field) { const time = Date.parse(value); if (!Number.isFinite(time) || time <= now.getTime()) fail("risk_control_invalid", `${field} must be a future date.`); return new Date(time).toISOString(); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
