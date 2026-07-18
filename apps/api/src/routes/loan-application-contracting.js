import {
  ExternalServiceManager,
  createLoanAccountFromApplication,
  createLoanId,
  generateDocumentPacket,
  markDisbursed,
  recordDocumentPacketDelivered,
  recordDocumentPacketDelivery,
  recordDocumentPacketGenerated,
  signDocumentPacket,
  summarizeFindings,
  validateCersaiForDisbursement,
  validateDisbursement,
  validateDocumentPacketAccess,
  validateDocumentPacketBeforeDisbursement,
  validateOriginationBeforeDisbursement,
  vaultDocumentPacket
} from "@loanos/core";

/** Owns post-approval contracting, borrower e-sign and disbursement. */
export async function routeLoanApplicationContracting(context) {
  const {
    method,
    path,
    req,
    res,
    tenant,
    store,
    readJson,
    sendJson,
    appendEvent,
    authContext,
    resolveSessionActorId
  } = context;
  if (!isContractingPath(path)) return false;

  const packetMatch = path.match(/^\/loans\/applications\/([^/]+)\/document-packet$/);
  if (packetMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, packetMatch[1], authContext);
    if (!application) {
      sendApplicationNotFound(res, sendJson);
      return true;
    }
    if (method === "GET") {
      if (!application.documentPacket) sendJson(res, 404, { error: { code: "not_found", message: "Document packet not found." } });
      else sendJson(res, 200, application.documentPacket);
      return true;
    }
    if (method === "POST") {
      if (rejectBorrowerMutation(authContext, res, sendJson)) return true;
      const body = await readJson(req);
      const actorId = resolveSessionActorId(authContext, body.actor ?? body.generatedBy);
      body.actor = actorId;
      body.generatedBy = actorId;
      const accessFindings = validateDocumentPacketAccess(state.users, actorId, "actor");
      if (summarizeFindings(accessFindings).status === "blocked") {
        sendJson(res, 422, { error: { code: "document_packet_access_blocked", message: "Document packet generation is blocked by actor role policy." }, findings: accessFindings });
        return true;
      }
      const packetResult = generateDocumentPacket(application, body);
      if (packetResult.summary.status === "blocked") {
        sendJson(res, 422, { error: { code: "document_packet_blocked", message: "Document packet generation is blocked by workflow findings." }, findings: packetResult.findings });
        return true;
      }
      const stored = recordDocumentPacketGenerated(application, packetResult.packet);
      await store.save(appendEvent(
        { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
        { type: "loan.document_packet.generated", applicationId: stored.applicationId, packetId: packetResult.packet.packetId }
      ));
      sendJson(res, 201, stored.documentPacket);
      return true;
    }
    return false;
  }

  const deliveryMatch = path.match(/^\/loans\/applications\/([^/]+)\/document-packet\/delivery$/);
  if (method === "POST" && deliveryMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, deliveryMatch[1], authContext);
    if (!application) {
      sendApplicationNotFound(res, sendJson);
      return true;
    }
    if (rejectBorrowerMutation(authContext, res, sendJson)) return true;
    const body = await readJson(req);
    const actorId = resolveSessionActorId(authContext, body.actor ?? body.deliveredBy);
    body.actor = actorId;
    body.deliveredBy = actorId;
    const accessFindings = validateDocumentPacketAccess(state.users, actorId, "actor");
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, { error: { code: "document_packet_access_blocked", message: "Document packet delivery is blocked by actor role policy." }, findings: accessFindings });
      return true;
    }
    const deliveryResult = recordDocumentPacketDelivery(application, body);
    if (deliveryResult.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "document_packet_delivery_blocked", message: "Document packet delivery is blocked by workflow findings." }, findings: deliveryResult.findings });
      return true;
    }
    const stored = recordDocumentPacketDelivered(application, deliveryResult.packet);
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      {
        type: "loan.document_packet.delivered",
        applicationId: stored.applicationId,
        packetId: deliveryResult.packet.packetId,
        deliveryRef: deliveryResult.packet.delivery.deliveryRef
      }
    ));
    sendJson(res, 200, stored.documentPacket);
    return true;
  }

  const esignMatch = path.match(/^\/loans\/applications\/([^/]+)\/document-packet\/esign$/);
  if (method === "POST" && esignMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, esignMatch[1], authContext);
    if (!application) {
      sendApplicationNotFound(res, sendJson);
      return true;
    }
    const authenticatedBorrowerName = authContext?.principalType === "borrower"
      ? application.borrower?.fullName ?? application.borrower?.legalName ?? application.borrower?.name
      : null;
    const { aadhaarNumber, otp } = body;
    const signerName = authenticatedBorrowerName ?? body.signerName;
    if (!aadhaarNumber || !otp || !signerName) {
      sendJson(res, 400, { error: { code: "bad_request", message: "aadhaarNumber, otp, and signerName are required." } });
      return true;
    }
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications });
    let esignResult;
    try {
      const payloadHash = (application.documentPacket?.documents ?? []).map((document) => document.checksumSha256).join(",");
      esignResult = await manager.verifyEsignOtp(aadhaarNumber, otp, payloadHash);
    } catch (error) {
      sendJson(res, 422, { error: { code: "esign_verification_failed", message: error.message } });
      return true;
    }
    const signResult = signDocumentPacket(application, {
      aadhaarNumber,
      signerName,
      signatureRef: esignResult.signatureRef,
      esignProvider: esignResult.esignProvider,
      envelopeId: esignResult.envelopeId,
      externalEnvelopeStorageUrl: esignResult.externalEnvelopeStorageUrl
    });
    if (signResult.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "document_packet_signing_blocked", message: "Document packet signing is blocked by workflow findings." }, findings: signResult.findings });
      return true;
    }
    const stored = { ...application, documentPacket: signResult.packet };
    const vaultResult = vaultDocumentPacket(state.documentVault, stored, signResult.packet, {
      vaultedBy: body.actor ?? "esign",
      retentionPolicyId: body.retentionPolicyId ?? undefined,
      storageCountry: body.storageCountry ?? undefined
    });
    if (vaultResult.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "document_vault_blocked", message: "Signed document packet could not be vaulted." }, findings: vaultResult.findings });
      return true;
    }
    const signedState = {
      ...state,
      loanApplications: { ...state.loanApplications, [stored.applicationId]: stored },
      documentVault: vaultResult.registry
    };
    await store.save(appendEvent(
      appendEvent(signedState, {
        type: "loan.document_packet.signed",
        applicationId: stored.applicationId,
        packetId: signResult.packet.packetId,
        signatureRef: esignResult.signatureRef,
        signerName,
        vaultRecordId: vaultResult.record.vaultRecordId
      }),
      {
        type: "document_vault.packet_vaulted",
        applicationId: stored.applicationId,
        packetId: signResult.packet.packetId,
        vaultRecordId: vaultResult.record.vaultRecordId,
        documentCount: vaultResult.record.documentCount,
        manifestChecksumSha256: vaultResult.record.manifestChecksumSha256
      }
    ));
    sendJson(res, 200, stored.documentPacket);
    return true;
  }

  const disbursementMatch = path.match(/^\/loans\/applications\/([^/]+)\/disbursement$/);
  if (method === "POST" && disbursementMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, disbursementMatch[1], authContext);
    if (!application) {
      sendApplicationNotFound(res, sendJson);
      return true;
    }
    if (rejectBorrowerMutation(authContext, res, sendJson)) return true;
    const body = await readJson(req);
    const result = validateDisbursement(application, body);
    const findings = [
      ...result.findings,
      ...validateDocumentPacketBeforeDisbursement(application).findings,
      ...validateCersaiForDisbursement(application, state).findings,
      ...validateOriginationBeforeDisbursement(application).findings
    ];
    if (summarizeFindings(findings).status === "blocked") {
      sendJson(res, 422, { error: { code: "disbursement_blocked", message: "Disbursement is blocked by compliance findings." }, findings });
      return true;
    }
    const disbursement = {
      ...body,
      disbursedAt: new Date().toISOString(),
      disbursementId: body.disbursementId ?? createLoanId("disb")
    };
    const disbursedApplication = markDisbursed(application, disbursement);
    const accountResult = createLoanAccountFromApplication(disbursedApplication, disbursement);
    if (accountResult.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "loan_account_blocked", message: "Loan account could not be opened after disbursement." }, findings: accountResult.findings });
      return true;
    }
    const stored = { ...disbursedApplication, loanAccountId: accountResult.loanAccount.loanAccountId };
    await store.save(appendEvent(
      {
        ...state,
        loanApplications: { ...state.loanApplications, [stored.applicationId]: stored },
        loanAccounts: { ...state.loanAccounts, [accountResult.loanAccount.loanAccountId]: accountResult.loanAccount }
      },
      {
        type: "loan.disbursement.recorded",
        applicationId: stored.applicationId,
        disbursementId: disbursement.disbursementId,
        loanAccountId: accountResult.loanAccount.loanAccountId
      }
    ));
    sendJson(res, 200, stored);
    return true;
  }

  return false;
}

function isContractingPath(path) {
  return /^\/loans\/applications\/[^/]+\/(?:document-packet(?:\/(?:delivery|esign))?|disbursement)$/.test(path);
}

function authorizedApplication(state, encodedApplicationId, authContext) {
  const application = state.loanApplications?.[decodeURIComponent(encodedApplicationId)];
  const borrowerId = application?.borrowerId ?? application?.borrower?.borrowerId ?? null;
  if (authContext?.principalType === "borrower" && borrowerId !== authContext.userId) return null;
  return application ?? null;
}

function rejectBorrowerMutation(authContext, res, sendJson) {
  if (authContext?.principalType !== "borrower") return false;
  sendJson(res, 403, { error: { code: "borrower_forbidden", message: "This operation is not available to borrower sessions." } });
  return true;
}

function sendApplicationNotFound(res, sendJson) {
  sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
}
