import {
  ExternalServiceManager,
  acceptKfs,
  applyDecisionApproval,
  applyKfsWorkflow,
  attachKfs,
  attachSanctionValidity,
  buildKeyFactStatement,
  completeWorkflowTask,
  deriveWorkflowTasks,
  evaluateEligibility,
  evaluateLoanApplication,
  proposeDecision,
  recordHumanReview,
  summarizeFindings,
  validateDecisionApprovalAccess,
  validateDecisionProposalAccess,
  validateHumanReviewAccess,
  validateKfs,
  validateKfsBeforeDecision,
  validateManualUnderwritingAccess,
  validateOriginationBeforeDecision
} from "@loanos/core";
import { assessEligibilityGated } from "../rules-engine.js";

const FORBIDDEN_KFS_TERM_FIELDS = Object.freeze([
  "terms",
  "principalAmount",
  "tenorMonths",
  "annualInterestRateBps",
  "aprBps",
  "charges",
  "acceptance"
]);

/** Owns governed eligibility, KFS and maker-checker credit decisions. */
export async function routeLoanApplicationUnderwriting(context) {
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

  if (!isUnderwritingPath(path)) return false;

  const eligibilityMatch = path.match(/^\/loans\/applications\/([^/]+)\/eligibility$/);
  if (method === "GET" && eligibilityMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, eligibilityMatch[1], authContext);
    if (!application) sendNotFound(res, sendJson);
    else sendJson(res, 200, application.eligibility ?? null);
    return true;
  }
  if (method === "POST" && eligibilityMatch) {
    const state = await store.load();
    const application = authorizedApplication(state, eligibilityMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    const borrower = state.borrowerProfiles?.[application.borrowerId];
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications });
    let bureauReport = null;
    try {
      bureauReport = await manager.queryCreditBureau(borrower?.pan || "ABCDE1234F");
    } catch (error) {
      if (isResidencyError(error)) {
        sendJson(res, 422, { error: { code: "credit_bureau_query_failed", message: error.message } });
        return true;
      }
      // Non-residency provider failures retain the governed thin-file path.
    }
    const appWithBureau = { ...application, bureauReport };
    const eligibility = await assessEligibilityGated({
      evaluateJs: evaluateEligibility,
      application: appWithBureau,
      tenantId: tenant.tenantId,
      stage: "eligibility"
    });
    const stored = { ...appWithBureau, eligibility: eligibility.assessment };
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      { type: "loan.eligibility.assessed", applicationId: stored.applicationId, decision: eligibility.assessment.decision }
    ));
    sendJson(res, 200, eligibility);
    return true;
  }

  const kfsMatch = path.match(/^\/loans\/applications\/([^/]+)\/kfs$/);
  if (method === "POST" && kfsMatch) {
    const body = await readJson(req);
    if (FORBIDDEN_KFS_TERM_FIELDS.some((field) => body[field] !== undefined)) {
      sendJson(res, 422, {
        error: {
          code: "kfs_terms_server_managed",
          message: "KFS pricing, loan terms, delivery, and acceptance are server-managed and cannot be supplied by the client."
        }
      });
      return true;
    }
    const state = await store.load();
    const application = authorizedApplication(state, kfsMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    const kfs = buildKeyFactStatement(application, kfsTerms(application));
    const kfsValidation = validateKfs(kfs);
    if (kfsValidation.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "kfs_generation_blocked", message: "KFS generation failed validation." }, findings: kfsValidation.findings });
      return true;
    }
    const manager = new ExternalServiceManager({ isSandbox: tenant.isSandbox, providerCertifications: state.providerCertifications });
    if (process.env.NODE_ENV === "production" && manager.config.emailProvider !== "real") {
      sendJson(res, 503, { error: { code: "kfs_delivery_provider_unavailable", message: "A production email provider is required before KFS issuance." } });
      return true;
    }
    let delivery;
    try {
      delivery = await manager.sendEmail(
        application.borrower?.contact?.email ?? application.borrower?.email,
        `Key Fact Statement ${kfs.proposalNumber}`,
        `Your Key Fact Statement proposal ${kfs.proposalNumber} is available until ${kfs.validUntil}. Sign in to review and accept it.`
      );
    } catch {
      sendJson(res, 503, { error: { code: "kfs_delivery_failed", message: "The KFS could not be delivered to the verified borrower email." } });
      return true;
    }
    const updated = {
      ...attachKfs(application, kfs),
      kfs: { ...kfs, deliveryChannel: delivery.channel, deliveryRef: delivery.ref, acceptedAt: null, acceptedBy: null }
    };
    const evaluation = evaluateLoanApplication(updated, { modelRegistry: state.modelRegistry });
    const eligibility = await assessEligibilityGated({
      evaluateJs: evaluateEligibility,
      application: updated,
      tenantId: tenant.tenantId,
      stage: "kfs"
    });
    const stored = applyKfsWorkflow({ ...updated, compliance: evaluation, eligibility: eligibility.assessment }, evaluation);
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      { type: "loan.kfs.generated", applicationId: stored.applicationId, kfsId: kfs.kfsId }
    ));
    sendJson(res, 201, stored);
    return true;
  }

  const kfsAcceptMatch = path.match(/^\/loans\/applications\/([^/]+)\/kfs\/accept$/);
  if (method === "POST" && kfsAcceptMatch) {
    if (authContext?.principalType !== "borrower") {
      sendJson(res, 403, { error: { code: "borrower_acceptance_required", message: "Only the authenticated borrower may accept a KFS." } });
      return true;
    }
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, kfsAcceptMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    const result = acceptKfs(application, {
      acceptedBy: authContext.userId,
      acceptanceChannel: "borrower_portal",
      acceptanceEvidenceRef: `session:${authContext.sessionId}:proposal:${application.kfs?.proposalNumber}`,
      understoodLanguage: body.understoodLanguage ?? application.kfs?.language ?? "en",
      languageConfirmationRef: body.languageConfirmationRef ?? application.origination?.languageConfirmationRef ?? null
    });
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "kfs_acceptance_blocked", message: "KFS acceptance is blocked." }, findings: result.findings });
      return true;
    }
    const evaluation = evaluateLoanApplication(result.application, { modelRegistry: state.modelRegistry });
    const eligibility = await assessEligibilityGated({
      evaluateJs: evaluateEligibility,
      application: result.application,
      tenantId: tenant.tenantId,
      stage: "kfs_acceptance"
    });
    const stored = applyKfsWorkflow({ ...result.application, compliance: evaluation, eligibility: eligibility.assessment }, evaluation);
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      { type: "loan.kfs.accepted", applicationId: stored.applicationId, kfsId: stored.kfs.kfsId, proposalNumber: stored.kfs.proposalNumber }
    ));
    sendJson(res, 200, stored);
    return true;
  }

  const decisionMatch = path.match(/^\/loans\/applications\/([^/]+)\/decision$/);
  if (method === "POST" && decisionMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, decisionMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    const resolvedProposer = resolveSessionActorId(authContext, body.proposedBy ?? body.decidedBy);
    body.proposedBy = resolvedProposer;
    body.decidedBy = resolvedProposer;
    if (body.manualUnderwriting?.underwriterId !== undefined) {
      body.manualUnderwriting = {
        ...body.manualUnderwriting,
        underwriterId: resolveSessionActorId(authContext, body.manualUnderwriting.underwriterId)
      };
    }
    const eligibility = await assessEligibilityGated({
      evaluateJs: evaluateEligibility,
      application: { ...application, aiDecision: body.aiDecision ?? application.aiDecision },
      tenantId: tenant.tenantId,
      stage: "decision"
    });
    const decisionApplication = {
      ...application,
      aiDecision: body.aiDecision ?? application.aiDecision,
      eligibility: eligibility.assessment
    };
    const preDecision = evaluateLoanApplication(decisionApplication, { modelRegistry: state.modelRegistry });
    const requiresUnderwriterAccessCheck =
      eligibility.assessment.decision === "refer" &&
      body.status === "approved" &&
      Boolean(body.manualUnderwriting?.underwriterId);
    const accessFindings = [
      ...validateDecisionProposalAccess(state.users, body),
      ...(requiresUnderwriterAccessCheck ? validateManualUnderwritingAccess(state.users, body) : [])
    ];
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, {
        error: { code: "decision_access_blocked", message: "Decision proposal is blocked by actor role policy." },
        findings: accessFindings
      });
      return true;
    }
    const activeTasks = deriveWorkflowTasks(state);
    const kfsCheck = validateKfsBeforeDecision(application);
    const originationCheck = body.status === "approved"
      ? validateOriginationBeforeDecision(decisionApplication)
      : { findings: [] };
    const eligibilityFindings = body.status === "approved" ? eligibility.findings : [];
    const findings = [...preDecision.findings, ...kfsCheck.findings, ...eligibilityFindings, ...originationCheck.findings];
    const proposal = proposeDecision(decisionApplication, body, findings, { modelRegistry: state.modelRegistry, activeTasks });
    if (proposal.summary.status === "blocked" && !proposal.requiresHumanReview) {
      sendJson(res, 422, { error: { code: "decision_blocked", message: "Decision is blocked by compliance findings." }, findings: proposal.findings });
      return true;
    }
    const stored = proposal.application;
    let nextWorkflowTasks = state.workflowTasks;
    const task = activeTasks.find((candidate) =>
      candidate.entity.type === "loan_application" &&
      candidate.entity.id === application.applicationId &&
      candidate.type === "application.manual_underwriting"
    );
    if (task) {
      const completion = completeWorkflowTask(
        state.workflowTasks,
        task.taskId,
        { actor: body.proposedBy || body.decidedBy },
        activeTasks
      );
      if (completion.summary.status !== "blocked") nextWorkflowTasks = completion.workflowTasks;
    }
    await store.save(appendEvent(
      {
        ...state,
        loanApplications: { ...state.loanApplications, [stored.applicationId]: stored },
        workflowTasks: nextWorkflowTasks
      },
      {
        type: proposal.requiresHumanReview ? "loan.human_review.required" : "loan.decision.proposed",
        applicationId: stored.applicationId,
        status: stored.status,
        proposalId: proposal.proposal?.proposalId ?? null
      }
    ));
    sendJson(res, 202, stored);
    return true;
  }

  const reviewMatch = path.match(/^\/loans\/applications\/([^/]+)\/human-reviews$/);
  if (method === "POST" && reviewMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, reviewMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    body.reviewedBy = resolveSessionActorId(authContext, body.reviewedBy);
    const accessFindings = validateHumanReviewAccess(state.users, body);
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, { error: { code: "human_review_access_blocked", message: "Human review is blocked by actor role policy." }, findings: accessFindings });
      return true;
    }
    const result = recordHumanReview(application, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "human_review_blocked", message: "Human review could not be recorded." }, findings: result.findings });
      return true;
    }
    const stored = result.application;
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      { type: "loan.human_review.recorded", applicationId: stored.applicationId, reviewId: result.humanReview.reviewId, outcome: result.humanReview.outcome }
    ));
    sendJson(res, 200, stored);
    return true;
  }

  const approvalMatch = path.match(/^\/loans\/applications\/([^/]+)\/approvals$/);
  if (method === "POST" && approvalMatch) {
    const body = await readJson(req);
    const state = await store.load();
    const application = authorizedApplication(state, approvalMatch[1], authContext);
    if (!application) {
      sendNotFound(res, sendJson);
      return true;
    }
    body.approvedBy = resolveSessionActorId(authContext, body.approvedBy);
    const accessFindings = validateDecisionApprovalAccess(state.users, body);
    if (summarizeFindings(accessFindings).status === "blocked") {
      sendJson(res, 422, { error: { code: "approval_access_blocked", message: "Decision approval is blocked by actor role policy." }, findings: accessFindings });
      return true;
    }
    const result = applyDecisionApproval(application, body);
    if (result.summary.status === "blocked") {
      sendJson(res, 422, { error: { code: "approval_blocked", message: "Decision approval is blocked by workflow findings." }, findings: result.findings });
      return true;
    }
    const stored = attachSanctionValidity(result.application, new Date(result.approval.approvedAt));
    await store.save(appendEvent(
      { ...state, loanApplications: { ...state.loanApplications, [stored.applicationId]: stored } },
      { type: "loan.decision.approval_recorded", applicationId: stored.applicationId, approvalId: result.approval.approvalId, status: stored.status }
    ));
    sendJson(res, 200, stored);
    return true;
  }

  return false;
}

function isUnderwritingPath(path) {
  return /^\/loans\/applications\/[^/]+\/(?:eligibility|kfs(?:\/accept)?|decision|human-reviews|approvals)$/.test(path);
}

function kfsTerms(application) {
  return {
    principalAmount: application.product?.requestedAmount,
    tenorMonths: application.product?.requestedTenorMonths ?? application.product?.defaultTenorMonths,
    annualInterestRateBps: application.product?.annualInterestRateBps,
    charges: application.product?.charges,
    contingentCharges: application.product?.contingentCharges,
    penalCharges: application.product?.penalCharges,
    repaymentFrequency: application.product?.repaymentFrequency,
    coolingOffDays: application.product?.coolingOffDays,
    recoveryMechanism: application.product?.recoveryMechanism,
    grievanceOfficer: application.tenant?.grievanceOfficer,
    privacyPolicyUrl: application.tenant?.privacyPolicyUrl,
    language: application.preferredLanguage ?? application.origination?.preferredLanguage ?? "en",
    languageName: application.origination?.languageName ?? "English"
  };
}

function authorizedApplication(state, encodedApplicationId, authContext) {
  const application = state.loanApplications?.[decodeURIComponent(encodedApplicationId)];
  const borrowerId = application?.borrowerId ?? application?.borrower?.borrowerId ?? null;
  if (authContext?.principalType === "borrower" && borrowerId !== authContext.userId) return null;
  return application ?? null;
}

function isResidencyError(error) {
  return String(error?.message ?? "").toLowerCase().includes("residency");
}

function sendNotFound(res, sendJson) {
  sendJson(res, 404, { error: { code: "not_found", message: "Loan application not found." } });
}
