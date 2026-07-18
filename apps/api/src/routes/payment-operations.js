import { createHash } from "node:crypto";
import {
  ExternalServiceManager,
  computeDelinquency,
  createLoanId,
  createSuspenseReceipt,
  reconcileBankStatementEntry,
  reconcilePaymentRailSettlement,
  resolveSuspenseReceipt,
  writeOffSuspenseReceipt
} from "@loanos/core";

export async function routePaymentOperations(context) {
  const { method, path, url, req, res, tenant, store, readJson, sendJson, appendEvent, isAccountingDateClosed } = context;

  if (method === "GET" && path === "/payment-rails") {
    const state = await store.load();
    const paymentRails = Object.values(state.paymentRails ?? {}).filter((record) => paymentRailMatchesFilters(record, url));
    sendJson(res, 200, { count: paymentRails.length, paymentRails });
    return true;
  }

  if (method === "GET" && path === "/payment-reconciliations") {
    const state = await store.load();
    const status = url.searchParams.get("status");
    const outcome = url.searchParams.get("outcome");
    const loanAccountId = url.searchParams.get("loanAccountId");
    const reconciliations = Object.values(state.paymentReconciliations ?? {}).filter((record) =>
      (!status || record.status === status) &&
      (!outcome || record.outcome === outcome) &&
      (!loanAccountId || record.loanAccountId === loanAccountId)
    );
    sendJson(res, 200, { count: reconciliations.length, reconciliations });
    return true;
  }

  if (method === "GET" && path === "/bank-reconciliations") {
    const state = await store.load();
    const outcome = url.searchParams.get("outcome");
    const entries = Object.values(state.bankReconciliations ?? {}).filter((record) => !outcome || record.outcome === outcome);
    sendJson(res, 200, { count: entries.length, bankReconciliations: entries });
    return true;
  }

  if (method === "GET" && path === "/payment-suspense/receipts") {
    const state = await store.load(); const status = url.searchParams.get("status");
    const receipts = Object.values(state.paymentSuspenseReceipts ?? {}).filter((record) => !status || record.status === status);
    sendJson(res, 200, { count: receipts.length, receipts }); return true;
  }

  if (method === "POST" && path === "/payment-suspense/receipts") {
    const body = await readJson(req); const state = await store.load();
    if (isAccountingDateClosed(state, body.valueDate ?? body.receivedAt ?? new Date().toISOString())) { sendJson(res, 422, { error: { code: "suspense_closed_period", message: "Suspense receipt cannot be recorded in a closed period." } }); return true; }
    const existing = Object.values(state.paymentSuspenseReceipts ?? {}).find((record) => record.transactionRef === body.transactionRef);
    if (existing && existing.amount === body.amount && existing.reasonCode === body.reasonCode) { sendJson(res, 200, { receipt: existing, idempotent: true }); return true; }
    if (existing) { sendJson(res, 409, { error: { code: "suspense_receipt_conflict", message: "transactionRef already exists with different receipt data." } }); return true; }
    const result = createSuspenseReceipt(state, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "suspense_receipt_blocked", message: "Suspense receipt is invalid." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, paymentSuspenseReceipts: { ...(state.paymentSuspenseReceipts ?? {}), [result.receipt.suspenseId]: result.receipt } }, { type: "finance.payment_suspense.received", suspenseId: result.receipt.suspenseId, transactionRef: result.receipt.transactionRef, amount: result.receipt.amount, reasonCode: result.receipt.reasonCode }));
    sendJson(res, 201, { receipt: result.receipt }); return true;
  }

  const suspenseResolutionMatch = path.match(/^\/payment-suspense\/receipts\/([^/]+)\/resolution$/);
  if (method === "POST" && suspenseResolutionMatch) {
    const body = await readJson(req); const state = await store.load(); const suspenseId = decodeURIComponent(suspenseResolutionMatch[1]); const receipt = state.paymentSuspenseReceipts?.[suspenseId];
    if (!receipt) { sendJson(res, 404, { error: { code: "not_found", message: "Suspense receipt not found." } }); return true; }
    const existing = receipt.resolutions?.find((resolution) => resolution.resolutionId === body.resolutionId);
    if (existing) { sendJson(res, 200, { receipt, resolution: existing, paymentEvent: state.loanAccounts?.[existing.loanAccountId]?.ledger?.find((event) => event.eventId === existing.paymentEventId) ?? null, idempotent: true }); return true; }
    if (isAccountingDateClosed(state, body.valueDate ?? receipt.valueDate)) { sendJson(res, 422, { error: { code: "suspense_resolution_closed_period", message: "Suspense cannot be resolved into a closed period." } }); return true; }
    const result = resolveSuspenseReceipt(state, receipt, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "suspense_resolution_blocked", message: "Suspense resolution is blocked." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, loanAccounts: result.loanAccounts, paymentSuspenseReceipts: { ...state.paymentSuspenseReceipts, [suspenseId]: result.receipt } }, { type: "finance.payment_suspense.resolved", suspenseId, resolutionId: result.resolution.resolutionId, loanAccountId: result.resolution.loanAccountId, amount: result.resolution.amount, paymentEventId: result.paymentEvent.eventId }));
    sendJson(res, 200, { receipt: result.receipt, resolution: result.resolution, paymentEvent: result.paymentEvent }); return true;
  }

  const suspenseWriteOffMatch = path.match(/^\/payment-suspense\/receipts\/([^/]+)\/write-off$/);
  if (method === "POST" && suspenseWriteOffMatch) {
    const body = await readJson(req); const state = await store.load(); const suspenseId = decodeURIComponent(suspenseWriteOffMatch[1]); const receipt = state.paymentSuspenseReceipts?.[suspenseId];
    if (!receipt) { sendJson(res, 404, { error: { code: "not_found", message: "Suspense receipt not found." } }); return true; }
    if (receipt.writeOff?.writeOffId === body.writeOffId) { sendJson(res, 200, { receipt, writeOff: receipt.writeOff, idempotent: true }); return true; }
    if (isAccountingDateClosed(state, body.eventDate ?? new Date().toISOString())) { sendJson(res, 422, { error: { code: "suspense_writeoff_closed_period", message: "Suspense cannot be written off in a closed period." } }); return true; }
    const result = writeOffSuspenseReceipt(receipt, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "suspense_writeoff_blocked", message: "Suspense write-off is blocked." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, paymentSuspenseReceipts: { ...state.paymentSuspenseReceipts, [suspenseId]: result.receipt } }, { type: "finance.payment_suspense.written_off", suspenseId, writeOffId: result.writeOff.writeOffId, amount: result.writeOff.amount, approvedBy: result.writeOff.approvedBy }));
    sendJson(res, 200, { receipt: result.receipt, writeOff: result.writeOff }); return true;
  }

  if (method === "GET" && path === "/finance/reconciliation-breaks") {
    const state = await store.load(); const queue = buildReconciliationBreakQueue(state, new Date()); const status = url.searchParams.get("status");
    const breaks = queue.filter((item) => !status || item.status === status); sendJson(res, 200, { count: breaks.length, breaks }); return true;
  }

  const breakAssignmentMatch = path.match(/^\/finance\/reconciliation-breaks\/([^/]+)\/assignment$/);
  if (method === "POST" && breakAssignmentMatch) {
    const body = await readJson(req); const state = await store.load(); const breakId = decodeURIComponent(breakAssignmentMatch[1]); const item = buildReconciliationBreakQueue(state, new Date()).find((record) => record.breakId === breakId);
    if (!item) { sendJson(res, 404, { error: { code: "not_found", message: "Open reconciliation break not found." } }); return true; }
    if (!body.assignedTo || !body.assignedBy || !body.dueAt || Number.isNaN(new Date(body.dueAt).getTime())) { sendJson(res, 422, { error: { code: "break_assignment_blocked", message: "assignedTo, assignedBy, and a valid dueAt are required." } }); return true; }
    const assignment = { breakId, assignedTo: body.assignedTo, assignedBy: body.assignedBy, dueAt: body.dueAt, assignedAt: new Date().toISOString(), note: body.note ?? null };
    await store.save(appendEvent({ ...state, reconciliationBreakAssignments: { ...(state.reconciliationBreakAssignments ?? {}), [breakId]: assignment } }, { type: "finance.reconciliation_break.assigned", breakId, assignedTo: assignment.assignedTo, dueAt: assignment.dueAt }));
    sendJson(res, 200, { break: { ...item, assignment } }); return true;
  }

  const breakWriteOffMatch = path.match(/^\/finance\/reconciliation-breaks\/([^/]+)\/write-off$/);
  if (method === "POST" && breakWriteOffMatch) {
    const body = await readJson(req); const state = await store.load(); const breakId = decodeURIComponent(breakWriteOffMatch[1]);
    const item = buildReconciliationBreakQueue(state, new Date()).find((record) => record.breakId === breakId);
    if (!item) { sendJson(res, 404, { error: { code: "not_found", message: "Open reconciliation break not found." } }); return true; }
    if (!body.writeOffId || !body.proposedBy || !body.approvedBy || body.proposedBy === body.approvedBy || !body.approvalRef || !body.reason) {
      sendJson(res, 422, { error: { code: "break_writeoff_blocked", message: "writeOffId, reason, and independent approval evidence are required." } }); return true;
    }
    const eventDate = body.eventDate ?? new Date().toISOString();
    if (isAccountingDateClosed(state, eventDate)) { sendJson(res, 422, { error: { code: "break_writeoff_closed_period", message: "Reconciliation break cannot be written off in a closed period." } }); return true; }
    if (item.sourceType === "suspense") { sendJson(res, 422, { error: { code: "break_writeoff_blocked", message: "Suspense breaks must use the suspense write-off endpoint." }, endpoint: `/payment-suspense/receipts/${item.sourceId}/write-off` }); return true; }
    const writeOff = { writeOffId: body.writeOffId, breakId, amount: item.amount, eventDate, proposedBy: body.proposedBy, approvedBy: body.approvedBy, approvalRef: body.approvalRef, reason: body.reason };
    const collection = item.sourceType === "payment" ? "paymentReconciliations" : "bankReconciliations";
    const record = state[collection][item.sourceId]; const updated = { ...record, outcome: "exception_written_off", writeOff };
    await store.save(appendEvent({ ...state, [collection]: { ...state[collection], [item.sourceId]: updated } }, { type: `finance.${item.sourceType}_reconciliation.exception_written_off`, breakId, sourceId: item.sourceId, amount: item.amount, approvedBy: body.approvedBy, approvalRef: body.approvalRef }));
    sendJson(res, 200, { break: { ...item, status: "written_off", writeOff } }); return true;
  }

  const paymentReconciliationResolutionMatch = path.match(/^\/payment-reconciliations\/([^/]+)\/resolution$/);
  if (method === "POST" && paymentReconciliationResolutionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const reconciliationId = decodeURIComponent(paymentReconciliationResolutionMatch[1]);
    const record = state.paymentReconciliations?.[reconciliationId];
    if (!record) { sendJson(res, 404, { error: { code: "not_found", message: "Payment reconciliation not found." } }); return true; }
    if (record.outcome !== "exception") { sendJson(res, 422, { error: { code: "resolution_blocked", message: "Only an unresolved payment exception can be resolved." } }); return true; }
    if (!body.resolvedBy || !body.approvalRef || !body.reason) { sendJson(res, 422, { error: { code: "resolution_blocked", message: "resolvedBy, approvalRef, and reason are required." } }); return true; }
    const resolved = { ...record, outcome: "exception_resolved", resolution: { resolvedBy: body.resolvedBy, approvalRef: body.approvalRef, reason: body.reason, resolvedAt: new Date().toISOString() } };
    await store.save(appendEvent({ ...state, paymentReconciliations: { ...state.paymentReconciliations, [reconciliationId]: resolved } }, { type: "finance.payment_reconciliation.exception_resolved", reconciliationId, resolvedBy: body.resolvedBy, approvalRef: body.approvalRef }));
    sendJson(res, 200, { reconciliation: resolved });
    return true;
  }

  const bankReconciliationResolutionMatch = path.match(/^\/bank-reconciliations\/([^/]+)\/resolution$/);
  if (method === "POST" && bankReconciliationResolutionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const bankReconciliationId = decodeURIComponent(bankReconciliationResolutionMatch[1]);
    const record = state.bankReconciliations?.[bankReconciliationId];
    if (!record) { sendJson(res, 404, { error: { code: "not_found", message: "Bank reconciliation not found." } }); return true; }
    if (record.outcome !== "exception") { sendJson(res, 422, { error: { code: "resolution_blocked", message: "Only an unresolved bank exception can be resolved." } }); return true; }
    if (!body.resolvedBy || !body.approvalRef || !body.reason) { sendJson(res, 422, { error: { code: "resolution_blocked", message: "resolvedBy, approvalRef, and reason are required." } }); return true; }
    const resolved = { ...record, outcome: "exception_resolved", resolution: { resolvedBy: body.resolvedBy, approvalRef: body.approvalRef, reason: body.reason, resolvedAt: new Date().toISOString() } };
    await store.save(appendEvent({ ...state, bankReconciliations: { ...state.bankReconciliations, [bankReconciliationId]: resolved } }, { type: "finance.bank_reconciliation.exception_resolved", bankReconciliationId, resolvedBy: body.resolvedBy, approvalRef: body.approvalRef }));
    sendJson(res, 200, { bankReconciliation: resolved });
    return true;
  }

  if (method === "POST" && path === "/bank-statements/entries") {
    const body = await readJson(req);
    const state = await store.load();
    const result = reconcileBankStatementEntry(state, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "bank_reconciliation_blocked", message: "Bank statement entry is invalid." }, findings: result.findings });
      return true;
    }
    if (result.duplicate) {
      sendJson(res, 200, { bankReconciliation: result.bankReconciliation, duplicate: true });
      return true;
    }
    await store.save(appendEvent(
      { ...state, bankReconciliations: result.bankReconciliations },
      { type: "finance.bank_statement.reconciled", bankReconciliationId: result.bankReconciliation.bankReconciliationId, transactionRef: result.bankReconciliation.transactionRef, outcome: result.bankReconciliation.outcome, amount: result.bankReconciliation.amount, paymentReconciliationId: result.bankReconciliation.paymentReconciliationId }
    ));
    sendJson(res, result.bankReconciliation.outcome === "matched" ? 200 : 202, { bankReconciliation: result.bankReconciliation, findings: result.findings });
    return true;
  }

  if (method === "POST" && path === "/integrations/payment-rails/settlements") {
    const body = await readJson(req);
    const state = await store.load();
    let callbackVerification = null;
    const callbackManager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications });
    if (callbackManager.config.providerCallbackSecrets?.payment_rail || callbackManager.config.paymentRailProvider === "real") {
      try {
        const signature = Array.isArray(req.headers["x-provider-signature"]) ? req.headers["x-provider-signature"][0] : req.headers["x-provider-signature"];
        const timestamp = Array.isArray(req.headers["x-provider-timestamp"]) ? req.headers["x-provider-timestamp"][0] : req.headers["x-provider-timestamp"];
        callbackVerification = callbackManager.verifyPaymentSettlementCallback(body.providerEventRef, body, signature, timestamp);
      } catch (error) { sendJson(res, 401, { error: { code: "payment_callback_unauthenticated", message: error.message } }); return true; }
    }
    const result = reconcilePaymentRailSettlement(state, { ...body, callbackVerification });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "payment_reconciliation_blocked", message: "Payment reconciliation is blocked by invalid callback data." },
        findings: result.findings
      });
      return true;
    }
    if (result.duplicate) {
      sendJson(res, 200, { reconciliation: result.reconciliation, duplicate: true });
      return true;
    }
    const nextState = appendEvent(
      { ...state, paymentRails: result.paymentRails, paymentReconciliations: result.reconciliations, loanAccounts: result.loanAccounts },
      { type: "integration.payment_rail.settlement_reconciled", reconciliationId: result.reconciliation.reconciliationId, paymentRailId: result.reconciliation.paymentRailId, providerEventRef: result.reconciliation.providerEventRef, loanAccountId: result.reconciliation.loanAccountId, outcome: result.reconciliation.outcome, status: result.reconciliation.status, amount: result.reconciliation.amount, paymentEventId: result.reconciliation.paymentEventId }
    );
    await store.save(nextState);
    sendJson(res, result.reconciliation.outcome === "matched_posted" ? 200 : 202, { reconciliation: result.reconciliation, paymentEvent: result.paymentEvent ?? null, reversalEvent: result.reversalEvent ?? null, findings: result.findings });
    return true;
  }

  if (method === "GET" && path === "/integrations/payment-rails/settlement-files") {
    const state = await store.load(); const files = Object.values(state.paymentSettlementFiles ?? {}).sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
    sendJson(res, 200, { count: files.length, settlementFiles: files }); return true;
  }

  if (method === "POST" && path === "/integrations/payment-rails/settlement-files") {
    const body = await readJson(req); const state = await store.load();
    if (!body.fileId || !body.provider || !Array.isArray(body.records) || !body.records.length) { sendJson(res, 422, { error: { code: "settlement_file_blocked", message: "fileId, provider, and at least one settlement record are required." } }); return true; }
    const checksumSha256 = createHash("sha256").update(JSON.stringify(body.records)).digest("hex"); const existing = state.paymentSettlementFiles?.[body.fileId];
    if (existing && existing.checksumSha256 !== checksumSha256) { sendJson(res, 409, { error: { code: "settlement_file_conflict", message: "fileId already exists with different content." } }); return true; }
    if (existing) { sendJson(res, 200, { settlementFile: existing, idempotent: true }); return true; }
    let working = state; const rowResults = [];
    for (let index = 0; index < body.records.length; index += 1) {
      const result = reconcilePaymentRailSettlement(working, body.records[index]);
      if (result.summary.status === "blocked") { rowResults.push({ rowNumber: index + 1, status: "rejected", findings: result.findings }); continue; }
      working = { ...working, paymentRails: result.paymentRails, paymentReconciliations: result.reconciliations, loanAccounts: result.loanAccounts };
      rowResults.push({ rowNumber: index + 1, status: result.duplicate ? "duplicate" : result.reconciliation.outcome, reconciliationId: result.reconciliation.reconciliationId, findings: result.findings });
    }
    const exceptionCount = rowResults.filter((row) => row.status === "exception" || row.status === "rejected").length;
    const settlementFile = { fileId: body.fileId, provider: body.provider, receivedAt: body.receivedAt ?? new Date().toISOString(), checksumSha256, totalRecordCount: body.records.length, matchedPostedCount: rowResults.filter((row) => row.status === "matched_posted").length, exceptionCount, duplicateCount: rowResults.filter((row) => row.status === "duplicate").length, status: exceptionCount ? "processed_with_exceptions" : "processed", acknowledgement: { status: exceptionCount ? "accepted_with_exceptions" : "accepted", reference: `ACK-${body.fileId}` }, rowResults };
    const nextState = appendEvent({ ...working, paymentSettlementFiles: { ...(working.paymentSettlementFiles ?? {}), [body.fileId]: settlementFile } }, { type: "integration.payment_rail.settlement_file_processed", fileId: body.fileId, provider: body.provider, totalRecordCount: settlementFile.totalRecordCount, matchedPostedCount: settlementFile.matchedPostedCount, exceptionCount });
    await store.save(nextState); sendJson(res, exceptionCount ? 202 : 201, { settlementFile, idempotent: false }); return true;
  }

  if (method === "POST" && path === "/integrations/payment-rails/nach-mandates") {
    const body = await readJson(req);
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: (await store.load()).providerCertifications });
    let providerResult = null;
    try {
      providerResult = await manager.createNachMandate(body);
    } catch (err) {
      sendJson(res, 422, { error: { code: "payment_rail_nach_mandate_failed", message: err.message } });
      return true;
    }
    const state = await store.load();
    const record = buildNachMandateRecord(body, providerResult);
    const nextState = appendEvent(
      { ...state, paymentRails: { ...(state.paymentRails ?? {}), [record.paymentRailId]: record } },
      { type: "integration.payment_rail.nach_mandate_registered", paymentRailId: record.paymentRailId, borrowerId: record.borrowerId, loanAccountId: record.loanAccountId, applicationId: record.applicationId, provider: record.provider, providerRef: record.providerRef, status: record.status, amount: record.maxAmount, dataResidencyCountry: record.dataResidencyCountry }
    );
    await store.save(nextState);
    sendJson(res, providerResult.success === false ? 422 : 201, { paymentRail: record });
    return true;
  }

  if (method === "POST" && path === "/integrations/payment-rails/nach-presentments") {
    const body = await readJson(req);
    const state = await store.load();
    const mandate = Object.values(state.paymentRails ?? {}).find((record) => record.type === "nach_mandate" && (record.paymentRailId === body.mandateId || record.providerRef === body.mandateRef));
    if (!mandate || mandate.status !== "registered") {
      sendJson(res, 422, { error: { code: "nach_mandate_unavailable", message: "An active registered NACH mandate is required for presentment." } });
      return true;
    }
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications });
    let providerResult;
    try {
      providerResult = await manager.createNachPresentment({ ...body, mandateRef: mandate.providerRef });
    } catch (err) {
      sendJson(res, 422, { error: { code: "payment_rail_nach_presentment_failed", message: err.message } });
      return true;
    }
    const record = buildNachPresentmentRecord(body, mandate, providerResult);
    const nextState = appendEvent(
      { ...state, paymentRails: { ...(state.paymentRails ?? {}), [record.paymentRailId]: record } },
      { type: "integration.payment_rail.nach_presentment_created", paymentRailId: record.paymentRailId, loanAccountId: record.loanAccountId, providerRef: record.providerRef, amount: record.amount, status: record.status }
    );
    await store.save(nextState);
    sendJson(res, providerResult.success === false ? 422 : 201, { paymentRail: record });
    return true;
  }

  if (method === "POST" && path === "/integrations/payment-rails/nach-due-presentments") {
    const body = await readJson(req); const state = await store.load(); const asOf = body.asOf ? new Date(body.asOf) : new Date();
    if (Number.isNaN(asOf.getTime()) || !body.batchId) { sendJson(res, 422, { error: { code: "nach_due_batch_blocked", message: "batchId and a valid asOf are required." } }); return true; }
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications }); let workingRails = { ...(state.paymentRails ?? {}) }; const created = []; const skipped = [];
    for (const account of Object.values(state.loanAccounts ?? {})) {
      if (Array.isArray(body.loanAccountIds) && !body.loanAccountIds.includes(account.loanAccountId)) continue;
      const delinquency = computeDelinquency(account, asOf); const mandate = Object.values(workingRails).find((record) => record.type === "nach_mandate" && record.loanAccountId === account.loanAccountId && record.status === "registered");
      const duplicate = Object.values(workingRails).find((record) => record.type === "nach_presentment" && record.loanAccountId === account.loanAccountId && record.dueDate === delinquency.earliestUnpaidDueDate && ["pending", "settled"].includes(record.status));
      if (!delinquency.earliestUnpaidDueDate || delinquency.totalOverdue <= 0 || !mandate || duplicate) { skipped.push({ loanAccountId: account.loanAccountId, reason: duplicate ? "already_presented" : !mandate ? "active_mandate_not_found" : "nothing_due" }); continue; }
      const amount = Math.min(delinquency.totalOverdue, mandate.maxAmount); if (amount <= 0) { skipped.push({ loanAccountId: account.loanAccountId, reason: "mandate_limit_unavailable" }); continue; }
      try {
        const input = { paymentRailId: `nachdue:${body.batchId}:${account.loanAccountId}`, loanAccountId: account.loanAccountId, amount, dueDate: delinquency.earliestUnpaidDueDate, mandateRef: mandate.providerRef };
        const providerResult = await manager.createNachPresentment(input); const record = buildNachPresentmentRecord(input, mandate, providerResult); workingRails[record.paymentRailId] = record; created.push(record);
      } catch (err) { skipped.push({ loanAccountId: account.loanAccountId, reason: "provider_rejected", message: err.message }); }
    }
    await store.save(appendEvent({ ...state, paymentRails: workingRails }, { type: "integration.payment_rail.nach_due_batch_created", batchId: body.batchId, asOf: asOf.toISOString(), createdCount: created.length, skippedCount: skipped.length }));
    sendJson(res, 201, { batchId: body.batchId, asOf: asOf.toISOString(), createdCount: created.length, skippedCount: skipped.length, paymentRails: created, skipped }); return true;
  }

  if (method === "POST" && path === "/integrations/payment-rails/upi-collects") {
    const body = await readJson(req);
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: (await store.load()).providerCertifications });
    let providerResult = null;
    try {
      providerResult = await manager.createUpiCollect(body);
    } catch (err) {
      sendJson(res, 422, { error: { code: "payment_rail_upi_collect_failed", message: err.message } });
      return true;
    }
    const state = await store.load();
    const record = buildUpiCollectRecord(body, providerResult);
    const nextState = appendEvent(
      { ...state, paymentRails: { ...(state.paymentRails ?? {}), [record.paymentRailId]: record } },
      { type: "integration.payment_rail.upi_collect_created", paymentRailId: record.paymentRailId, borrowerId: record.borrowerId, loanAccountId: record.loanAccountId, applicationId: record.applicationId, provider: record.provider, providerRef: record.providerRef, status: record.status, amount: record.amount, dataResidencyCountry: record.dataResidencyCountry }
    );
    await store.save(nextState);
    sendJson(res, providerResult.success === false ? 422 : 201, { paymentRail: record });
    return true;
  }

  return false;
}

function buildReconciliationBreakQueue(state, now = new Date()) {
  const assignments = state.reconciliationBreakAssignments ?? {};
  const build = (sourceType, sourceId, record, occurredAt, amount, exceptionCode) => {
    const breakId = `${sourceType}:${sourceId}`; const assignment = assignments[breakId] ?? null; const timestamp = new Date(occurredAt).getTime();
    const ageDays = Number.isNaN(timestamp) ? null : Math.max(0, Math.floor((now.getTime() - timestamp) / 86400000));
    return { breakId, sourceType, sourceId, status: assignment ? (new Date(assignment.dueAt).getTime() < now.getTime() ? "overdue" : "assigned") : "unassigned", exceptionCode, amount: Number(amount ?? 0), currency: record.currency ?? "INR", occurredAt, ageDays, loanAccountId: record.loanAccountId ?? null, assignment, resolutionEndpoint: sourceType === "payment" ? `/payment-reconciliations/${sourceId}/resolution` : sourceType === "bank" ? `/bank-reconciliations/${sourceId}/resolution` : `/payment-suspense/receipts/${sourceId}/resolution`, writeOffEndpoint: sourceType === "suspense" ? `/payment-suspense/receipts/${sourceId}/write-off` : `/finance/reconciliation-breaks/${encodeURIComponent(breakId)}/write-off` };
  };
  return [
    ...Object.values(state.paymentReconciliations ?? {}).filter((record) => record.outcome === "exception").map((record) => build("payment", record.reconciliationId, record, record.settledAt ?? record.receivedAt, record.amount, record.exceptionCode)),
    ...Object.values(state.bankReconciliations ?? {}).filter((record) => record.outcome === "exception").map((record) => build("bank", record.bankReconciliationId, record, record.valueDate ?? record.receivedAt, record.amount, record.exceptionCode)),
    ...Object.values(state.paymentSuspenseReceipts ?? {}).filter((record) => ["open", "partially_resolved"].includes(record.status)).map((record) => build("suspense", record.suspenseId, record, record.valueDate ?? record.receivedAt, record.remainingAmount, record.reasonCode))
  ].sort((left, right) => (right.ageDays ?? -1) - (left.ageDays ?? -1) || left.breakId.localeCompare(right.breakId));
}

function paymentRailMatchesFilters(record, url) {
  const filters = {
    type: url.searchParams.get("type"),
    channel: url.searchParams.get("channel"),
    status: url.searchParams.get("status"),
    borrowerId: url.searchParams.get("borrowerId"),
    applicationId: url.searchParams.get("applicationId"),
    loanAccountId: url.searchParams.get("loanAccountId"),
    providerRef: url.searchParams.get("providerRef")
  };
  if (filters.type && record.type !== filters.type) return false;
  if (filters.channel && record.channel !== filters.channel) return false;
  if (filters.status && record.status !== filters.status) return false;
  if (filters.borrowerId && record.borrowerId !== filters.borrowerId) return false;
  if (filters.applicationId && record.applicationId !== filters.applicationId) return false;
  if (filters.loanAccountId && record.loanAccountId !== filters.loanAccountId) return false;
  if (filters.providerRef && record.providerRef !== filters.providerRef) return false;
  return true;
}

function buildNachMandateRecord(input, providerResult, now = new Date()) {
  const accountNumber = input.accountNumber ? String(input.accountNumber).trim() : "";
  return {
    paymentRailId: input.paymentRailId ?? input.mandateId ?? createLoanId("payrail"),
    type: "nach_mandate", channel: "nach", borrowerId: input.borrowerId, applicationId: input.applicationId ?? null, loanAccountId: input.loanAccountId ?? null,
    maxAmount: Number(input.maxAmount), currency: input.currency ?? "INR", frequency: input.frequency ?? "monthly", startsAt: input.startsAt ?? null, expiresAt: input.expiresAt ?? null,
    consentRef: input.consentRef ?? null, bankAccountVerificationRef: input.bankAccountVerificationRef ?? null, ifsc: input.ifsc ? String(input.ifsc).trim().toUpperCase() : null,
    accountNumberLast4: input.accountNumberLast4 ?? (accountNumber ? accountNumber.slice(-4) : null), accountNumberSha256: accountNumber ? hashString(accountNumber) : null,
    provider: providerResult.provider, providerRef: providerResult.mandateRef ?? providerResult.ref ?? providerResult.providerRef ?? null,
    status: providerResult.status ?? (providerResult.success ? "registered" : "failed"), dataResidencyCountry: providerResult.dataResidencyCountry ?? "IN", registeredAt: providerResult.registeredAt ?? now.toISOString()
  };
}

function buildUpiCollectRecord(input, providerResult, now = new Date()) {
  const vpa = String(input.vpa ?? "").trim().toLowerCase();
  return {
    paymentRailId: input.paymentRailId ?? input.collectId ?? createLoanId("payrail"), type: "upi_collect", channel: "upi", borrowerId: input.borrowerId ?? null,
    applicationId: input.applicationId ?? null, loanAccountId: input.loanAccountId ?? null, amount: Number(input.amount), currency: input.currency ?? "INR", purpose: input.purpose ?? "repayment",
    vpaMasked: maskVpa(vpa), vpaSha256: hashString(vpa), provider: providerResult.provider, providerRef: providerResult.collectRef ?? providerResult.ref ?? providerResult.providerRef ?? null,
    status: providerResult.status ?? (providerResult.success ? "pending" : "failed"), dataResidencyCountry: providerResult.dataResidencyCountry ?? "IN", createdAt: providerResult.createdAt ?? now.toISOString(), expiresAt: input.expiresAt ?? null
  };
}

function buildNachPresentmentRecord(input, mandate, providerResult, now = new Date()) {
  return {
    paymentRailId: input.paymentRailId ?? input.presentmentId ?? createLoanId("payrail"), type: "nach_presentment", channel: "nach", borrowerId: input.borrowerId ?? mandate.borrowerId ?? null,
    applicationId: input.applicationId ?? mandate.applicationId ?? null, loanAccountId: input.loanAccountId ?? mandate.loanAccountId ?? null, mandateId: mandate.paymentRailId, mandateRef: mandate.providerRef,
    amount: Number(input.amount), currency: input.currency ?? mandate.currency ?? "INR", purpose: input.purpose ?? "repayment", provider: providerResult.provider,
    providerRef: providerResult.presentmentRef ?? providerResult.ref ?? providerResult.providerRef ?? null, status: providerResult.status ?? (providerResult.success ? "pending" : "failed"),
    dataResidencyCountry: providerResult.dataResidencyCountry ?? "IN", createdAt: providerResult.createdAt ?? now.toISOString(), dueDate: input.dueDate ?? null
  };
}

function maskVpa(value) {
  const [handle, provider] = String(value ?? "").split("@");
  return `${(handle ?? "").slice(0, 2)}***@${provider ?? "***"}`;
}

function hashString(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}
