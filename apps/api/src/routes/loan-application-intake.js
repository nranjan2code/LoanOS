import {
  ExternalServiceManager,
  createLoanId,
  createUnderwritingCondition,
  evaluateLoanApplication,
  evaluateOriginationReadiness,
  initializeApplicationWorkflow,
  initializeOriginationJourney,
  recordApplicationDocument,
  resolveBorrowerApplicationReferences,
  resolveLoanApplicationReferences,
  reviewApplicationDocument,
  satisfyUnderwritingCondition,
  summarizeFindings,
  validateDocumentPacketAccess
} from "@loanos/core";

/**
 * Owns application capture and the evidence gathered before pricing or a
 * credit decision. Later origination stages (eligibility, KFS, decision,
 * contracting and disbursement) intentionally remain separate extraction
 * boundaries.
 */
export async function routeLoanApplicationIntake(context) {
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

  if (!isLoanApplicationIntakePath(path)) return false;

  if (method === "POST" && (path === "/loans/applications" || path === "/borrower/applications")) {
    const requestBody = await readJson(req);
    const selfService = path === "/borrower/applications";
    if (selfService && authContext?.principalType !== "borrower") {
      sendJson(res, 403, { error: { code: "borrower_session_required", message: "A borrower session is required for digital application capture." } });
      return true;
    }
    const body = selfService ? borrowerApplicationInput(requestBody, authContext.userId) : requestBody;
    const state = await store.load();
    const borrower = state.borrowerProfiles?.[body.borrowerId];
    const pan = borrower?.pan || "ABCDE1234F";
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications });
    let bureauReport = null;
    try {
      bureauReport = await manager.queryCreditBureau(pan);
    } catch (error) {
      if (isResidencyError(error)) {
        sendJson(res, 422, { error: { code: "credit_bureau_query_failed", message: error.message } });
        return true;
      }
      // Non-residency provider failures retain the existing thin-file path.
    }

    const application = {
      ...body,
      applicationId: body.applicationId ?? createLoanId("app"),
      status: "application_received",
      createdAt: new Date().toISOString(),
      bureauReport
    };
    const borrowerResolution = resolveBorrowerApplicationReferences(application, {
      borrowerProfiles: state.borrowerProfiles,
      consentRecords: state.consentRecords,
      kycRecords: state.kycRecords,
      beneficialOwners: state.beneficialOwners
    });
    const resolution = resolveLoanApplicationReferences(borrowerResolution.application, {
      regulatedEntities: state.regulatedEntities,
      productPolicies: state.productPolicies
    });
    const evaluation = evaluateLoanApplication(resolution.application, { modelRegistry: state.modelRegistry });
    const compliance = combineComplianceResults(borrowerResolution, resolution, evaluation);
    let stored = initializeApplicationWorkflow({ ...resolution.application, compliance }, compliance);

    if (selfService) {
      const journey = initializeOriginationJourney(stored, borrowerJourneyInput(requestBody));
      if (journey.summary.status === "blocked") {
        sendJson(res, 422, {
          error: { code: "digital_application_blocked", message: "Digital application declaration or journey configuration is incomplete." },
          findings: journey.findings
        });
        return true;
      }
      stored = journey.application;
    }

    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      {
        type: "loan.application.created",
        applicationId: stored.applicationId,
        status: stored.status,
        channel: stored.origination?.channel ?? "operations"
      }
    ));
    sendJson(res, compliance.summary.status === "blocked" ? 422 : 201, stored);
    return true;
  }

  if (method === "GET" && path === "/loans/applications") {
    const state = await store.load();
    sendJson(res, 200, {
      applications: Object.values(state.loanApplications || {}).filter(
        (application) => authContext?.principalType !== "borrower" || borrowerIdForApplication(application) === authContext.userId
      )
    });
    return true;
  }

  const applicationMatch = path.match(/^\/loans\/applications\/([^/]+)$/);
  if (method === "GET" && applicationMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, applicationMatch[1], authContext);
    if (!application) sendNotFound(res, sendJson);
    else sendJson(res, 200, application);
    return true;
  }

  const readinessMatch = path.match(/^\/loans\/applications\/([^/]+)\/origination-readiness$/);
  if (method === "GET" && readinessMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, readinessMatch[1], authContext);
    if (!application) sendNotFound(res, sendJson);
    else sendJson(res, 200, evaluateOriginationReadiness(application));
    return true;
  }

  const documentsMatch = path.match(/^\/loans\/applications\/([^/]+)\/documents$/);
  if (method === "POST" && documentsMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, documentsMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    const actorId = authContext?.principalType === "borrower"
      ? authContext.userId
      : resolveSessionActorId(authContext, body.uploadedBy ?? body.actor);
    const result = recordApplicationDocument(application, body, {
      actorId,
      actorType: authContext?.principalType === "borrower" ? "borrower" : "staff"
    });
    if (result.document) {
      await store.save(appendEvent(
        { ...state, loanApplications: { ...state.loanApplications, [application.applicationId]: result.application } },
        {
          type: result.document.status === "quarantined" ? "loan.application_document.quarantined" : "loan.application_document.uploaded",
          applicationId: application.applicationId,
          documentId: result.document.documentId,
          documentType: result.document.type,
          actor: actorId
        }
      ));
    }
    if (result.summary.status === "blocked") {
      sendJson(res, 422, {
        error: { code: "application_document_blocked", message: "Application document was rejected or quarantined." },
        document: result.document,
        findings: result.findings
      });
      return true;
    }
    sendJson(res, 201, result.document);
    return true;
  }

  const reviewMatch = path.match(/^\/loans\/applications\/([^/]+)\/documents\/([^/]+)\/review$/);
  if (method === "POST" && reviewMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, reviewMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    body.reviewedBy = resolveSessionActorId(authContext, body.reviewedBy);
    const accessFindings = [
      ...validateDocumentPacketAccess(state.users, body.reviewedBy, "reviewedBy"),
      ...(body.outcome === "waived" ? validateDocumentPacketAccess(state.users, body.approvedBy, "approvedBy") : [])
    ];
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, { error: { code: "document_review_access_blocked", message: "Document review is blocked by actor policy." }, findings: accessFindings });
      return true;
    }
    const result = reviewApplicationDocument(application, decodeURIComponent(reviewMatch[2]), body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "application_document_review_blocked", message: "Application document review is invalid." }, findings: result.findings });
      return true;
    }
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [application.applicationId]: result.application } },
      { type: "loan.application_document.reviewed", applicationId: application.applicationId, documentId: result.document.documentId, outcome: result.review.outcome, actor: body.reviewedBy }
    ));
    sendJson(res, 200, result.document);
    return true;
  }

  const conditionsMatch = path.match(/^\/loans\/applications\/([^/]+)\/conditions$/);
  if (method === "POST" && conditionsMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, conditionsMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    body.createdBy = resolveSessionActorId(authContext, body.createdBy);
    const accessFindings = [
      ...validateDocumentPacketAccess(state.users, body.createdBy, "createdBy"),
      ...validateDocumentPacketAccess(state.users, body.approvedBy, "approvedBy")
    ];
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, { error: { code: "condition_access_blocked", message: "Condition creation is blocked by actor policy." }, findings: accessFindings });
      return true;
    }
    const result = createUnderwritingCondition(application, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "condition_blocked", message: "Underwriting condition is invalid." }, findings: result.findings });
      return true;
    }
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [application.applicationId]: result.application } },
      { type: "loan.underwriting_condition.created", applicationId: application.applicationId, conditionId: result.condition.conditionId, conditionType: result.condition.type, actor: body.createdBy }
    ));
    sendJson(res, 201, result.condition);
    return true;
  }

  const satisfactionMatch = path.match(/^\/loans\/applications\/([^/]+)\/conditions\/([^/]+)\/satisfaction$/);
  if (method === "POST" && satisfactionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, satisfactionMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    body.satisfiedBy = resolveSessionActorId(authContext, body.satisfiedBy);
    const accessFindings = [
      ...validateDocumentPacketAccess(state.users, body.satisfiedBy, "satisfiedBy"),
      ...validateDocumentPacketAccess(state.users, body.verifiedBy, "verifiedBy")
    ];
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, { error: { code: "condition_access_blocked", message: "Condition satisfaction is blocked by actor policy." }, findings: accessFindings });
      return true;
    }
    const result = satisfyUnderwritingCondition(application, decodeURIComponent(satisfactionMatch[2]), body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "condition_satisfaction_blocked", message: "Condition satisfaction is invalid." }, findings: result.findings });
      return true;
    }
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [application.applicationId]: result.application } },
      { type: "loan.underwriting_condition.satisfied", applicationId: application.applicationId, conditionId: result.condition.conditionId, actor: body.satisfiedBy, verifiedBy: body.verifiedBy }
    ));
    sendJson(res, 200, result.condition);
    return true;
  }

  return false;
}

function isLoanApplicationIntakePath(path) {
  return path === "/loans/applications" ||
    path === "/borrower/applications" ||
    /^\/loans\/applications\/[^/]+(?:\/origination-readiness|\/documents(?:\/[^/]+\/review)?|\/conditions(?:\/[^/]+\/satisfaction)?)?$/.test(path);
}

function borrowerApplicationInput(input, borrowerId) {
  return {
    regulatedEntityId: input.regulatedEntityId,
    productId: input.productId,
    borrowerId,
    requestedAmount: input.requestedAmount,
    requestedTenorMonths: input.requestedTenorMonths,
    purpose: input.purpose,
    disbursement: {
      destinationAccount: {
        country: "IN",
        ownerRole: "borrower",
        ifsc: input.destinationAccount?.ifsc,
        accountNumberLast4: input.destinationAccount?.accountNumberLast4
      }
    },
    repayment: { recoveryMechanism: input.repaymentMechanism ?? "nach" }
  };
}

function borrowerJourneyInput(input) {
  return {
    channel: "borrower_self_service",
    source: input.source ?? "direct",
    campaignRef: input.campaignRef,
    referralRef: input.referralRef,
    preferredLanguage: input.preferredLanguage,
    languageUnderstood: input.languageUnderstood,
    languageConfirmationRef: input.languageConfirmationRef,
    informationAccurate: input.informationAccurate,
    applicationDeclarationRef: input.applicationDeclarationRef
  };
}

function combineComplianceResults(...results) {
  const findings = results.flatMap((result) => result?.findings ?? []);
  return { findings, summary: summarizeFindings(findings) };
}

function borrowerIdForApplication(application) {
  return application?.borrowerId ?? application?.borrower?.borrowerId ?? null;
}

function authorizedApplication(state, encodedApplicationId, authContext) {
  const application = state.loanApplications?.[decodeURIComponent(encodedApplicationId)];
  if (
    authContext?.principalType === "borrower" &&
    borrowerIdForApplication(application) !== authContext.userId
  ) return null;
  return application ?? null;
}

function isResidencyError(error) {
  return String(error?.message ?? "").toLowerCase().includes("residency");
}

function sendNotFound(res, sendJson) {
  sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
}
