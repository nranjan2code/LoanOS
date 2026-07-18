import { createHash } from "node:crypto";
import {
  PRODUCT_JOURNEY_TYPES,
  approveProductJourneyProductionArtifact,
  assessTenantJourneyActivation,
  certifyProductJourneySupport,
  projectProductJourneyProductionEvidenceBlockers,
  projectProductJourneySupport,
  registerProductJourneyProductionEvidence,
  resolveProductJourneyProductionArtifacts,
  resolveProductJourneyProductionEvidence,
  suspendProductJourneyProductionArtifact,
  suspendProductJourneySupport,
  validateProductJourneyProductionArtifactInput
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
    const artifactProposals = state.productJourneyProductionArtifactProposals ?? {};
    const artifacts = state.productJourneyProductionArtifacts ?? {};
    const artifactSuspensionProposals = state.productJourneyProductionArtifactSuspensionProposals ?? {};
    if (method === "GET" && path === PREFIX) {
      sendJson(res, 200, {
        catalogue: PRODUCT_JOURNEY_TYPES,
        support: projectProductJourneySupport(certifications, tenant.tenantId),
        proposals: Object.values(proposals).filter((item) => item.tenantId === tenant.tenantId).map(projectProposal),
        suspensionProposals: Object.values(suspensionProposals).filter((item) => item.tenantId === tenant.tenantId),
        evidenceProposals: Object.values(evidenceProposals).filter((item) => item.tenantId === tenant.tenantId),
        evidenceRegistries: Object.fromEntries(Object.entries(evidenceRegistries).map(([type, registry]) => [type, Object.values(registry).filter((item) => item.tenantId === tenant.tenantId)])),
        artifactProposals: Object.values(artifactProposals).filter((item) => item.tenantId === tenant.tenantId),
        artifacts: Object.values(artifacts).filter((item) => item.tenantId === tenant.tenantId),
        artifactSuspensionProposals: Object.values(artifactSuspensionProposals).filter((item) => item.tenantId === tenant.tenantId),
        certifications: Object.values(certifications).filter((item) => item.tenantId === tenant.tenantId)
      }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/artifact-proposals`) {
      const body = await readJson(req);
      rejectRawArtifactContent(body);
      const proposalId = required(body.proposalId, "proposalId");
      const artifactInput = validateProductJourneyProductionArtifactInput(sanitizeArtifactInput(body, tenant.tenantId));
      const immutable = { tenantId: tenant.tenantId, proposalId, artifactInput, proposedBy: actor };
      const proposalChecksumSha256 = hash(immutable); const key = `${tenant.tenantId}:${proposalId}`; const prior = artifactProposals[key];
      if (prior) { if (prior.proposalChecksumSha256 !== proposalChecksumSha256) throw coded("journey_production_artifact_proposal_conflict", "proposalId is already bound to different artifact metadata."); sendJson(res, 200, { proposal: prior, idempotent: true }); return true; }
      const proposal = { ...immutable, proposalChecksumSha256, status: "pending", proposedAt: new Date().toISOString() };
      await store.save(appendEvent({ ...state, productJourneyProductionArtifactProposals: { ...artifactProposals, [key]: proposal } }, { type: "product_journey.production_artifact_proposed", actor, proposalId, artifactId: artifactInput.artifactId, artifactType: artifactInput.artifactType, proposalChecksumSha256 }));
      sendJson(res, 201, { proposal, idempotent: false }); return true;
    }
    const artifactProposalId = match(path, `${PREFIX}/artifact-proposals/`, "/review");
    if (method === "POST" && artifactProposalId) {
      const body = await readJson(req); const key = `${tenant.tenantId}:${artifactProposalId}`; const proposal = artifactProposals[key];
      if (!proposal || proposal.status !== "pending") throw coded("journey_production_artifact_proposal_missing", "A pending same-tenant artifact proposal is required.");
      if (proposal.proposedBy === actor) throw coded("journey_production_artifact_review_independence", "Artifact proposer cannot review the proposal.");
      const outcome = required(body.outcome, "outcome");
      if (!new Set(["accepted", "rejected"]).has(outcome)) throw coded("journey_production_artifact_review_invalid", "Review outcome must be accepted or rejected.");
      if (outcome === "rejected") {
        const decided = { ...proposal, status: "rejected", reviewedBy: actor, reviewEvidenceRef: required(body.reviewEvidenceRef, "reviewEvidenceRef"), rejectionReason: required(body.rejectionReason, "rejectionReason"), reviewedAt: new Date().toISOString() };
        await store.save(appendEvent({ ...state, productJourneyProductionArtifactProposals: { ...artifactProposals, [key]: decided } }, { type: "product_journey.production_artifact_rejected", actor, proposalId: artifactProposalId, artifactId: proposal.artifactInput.artifactId, rejectionReason: decided.rejectionReason }));
        sendJson(res, 200, { proposal: decided }); return true;
      }
      const result = approveProductJourneyProductionArtifact(artifacts, { artifact: proposal.artifactInput, proposedBy: proposal.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef"), reviewEvidenceRef: required(body.reviewEvidenceRef, "reviewEvidenceRef"), reviewChecklist: body.reviewChecklist });
      const decided = { ...proposal, status: "approved", reviewedBy: actor, approvalRef: body.approvalRef, reviewEvidenceRef: body.reviewEvidenceRef, reviewedAt: new Date().toISOString(), artifactChecksumSha256: result.artifact.artifactChecksumSha256 };
      await store.save(appendEvent({ ...state, productJourneyProductionArtifactProposals: { ...artifactProposals, [key]: decided }, productJourneyProductionArtifacts: result.registry }, { type: "product_journey.production_artifact_approved", actor, proposalId: artifactProposalId, artifactId: result.artifact.artifactId, artifactChecksumSha256: result.artifact.artifactChecksumSha256 }));
      sendJson(res, 200, { proposal: decided, artifact: result.artifact }); return true;
    }
    const artifactIdForSuspension = match(path, `${PREFIX}/artifacts/`, "/suspension-proposals");
    if (method === "POST" && artifactIdForSuspension) {
      const body = await readJson(req); const artifact = artifacts[artifactIdForSuspension];
      if (!artifact || artifact.tenantId !== tenant.tenantId || artifact.status !== "active") throw coded("journey_production_artifact_missing", "An active same-tenant artifact is required.");
      const proposalId = required(body.proposalId, "proposalId"); const immutable = { tenantId: tenant.tenantId, proposalId, artifactId: artifactIdForSuspension, reason: required(body.reason, "reason"), incidentRef: required(body.incidentRef, "incidentRef"), proposedBy: actor, artifactChecksumSha256: artifact.artifactChecksumSha256 };
      const proposalChecksumSha256 = hash(immutable); const key = `${tenant.tenantId}:${proposalId}`; const prior = artifactSuspensionProposals[key];
      if (prior) { if (prior.proposalChecksumSha256 !== proposalChecksumSha256) throw coded("journey_production_artifact_suspension_conflict", "proposalId is already bound to different suspension metadata."); sendJson(res, 200, { proposal: prior, idempotent: true }); return true; }
      const proposal = { ...immutable, proposalChecksumSha256, status: "pending", proposedAt: new Date().toISOString() };
      await store.save(appendEvent({ ...state, productJourneyProductionArtifactSuspensionProposals: { ...artifactSuspensionProposals, [key]: proposal } }, { type: "product_journey.production_artifact_suspension_proposed", actor, proposalId, artifactId: artifactIdForSuspension, proposalChecksumSha256 }));
      sendJson(res, 201, { proposal, idempotent: false }); return true;
    }
    const artifactSuspensionProposalId = match(path, `${PREFIX}/artifact-suspension-proposals/`, "/approval");
    if (method === "POST" && artifactSuspensionProposalId) {
      const body = await readJson(req); const key = `${tenant.tenantId}:${artifactSuspensionProposalId}`; const proposal = artifactSuspensionProposals[key];
      if (!proposal || proposal.status !== "pending") throw coded("journey_production_artifact_suspension_missing", "A pending same-tenant artifact suspension proposal is required.");
      if (proposal.proposedBy === actor) throw coded("journey_production_artifact_suspension_four_eyes", "Artifact suspension proposer cannot approve it.");
      const current = artifacts[proposal.artifactId];
      if (!current || current.artifactChecksumSha256 !== proposal.artifactChecksumSha256) throw coded("journey_production_artifact_not_current", "Artifact changed after suspension proposal.");
      const result = suspendProductJourneyProductionArtifact(artifacts, { artifactId: proposal.artifactId, reason: proposal.reason, incidentRef: proposal.incidentRef, proposedBy: proposal.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      const decided = { ...proposal, status: "approved", approvedBy: actor, approvalRef: body.approvalRef, approvedAt: new Date().toISOString() };
      await store.save(appendEvent({ ...state, productJourneyProductionArtifactSuspensionProposals: { ...artifactSuspensionProposals, [key]: decided }, productJourneyProductionArtifacts: result.registry }, { type: "product_journey.production_artifact_suspended", actor, proposalId: artifactSuspensionProposalId, artifactId: proposal.artifactId, incidentRef: proposal.incidentRef }));
      sendJson(res, 200, { proposal: decided, artifact: result.artifact }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/evidence-blockers`) {
      const body = await readJson(req);
      const blockers = projectProductJourneyProductionEvidenceBlockers(artifacts, evidenceRegistries, { ...body, tenantId: tenant.tenantId });
      sendJson(res, blockers.status === "ready_for_certification_proposal" ? 200 : 422, { blockers }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/evidence-proposals`) {
      const body = await readJson(req); const proposalId = required(body.proposalId, "proposalId");
      if (body.evidence || body.externalDependencies || body.productionEvidence || body.rawEvidence) throw coded("journey_production_request_body_evidence_rejected", "Raw evidence claims are forbidden; reference independently reviewed artifact records.");
      const requested = sanitizeEvidenceInput(body, tenant.tenantId);
      const resolvedArtifacts = resolveProductJourneyProductionArtifacts(artifacts, requested);
      const recordInput = { ...requested, ...resolvedArtifacts };
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
      const currentArtifacts = resolveProductJourneyProductionArtifacts(artifacts, proposal.recordInput);
      const currentRecordInput = { ...proposal.recordInput, ...currentArtifacts };
      if (hash(currentRecordInput) !== hash(proposal.recordInput)) throw coded("journey_production_artifact_not_current", "Source artifacts changed after evidence proposal.");
      const result = registerProductJourneyProductionEvidence(evidenceRegistries, { ...currentRecordInput, proposedBy: proposal.proposedBy, approvedBy: actor, approvalRef: required(body.approvalRef, "approvalRef") });
      const decided = { ...proposal, status: "approved", approvedBy: actor, approvalRef: body.approvalRef, approvedAt: new Date().toISOString(), recordChecksumSha256: result.record.checksumSha256 };
      await store.save(appendEvent({ ...state, productJourneyProductionEvidenceProposals: { ...evidenceProposals, [key]: decided }, productJourneyProductionEvidenceRegistries: result.registries }, { type: "product_journey.production_evidence_approved", actor, proposalId: evidenceProposalId, registryType: result.record.registryType, evidenceId: result.record.evidenceId, recordChecksumSha256: result.record.checksumSha256 }));
      sendJson(res, 200, { proposal: decided, record: result.record }); return true;
    }
    if (method === "POST" && path === `${PREFIX}/proposals`) {
      const body = await readJson(req);
      const proposalId = required(body.proposalId, "proposalId");
      const certificationInput = sanitizeCertificationInput(body, tenant.tenantId);
      if (body.productionEvidence || body.externalDependencies) throw coded("journey_production_request_body_evidence_rejected", "Production evidence and provider dependencies must be resolved from checker-approved registries.");
      const resolved = certificationInput.supportLevel === "production_ready" ? resolveProductJourneyProductionEvidence(evidenceRegistries, { ...certificationInput, productionArtifacts: artifacts }) : null;
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
      const resolved = proposal.certificationInput.supportLevel === "production_ready" ? resolveProductJourneyProductionEvidence(evidenceRegistries, { ...proposal.certificationInput, productionArtifacts: artifacts }) : null;
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
      const resolved = body.liveMode && certification?.supportLevel === "production_ready" ? resolveProductJourneyProductionEvidence(evidenceRegistries, { tenantId: tenant.tenantId, journeyType: body.journeyType, templateVersion: certification.templateVersion, configurationVersion: certification.configurationVersion, productionRegistryRefs: certification.productionRegistryRefs, productionArtifacts: artifacts }) : null;
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
function sanitizeEvidenceInput(body, tenantId) { return { tenantId, registryType: body.registryType, evidenceId: body.evidenceId, journeyType: body.journeyType, templateVersion: body.templateVersion, configurationVersion: body.configurationVersion, artifactRefs: body.artifactRefs, activationBindings: body.activationBindings, validUntil: body.validUntil }; }
function sanitizeArtifactInput(body, tenantId) { const { proposedBy: _proposedBy, approvedBy: _approvedBy, approvalRef: _approvalRef, proposalId: _proposalId, outcome: _outcome, reviewChecklist: _reviewChecklist, reviewEvidenceRef: _reviewEvidenceRef, ...input } = body; return { ...input, tenantId }; }
function rejectRawArtifactContent(body) { for (const field of ["content", "payload", "rawEvidence", "artifactPayload", "productionEvidence"]) if (body[field] !== undefined) throw coded("journey_production_artifact_payload_rejected", "Artifact payloads are not accepted; register external metadata and checksum only."); }
function withResolvedProductionEvidence(input, resolved) { return { ...input, productionEvidence: resolved.productionEvidence, externalDependencies: resolved.externalDependencies, productionRegistryRefs: resolved.productionRegistryRefs, productionReadinessRef: `trusted-registry-assessment/${resolved.assessment.evidenceChecksumSha256}` }; }
function projectProposal({ certificationInput, ...proposal }) { return { ...proposal, journeyType: certificationInput.journeyType, templateVersion: certificationInput.templateVersion, supportLevel: certificationInput.supportLevel, validUntil: certificationInput.validUntil }; }
function required(value, field) { if (typeof value !== "string" || !value.trim()) throw coded("journey_certification_invalid", `${field} is required.`); return value.trim(); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
function match(path, prefix, suffix) { if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null; const value = path.slice(prefix.length, -suffix.length); return value && !value.includes("/") ? decodeURIComponent(value) : null; }
