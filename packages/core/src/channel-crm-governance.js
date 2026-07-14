const PARTNER_TYPES = new Set(["dsa", "branch", "field_agency", "merchant", "fintech"]);
const CREDENTIAL_TYPES = new Set(["portal", "api", "field_pwa"]);
const CONDUCT_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

export function createPartnerOnboarding(input = {}, existing = [], now = new Date()) {
  identity(input); text(input.partnerId, "partnerId");
  if (existing.some((item) => item.tenantId === input.tenantId && item.partnerId === input.partnerId)) fail("partner_duplicate", "partnerId already exists in this tenant.");
  if (!PARTNER_TYPES.has(input.partnerType)) fail("partner_invalid", "partnerType is invalid.");
  for (const field of ["legalName", "agreementRef", "dueDiligenceRef", "conductPolicyRef", "trainingEvidenceRef", "submittedBy"]) text(input[field], field);
  const territoryIds = strings(input.territoryIds, "territoryIds", true);
  return { tenantId: input.tenantId, partnerId: input.partnerId, partnerType: input.partnerType, legalName: input.legalName, territoryIds, agreementRef: input.agreementRef, dueDiligenceRef: input.dueDiligenceRef, conductPolicyRef: input.conductPolicyRef, trainingEvidenceRef: input.trainingEvidenceRef, submittedBy: input.submittedBy, status: "pending_approval", submittedAt: now.toISOString() };
}

export function approvePartnerOnboarding(partner, input = {}, now = new Date()) {
  sameTenant(partner, input); if (partner.status !== "pending_approval") fail("partner_transition_invalid", "Only pending onboarding can be approved.");
  text(input.approvedBy, "approvedBy"); text(input.approvalRef, "approvalRef");
  if (input.approvedBy === partner.submittedBy) fail("channel_four_eyes_required", "Onboarding requires independent approval.");
  return { ...partner, status: "active", approvedBy: input.approvedBy, approvalRef: input.approvalRef, approvedAt: now.toISOString() };
}

export function issuePartnerCredential(partner, input = {}, existing = [], now = new Date()) {
  sameTenant(partner, input); if (partner.status !== "active") fail("partner_inactive", "Credentials require an active partner.");
  for (const field of ["credentialId", "principalId", "proposedBy", "approvedBy", "approvalRef", "provisioningEvidenceRef"]) text(input[field], field);
  if (!CREDENTIAL_TYPES.has(input.credentialType)) fail("credential_invalid", "credentialType is invalid.");
  if (input.proposedBy === input.approvedBy) fail("channel_four_eyes_required", "Credential issuance requires independent approval.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.credentialId === input.credentialId)) fail("credential_duplicate", "credentialId already exists in this tenant.");
  const expiresAt = future(input.expiresAt, now, "expiresAt");
  const scopes = strings(input.scopes, "scopes", true);
  return { tenantId: input.tenantId, credentialId: input.credentialId, partnerId: partner.partnerId, principalId: input.principalId, credentialType: input.credentialType, scopes, status: "active", expiresAt, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, provisioningEvidenceRef: input.provisioningEvidenceRef, issuedAt: now.toISOString() };
}

export function revokePartnerCredential(credential, input = {}, now = new Date()) {
  sameTenant(credential, input); if (credential.status !== "active") fail("credential_transition_invalid", "Only active credentials can be revoked.");
  for (const field of ["revokedBy", "approvedBy", "approvalRef", "reason", "revocationEvidenceRef"]) text(input[field], field);
  if (input.revokedBy === input.approvedBy) fail("channel_four_eyes_required", "Credential revocation requires independent approval.");
  return { ...credential, status: "revoked", revokedBy: input.revokedBy, revocationApprovedBy: input.approvedBy, revocationApprovalRef: input.approvalRef, revocationReason: input.reason, revocationEvidenceRef: input.revocationEvidenceRef, revokedAt: now.toISOString() };
}

export function createFieldHierarchy(input = {}, existing = [], now = new Date()) {
  identity(input); for (const field of ["unitId", "name", "unitType", "proposedBy", "approvedBy", "approvalRef"]) text(input[field], field);
  if (input.proposedBy === input.approvedBy) fail("channel_four_eyes_required", "Hierarchy changes require independent approval.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.unitId === input.unitId)) fail("field_unit_duplicate", "unitId already exists in this tenant.");
  const parent = input.parentUnitId == null ? null : existing.find((item) => item.tenantId === input.tenantId && item.unitId === input.parentUnitId);
  if (input.parentUnitId && !parent) fail("field_parent_missing", "Parent unit must exist in the same tenant.");
  return { tenantId: input.tenantId, unitId: input.unitId, name: input.name, unitType: input.unitType, parentUnitId: parent?.unitId ?? null, territoryIds: strings(input.territoryIds, "territoryIds", true), capacity: positive(input.capacity, "capacity"), proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", approvedAt: now.toISOString() };
}

export function allocateTerritoryCapacity(units = [], input = {}, existing = [], now = new Date()) {
  identity(input); for (const field of ["allocationId", "unitId", "assigneeId", "territoryId", "proposedBy", "approvedBy", "approvalRef"]) text(input[field], field);
  if (input.proposedBy === input.approvedBy) fail("channel_four_eyes_required", "Capacity allocation requires independent approval.");
  const unit = units.find((item) => item.tenantId === input.tenantId && item.unitId === input.unitId && item.status === "active");
  if (!unit || !unit.territoryIds.includes(input.territoryId)) fail("territory_not_authorised", "An active tenant-local unit covering the territory is required.");
  const workload = positive(input.workload, "workload");
  const used = existing.filter((item) => item.tenantId === input.tenantId && item.unitId === input.unitId && item.status === "active").reduce((sum, item) => sum + item.workload, 0);
  if (used + workload > unit.capacity) fail("capacity_exceeded", "Allocation exceeds approved unit capacity.");
  return { tenantId: input.tenantId, allocationId: input.allocationId, unitId: unit.unitId, assigneeId: input.assigneeId, territoryId: input.territoryId, workload, proposedBy: input.proposedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, status: "active", allocatedAt: now.toISOString() };
}

export function certifyPartnerAccess(partner, credentials = [], input = {}, now = new Date()) {
  sameTenant(partner, input); for (const field of ["certificationId", "certifiedBy", "approvedBy", "approvalRef", "evidenceRef"]) text(input[field], field);
  if (input.certifiedBy === input.approvedBy) fail("channel_four_eyes_required", "Access certification requires independent approval.");
  const reviewedIds = strings(input.credentialIds, "credentialIds", true);
  const reviewed = reviewedIds.map((id) => credentials.find((item) => item.tenantId === input.tenantId && item.partnerId === partner.partnerId && item.credentialId === id));
  if (reviewed.some((item) => !item)) fail("access_credential_missing", "Every credential must belong to the partner and tenant.");
  const unreviewedActive = credentials.filter((item) => item.tenantId === input.tenantId && item.partnerId === partner.partnerId && item.status === "active" && !reviewedIds.includes(item.credentialId));
  const exceptions = reviewed.filter((item) => item.status !== "active" || Date.parse(item.expiresAt) <= now.getTime()).map((item) => item.credentialId);
  if (unreviewedActive.length || exceptions.length) fail("access_certification_blocked", "All active access must be reviewed and current.");
  return { tenantId: input.tenantId, certificationId: input.certificationId, partnerId: partner.partnerId, credentialIds: reviewedIds, status: "certified", nextReviewAt: future(input.nextReviewAt, now, "nextReviewAt"), certifiedBy: input.certifiedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, evidenceRef: input.evidenceRef, certifiedAt: now.toISOString() };
}

export function openPartnerConductCase(partner, input = {}, existing = [], now = new Date()) {
  sameTenant(partner, input); for (const field of ["caseId", "allegation", "sourceRef", "openedBy", "owner"]) text(input[field], field);
  if (!CONDUCT_SEVERITIES.has(input.severity)) fail("conduct_case_invalid", "severity is invalid.");
  if (existing.some((item) => item.tenantId === input.tenantId && item.caseId === input.caseId)) fail("conduct_case_duplicate", "caseId already exists in this tenant.");
  return { tenantId: input.tenantId, caseId: input.caseId, partnerId: partner.partnerId, allegation: input.allegation, severity: input.severity, sourceRef: input.sourceRef, openedBy: input.openedBy, owner: input.owner, status: "investigating", openedAt: now.toISOString() };
}

export function closePartnerConductCase(conductCase, input = {}, now = new Date()) {
  sameTenant(conductCase, input); if (conductCase.status !== "investigating") fail("conduct_case_transition_invalid", "Only investigating cases can be closed.");
  for (const field of ["finding", "investigatedBy", "approvedBy", "approvalRef", "evidenceRef"]) text(input[field], field);
  if (!["substantiated", "unsubstantiated"].includes(input.finding)) fail("conduct_case_invalid", "finding is invalid.");
  if (input.investigatedBy === input.approvedBy) fail("channel_four_eyes_required", "Conduct findings require independent approval.");
  const actions = strings(input.actions, "actions", input.finding === "substantiated");
  return { ...conductCase, status: "closed", finding: input.finding, actions, partnerAccessRecommendation: input.finding === "substantiated" ? "suspend" : "retain", investigatedBy: input.investigatedBy, approvedBy: input.approvedBy, approvalRef: input.approvalRef, evidenceRef: input.evidenceRef, closedAt: now.toISOString() };
}

function identity(input) { text(input.tenantId, "tenantId"); }
function sameTenant(record, input) { identity(input); if (!record || record.tenantId !== input.tenantId) fail("channel_tenant_mismatch", "Record must belong to the requested tenant."); }
function text(value, field) { if (typeof value !== "string" || !value.trim()) fail("channel_governance_invalid", `${field} is required.`); }
function strings(value, field, required = false) { if (!Array.isArray(value)) fail("channel_governance_invalid", `${field} must be an array.`); const result = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]; if (required && !result.length) fail("channel_governance_invalid", `${field} requires at least one value.`); return result; }
function positive(value, field) { if (!Number.isInteger(value) || value <= 0) fail("channel_governance_invalid", `${field} must be a positive integer.`); return value; }
function future(value, now, field) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now.getTime()) fail("channel_governance_invalid", `${field} must be a future ISO date-time.`); return new Date(value).toISOString(); }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export { CONDUCT_SEVERITIES, CREDENTIAL_TYPES, PARTNER_TYPES };
