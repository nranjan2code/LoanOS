import {
  assessDataQuality,
  certifyDataQuality,
  createAuditAnchor,
  createDataQualityRule,
  createEvidenceCustodyRecord,
  deleteEvidenceWithProof,
  placeEvidenceLegalHold,
  releaseEvidenceLegalHold,
  reconcileBusinessEventCompleteness,
  registerDataLineage
} from "@loanos/core";

export async function routeDataGovernanceControls(context) {
  const { method, path, req, res, tenant, store, readJson, sendJson, appendEvent } = context;

  if (method === "GET" && path === "/governance/audit-anchors") {
    const state = await store.load(); sendJson(res, 200, { anchors: Object.values(state.auditAnchors ?? {}) }); return true;
  }
  if (method === "POST" && path === "/governance/audit-anchors") {
    const body = await readJson(req); const state = await store.load();
    const result = createAuditAnchor(state.events, tenant.tenantId, state.auditAnchors, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "audit_anchor_blocked", message: "Audit anchoring failed closed." }, findings: result.findings, integrity: result.integrity }); return true; }
    await store.save(appendEvent({ ...state, auditAnchors: result.registry }, { type: "governance.audit.anchor_recorded", anchorId: result.anchor.anchorId, headHash: result.anchor.headHash, eventCount: result.anchor.eventCount, providerRef: result.anchor.providerRef, actor: result.anchor.approvedBy }));
    sendJson(res, 201, result.anchor); return true;
  }
  if (method === "POST" && path === "/governance/audit-completeness") {
    const body = await readJson(req); const state = await store.load();
    const result = reconcileBusinessEventCompleteness(state, { ...body, tenantId: tenant.tenantId });
    if (!body.reconciliationId || state.auditCompletenessReconciliations?.[body.reconciliationId] || !body.proposedBy || !body.approvedBy || body.proposedBy === body.approvedBy || !body.approvalRef) { sendJson(res, 422, { error: { code: "audit_completeness_request_blocked", message: "Unique reconciliation id and independent approval are required." }, findings: result.findings }); return true; }
    const registry = { ...(state.auditCompletenessReconciliations ?? {}), [result.reconciliation.reconciliationId]: result.reconciliation };
    await store.save(appendEvent({ ...state, auditCompletenessReconciliations: registry }, { type: "governance.audit.completeness_reconciled", reconciliationId: result.reconciliation.reconciliationId, status: result.reconciliation.status, exceptionCount: result.reconciliation.exceptionCount, actor: result.reconciliation.approvedBy }));
    sendJson(res, result.summary.status === "blocked" ? 422 : 201, { reconciliation: result.reconciliation, findings: result.findings }); return true;
  }

  if (method === "GET" && path === "/governance/evidence") { const state = await store.load(); sendJson(res, 200, { evidence: Object.values(state.evidenceCustody ?? {}) }); return true; }
  if (method === "POST" && path === "/governance/evidence") {
    const body = await readJson(req); const state = await store.load(); const result = createEvidenceCustodyRecord(state.evidenceCustody, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "evidence_admission_blocked", message: "Evidence admission failed closed." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, evidenceCustody: result.registry }, { type: "governance.evidence.admitted", evidenceId: result.evidence.evidenceId, sourceType: result.evidence.sourceType, sourceId: result.evidence.sourceId, custodyHash: result.evidence.custodyHash, actor: result.evidence.approvedBy })); sendJson(res, 201, result.evidence); return true;
  }
  const evidenceAction = path.match(/^\/governance\/evidence\/([^/]+)\/(legal-holds|deletion)$/);
  if (method === "POST" && evidenceAction) {
    const body = await readJson(req); const state = await store.load(); const evidenceId = decodeURIComponent(evidenceAction[1]);
    const result = evidenceAction[2] === "legal-holds" ? placeEvidenceLegalHold(state.evidenceCustody, evidenceId, body) : deleteEvidenceWithProof(state.evidenceCustody, evidenceId, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: `evidence_${evidenceAction[2] === "legal-holds" ? "hold" : "deletion"}_blocked`, message: "Evidence custody transition failed closed." }, findings: result.findings }); return true; }
    const event = evidenceAction[2] === "legal-holds" ? { type: "governance.evidence.legal_hold_placed", holdId: result.hold.holdId } : { type: "governance.evidence.deleted", deletionRef: result.evidence.deletionProof.deletionRef, proofChecksumSha256: result.evidence.deletionProof.proofChecksumSha256 };
    await store.save(appendEvent({ ...state, evidenceCustody: result.registry }, { ...event, evidenceId, actor: body.approvedBy })); sendJson(res, 200, result.evidence); return true;
  }
  const legalHoldRelease = path.match(/^\/governance\/evidence\/([^/]+)\/legal-holds\/([^/]+)\/release$/);
  if (method === "POST" && legalHoldRelease) {
    const body = await readJson(req); const state = await store.load(); const evidenceId = decodeURIComponent(legalHoldRelease[1]); const holdId = decodeURIComponent(legalHoldRelease[2]);
    const result = releaseEvidenceLegalHold(state.evidenceCustody, evidenceId, holdId, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "evidence_hold_release_blocked", message: "Legal-hold release failed closed." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, evidenceCustody: result.registry }, { type: "governance.evidence.legal_hold_released", evidenceId, holdId, authorityRef: result.hold.releaseAuthorityRef, actor: result.hold.releaseApprovedBy })); sendJson(res, 200, result.evidence); return true;
  }

  if (method === "GET" && path === "/governance/lineage") { const state = await store.load(); sendJson(res, 200, { lineage: Object.values(state.dataLineage ?? {}) }); return true; }
  if (method === "POST" && path === "/governance/lineage") {
    const body = await readJson(req); const state = await store.load(); const result = registerDataLineage(state.dataLineage, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "data_lineage_blocked", message: "Data-lineage registration failed closed." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, dataLineage: result.registry }, { type: "governance.data_lineage.registered", lineageId: result.lineage.lineageId, output: result.lineage.output, lineageChecksumSha256: result.lineage.lineageChecksumSha256, actor: result.lineage.approvedBy })); sendJson(res, 201, result.lineage); return true;
  }

  if (method === "GET" && path === "/governance/data-quality/rules") { const state = await store.load(); sendJson(res, 200, { rules: Object.values(state.dataQualityRules ?? {}) }); return true; }
  if (method === "POST" && path === "/governance/data-quality/rules") {
    const body = await readJson(req); const state = await store.load(); const result = createDataQualityRule(state.dataQualityRules, body);
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "data_quality_rule_blocked", message: "Data-quality rule creation failed closed." }, findings: result.findings }); return true; }
    await store.save(appendEvent({ ...state, dataQualityRules: result.registry }, { type: "governance.data_quality.rule_created", ruleId: result.rule.ruleId, collection: result.rule.collection, field: result.rule.field, actor: result.rule.approvedBy })); sendJson(res, 201, result.rule); return true;
  }
  if (method === "POST" && path === "/governance/data-quality/assessments") {
    const body = await readJson(req); const state = await store.load(); const result = assessDataQuality(state, state.dataQualityRules, body);
    if (body.assessmentId && state.dataQualityAssessments?.[body.assessmentId]) { sendJson(res, 409, { error: { code: "data_quality_assessment_duplicate", message: "assessmentId already exists." } }); return true; }
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "data_quality_assessment_blocked", message: "Data-quality assessment failed closed." }, findings: result.findings }); return true; }
    const assessments = { ...(state.dataQualityAssessments ?? {}), [result.assessment.assessmentId]: result.assessment };
    await store.save(appendEvent({ ...state, dataQualityAssessments: assessments }, { type: "governance.data_quality.assessed", assessmentId: result.assessment.assessmentId, status: result.assessment.status, failureCount: result.assessment.failureCount, actor: result.assessment.assessedBy })); sendJson(res, 201, result.assessment); return true;
  }
  const certificationMatch = path.match(/^\/governance\/data-quality\/assessments\/([^/]+)\/certification$/);
  if (method === "POST" && certificationMatch) {
    const body = await readJson(req); const state = await store.load(); const assessment = state.dataQualityAssessments?.[decodeURIComponent(certificationMatch[1])]; const result = certifyDataQuality(assessment, body);
    if (body.certificationId && state.dataQualityCertifications?.[body.certificationId]) { sendJson(res, 409, { error: { code: "data_quality_certification_duplicate", message: "certificationId already exists." } }); return true; }
    if (result.summary.status === "blocked") { sendJson(res, 422, { error: { code: "data_quality_certification_blocked", message: "Data-quality certification failed closed." }, findings: result.findings }); return true; }
    const certifications = { ...(state.dataQualityCertifications ?? {}), [result.certification.certificationId]: result.certification };
    await store.save(appendEvent({ ...state, dataQualityCertifications: certifications }, { type: "governance.data_quality.certified", certificationId: result.certification.certificationId, assessmentId: result.certification.assessmentId, status: result.certification.status, actor: result.certification.approvedBy })); sendJson(res, 201, result.certification); return true;
  }
  return false;
}
