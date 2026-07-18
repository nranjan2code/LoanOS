/**
 * Collections and legal recovery: the post-delinquency lifecycle for a
 * loan account — fair-practice-constrained collection contacts, promise-
 * to-pay tracking, and the statutory legal-recovery tracks (SARFAESI,
 * Section 138 cheque-bounce, Lok Adalat, arbitration, DRT, civil suit,
 * insolvency). This module does not own the loan account's ledger or
 * delinquency computation itself (`loan-account.js` does — this module
 * calls `computeDelinquency`/`classifyLoanAsset`/`summarizeLoanAccount` and
 * layers the collections/legal workflow on top).
 *
 * Fair-practice controls are enforced directly here, not left to the
 * caller: a collection contact must reference an active, *noticed*
 * recovery assignment, must be made by the assigned agent (not anyone
 * else), and (per RBI-FPC-PENAL) is only permitted between 08:00-19:00 IST
 * — computed by shifting the UTC timestamp by 330 minutes, since the
 * platform stores everything in UTC. Legal-track initiation and events
 * enforce their own statutory preconditions and clocks: SARFAESI requires
 * NPA classification and a registered security interest, and enforcement
 * cannot be authorized before the 60-day section 13(2) demand period
 * expires; Section 138 requires cheque + bank-return-memo evidence, a
 * 30-day notice-issue deadline from the memo date, and a 15-day payment
 * period before a complaint can be filed. All of these are fail-closed
 * findings (`createFinding`/`summarizeFindings`), never silently skipped.
 */
import { createFinding, summarizeFindings } from "../compliance/compliance-controls.js";
import { classifyLoanAsset, computeDelinquency, summarizeLoanAccount } from "./loan-account.js";
import { createLoanId } from "./loan-policy.js";
import { createHash } from "node:crypto";

const CONTACT_CHANNELS = new Set(["call", "ivr", "field_visit"]);
const CONTACT_DISPOSITIONS = new Set(["connected", "no_answer", "busy", "wrong_number", "refused", "promise_to_pay", "hardship", "dispute", "not_met", "met"]);
export const LEGAL_RECOVERY_TRACKS = new Set(["sarfaesi", "section_138", "lok_adalat", "arbitration", "drt", "civil_suit", "insolvency"]);
const LEGAL_EVENT_TYPES = new Set(["representation_received", "representation_decided", "filed", "hearing_scheduled", "order_recorded", "enforcement_authorized", "settlement_recorded", "withdrawn", "closed"]);
const TERMINAL_CASE_STATUSES = new Set(["withdrawn", "closed"]);

/**
 * Record a collection contact (call/IVR/field visit) against an active
 * loan account. Fails closed unless: the account is active, there's an
 * active recovery assignment for `assignmentId` that has already had a
 * notice sent (`noticeSentAt`/`noticeDeliveryRef`), the contact was made by
 * the assigned agent, the contact time falls within the 08:00-19:00 IST
 * fair-practice window, and — for field visits — a valid lat/long plus geo
 * evidence is supplied.
 * @param {object} account - loan account with `recoveryAssignments`/`collectionContacts`.
 * @param {object} input - contactId, assignmentId, channel, disposition, contactedAt, actor, evidenceRef, +lat/long/geoEvidenceRef for field_visit.
 * @param {Date} [now]
 * @returns {{loanAccount: object, contact: object|null, findings: Array<object>, summary: object}}
 */
export function recordCollectionContact(account, input = {}, now = new Date()) {
  const findings = []; const contactedAt = input.contactedAt ? new Date(input.contactedAt) : now;
  const assignment = (account?.recoveryAssignments ?? []).find((item) => item.assignmentId === input.assignmentId && item.status === "active");
  if (!account || account.status !== "active") findings.push(createFinding("error", "RBI-DL-2025", "An active loan account is required.", "loanAccount"));
  if (!CONTACT_CHANNELS.has(input.channel)) findings.push(createFinding("error", "RBI-FPC-PENAL", "Collection contact channel is invalid.", "channel"));
  if (!CONTACT_DISPOSITIONS.has(input.disposition)) findings.push(createFinding("error", "RBI-DL-2025", "Collection contact disposition is invalid.", "disposition"));
  if (!input.contactId || !input.actor || !input.evidenceRef) findings.push(createFinding("error", "RBI-IT-GRC", "Contact ID, actor, and evidence reference are required.", "evidenceRef"));
  if (Number.isNaN(contactedAt.getTime())) findings.push(createFinding("error", "RBI-DL-2025", "contactedAt must be valid.", "contactedAt"));
  if (!assignment?.noticeSentAt || !assignment?.noticeDeliveryRef) findings.push(createFinding("error", "RBI-DL-2025", "Collection contact requires an active, noticed recovery assignment.", "assignmentId"));
  if (assignment && input.actor !== assignment.recoveryAgentId) findings.push(createFinding("error", "RBI-IT-GRC", "Collection contact actor must be the assigned recovery agent.", "actor"));
  if (!Number.isNaN(contactedAt.getTime())) { const istHour = new Date(contactedAt.getTime() + 330 * 60000).getUTCHours(); if (istHour < 8 || istHour >= 19) findings.push(createFinding("error", "RBI-FPC-PENAL", "Recovery contact is permitted only between 08:00 and 19:00 IST.", "contactedAt")); }
  if (input.channel === "field_visit" && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180 || !input.geoEvidenceRef)) findings.push(createFinding("error", "RBI-IT-GRC", "Field visits require valid latitude, longitude, and geo evidence.", "geoEvidenceRef"));
  if ((account?.collectionContacts ?? []).some((contact) => contact.contactId === input.contactId)) findings.push(createFinding("error", "RBI-IT-GRC", "contactId already exists.", "contactId"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { loanAccount: account, contact: null, findings, summary };
  const delinquency = computeDelinquency(account, contactedAt); const contact = { contactId: input.contactId, assignmentId: assignment.assignmentId, recoveryAgentId: assignment.recoveryAgentId, channel: input.channel, disposition: input.disposition, contactedAt: contactedAt.toISOString(), actor: input.actor, notes: input.notes ?? null, evidenceRef: input.evidenceRef, latitude: input.channel === "field_visit" ? input.latitude : null, longitude: input.channel === "field_visit" ? input.longitude : null, geoEvidenceRef: input.channel === "field_visit" ? input.geoEvidenceRef : null, daysPastDue: delinquency.daysPastDue, delinquencyBucket: delinquency.bucket };
  return { loanAccount: { ...account, collectionContacts: [...(account.collectionContacts ?? []), contact], servicingEvents: [...(account.servicingEvents ?? []), { type: "loan_account.collection_contact.recorded", contactId: contact.contactId, channel: contact.channel, at: contact.contactedAt, actor: contact.actor }], updatedAt: now.toISOString() }, contact, findings, summary };
}

/**
 * Record a borrower's promise-to-pay against a delinquent account. Fails
 * closed unless the account is actually delinquent, the promised amount is
 * positive, paise-exact, and within total outstanding dues, the promised
 * date is on or after capture, and the promise references an already-
 * evidenced collection contact (a promise cannot be recorded without a
 * prior documented contact that elicited it).
 * @param {object} account - loan account with `collectionContacts`/`promisesToPay`.
 * @param {object} input - promiseId, contactId, amount, promisedDate, capturedAt, actor, notes.
 * @param {Date} [now]
 * @returns {{loanAccount: object, promise: object|null, findings: Array<object>, summary: object}} `promise` is enriched with kept/broken/pending status via `evaluatePromisesToPay`.
 */
export function createPromiseToPay(account, input = {}, now = new Date()) {
  const findings = []; const capturedAt = input.capturedAt ? new Date(input.capturedAt) : now; const promisedDate = new Date(`${input.promisedDate}T23:59:59.999Z`); const balance = account && !Number.isNaN(capturedAt.getTime()) ? summarizeLoanAccount(account, capturedAt) : null;
  if (!account || account.status !== "active" || !balance || computeDelinquency(account, capturedAt).daysPastDue <= 0) findings.push(createFinding("error", "RBI-DL-2025", "Promise-to-pay requires an active delinquent account.", "loanAccount"));
  if (!input.promiseId || !input.actor || !input.contactId) findings.push(createFinding("error", "RBI-IT-GRC", "Promise ID, source contact, and actor are required.", "promiseId"));
  if (!Number.isFinite(input.amount) || input.amount <= 0 || Math.abs(input.amount * 100 - Math.round(input.amount * 100)) >= 1e-8 || (balance && input.amount > balance.totalOutstanding)) findings.push(createFinding("error", "RBI-DL-2025", "Promise amount must be positive, paise-exact, and within outstanding dues.", "amount"));
  if (Number.isNaN(capturedAt.getTime()) || Number.isNaN(promisedDate.getTime()) || promisedDate.getTime() < capturedAt.getTime()) findings.push(createFinding("error", "RBI-DL-2025", "promisedDate must be on or after capture.", "promisedDate"));
  if (!(account?.collectionContacts ?? []).some((contact) => contact.contactId === input.contactId)) findings.push(createFinding("error", "RBI-IT-GRC", "Promise must reference an evidenced collection contact.", "contactId"));
  if ((account?.promisesToPay ?? []).some((promise) => promise.promiseId === input.promiseId)) findings.push(createFinding("error", "RBI-IT-GRC", "promiseId already exists.", "promiseId"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { loanAccount: account, promise: null, findings, summary };
  const promise = { promiseId: input.promiseId, contactId: input.contactId, amount: roundMoney(input.amount), promisedDate: input.promisedDate, capturedAt: capturedAt.toISOString(), actor: input.actor, notes: input.notes ?? null };
  return { loanAccount: { ...account, promisesToPay: [...(account.promisesToPay ?? []), promise], servicingEvents: [...(account.servicingEvents ?? []), { type: "loan_account.promise_to_pay.created", promiseId: promise.promiseId, at: promise.capturedAt, actor: promise.actor }], updatedAt: now.toISOString() }, promise: enrichPromiseToPay(account, promise, now), findings, summary };
}

/**
 * Evaluate every promise-to-pay on an account against the account's actual
 * payment ledger as of `asOf`: allocates ledger payments (oldest promise
 * first, within each promise's capture-to-deadline window) to determine
 * whether each promise was `"kept"` (fully covered), `"broken"` (deadline
 * passed, not covered), or still `"pending"`. Each ledger payment's
 * remaining paise is tracked across promises so the same rupee isn't
 * double-counted toward two promises.
 * @param {object} account - loan account with `ledger`/`promisesToPay`.
 * @param {Date} [asOf]
 * @returns {Array<object>} promises annotated with status/amountReceived/shortfallAmount.
 */
export function evaluatePromisesToPay(account, asOf = new Date()) {
  const payments = (account?.ledger ?? []).filter((event) => ["payment", "cash_recovery_payment"].includes(event.type) && new Date(event.eventDate).getTime() <= asOf.getTime()).map((event) => ({ ...event, remainingPaise: Math.round(event.amount * 100) })).sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  return [...(account?.promisesToPay ?? [])].sort((a, b) => a.promisedDate.localeCompare(b.promisedDate)).map((promise) => { const captured = new Date(promise.capturedAt).getTime(); const deadline = new Date(`${promise.promisedDate}T23:59:59.999Z`).getTime(); let receivedPaise = 0; for (const payment of payments) { const time = new Date(payment.eventDate).getTime(); if (time < captured || time > deadline || payment.remainingPaise <= 0) continue; const allocated = Math.min(payment.remainingPaise, Math.round(promise.amount * 100) - receivedPaise); receivedPaise += allocated; payment.remainingPaise -= allocated; if (receivedPaise >= Math.round(promise.amount * 100)) break; } const status = receivedPaise >= Math.round(promise.amount * 100) ? "kept" : asOf.getTime() > deadline ? "broken" : "pending"; return { ...promise, status, amountReceived: receivedPaise / 100, shortfallAmount: roundMoney(Math.max(0, promise.amount - receivedPaise / 100)), evaluatedAt: asOf.toISOString() }; });
}

/**
 * Open a legal-recovery case for a delinquent or written-off loan on one of
 * `LEGAL_RECOVERY_TRACKS`. Fails closed unless: the account is active or
 * written-off with retained dues, the case has independent proposer/
 * approver, `caseId` is unique, and the chosen track's own statutory
 * preconditions hold — SARFAESI requires NPA classification plus a
 * registered/modified security interest; Section 138 requires cheque
 * number/amount and a bank-return memo dated on or before case opening;
 * any other track requires a forum and jurisdiction.
 * @param {Record<string, object>} registry - caseId -> legal case record.
 * @param {object} account - the loan account the case concerns.
 * @param {Record<string, object>} securityInterests - securityInterestId -> record, for SARFAESI eligibility.
 * @param {object} input - caseId, track, reason, proposedBy, approvedBy, approvalRef, openedAt, +track-specific fields (chequeNumber/chequeAmount/bankReturnMemoRef/bankReturnMemoDate for section_138; forum/jurisdiction otherwise).
 * @param {Date} [now]
 * @returns {{registry: object, legalCase: object|null, findings: Array<object>, summary: object}}
 */
export function createLegalRecoveryCase(registry = {}, account, securityInterests = {}, input = {}, now = new Date()) {
  const findings = []; const openedAt = input.openedAt ? new Date(input.openedAt) : now; const track = input.track; const classification = account && !Number.isNaN(openedAt.getTime()) ? classifyLoanAsset(account, openedAt) : null;
  if (!account || !["active", "written_off"].includes(account.status)) findings.push(createFinding("error", "RBI-DL-2025", "Legal recovery requires an active or written-off loan with retained dues.", "loanAccount"));
  if (!LEGAL_RECOVERY_TRACKS.has(track)) findings.push(createFinding("error", "RBI-IT-GRC", "Legal recovery track is invalid.", "track"));
  if (!input.caseId || !input.reason || !input.proposedBy || !input.approvedBy || input.proposedBy === input.approvedBy || !input.approvalRef) findings.push(createFinding("error", "RBI-IT-GRC", "Case ID, reason, and independent approval are required.", "approval"));
  if (Number.isNaN(openedAt.getTime())) findings.push(createFinding("error", "RBI-IT-GRC", "openedAt must be valid.", "openedAt"));
  if (registry[input.caseId]) findings.push(createFinding("error", "RBI-IT-GRC", "caseId already exists.", "caseId"));
  if (classification && classification.daysPastDue <= 0 && account?.status !== "written_off") findings.push(createFinding("error", "RBI-DL-2025", "Legal recovery requires delinquency or retained written-off dues.", "loanAccount"));
  const charges = Object.values(securityInterests).filter((item) => item.loanAccountId === account?.loanAccountId && ["registered", "modified"].includes(item.status));
  if (track === "sarfaesi" && (!classification?.isNpa || charges.length === 0)) findings.push(createFinding("error", "SARFAESI", "SARFAESI requires NPA classification and a registered unsatisfied security interest.", "track"));
  const memoAt = new Date(`${input.bankReturnMemoDate}T00:00:00.000Z`);
  if (track === "section_138" && (!input.chequeNumber || !Number.isFinite(input.chequeAmount) || input.chequeAmount <= 0 || !input.bankReturnMemoRef || Number.isNaN(memoAt.getTime()))) findings.push(createFinding("error", "NI-ACT-138", "Section 138 requires cheque and valid bank-return memo evidence.", "bankReturnMemoRef"));
  if (track === "section_138" && !Number.isNaN(memoAt.getTime()) && !Number.isNaN(openedAt.getTime()) && memoAt.getTime() > openedAt.getTime()) findings.push(createFinding("error", "NI-ACT-138", "Bank-return memo date cannot be after case opening.", "bankReturnMemoDate"));
  if (!["sarfaesi", "section_138"].includes(track) && (!input.forum || !input.jurisdiction)) findings.push(createFinding("error", "RBI-IT-GRC", "Selected legal track requires forum and jurisdiction.", "forum"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { registry, legalCase: null, findings, summary };
  const legalCase = { caseId: input.caseId, loanAccountId: account.loanAccountId, borrowerId: account.borrowerId, track, status: "strategy_approved", reason: input.reason, outstandingAtOpening: summarizeLoanAccount(account, openedAt).totalOutstanding, assetClassificationAtOpening: classification, securityInterestIds: track === "sarfaesi" ? charges.map((item) => item.securityInterestId) : [], chequeDetails: track === "section_138" ? { chequeNumber: input.chequeNumber, chequeAmount: roundMoney(input.chequeAmount), bankReturnMemoDate: input.bankReturnMemoDate, bankReturnMemoRef: input.bankReturnMemoRef, noticeIssueDeadline: addDays(memoAt, 30).toISOString() } : null, forum: input.forum ?? null, jurisdiction: input.jurisdiction ?? null, advocateRef: input.advocateRef ?? null, openedAt: openedAt.toISOString(), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, notices: [], events: [{ eventId: createLoanId("legal_event"), type: "strategy_approved", occurredAt: openedAt.toISOString(), actor: input.approvedBy, evidenceRef: input.approvalRef }], nextHearingDate: null, courtCaseNumber: null, updatedAt: now.toISOString() };
  return { registry: { ...registry, [legalCase.caseId]: legalCase }, legalCase: enrichLegalRecoveryCase(legalCase, now), findings, summary };
}

/**
 * Issue the statutory legal notice for an open case (SARFAESI section
 * 13(2) demand, Section 138 statutory demand, or a generic legal notice for
 * other tracks), starting that track's statutory response clock (60 days
 * for SARFAESI from issue, 15 days for Section 138 from delivery). Fails
 * closed unless the case is open (not withdrawn/closed), notice evidence
 * and independent approval are present, delivery is on or after issuance,
 * `noticeId` is unique, and — for Section 138 — issuance happens within the
 * 30-day deadline from the bank-return memo date. The notice document is
 * hashed (`checksumSha256`) at issuance to fix its content for later
 * dispute resolution.
 * @param {object} legalCase - existing open legal case record.
 * @param {object} input - noticeId, documentRef, deliveryRef, issuedBy, approvedBy, issuedAt, deliveredAt, +demandAmount for sarfaesi/section_138, +responseDays for other tracks.
 * @param {Date} [now]
 * @returns {{legalCase: object, notice: object|null, findings: Array<object>, summary: object}}
 */
export function issueLegalRecoveryNotice(legalCase, input = {}, now = new Date()) {
  const findings = []; const issuedAt = input.issuedAt ? new Date(input.issuedAt) : now; const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : null;
  if (!legalCase || TERMINAL_CASE_STATUSES.has(legalCase?.status)) findings.push(createFinding("error", "RBI-IT-GRC", "An open legal recovery case is required.", "caseId"));
  if (!input.noticeId || !input.documentRef || !input.deliveryRef || !input.issuedBy || !input.approvedBy || input.issuedBy === input.approvedBy) findings.push(createFinding("error", "RBI-IT-GRC", "Notice evidence and independent approval are required.", "notice"));
  if (Number.isNaN(issuedAt.getTime()) || !deliveredAt || Number.isNaN(deliveredAt.getTime()) || deliveredAt.getTime() < issuedAt.getTime()) findings.push(createFinding("error", "RBI-IT-GRC", "Notice issue and delivery timestamps are invalid.", "deliveredAt"));
  if ((legalCase?.notices ?? []).some((notice) => notice.noticeId === input.noticeId)) findings.push(createFinding("error", "RBI-IT-GRC", "noticeId already exists.", "noticeId"));
  if (legalCase?.track === "section_138" && issuedAt.getTime() > new Date(legalCase.chequeDetails.noticeIssueDeadline).getTime()) findings.push(createFinding("error", "NI-ACT-138", "Section 138 demand notice missed the 30-day issue deadline.", "issuedAt"));
  if (legalCase?.track === "sarfaesi" && (!Number.isFinite(input.demandAmount) || input.demandAmount <= 0)) findings.push(createFinding("error", "SARFAESI", "SARFAESI demand notice requires the demanded amount.", "demandAmount"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { legalCase, notice: null, findings, summary };
  const responseDays = legalCase.track === "sarfaesi" ? 60 : legalCase.track === "section_138" ? 15 : (input.responseDays ?? null); const clockStartsAt = legalCase.track === "sarfaesi" ? issuedAt : deliveredAt; const statutoryDeadline = responseDays ? addDays(clockStartsAt, responseDays).toISOString() : null; const noticeType = legalCase.track === "sarfaesi" ? "section_13_2_demand" : legalCase.track === "section_138" ? "statutory_demand" : "legal_notice"; const demandAmount = roundMoney(input.demandAmount ?? legalCase.outstandingAtOpening);
  const document = { documentType: noticeType, caseId: legalCase.caseId, loanAccountId: legalCase.loanAccountId, borrowerId: legalCase.borrowerId, legalTrack: legalCase.track, statutoryBasis: legalCase.track === "sarfaesi" ? "SARFAESI Act 2002 section 13(2)" : legalCase.track === "section_138" ? "Negotiable Instruments Act 1881 section 138" : legalCase.track, demandAmount, issuedAt: issuedAt.toISOString(), statutoryResponseDays: responseDays, statutoryDeadline, declarations: ["Payment, settlement, representation, and dispute evidence must be recorded against this case.", "No enforcement action is permitted before the applicable statutory response period expires."] };
  const notice = { noticeId: input.noticeId, noticeType, demandAmount, documentRef: input.documentRef, document: { ...document, checksumSha256: createHash("sha256").update(JSON.stringify(document)).digest("hex") }, deliveryRef: input.deliveryRef, issuedAt: issuedAt.toISOString(), deliveredAt: deliveredAt.toISOString(), issuedBy: input.issuedBy, approvedBy: input.approvedBy, statutoryResponseDays: responseDays, statutoryDeadline };
  const updated = { ...legalCase, status: "notice_issued", notices: [...legalCase.notices, notice], events: [...legalCase.events, { eventId: createLoanId("legal_event"), type: "notice_issued", occurredAt: issuedAt.toISOString(), actor: input.approvedBy, evidenceRef: input.documentRef, noticeId: notice.noticeId }], updatedAt: now.toISOString() };
  return { legalCase: enrichLegalRecoveryCase(updated, now), notice, findings, summary };
}

/**
 * Record a case-lifecycle event (filing, hearing, order, settlement,
 * enforcement authorization, withdrawal, closure) against an open legal
 * case. Fails closed unless: the case is open, the event type/id/actor/
 * evidence/timestamp are valid and `eventId` is unique, an
 * `"enforcement_authorized"` event is only for a SARFAESI track past its
 * 60-day demand deadline with independent approval, a `"hearing_scheduled"`
 * event carries a valid `nextHearingDate`, a `"filed"` event carries a
 * `courtCaseNumber` and — for Section 138 — happens only after the 15-day
 * payment period expires.
 * @param {object} legalCase - existing open legal case record.
 * @param {object} input - eventId, eventType, actor, evidenceRef, occurredAt, +approvedBy for enforcement_authorized, +nextHearingDate/courtCaseNumber/amount as applicable.
 * @param {Date} [now]
 * @returns {{legalCase: object, event: object|null, findings: Array<object>, summary: object}}
 */
export function recordLegalRecoveryEvent(legalCase, input = {}, now = new Date()) {
  const findings = []; const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now; const latestNotice = legalCase?.notices?.at(-1); const eventType = input.eventType;
  if (!legalCase || TERMINAL_CASE_STATUSES.has(legalCase?.status)) findings.push(createFinding("error", "RBI-IT-GRC", "An open legal recovery case is required.", "caseId"));
  if (!LEGAL_EVENT_TYPES.has(eventType) || !input.eventId || !input.actor || !input.evidenceRef || Number.isNaN(occurredAt.getTime())) findings.push(createFinding("error", "RBI-IT-GRC", "Valid event ID, type, actor, timestamp, and evidence are required.", "event"));
  if ((legalCase?.events ?? []).some((event) => event.eventId === input.eventId)) findings.push(createFinding("error", "RBI-IT-GRC", "eventId already exists.", "eventId"));
  if (eventType === "enforcement_authorized") { if (legalCase?.track !== "sarfaesi" || !latestNotice?.statutoryDeadline || occurredAt.getTime() < new Date(latestNotice.statutoryDeadline).getTime()) findings.push(createFinding("error", "SARFAESI", "Enforcement cannot be authorized before the 60-day demand period expires.", "occurredAt")); if (!input.approvedBy || input.approvedBy === input.actor) findings.push(createFinding("error", "RBI-IT-GRC", "Enforcement authorization requires independent approval.", "approvedBy")); }
  if (eventType === "hearing_scheduled" && (!input.nextHearingDate || Number.isNaN(new Date(`${input.nextHearingDate}T00:00:00.000Z`).getTime()))) findings.push(createFinding("error", "RBI-IT-GRC", "Hearing event requires a valid nextHearingDate.", "nextHearingDate"));
  if (eventType === "filed" && !input.courtCaseNumber) findings.push(createFinding("error", "RBI-IT-GRC", "Filing requires courtCaseNumber.", "courtCaseNumber"));
  if (eventType === "filed" && legalCase?.track === "section_138" && (!latestNotice?.statutoryDeadline || occurredAt.getTime() < new Date(latestNotice.statutoryDeadline).getTime())) findings.push(createFinding("error", "NI-ACT-138", "Section 138 complaint cannot be filed before the 15-day payment period expires.", "occurredAt"));
  const summary = summarizeFindings(findings); if (summary.status === "blocked") return { legalCase, event: null, findings, summary };
  const event = { eventId: input.eventId, type: eventType, occurredAt: occurredAt.toISOString(), actor: input.actor, approvedBy: input.approvedBy ?? null, evidenceRef: input.evidenceRef, notes: input.notes ?? null, nextHearingDate: input.nextHearingDate ?? null, courtCaseNumber: input.courtCaseNumber ?? null, amount: Number.isFinite(input.amount) ? roundMoney(input.amount) : null };
  const status = eventType === "withdrawn" || eventType === "closed" ? eventType : eventType === "enforcement_authorized" ? "enforcement_ready" : eventType === "filed" ? "filed" : legalCase.status;
  const clearsHearing = ["order_recorded", "settlement_recorded", "withdrawn", "closed"].includes(eventType); const updated = { ...legalCase, status, events: [...legalCase.events, event], nextHearingDate: input.nextHearingDate ?? (clearsHearing ? null : legalCase.nextHearingDate), courtCaseNumber: input.courtCaseNumber ?? legalCase.courtCaseNumber, updatedAt: now.toISOString() };
  return { legalCase: enrichLegalRecoveryCase(updated, now), event, findings, summary };
}

/**
 * Derive read-only, time-sensitive status on top of a legal case: the
 * statutory response clock's days-remaining/expired state (from the latest
 * notice), and whether the next scheduled hearing date has passed without
 * a recorded outcome. Called after every mutation above so callers always
 * see a case with up-to-date derived state rather than having to
 * recompute it themselves.
 * @param {object} legalCase
 * @param {Date} [asOf]
 * @returns {object|null} the case with `statutoryClock`/`hearingOverdue` added, or null if no case was given.
 */
export function enrichLegalRecoveryCase(legalCase, asOf = new Date()) {
  if (!legalCase) return null; const notice = legalCase.notices?.at(-1) ?? null; const deadline = notice?.statutoryDeadline ? new Date(notice.statutoryDeadline) : null; const remaining = deadline ? Math.ceil((deadline.getTime() - asOf.getTime()) / 86400000) : null;
  return { ...legalCase, statutoryClock: deadline ? { deadline: deadline.toISOString(), daysRemaining: Math.max(0, remaining), expired: asOf.getTime() >= deadline.getTime() } : null, hearingOverdue: legalCase.nextHearingDate ? asOf.getTime() > new Date(`${legalCase.nextHearingDate}T23:59:59.999Z`).getTime() : false };
}

// Reuse the full evaluatePromisesToPay logic for a single just-created
// promise, so its initial kept/broken/pending status is computed the same
// way it would be on any later evaluation.
function enrichPromiseToPay(account, promise, asOf) { return evaluatePromisesToPay({ ...account, promisesToPay: [promise] }, asOf)[0]; }
function addDays(date, days) { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
