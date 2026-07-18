/**
 * Secured-lending collateral and staged-disbursement completion: covers the
 * lifecycle of a collateral asset (assessment -> ongoing monitoring ->
 * release) and, separately, multi-party document signing plus milestone-
 * gated tranche disbursement for facilities that release funds in stages
 * against certified progress (e.g. supply-chain/project finance) rather
 * than a single lump sum. This module does not perform valuation, legal
 * review, insurance underwriting, or panel management itself — it only
 * validates that independently-produced evidence for each (an active panel
 * appointment, an approved valuation, a clear legal opinion, active
 * lender-noted insurance, perfected security, physical custody) is present
 * and internally consistent before allowing the collateral to become
 * `"secured"`, and similarly validates milestone certification/invoice
 * matching before authorizing a disbursement tranche.
 *
 * Money and ratio fields are exact-decimal strings (paise-denominated
 * amounts, basis-point ratios), converted to `BigInt` internally
 * (`money()`/`ratio()`) — this mirrors the Rust engine's `rust_decimal`-only
 * money-math discipline (AGENTS.md "exact money math") even though this is
 * JS: no floating point ever touches a monetary comparison here.
 */
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("collateral_input_invalid", `${field} is required.`); return value.trim(); }
function list(value, field) { if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string" || !item)) fail("collateral_evidence_required", `${field} is required.`); return [...value]; }
function eyes(input) { text(input.proposedBy, "proposedBy"); text(input.approvedBy, "approvedBy"); text(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("collateral_four_eyes_required", "Independent approval is required."); }
function money(value, field, { positive = false } = {}) { if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || (positive && BigInt(value) === 0n)) fail("collateral_money_invalid", `${field} must be an exact paise string.`); return BigInt(value); }
function ratio(value, field) { if (typeof value !== "string" || !/^\d+(\.\d{1,4})?$/.test(value)) fail("collateral_ratio_invalid", `${field} must be an exact decimal string.`); const [a,b=""] = value.split("."); return BigInt(a) * 10000n + BigInt(b.padEnd(4,"0")); }
function map(state, key) { return state[key] ?? {}; }

/**
 * Bring a new collateral asset into `"secured"` status. Fails closed unless
 * every due-diligence leg checks out: an active independent valuation
 * panel, a completed panel work order tied to that panel, an approved
 * valuation report, a clear legal opinion, adequate active lender-noted
 * insurance (sum insured >= market value, not yet expired), perfected
 * security registration, and physical custody receipt. Eligible value is
 * computed as `marketValue * (1 - haircut)`, and the actual LTV
 * (`exposure / marketValue`) must not exceed the approved maximum LTV.
 * @param {object} state - holds `collateralRecords`.
 * @param {object} input - collateralId, proposedBy/approvedBy/approvalRef, evidenceRefs, panel, order, valuation, legalReview, haircutPercent, exposurePaise, maximumLtvPercent, insurance, perfection, custody, nextRevaluationAt.
 * @param {Date} [now]
 * @returns {{state: object, collateral: object}}
 */
export function registerCollateralAssessment(state, input, now = new Date()) {
  eyes(input); const collateralId = text(input.collateralId, "collateralId"); list(input.evidenceRefs, "evidenceRefs");
  const panel = input.panel; if (!panel || panel.status !== "active" || !panel.independent || !panel.validUntil || new Date(panel.validUntil) < now) fail("collateral_panel_invalid", "An active independent panel appointment is required.");
  const order = input.order; if (!order?.orderRef || order.panelId !== panel.panelId || order.status !== "completed") fail("collateral_order_incomplete", "Completed panel work order is required.");
  if (input.valuation?.status !== "approved" || !input.valuation.reportRef || input.legalReview?.status !== "clear" || !input.legalReview.opinionRef) fail("collateral_due_diligence_incomplete", "Approved valuation and clear legal review are required.");
  const market = money(input.valuation.marketValuePaise, "marketValuePaise", { positive: true }); const haircut = ratio(input.haircutPercent, "haircutPercent"); if (haircut > 1000000n) fail("collateral_ratio_invalid", "Haircut cannot exceed 100 percent.");
  const eligible = market * (1000000n - haircut) / 1000000n; const exposure = money(input.exposurePaise, "exposurePaise", { positive: true }); const maxLtv = ratio(input.maximumLtvPercent, "maximumLtvPercent"); const actualLtv = exposure * 1000000n / market;
  if (actualLtv > maxLtv) fail("collateral_ltv_exceeded", "Exposure exceeds approved LTV.");
  const insurance = input.insurance; if (!insurance || insurance.status !== "active" || money(insurance.sumInsuredPaise, "sumInsuredPaise") < market || new Date(insurance.validUntil) <= now || !insurance.policyRef || !insurance.lenderLossPayee) fail("collateral_insurance_invalid", "Adequate active lender-noted insurance is required.");
  const perfection = input.perfection; if (perfection?.status !== "perfected" || !perfection.registrationRef || !perfection.evidenceRef) fail("collateral_perfection_incomplete", "Security perfection evidence is required.");
  const custody = input.custody; if (custody?.status !== "received" || !custody.inventoryRef || !custody.storageRef || !custody.receivedAt) fail("collateral_custody_incomplete", "Collateral custody evidence is required.");
  const collateral = { ...input, collateralId, eligibleValuePaise: eligible.toString(), actualLtvPercent: `${actualLtv / 10000n}.${String(actualLtv % 10000n).padStart(4,"0")}`, status: "secured", approvedAt: now.toISOString(), nextRevaluationAt: text(input.nextRevaluationAt, "nextRevaluationAt"), version: 1 };
  return { state: { ...state, collateralRecords: { ...map(state,"collateralRecords"), [collateralId]: collateral } }, collateral };
}

/**
 * Record an ongoing monitoring cycle against a `"secured"` collateral
 * record. Uses optimistic concurrency (`expectedVersion` must match the
 * record's current `version`) since monitoring updates and releases can
 * race. Fails closed unless the inspection is satisfactory, covenants are
 * compliant, no open high/critical early-warning signal remains
 * unresolved, and — if the record's `nextRevaluationAt` has passed — an
 * approved revaluation is included in this same call.
 * @param {object} state - holds `collateralRecords`.
 * @param {object} input - collateralId, expectedVersion, proposedBy/approvedBy/approvalRef, evidenceRefs, inspection, covenants, earlyWarningSignals, revaluation.
 * @param {Date} [now]
 * @returns {{state: object, collateral: object}}
 */
export function recordCollateralMonitoring(state, input, now = new Date()) {
  eyes(input); list(input.evidenceRefs,"evidenceRefs"); const collateral = map(state,"collateralRecords")[input.collateralId]; if (!collateral || collateral.status !== "secured") fail("collateral_not_active", "Active secured collateral is required.");
  if (input.expectedVersion !== collateral.version) fail("collateral_version_conflict", "Collateral record changed concurrently.");
  if (input.inspection?.status !== "satisfactory" || !input.inspection.reportRef || input.covenants?.status !== "compliant") fail("collateral_monitoring_breach", "Inspection and covenant compliance are required.");
  if (input.earlyWarningSignals?.some((item) => item.status === "open" && ["high","critical"].includes(item.severity))) fail("collateral_ews_open", "Material early-warning signals require resolution.");
  if (new Date(collateral.nextRevaluationAt) <= now && (!input.revaluation || input.revaluation.status !== "approved" || !input.revaluation.reportRef)) fail("collateral_revaluation_due", "Due revaluation must be completed.");
  const updated = { ...collateral, lastInspection: input.inspection, covenants: input.covenants, earlyWarningSignals: input.earlyWarningSignals ?? [], revaluation: input.revaluation ?? collateral.revaluation, version: collateral.version + 1, monitoredAt: now.toISOString() };
  return { state: { ...state, collateralRecords: { ...map(state,"collateralRecords"), [input.collateralId]: updated } }, collateral: updated };
}

/**
 * Release a `"secured"` collateral record once the underlying loan is fully
 * settled. Fails closed unless the loan is `"closed"` with zero outstanding
 * balance, the registered charge/perfection has actually been released
 * (with evidence), the custody return is acknowledged by the recipient,
 * and the release happens within the committed `releaseDueAt` timeline —
 * a late release is a hard failure here, not a warning, since collateral
 * release delay is a common borrower-harm pattern regulators scrutinize.
 * @param {object} state - holds `collateralRecords`.
 * @param {object} input - collateralId, proposedBy/approvedBy/approvalRef, evidenceRefs, loanStatus, outstandingPaise, perfectionRelease, custodyRelease, releaseDueAt.
 * @param {Date} [now]
 * @returns {{state: object, collateral: object}}
 */
export function recordCollateralRelease(state, input, now = new Date()) {
  eyes(input); list(input.evidenceRefs,"evidenceRefs"); const collateral = map(state,"collateralRecords")[input.collateralId]; if (!collateral || collateral.status !== "secured") fail("collateral_not_releasable", "Secured collateral is required.");
  if (input.loanStatus !== "closed" || input.outstandingPaise !== "0" || input.perfectionRelease?.status !== "released" || !input.perfectionRelease.evidenceRef || !input.custodyRelease?.recipientAcknowledgementRef) fail("collateral_release_blocked", "Closure, charge release and acknowledged custody return are required.");
  const due = new Date(input.releaseDueAt); if (!Number.isFinite(due.getTime()) || now > due) fail("collateral_release_timeline_breached", "Collateral release timeline has been breached.");
  const updated = { ...collateral, status: "released", releasedAt: now.toISOString(), releaseEvidenceRefs: input.evidenceRefs, version: collateral.version + 1 };
  return { state: { ...state, collateralRecords: { ...map(state,"collateralRecords"), [input.collateralId]: updated } }, collateral: updated };
}

/**
 * Complete a multi-party document signing (e.g. borrower + guarantor +
 * co-lender partner). Fails closed unless every required party has signed
 * with their own signature and identity evidence, and — critically — every
 * party's signature binds the *same* document checksum, so a signer cannot
 * be shown a different document version than the others.
 * @param {object} state - holds `multipartySignings`.
 * @param {object} input - signingId, proposedBy/approvedBy/approvalRef, evidenceRefs, parties, documentChecksumSha256.
 * @param {Date} [now]
 * @returns {{state: object, signing: object}}
 */
export function completeMultipartySigning(state, input, now = new Date()) {
  eyes(input); list(input.evidenceRefs,"evidenceRefs"); const signingId = text(input.signingId,"signingId"); if (!input.parties?.length) fail("signing_parties_required","Signing parties are required.");
  for (const party of input.parties) if (party.status !== "signed" || !party.signatureRef || !party.identityEvidenceRef || !party.signedAt) fail("signing_incomplete","Every required party must sign with identity evidence.");
  if (!input.documentChecksumSha256?.match(/^[a-f0-9]{64}$/) || input.parties.some((party) => party.documentChecksumSha256 !== input.documentChecksumSha256)) fail("signing_checksum_mismatch","All signatures must bind the same document checksum.");
  const signing = { ...input, signingId, status:"completed", completedAt:now.toISOString() }; return { state:{...state,multipartySignings:{...map(state,"multipartySignings"),[signingId]:signing}},signing };
}

/**
 * Authorize one disbursement tranche of a staged facility. Fails closed
 * unless: the referenced multi-party signing is completed, any linked
 * collateral is still `"secured"`, the funding milestone is certified,
 * every supplier invoice is well-formed and the invoice total exactly
 * equals the tranche amount (no partial-invoice slack), funds route only
 * to the linked supplier account (`destinationType === "supplier"` —
 * end-use control), and cumulative tranches-to-date plus this one do not
 * exceed the facility's sanctioned amount.
 * @param {object} state - holds `multipartySignings`, `collateralRecords`, `disbursementTranches`.
 * @param {object} input - trancheId, amountPaise, proposedBy/approvedBy/approvalRef, evidenceRefs, signingId, collateralId, stage, invoices, supplierPaymentAccountRef, destinationType, facilityId, sanctionedAmountPaise.
 * @param {Date} [now]
 * @returns {{state: object, tranche: object}}
 */
export function authorizeDisbursementTranche(state, input, now = new Date()) {
  eyes(input); list(input.evidenceRefs,"evidenceRefs"); const trancheId=text(input.trancheId,"trancheId"); const amount=money(input.amountPaise,"amountPaise",{positive:true});
  const signing=map(state,"multipartySignings")[input.signingId]; if (signing?.status!=="completed") fail("disbursement_signing_incomplete","Completed signing is required.");
  const collateral=map(state,"collateralRecords")[input.collateralId]; if (input.collateralId && collateral?.status!=="secured") fail("disbursement_collateral_invalid","Active secured collateral is required.");
  if (!input.stage?.milestoneRef || input.stage.status!=="certified" || !input.stage.certificateRef) fail("disbursement_stage_incomplete","Certified tranche milestone is required.");
  const invoices=input.invoices; if (!invoices?.length || invoices.some((item)=>!item.invoiceRef||!item.supplierId||!item.endUse||money(item.amountPaise,"invoiceAmountPaise")<=0n)) fail("disbursement_invoice_invalid","Supplier and end-use invoices are required.");
  if (invoices.reduce((sum,item)=>sum+money(item.amountPaise,"invoiceAmountPaise"),0n)!==amount) fail("disbursement_invoice_mismatch","Invoice total must exactly equal tranche amount.");
  if (!input.supplierPaymentAccountRef || input.destinationType!=="supplier") fail("disbursement_end_use_invalid","Payment must route to the linked supplier account.");
  const prior=Object.values(map(state,"disbursementTranches")).filter((item)=>item.facilityId===input.facilityId).reduce((sum,item)=>sum+money(item.amountPaise,"amountPaise"),0n); if(prior+amount>money(input.sanctionedAmountPaise,"sanctionedAmountPaise")) fail("disbursement_limit_exceeded","Tranches exceed sanctioned amount.");
  const tranche={...input,trancheId,status:"authorised",authorisedAt:now.toISOString()}; return {state:{...state,disbursementTranches:{...map(state,"disbursementTranches"),[trancheId]:tranche}},tranche};
}

/**
 * Close out a disbursed tranche with post-disbursement follow-up: fails
 * closed unless end-use has been independently verified, the borrower has
 * acknowledged the disbursement, and any raised exceptions are already
 * closed. This is the final control that confirms disbursed funds actually
 * reached and were used for their sanctioned purpose.
 * @param {object} state - holds `disbursementTranches`, `postDisbursementFollowups`.
 * @param {object} input - trancheId, followupId, proposedBy/approvedBy/approvalRef, evidenceRefs, endUseVerification, borrowerAcknowledgement, exceptions.
 * @param {Date} [now]
 * @returns {{state: object, followup: object}}
 */
export function recordPostDisbursementFollowup(state,input,now=new Date()){
  eyes(input); list(input.evidenceRefs,"evidenceRefs"); const tranche=map(state,"disbursementTranches")[input.trancheId]; if(tranche?.status!=="authorised") fail("disbursement_tranche_missing","Authorised tranche is required.");
  if(input.endUseVerification?.status!=="verified"||!input.endUseVerification.reportRef||input.borrowerAcknowledgement?.status!=="received"||!input.borrowerAcknowledgement.ref||input.exceptions?.some((item)=>item.status!=="closed")) fail("disbursement_followup_incomplete","Verified end use, borrower acknowledgement and closed exceptions are required.");
  const followup={followupId:text(input.followupId,"followupId"),trancheId:input.trancheId,status:"completed",...input,completedAt:now.toISOString()}; return {state:{...state,postDisbursementFollowups:{...map(state,"postDisbursementFollowups"),[followup.followupId]:followup}},followup};
}
