import { createHash } from "node:crypto";

const INDIA_REGIONS = /^(ap-south-[12]|asia-south[12]|centralindia|southindia|westindia|in-[a-z0-9-]+)$/i;
const KEY_PURPOSES = new Set(["tenant_data", "database", "backup", "audit", "signing"]);
const LOG_SOURCES = new Set(["identity", "application", "audit", "database", "cloud", "network", "endpoint", "provider", "decision_engine"]);

export function registerManagedKeyAttestation(input = {}, existing = [], now = new Date()) {
  unique(input.attestationId, existing, "attestationId");
  for (const field of ["keyId", "provider", "keyRef", "region", "algorithm", "evidenceRef", "proposedBy", "approvedBy", "approvalRef"]) requireText(input[field], field);
  if (!KEY_PURPOSES.has(input.purpose)) fail("managed_key_invalid", "purpose is invalid.");
  if (!INDIA_REGIONS.test(input.region)) fail("managed_key_residency_invalid", "Managed key must be hosted in an India region.");
  if (input.nonExportable !== true || input.hsmBacked !== true || input.dualControl !== true) fail("managed_key_invalid", "Key must be non-exportable, HSM-backed, and dual controlled.");
  if (!Number.isInteger(input.rotationDays) || input.rotationDays < 30 || input.rotationDays > 365) fail("managed_key_invalid", "rotationDays must be between 30 and 365.");
  fourEyes(input);
  return { attestationId: String(input.attestationId), keyId: String(input.keyId), provider: String(input.provider), keyRef: String(input.keyRef), purpose: input.purpose, region: String(input.region), algorithm: String(input.algorithm), nonExportable: true, hsmBacked: true, dualControl: true, rotationDays: input.rotationDays, destructionPolicyRef: requiredString(input.destructionPolicyRef, "destructionPolicyRef"), evidenceRef: String(input.evidenceRef), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "attested", attestedAt: now.toISOString() };
}

export function registerSecurityLogCustody(input = {}, existing = [], now = new Date()) {
  unique(input.custodyId, existing, "custodyId"); fourEyes(input);
  for (const field of ["provider", "storageRef", "collectorIdentityRef", "schemaRegistryRef", "timeSourceRef", "evidenceRef"]) requireText(input[field], field);
  const sources = stringList(input.sources, "sources", true);
  if (sources.some((source) => !LOG_SOURCES.has(source))) fail("log_custody_invalid", "sources contains an unsupported security-log family.");
  if (input.storageCountry !== "IN" || input.immutable !== true || input.searchable !== true) fail("log_custody_invalid", "Logs require searchable immutable India custody.");
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 180) fail("log_custody_invalid", "Log retention must be at least 180 days.");
  if (input.authenticatedCollectors !== true || input.trustedTime !== true || input.encrypted !== true) fail("log_custody_invalid", "Authenticated collection, trusted time, and encryption are mandatory.");
  return { custodyId: String(input.custodyId), provider: String(input.provider), storageRef: String(input.storageRef), storageCountry: "IN", sources, retentionDays: input.retentionDays, immutable: true, searchable: true, encrypted: true, authenticatedCollectors: true, collectorIdentityRef: String(input.collectorIdentityRef), schemaRegistryRef: String(input.schemaRegistryRef), trustedTime: true, timeSourceRef: String(input.timeSourceRef), evidenceRef: String(input.evidenceRef), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "ready", approvedAt: now.toISOString() };
}

export function registerDatabaseTopology(input = {}, existing = [], keyAttestations = [], now = new Date()) {
  unique(input.topologyId, existing, "topologyId"); fourEyes(input);
  if (input.engine !== "postgresql") fail("database_topology_invalid", "Only PostgreSQL topology is supported.");
  const nodes = array(input.nodes, "nodes", true).map((node) => ({ nodeId: requiredString(node.nodeId, "nodeId"), role: oneOf(node.role, ["primary", "synchronous_standby", "read_replica"], "role"), region: requiredString(node.region, "region"), availabilityZone: requiredString(node.availabilityZone, "availabilityZone") }));
  if (nodes.filter((node) => node.role === "primary").length !== 1 || !nodes.some((node) => node.role === "synchronous_standby")) fail("database_topology_invalid", "Exactly one primary and at least one synchronous standby are required.");
  if (nodes.some((node) => !INDIA_REGIONS.test(node.region))) fail("database_topology_residency_invalid", "All database nodes must be in India regions.");
  if (new Set(nodes.map((node) => node.availabilityZone)).size < 2) fail("database_topology_invalid", "Database nodes must span at least two availability zones.");
  if (input.encrypted !== true || input.rlsEnforced !== true || input.connectionPooler !== true || input.automaticFailover !== true) fail("database_topology_invalid", "Encryption, RLS, pooling, and automatic failover are mandatory.");
  if (!keyAttestations.some((item) => item.attestationId === input.keyAttestationId && item.purpose === "database" && item.status === "attested")) fail("database_key_attestation_missing", "An attested database key is required.");
  return { topologyId: String(input.topologyId), engine: "postgresql", nodes, encrypted: true, keyAttestationId: requiredString(input.keyAttestationId, "keyAttestationId"), rlsEnforced: true, connectionPooler: true, automaticFailover: true, failoverRunbookRef: requiredString(input.failoverRunbookRef, "failoverRunbookRef"), monitoringRef: requiredString(input.monitoringRef, "monitoringRef"), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "ready", approvedAt: now.toISOString() };
}

export function registerPitrPolicy(input = {}, existing = [], topologies = [], keyAttestations = [], now = new Date()) {
  unique(input.policyId, existing, "policyId"); fourEyes(input);
  if (!topologies.some((item) => item.topologyId === input.topologyId && item.status === "ready")) fail("pitr_topology_missing", "A ready database topology is required.");
  if (!keyAttestations.some((item) => item.attestationId === input.keyAttestationId && item.purpose === "backup" && item.status === "attested")) fail("pitr_key_attestation_missing", "An attested backup key is required.");
  if (input.continuousWal !== true || input.immutableBackups !== true || input.crossAccountCustody !== true) fail("pitr_policy_invalid", "Continuous WAL and immutable cross-account backups are mandatory.");
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 35) fail("pitr_policy_invalid", "PITR retention must be at least 35 days.");
  if (!Number.isInteger(input.targetRpoMinutes) || input.targetRpoMinutes < 0 || input.targetRpoMinutes > 15) fail("pitr_policy_invalid", "Target RPO must be 0-15 minutes.");
  if (!Number.isInteger(input.targetRtoMinutes) || input.targetRtoMinutes < 1 || input.targetRtoMinutes > 240) fail("pitr_policy_invalid", "Target RTO must be 1-240 minutes.");
  return { policyId: String(input.policyId), topologyId: String(input.topologyId), continuousWal: true, fullBackupSchedule: requiredString(input.fullBackupSchedule, "fullBackupSchedule"), incrementalBackupSchedule: requiredString(input.incrementalBackupSchedule, "incrementalBackupSchedule"), retentionDays: input.retentionDays, immutableBackups: true, crossAccountCustody: true, storageCountry: oneOf(input.storageCountry, ["IN"], "storageCountry"), keyAttestationId: requiredString(input.keyAttestationId, "keyAttestationId"), targetRpoMinutes: input.targetRpoMinutes, targetRtoMinutes: input.targetRtoMinutes, restoreDrillRef: requiredString(input.restoreDrillRef, "restoreDrillRef"), corruptionCheckRef: requiredString(input.corruptionCheckRef, "corruptionCheckRef"), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "ready", approvedAt: now.toISOString() };
}

export function assessPlatformCapacity(input = {}, existing = [], now = new Date()) {
  unique(input.assessmentId, existing, "assessmentId"); fourEyes(input);
  const metrics = ["apiCpuPct", "databaseCpuPct", "databaseConnectionsPct", "storagePct", "queueLagPct"].map((name) => [name, percentage(input.metrics?.[name], `metrics.${name}`)]);
  const minimumHeadroomPct = percentage(input.minimumHeadroomPct ?? 30, "minimumHeadroomPct");
  const checks = Object.fromEntries(metrics.map(([name, used]) => [name, { usedPct: used, headroomPct: 100 - used, status: 100 - used >= minimumHeadroomPct ? "passed" : "failed" }]));
  const status = Object.values(checks).every((item) => item.status === "passed") ? "ready" : "capacity_gap";
  if (status === "capacity_gap" && stringList(input.actions, "actions").length === 0) fail("capacity_actions_missing", "Capacity gaps require remediation actions.");
  return { assessmentId: String(input.assessmentId), environment: requiredString(input.environment, "environment"), forecastHorizonDays: positiveInteger(input.forecastHorizonDays, "forecastHorizonDays"), minimumHeadroomPct, checks, status, evidenceRef: requiredString(input.evidenceRef, "evidenceRef"), actions: stringList(input.actions, "actions"), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), assessedAt: now.toISOString() };
}

export function registerDeploymentAutomationPolicy(input = {}, existing = [], controls = {}, now = new Date()) {
  unique(input.policyId, existing, "policyId"); fourEyes(input);
  for (const field of ["repositoryRef", "iacRef", "pipelineRef", "artifactRegistryRef", "provenancePolicyRef", "migrationPolicyRef", "rollbackControllerRef", "driftControllerRef"]) requireText(input[field], field);
  requireDigest(input.iacChecksumSha256, "iacChecksumSha256");
  const mandatory = ["signedArtifacts", "sbomVerified", "provenanceVerified", "expandContractMigrations", "progressiveDelivery", "automaticRollback", "continuousDriftDetection", "secretsFromVault"];
  if (mandatory.some((field) => input[field] !== true)) fail("deployment_automation_invalid", `All automation gates are mandatory: ${mandatory.join(", ")}.`);
  if (!controls.databaseTopologies?.some((item) => item.topologyId === input.databaseTopologyId && item.status === "ready")) fail("deployment_dependency_missing", "A ready database topology is required.");
  if (!controls.pitrPolicies?.some((item) => item.policyId === input.pitrPolicyId && item.status === "ready")) fail("deployment_dependency_missing", "A ready PITR policy is required.");
  if (!controls.capacityAssessments?.some((item) => item.assessmentId === input.capacityAssessmentId && item.status === "ready")) fail("deployment_dependency_missing", "A ready capacity assessment is required.");
  return { policyId: String(input.policyId), environment: oneOf(input.environment, ["uat", "production"], "environment"), targetRegion: indiaRegion(input.targetRegion), databaseTopologyId: String(input.databaseTopologyId), pitrPolicyId: String(input.pitrPolicyId), capacityAssessmentId: String(input.capacityAssessmentId), repositoryRef: String(input.repositoryRef), iacRef: String(input.iacRef), iacChecksumSha256: input.iacChecksumSha256.toLowerCase(), pipelineRef: String(input.pipelineRef), artifactRegistryRef: String(input.artifactRegistryRef), provenancePolicyRef: String(input.provenancePolicyRef), migrationPolicyRef: String(input.migrationPolicyRef), rollbackControllerRef: String(input.rollbackControllerRef), driftControllerRef: String(input.driftControllerRef), signedArtifacts: true, sbomVerified: true, provenanceVerified: true, expandContractMigrations: true, progressiveDelivery: true, automaticRollback: true, continuousDriftDetection: true, secretsFromVault: true, proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "ready", approvedAt: now.toISOString() };
}

export function registerApiContract(input = {}, existing = [], now = new Date()) {
  unique(input.contractId, existing, "contractId"); fourEyes(input);
  if (existing.some((item) => item.service === input.service && item.version === input.version)) fail("api_contract_duplicate", "service and version already exist.");
  if (input.openApiVersion !== "3.1.0") fail("api_contract_invalid", "OpenAPI 3.1.0 is required.");
  requireDigest(input.documentChecksumSha256, "documentChecksumSha256");
  const contract = { contractId: String(input.contractId), service: requiredString(input.service, "service"), version: positiveInteger(input.version, "version"), basePath: requiredString(input.basePath, "basePath"), openApiVersion: "3.1.0", documentRef: requiredString(input.documentRef, "documentRef"), documentChecksumSha256: input.documentChecksumSha256.toLowerCase(), authentication: oneOf(input.authentication, ["tenant_session", "tenant_api_key", "platform_session"], "authentication"), tenantIsolationDeclared: input.tenantIsolationDeclared === true, consistentErrorContract: input.consistentErrorContract === true, idempotencyDeclared: input.idempotencyDeclared === true, owner: requiredString(input.owner, "owner"), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "published", publishedAt: now.toISOString() };
  if (!contract.tenantIsolationDeclared || !contract.consistentErrorContract) fail("api_contract_invalid", "Tenant isolation and consistent errors must be declared.");
  return contract;
}

export function registerEventSchema(input = {}, existing = [], now = new Date()) {
  unique(input.schemaId, existing, "schemaId"); fourEyes(input);
  const version = positiveInteger(input.version, "version"); const fields = normalizeFields(input.fields);
  if (new Set(fields.map((field) => field.name)).size !== fields.length) fail("event_schema_invalid", "Event field names must be unique.");
  const prior = existing.filter((item) => item.eventType === input.eventType).sort((a, b) => b.version - a.version)[0];
  if (prior && version !== prior.version + 1) fail("event_schema_version_invalid", "Event schema versions must be contiguous.");
  if (!prior && version !== 1) fail("event_schema_version_invalid", "The first event schema version must be 1.");
  if (prior) {
    const removed = prior.fields.filter((field) => !fields.some((next) => next.name === field.name));
    const changed = prior.fields.filter((field) => fields.some((next) => next.name === field.name && next.type !== field.type));
    const newRequired = fields.filter((field) => field.required && !prior.fields.some((previous) => previous.name === field.name));
    if (removed.length || changed.length || newRequired.length) fail("event_schema_breaking_change", "Published event fields cannot be removed, change type, or gain new required fields.");
  }
  const canonical = { eventType: requiredString(input.eventType, "eventType"), version, fields, tenantField: requiredString(input.tenantField, "tenantField"), orderingKey: requiredString(input.orderingKey, "orderingKey"), idempotencyField: requiredString(input.idempotencyField, "idempotencyField") };
  for (const field of [canonical.tenantField, canonical.orderingKey, canonical.idempotencyField]) if (!fields.some((item) => item.name === field && item.required)) fail("event_schema_invalid", "Tenant, ordering, and idempotency fields must exist and be required.");
  const schemaChecksumSha256 = digest(canonical);
  if (input.schemaChecksumSha256 && input.schemaChecksumSha256.toLowerCase() !== schemaChecksumSha256) fail("event_schema_checksum_mismatch", "schemaChecksumSha256 does not match the canonical schema.");
  return { schemaId: String(input.schemaId), ...canonical, schemaChecksumSha256, classification: oneOf(input.classification, ["public", "internal", "confidential", "restricted"], "classification"), owner: requiredString(input.owner, "owner"), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), compatibility: "backward", status: "published", publishedAt: now.toISOString() };
}

export function createWebhookSubscription(input = {}, existing = [], schemas = [], now = new Date()) {
  unique(input.subscriptionId, existing, "subscriptionId"); fourEyes(input); requireHttps(input.endpointUrl, "endpointUrl");
  const eventTypes = stringList(input.eventTypes, "eventTypes", true);
  if (eventTypes.some((eventType) => !schemas.some((schema) => schema.eventType === eventType && schema.status === "published"))) fail("webhook_schema_missing", "Every subscribed event requires a published schema.");
  if (!/^(vault\/|kms\/|secret:\/\/)/.test(input.secretRef ?? "")) fail("webhook_secret_ref_invalid", "secretRef must reference a managed vault or KMS secret.");
  return { subscriptionId: String(input.subscriptionId), tenantId: requiredString(input.tenantId, "tenantId"), endpointUrl: String(input.endpointUrl), secretRef: String(input.secretRef), eventTypes, dataResidencyCountry: oneOf(input.dataResidencyCountry, ["IN"], "dataResidencyCountry"), maximumAttempts: boundedInteger(input.maximumAttempts ?? 8, 1, 20, "maximumAttempts"), timeoutMs: boundedInteger(input.timeoutMs ?? 5000, 100, 30000, "timeoutMs"), proposedBy: String(input.proposedBy), approvedBy: String(input.approvedBy), approvalRef: String(input.approvalRef), status: "active", approvedAt: now.toISOString() };
}

export function queueWebhookDelivery(input = {}, subscriptions = [], schemas = [], existing = [], now = new Date()) {
  unique(input.deliveryId, existing, "deliveryId"); const subscription = subscriptions.find((item) => item.subscriptionId === input.subscriptionId && item.status === "active");
  if (existing.some((item) => item.subscriptionId === input.subscriptionId && item.idempotencyKey === input.idempotencyKey)) fail("webhook_delivery_duplicate", "Webhook idempotency key already exists for this subscription.");
  if (!subscription || !subscription.eventTypes.includes(input.eventType)) fail("webhook_subscription_invalid", "An active matching subscription is required.");
  const schema = schemas.filter((item) => item.eventType === input.eventType && item.status === "published").sort((a, b) => b.version - a.version)[0];
  if (!schema || schema.version !== input.schemaVersion) fail("webhook_schema_invalid", "Delivery must use the latest published schema version.");
  requireDigest(input.payloadChecksumSha256, "payloadChecksumSha256");
  const orderingKey = requiredString(input.orderingKey, "orderingKey"); const sequence = positiveInteger(input.sequence, "sequence");
  const priorSequence = existing.filter((item) => item.subscriptionId === subscription.subscriptionId && item.orderingKey === orderingKey).reduce((maximum, item) => Math.max(maximum, item.sequence), 0);
  if (sequence !== priorSequence + 1) fail("webhook_sequence_invalid", `sequence must be ${priorSequence + 1} for this subscription and ordering key.`);
  return { deliveryId: String(input.deliveryId), subscriptionId: subscription.subscriptionId, tenantId: subscription.tenantId, eventId: requiredString(input.eventId, "eventId"), eventType: String(input.eventType), schemaVersion: input.schemaVersion, orderingKey, payloadChecksumSha256: input.payloadChecksumSha256.toLowerCase(), idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey"), sequence, status: "queued", attempts: [], nextAttemptAt: now.toISOString(), queuedAt: now.toISOString() };
}

export function recordWebhookOutcome(delivery, subscription, input = {}, now = new Date()) {
  if (!delivery || !["queued", "retry_scheduled"].includes(delivery.status)) fail("webhook_delivery_transition_invalid", "A queued delivery is required.");
  const attemptNumber = delivery.attempts.length + 1; const delivered = input.httpStatus >= 200 && input.httpStatus < 300 && input.acknowledged === true;
  const attempt = { attemptNumber, httpStatus: boundedInteger(input.httpStatus, 100, 599, "httpStatus"), acknowledged: input.acknowledged === true, responseChecksumSha256: input.responseChecksumSha256 ? digestInput(input.responseChecksumSha256, "responseChecksumSha256") : null, evidenceRef: requiredString(input.evidenceRef, "evidenceRef"), observedBy: requiredString(input.observedBy, "observedBy"), attemptedAt: now.toISOString() };
  const exhausted = !delivered && attemptNumber >= subscription.maximumAttempts;
  return { ...delivery, attempts: [...delivery.attempts, attempt], status: delivered ? "delivered" : exhausted ? "dead_letter" : "retry_scheduled", nextAttemptAt: delivered || exhausted ? null : new Date(now.getTime() + Math.min(3600, 2 ** attemptNumber * 30) * 1000).toISOString(), deliveredAt: delivered ? now.toISOString() : null, deadLetteredAt: exhausted ? now.toISOString() : null };
}

export function projectEnterprisePlatform(events = []) {
  const buckets = { keyAttestations: [], logCustody: [], databaseTopologies: [], pitrPolicies: [], capacityAssessments: [], deploymentPolicies: [], apiContracts: [], eventSchemas: [], webhookSubscriptions: [], webhookDeliveries: [] };
  const deliveryMap = new Map();
  for (const event of events) {
    const mappings = { "platform.enterprise.key_attested": ["keyAttestations", "attestation"], "platform.enterprise.log_custody_approved": ["logCustody", "custody"], "platform.enterprise.database_topology_approved": ["databaseTopologies", "topology"], "platform.enterprise.pitr_policy_approved": ["pitrPolicies", "policy"], "platform.enterprise.capacity_assessed": ["capacityAssessments", "assessment"], "platform.enterprise.deployment_policy_approved": ["deploymentPolicies", "policy"], "platform.api.contract_published": ["apiContracts", "contract"], "platform.api.event_schema_published": ["eventSchemas", "schema"], "platform.api.webhook_subscription_approved": ["webhookSubscriptions", "subscription"] };
    const mapping = mappings[event.type]; if (mapping && event[mapping[1]]) buckets[mapping[0]].push(event[mapping[1]]);
    if (event.type?.startsWith("platform.api.webhook_delivery_") && event.delivery) deliveryMap.set(event.delivery.deliveryId, event.delivery);
  }
  buckets.webhookDeliveries = [...deliveryMap.values()]; return buckets;
}

function normalizeFields(value) { return array(value, "fields", true).map((field) => ({ name: requiredString(field.name, "fields.name"), type: oneOf(field.type, ["string", "integer", "boolean", "decimal_string", "date_time", "object", "array"], "fields.type"), required: field.required === true })); }
function unique(id, existing, field) { requireText(id, field); if (existing.some((item) => item[field] === id)) fail("enterprise_control_duplicate", `${field} already exists.`); }
function fourEyes(input) { requireText(input.proposedBy, "proposedBy"); requireText(input.approvedBy, "approvedBy"); requireText(input.approvalRef, "approvalRef"); if (input.proposedBy === input.approvedBy) fail("enterprise_four_eyes_required", "Independent approval is required."); }
function requiredString(value, field) { requireText(value, field); return String(value); }
function requireText(value, field) { if (typeof value !== "string" || !value.trim()) fail("enterprise_control_invalid", `${field} is required.`); }
function requireDigest(value, field) { if (!/^[a-fA-F0-9]{64}$/.test(value ?? "")) fail("enterprise_control_invalid", `${field} must be a SHA-256 digest.`); }
function digestInput(value, field) { requireDigest(value, field); return value.toLowerCase(); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function stringList(value, field, required = false) { const items = array(value, field, required).map(String).map((item) => item.trim()).filter(Boolean); const result = [...new Set(items)]; if (required && !result.length) fail("enterprise_control_invalid", `${field} requires values.`); return result; }
function array(value, field, required = false) { if (value == null && !required) return []; if (!Array.isArray(value) || (required && !value.length)) fail("enterprise_control_invalid", `${field} must be a non-empty array.`); return value; }
function oneOf(value, allowed, field) { if (!allowed.includes(value)) fail("enterprise_control_invalid", `${field} is invalid.`); return value; }
function positiveInteger(value, field) { if (!Number.isInteger(value) || value <= 0) fail("enterprise_control_invalid", `${field} must be a positive integer.`); return value; }
function boundedInteger(value, min, max, field) { if (!Number.isInteger(value) || value < min || value > max) fail("enterprise_control_invalid", `${field} must be between ${min} and ${max}.`); return value; }
function percentage(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) fail("enterprise_control_invalid", `${field} must be between 0 and 100.`); return value; }
function indiaRegion(value) { requireText(value, "targetRegion"); if (!INDIA_REGIONS.test(value)) fail("enterprise_control_residency_invalid", "Target region must be in India."); return String(value); }
function requireHttps(value, field) { try { if (new URL(value).protocol !== "https:") throw new Error(); } catch { fail("enterprise_control_invalid", `${field} must be an HTTPS URL.`); } }
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
