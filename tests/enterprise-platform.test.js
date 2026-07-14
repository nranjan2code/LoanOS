import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyScimIdentityEvent,
  assessFederationPolicy,
  assessPlatformCapacity,
  certifyFederationPolicy,
  createFederationPolicy,
  createWebhookSubscription,
  queueWebhookDelivery,
  recordWebhookOutcome,
  registerApiContract,
  registerDatabaseTopology,
  registerDeploymentAutomationPolicy,
  registerEventSchema,
  registerManagedKeyAttestation,
  registerPitrPolicy,
  registerSecurityLogCustody
} from "../packages/core/src/index.js";
import { upsertFederatedTenantUser } from "../apps/api/src/identity.js";
import { createLoanOsServer } from "../apps/api/src/server.js";

const NOW = new Date("2026-07-14T00:00:00.000Z");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const approval = { proposedBy: "platform_maker", approvedBy: "platform_checker", approvalRef: "change-approval-1" };

function activeFederation() {
  const draft = createFederationPolicy({}, { policyId: "idp-bank", protocol: "oidc", issuer: "https://idp.bank.in", metadataUrl: "https://idp.bank.in/.well-known/openid-configuration", audience: "loanos", allowedDomains: ["bank.in"], groupMappings: { "loan-ops": { adminRoles: ["operator"], roles: ["loan_officer"], queues: ["origination"] } }, pkceRequired: true, mfaRequired: true, owner: "identity_owner", proposedBy: "identity_maker" }, NOW);
  return certifyFederationPolicy(draft.registry, "idp-bank", { approvedBy: "identity_checker", approvalRef: "idp-approval", metadataChecksumSha256: sha("metadata"), metadataValidUntil: "2027-07-14T00:00:00.000Z", loginTestRef: "test-login", logoutTestRef: "test-logout", mfaTestRef: "test-mfa" }, NOW);
}

test("OIDC policy certification gates idempotent SCIM provisioning and deprovisioning", () => {
  const certified = activeFederation();
  assert.equal(assessFederationPolicy(certified.policy, NOW).status, "ready");
  const applied = applyScimIdentityEvent({}, {}, certified.registry, { eventId: "scim-1", policyId: "idp-bank", externalId: "staff-1", email: "asha@bank.in", displayName: "Asha", operation: "upsert", groups: ["loan-ops"], idempotencyKey: "scim-key-1", appliedBy: "scim_gateway" }, NOW);
  const user = upsertFederatedTenantUser({}, applied.userInput, NOW);
  assert.equal(user.findings.length, 0);
  assert.equal(user.user.authenticationSource, "federated");
  assert.equal(user.user.passwordHash, undefined);
  const deactivated = applyScimIdentityEvent(user.users, applied.events, certified.registry, { eventId: "scim-2", policyId: "idp-bank", externalId: "staff-1", email: "asha@bank.in", displayName: "Asha", operation: "deactivate", groups: [], idempotencyKey: "scim-key-2", appliedBy: "scim_gateway" }, NOW);
  assert.equal(upsertFederatedTenantUser(user.users, deactivated.userInput, NOW).user.status, "inactive");
  assert.throws(() => applyScimIdentityEvent(user.users, applied.events, certified.registry, { eventId: "scim-3", policyId: "idp-bank", externalId: "staff-2", email: "outside@example.com", displayName: "Outside", operation: "upsert", groups: ["loan-ops"], idempotencyKey: "scim-key-3" }, NOW), /allowed domains/);
});

test("managed key and security-log custody attestations fail closed on residency and custody gaps", () => {
  const key = registerManagedKeyAttestation({ attestationId: "key-db", keyId: "db-key-v1", provider: "aws-kms", keyRef: "arn:aws:kms:ap-south-1:111:key/db", purpose: "database", region: "ap-south-1", algorithm: "AES_256", nonExportable: true, hsmBacked: true, dualControl: true, rotationDays: 180, destructionPolicyRef: "policy/key-destroy", evidenceRef: "evidence/key-db", ...approval }, [], NOW);
  assert.equal(key.status, "attested");
  const custody = registerSecurityLogCustody({ custodyId: "logs-1", provider: "india-siem", storageRef: "worm://logs/security", storageCountry: "IN", sources: ["identity", "application", "audit", "database", "cloud"], retentionDays: 365, immutable: true, searchable: true, encrypted: true, authenticatedCollectors: true, collectorIdentityRef: "workload/log-forwarder", schemaRegistryRef: "schemas/security-v1", trustedTime: true, timeSourceRef: "ntp/india", evidenceRef: "evidence/log-custody", ...approval }, [], NOW);
  assert.equal(custody.status, "ready");
  assert.throws(() => registerSecurityLogCustody({ ...custody, custodyId: "logs-bad", storageCountry: "US" }, [], NOW), /India custody/);
});

test("Postgres HA, PITR, capacity, and deployment automation form one fail-closed readiness chain", () => {
  const databaseKey = registerManagedKeyAttestation({ attestationId: "key-db", keyId: "db-key-v1", provider: "kms", keyRef: "kms/db", purpose: "database", region: "ap-south-1", algorithm: "AES_256", nonExportable: true, hsmBacked: true, dualControl: true, rotationDays: 180, destructionPolicyRef: "destroy/db", evidenceRef: "evidence/db", ...approval }, [], NOW);
  const backupKey = registerManagedKeyAttestation({ ...databaseKey, attestationId: "key-backup", keyId: "backup-v1", keyRef: "kms/backup", purpose: "backup" }, [], NOW);
  const topology = registerDatabaseTopology({ topologyId: "pg-prod", engine: "postgresql", nodes: [{ nodeId: "pg-a", role: "primary", region: "ap-south-1", availabilityZone: "ap-south-1a" }, { nodeId: "pg-b", role: "synchronous_standby", region: "ap-south-1", availabilityZone: "ap-south-1b" }], encrypted: true, keyAttestationId: "key-db", rlsEnforced: true, connectionPooler: true, automaticFailover: true, failoverRunbookRef: "runbook/pg-failover", monitoringRef: "monitor/pg", ...approval }, [], [databaseKey, backupKey], NOW);
  const pitr = registerPitrPolicy({ policyId: "pitr-prod", topologyId: "pg-prod", continuousWal: true, fullBackupSchedule: "0 2 * * *", incrementalBackupSchedule: "0 */6 * * *", retentionDays: 35, immutableBackups: true, crossAccountCustody: true, storageCountry: "IN", keyAttestationId: "key-backup", targetRpoMinutes: 5, targetRtoMinutes: 60, restoreDrillRef: "drill/restore-1", corruptionCheckRef: "check/pgbackrest-1", ...approval }, [], [topology], [databaseKey, backupKey], NOW);
  const capacity = assessPlatformCapacity({ assessmentId: "capacity-prod", environment: "production", forecastHorizonDays: 180, minimumHeadroomPct: 30, metrics: { apiCpuPct: 50, databaseCpuPct: 55, databaseConnectionsPct: 60, storagePct: 40, queueLagPct: 20 }, evidenceRef: "capacity/report-1", actions: [], ...approval }, [], NOW);
  const controls = { databaseTopologies: [topology], pitrPolicies: [pitr], capacityAssessments: [capacity] };
  const deployment = registerDeploymentAutomationPolicy({ policyId: "deploy-prod", environment: "production", targetRegion: "ap-south-1", databaseTopologyId: "pg-prod", pitrPolicyId: "pitr-prod", capacityAssessmentId: "capacity-prod", repositoryRef: "repo/loanos", iacRef: "iac/prod", iacChecksumSha256: sha("iac"), pipelineRef: "pipeline/prod", artifactRegistryRef: "ecr/prod", provenancePolicyRef: "slsa/prod", migrationPolicyRef: "migrations/expand-contract", rollbackControllerRef: "rollout/prod", driftControllerRef: "drift/prod", signedArtifacts: true, sbomVerified: true, provenanceVerified: true, expandContractMigrations: true, progressiveDelivery: true, automaticRollback: true, continuousDriftDetection: true, secretsFromVault: true, ...approval }, [], controls, NOW);
  assert.equal(deployment.status, "ready");
  assert.throws(() => registerDeploymentAutomationPolicy({ ...deployment, policyId: "deploy-orphan", databaseTopologyId: "missing", ...approval }, [], controls, NOW), /database topology/);
});

test("OpenAPI and event schema governance reject breaking contracts", () => {
  const contract = registerApiContract({ contractId: "api-v1", service: "loanos-api", version: 1, basePath: "/v1", openApiVersion: "3.1.0", documentRef: "openapi/v1.json", documentChecksumSha256: sha("openapi"), authentication: "tenant_api_key", tenantIsolationDeclared: true, consistentErrorContract: true, idempotencyDeclared: true, owner: "api_owner", ...approval }, [], NOW);
  assert.equal(contract.status, "published");
  const v1 = registerEventSchema({ schemaId: "loan-created-v1", eventType: "loan.created", version: 1, fields: [{ name: "tenantId", type: "string", required: true }, { name: "eventId", type: "string", required: true }, { name: "loanId", type: "string", required: true }], tenantField: "tenantId", orderingKey: "loanId", idempotencyField: "eventId", classification: "confidential", owner: "event_owner", ...approval }, [], NOW);
  const v2 = registerEventSchema({ schemaId: "loan-created-v2", eventType: "loan.created", version: 2, fields: [...v1.fields, { name: "productId", type: "string", required: false }], tenantField: "tenantId", orderingKey: "loanId", idempotencyField: "eventId", classification: "confidential", owner: "event_owner", ...approval }, [v1], NOW);
  assert.equal(v2.compatibility, "backward");
  assert.throws(() => registerEventSchema({ ...v2, schemaId: "loan-created-v3", version: 3, fields: v2.fields.filter((field) => field.name !== "loanId"), ...approval }, [v1, v2], NOW), /cannot be removed/);
  assert.throws(() => registerEventSchema({ ...v2, schemaId: "loan-created-v3-required", version: 3, fields: [...v2.fields, { name: "requiredNew", type: "string", required: true }], ...approval }, [v1, v2], NOW), /required fields/);
});

test("webhook delivery is schema-bound, idempotent, ordered, retried, and dead-lettered", () => {
  const schema = registerEventSchema({ schemaId: "payment-v1", eventType: "payment.settled", version: 1, fields: [{ name: "tenantId", type: "string", required: true }, { name: "eventId", type: "string", required: true }, { name: "accountId", type: "string", required: true }], tenantField: "tenantId", orderingKey: "accountId", idempotencyField: "eventId", classification: "confidential", owner: "event_owner", ...approval }, [], NOW);
  const subscription = createWebhookSubscription({ subscriptionId: "sub-1", tenantId: "tenant-bank", endpointUrl: "https://bank.in/hooks/loanos", secretRef: "vault/webhook/sub-1", eventTypes: ["payment.settled"], dataResidencyCountry: "IN", maximumAttempts: 2, timeoutMs: 5000, ...approval }, [], [schema], NOW);
  const delivery = queueWebhookDelivery({ deliveryId: "delivery-1", subscriptionId: "sub-1", eventId: "event-1", eventType: "payment.settled", schemaVersion: 1, orderingKey: "loan-1", payloadChecksumSha256: sha("payload"), idempotencyKey: "event-1", sequence: 1 }, [subscription], [schema], [], NOW);
  const retry = recordWebhookOutcome(delivery, subscription, { httpStatus: 503, acknowledged: false, evidenceRef: "delivery/attempt-1", observedBy: "webhook_worker" }, NOW);
  assert.equal(retry.status, "retry_scheduled");
  const dead = recordWebhookOutcome(retry, subscription, { httpStatus: 503, acknowledged: false, evidenceRef: "delivery/attempt-2", observedBy: "webhook_worker" }, NOW);
  assert.equal(dead.status, "dead_letter");
  assert.throws(() => queueWebhookDelivery({ ...delivery, deliveryId: "delivery-2" }, [subscription], [schema], [delivery], NOW), /idempotency key/);
  assert.throws(() => queueWebhookDelivery({ ...delivery, deliveryId: "delivery-3", idempotencyKey: "event-3", sequence: 3 }, [subscription], [schema], [delivery], NOW), /sequence must be 2/);
});

test("tenant federation and platform enterprise APIs persist governed controls", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-enterprise-")); const tenant = { tenantId: "tenant_enterprise", name: "Enterprise Bank", apiKey: "tenant-enterprise-key" }; const platformAdminKey = "platform-enterprise-key";
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant], platformAdminKey }); await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/admin/federation/policies`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": tenant.apiKey }, body: JSON.stringify({ policyId: "tenant-idp", protocol: "oidc", issuer: "https://idp.enterprise.in", metadataUrl: "https://idp.enterprise.in/.well-known/openid-configuration", audience: "loanos", allowedDomains: ["enterprise.in"], groupMappings: { staff: { adminRoles: ["operator"], roles: [], queues: [] } }, pkceRequired: true, mfaRequired: true, owner: "identity_owner" }) });
  assert.equal(response.status, 201, await response.clone().text());
  const platformPost = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-platform-admin-key": platformAdminKey }, body: JSON.stringify(body) });
  response = await platformPost("/platform/enterprise/key-attestations", { attestationId: "api-key-db", keyId: "db-v1", provider: "kms", keyRef: "kms/db", purpose: "database", region: "ap-south-1", algorithm: "AES_256", nonExportable: true, hsmBacked: true, dualControl: true, rotationDays: 180, destructionPolicyRef: "destroy/db", evidenceRef: "evidence/db", proposedBy: "platform_maker", approvedBy: "platform_admin_key", approvalRef: "approval-api" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await platformPost("/platform/api-governance/event-schemas", { schemaId: "api-event-v1", eventType: "enterprise.ready", version: 1, fields: [{ name: "tenantId", type: "string", required: true }, { name: "eventId", type: "string", required: true }, { name: "resourceId", type: "string", required: true }], tenantField: "tenantId", orderingKey: "resourceId", idempotencyField: "eventId", classification: "internal", owner: "api_owner", proposedBy: "platform_maker", approvedBy: "platform_admin_key", approvalRef: "approval-api" });
  assert.equal(response.status, 201, await response.clone().text());
  response = await fetch(`${base}/platform/enterprise/controls`, { headers: { "x-platform-admin-key": platformAdminKey } }); const controls = await response.json();
  assert.equal(response.status, 200); assert.equal(controls.keyAttestations.length, 1); assert.equal(controls.eventSchemas.length, 1);
});
