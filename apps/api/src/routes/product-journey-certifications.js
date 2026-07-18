import { createHash } from "node:crypto";
import {
  PRODUCT_JOURNEY_TYPES,
  assessTenantJourneyActivation,
  certifyProductJourneySupport,
  projectProductJourneySupport,
  registerProductJourneyProductionEvidence,
  resolveProductJourneyProductionEvidence,
  suspendProductJourneySupport
} from "@loanos/core";

const PREFIX = "/admin/product-journey-certifications";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function routeProductJourneyCertifications(context) {
  const { method, path, req, res, tenant, authContext, store, readJson, sendJson, appendEvent, hasTenantAdminRole, authActor } = context;
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  if (authContext?.principalType !== "tenant_user" || !hasTenantAdminRole(authContext, method === "GET" ? ["tenant_admin", "auditor", "compliance_admin", "security_admin"] : ["tenant_admin", "compliance_admin", "security_admin"])) {
    sendJson(res, 403, { error: { code: "product_journey_certification_forbidden", message: "A same-tenant human product-control administrator is required." } }); return true;
  }
  const actor = authActor(authContext);
  try {
    const state = await store.load();
    const proposals = state.productJourneyCertificationProposals ?? {};
    const suspensionProposals = state.productJourneyCertificationSuspensionProposals ?? {};
    const certifications = state.productJourneySupportCertifications ?? {};
    const evidenceProposals = state.productJourneyProductionEvidenceProposals ?? {};
    const evidenceRegistries = state.productJourneyProductionEvidenceRegistries ?? {};
    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, {
        catalogue: PRODUCT_JOURNEY_TYPES,
        support: projectProductJourneySupport(certifications, tenant.tenantId),
        proposals: Object.values(proposals).filter((item) => item.tenantId === tenant.tenantId).map(projectProposal),
        suspensionProposals: Object.values(suspensionProposals).filter((item) => item.tenantId === tenant.tenantId),
        evidenceProposals: Object.values(evidenceProposals).filter((item) => item.tenantId === tenant.tenantId),
        evidenceRegistries: Object.fromEntries(Object.entries(evidenceRegistries).map(([type, registry]) => [type, Object.values(registry).filter((item) => item.tenantId === tenant.tenantId)])),
        certifications: Object.values(certifications).filter((item) => item.tenantId === tenant.tenantId)
      }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/evidence-proposals`) {
      const body = await readJson(req); const proposalId = required(body.proposalId, "proposalId");
      const recordInput = sanitizeEvidenceInput(body, tenant.tenantId);
      registerProductJourneyProductionEvidence({}, { ...recordInput, proposedBy: actor, approvedBy: "validation-only-independent-checker", approvalRef: "validation-only" });
      const immutable = { tenantId: tenant.tenantId, proposalId, recordInput, proposedBy: actor }; const proposalChecksumSha256 = hash(immutable); const key = `${tenant.tenantId}:${proposalId}`; const prior = evidenceProposals[key];
      if (prior) { if (prior.proposalChecksumSha256 !== proposalChecksumSha256) throw coded("journey_production_evidence_proposal_conflict", "proposalId is already bound to different evidence."); sendJson(res, 200, { proposal: prior, idempotent: true }); return true; }
      const proposal = { ...immutable, proposalChecksumSha256, status: "pending", proposedAt: new Date().toISOString() };
      await store.save(appendEvent({ ...state, productJourneyProductionEvidenceProposals: { ...evidenceProposals, [key]: proposal } }, { type: "product_journey.production_evidence_proposed", actor, proposalId, registryType: recordInput.registryType, evidenceId: recordInput.evidenceId, proposalChecksumSha256 }));
      sendJson(res, 201, { proposal, idempotent: false }); return true;
    }
    const evidenceProposalId = match(path, `${PREFIX}/evidence-proposals/`, "/approval");
    if (method === "POST" && evidenceProposalId) {
      const body = await readJson(req); const key = `${tenant.tenantId}:${evidenceProposalId}`; const proposal = evidenceProposals[key];
      if (!proposal || proposal.status !== "pending") throw coded("journey_production_evidence_proposal_missing", "A pending same-tenant evidence proposal is required.");
      if (proposal.proposedBy === actor) throw coded("journey_certification_four_eyes", "The evidence proposer cannot approve it.");
      const result = registerProductJourneyProductionEvidence(evidenceRegistries, { ...proposal.recordInput, proposedBy: proposal.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      const decided = { ...proposal, status: "approved", approvedBy: actor, approvalRef: body.approvalRef, approvedAt: new Date().toISOString(), recordChecksumSha256: result.record.checksumSha256 };
      await store.save(appendEvent({ ...state, productJourneyProductionEvidenceProposals: { ...evidenceProposals, [key]: decided }, productJourneyProductionEvidenceRegistries: result.registries }, { type: "product_journey.production_evidence_approved", actor, proposalId: evidenceProposalId, registryType: result.record.registryType, evidenceId: result.record.evidenceId, recordChecksumSha256: result.record.checksumSha256 }));
      sendJson(res, 200, { proposal: decided, record: result.record }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/proposals`) {
      const body = await readJson(req);
      const proposalId = required(body.proposalId, "proposalId");
      const certificationInput = sanitizeCertificationInput(body, tenant.tenantId);
      if (body.productionEvidence || body.externalDependencies) throw coded("journey_production_request_body_evidence_rejected", "Production evidence and provider dependencies must be resolved from checker-approved registries.");
      const resolved = certificationInput.supportLevel === "production_ready" ? resolveProductJourneyProductionEvidence(evidenceRegistries, certificationInput) : null;
      const validationInput = resolved ? withResolvedProductionEvidence(certificationInput, resolved) : certificationInput;
      certifyProductJourneySupport({}, { ...validationInput, proposedBy: actor, approvedBy: "validation-only-independent-checker", approvalRef: "validation-only" });
      const productionAssessment = resolved?.assessment ?? null;
      const immutable = { tenantId: tenant.tenantId, proposalId, certificationInput, proposedBy: actor, productionAssessmentChecksumSha256: productionAssessment?.evidenceChecksumSha256 ?? null };
      const proposalChecksumSha256 = hash(immutable);
      const prior = proposals[`${tenant.tenantId}:${proposalId}`];
      if (prior) {
        if (prior.proposalChecksumSha256 !== proposalChecksumSha256) throw coded("journey_certification_proposal_conflict", "proposalId is already bound to different content.");
        sendJson(res, 200, { proposal: projectProposal(prior), idempotent: true }); return true;
      }
      const proposal = { ...immutable, proposalChecksumSha256, status: "pending", proposedAt: new Date().toISOString() };
      const nextState = appendEvent({ ...state, productJourneyCertificationProposals: { ...proposals, [`${tenant.tenantId}:${proposalId}`]: proposal } }, { type: "product_journey.certification_proposed", actor, proposalId, journeyType: certificationInput.journeyType, supportLevel: certificationInput.supportLevel, proposalChecksumSha256 });
      await store.save(nextState);
      sendJson(res, 201, { proposal: projectProposal(proposal), idempotent: false }); return true;
    }
    const proposalId = match(path, `${PREFIX}/proposals/`, "/approval");
    if (method === "POST" && proposalId) {
      const body = await readJson(req);
      const key = `${tenant.tenantId}:${proposalId}`;
      const proposal = proposals[key];
      if (!proposal || proposal.status !== "pending") throw coded("journey_certification_proposal_missing", "A pending same-tenant proposal is required.");
      if (proposal.proposedBy === actor) throw coded("journey_certification_four_eyes", "The proposer cannot approve the certification.");
      const resolved = proposal.certificationInput.supportLevel === "production_ready" ? resolveProductJourneyProductionEvidence(evidenceRegistries, proposal.certificationInput) : null;
      if (resolved && resolved.assessment.evidenceChecksumSha256 !== proposal.productionAssessmentChecksumSha256) throw coded("journey_production_evidence_changed", "Trusted production evidence changed after proposal; submit a new certification proposal.");
      const approvalInput = resolved ? withResolvedProductionEvidence(proposal.certificationInput, resolved) : proposal.certificationInput;
      const result = certifyProductJourneySupport(certifications, { ...approvalInput, proposedBy: proposal.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      const decided = { ...proposal, status: "approved", approvedBy: actor, approvalRef: body.approvalRef, approvedAt: new Date().toISOString(), certificationChecksumSha256: result.certification.checksumSha256 };
      const nextState = appendEvent({ ...state, productJourneyCertificationProposals: { ...proposals, [key]: decided }, productJourneySupportCertifications: result.registry }, { type: "product_journey.certification_approved", actor, proposalId, certificationId: result.certification.certificationId, journeyType: result.certification.journeyType, supportLevel: result.certification.supportLevel, certificationChecksumSha256: result.certification.checksumSha256 });
      await store.save(nextState);
      sendJson(res, 200, { proposal: projectProposal(decided), certification: result.certification }); return true;
    }
    const suspensionJourneyType = match(path, `${PREFIX}/certifications/`, "/suspension-proposals");
    if (method === "POST" && suspensionJourneyType) {
      const body = await readJson(req); const proposalId = required(body.proposalId, "proposalId");
      const certification = certifications[`${tenant.tenantId}:${suspensionJourneyType}`];
      if (!certification || certification.status !== "active") throw coded("journey_certification_missing", "An active same-tenant certification is required.");
      const immutable = { tenantId: tenant.tenantId, proposalId, journeyType: suspensionJourneyType, reason: required(body.reason, "reason"), evidenceRef: required(body.evidenceRef, "evidenceRef"), proposedBy: actor, certificationChecksumSha256: certification.checksumSha256 };
      const proposalChecksumSha256 = hash(immutable); const key = `${tenant.tenantId}:${proposalId}`; const prior = suspensionProposals[key];
      if (prior) { if (prior.proposalChecksumSha256 !== proposalChecksumSha256) throw coded("journey_certification_suspension_conflict", "proposalId is already bound to different suspension content."); sendJson(res, 200, { proposal: prior, idempotent: true }); return true; }
      const proposal = { ...immutable, proposalChecksumSha256, status: "pending", proposedAt: new Date().toISOString() };
      await store.save(appendEvent({ ...state, productJourneyCertificationSuspensionProposals: { ...suspensionProposals, [key]: proposal } }, { type: "product_journey.certification_suspension_proposed", actor, proposalId, journeyType: suspensionJourneyType, proposalChecksumSha256 }));
      sendJson(res, 201, { proposal, idempotent: false }); return true;
    }
    const suspensionProposalId = match(path, `${PREFIX}/suspension-proposals/`, "/approval");
    if (method === "POST" && suspensionProposalId) {
      const body = await readJson(req); const key = `${tenant.tenantId}:${suspensionProposalId}`; const proposal = suspensionProposals[key];
      if (!proposal || proposal.status !== "pending") throw coded("journey_certification_suspension_missing", "A pending same-tenant suspension proposal is required.");
      if (proposal.proposedBy === actor) throw coded("journey_certification_four_eyes", "The suspension proposer cannot approve it.");
      const result = suspendProductJourneySupport(certifications, { tenantId: tenant.tenantId, journeyType: proposal.journeyType, reason: proposal.reason, evidenceRef: proposal.evidenceRef, proposedBy: proposal.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      const decided = { ...proposal, status: "approved", approvedBy: actor, approvalRef: body.approvalRef, approvedAt: new Date().toISOString() };
      await store.save(appendEvent({ ...state, productJourneyCertificationSuspensionProposals: { ...suspensionProposals, [key]: decided }, productJourneySupportCertifications: result.registry }, { type: "product_journey.certification_suspended", actor, proposalId: suspensionProposalId, journeyType: proposal.journeyType, reason: proposal.reason }));
      sendJson(res, 200, { proposal: decided, certification: result.certification }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/activation-assessments`) {
      const body = await readJson(req);
      const certification = certifications[`${tenant.tenantId}:${body.journeyType}`];
      const resolved = body.liveMode && certification?.supportLevel === "production_ready" ? resolveProductJourneyProductionEvidence(evidenceRegistries, { tenantId: tenant.tenantId, journeyType: body.journeyType, templateVersion: certification.templateVersion, configurationVersion: certification.configurationVersion, productionRegistryRefs: certification.productionRegistryRefs }) : null;
      const trusted = resolved ? { ...resolved.activationBindings, templateVersion: certification.templateVersion, configurationVersion: certification.configurationVersion, currentProductionEvidence: resolved.productionEvidence, currentExternalDependencies: resolved.externalDependencies, providerReadinessRef: resolved.providerReadinessRef, deploymentReadinessRef: resolved.deploymentReadinessRef, institutionReadinessRef: resolved.institutionReadinessRef } : {};
      const assessment = assessTenantJourneyActivation(certifications, { ...body, ...trusted, tenantId: tenant.tenantId });
      sendJson(res, assessment.status === "ready" ? 200 : 422, { assessment }); return true;
    }
    sendJson(res, 404, { error: { code: "not_found", message: "Product journey certification route not found." } }); return true;
  } catch (error) {
    sendJson(res, error.code?.includes("conflict") ? 409 : 422, { error: { code: error.code ?? "product_journey_certification_invalid", message: error.message } }); return true;
  }
}

function sanitizeCertificationInput(body, tenantId) {
  const { proposedBy: _proposedBy, approvedBy: _approvedBy, approvalRef: _approvalRef, proposalId: _proposalId, productionEvidence: _productionEvidence, externalDependencies: _externalDependencies, ...input } = body;
  return { ...input, tenantId };
}
function sanitizeEvidenceInput(body, tenantId) { const { proposedBy: _proposedBy, approvedBy: _approvedBy, approvalRef: _approvalRef, proposalId: _proposalId, ...input } = body; return { ...input, tenantId }; }
function withResolvedProductionEvidence(input, resolved) { return { ...input, productionEvidence: resolved.productionEvidence, externalDependencies: resolved.externalDependencies, productionRegistryRefs: resolved.productionRegistryRefs, productionReadinessRef: `trusted-registry-assessment/${resolved.assessment.evidenceChecksumSha256}` }; }
function projectProposal({ certificationInput, ...proposal }) { return { ...proposal, journeyType: certificationInput.journeyType, templateVersion: certificationInput.templateVersion, supportLevel: certificationInput.supportLevel, validUntil: certificationInput.validUntil }; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) throw coded("journey_certification_invalid", `${field} is required.`); return value.trim(); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
function match(path, prefix, suffix) { if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null; const value = path.slice(prefix.length, -suffix.length); return value && !value.includes("/") ? decodeURIComponent(value) : null; }
