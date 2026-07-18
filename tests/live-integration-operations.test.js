import assert from "node:assert/strict";
import test from "node:test";
import { activateLiveIntegration, approveLiveIntegrationOnboarding, assessLiveIntegrationReadiness, recordLiveIntegrationConformance } from "@loanos/core/integrations/live-integration-operations.js";

const NOW = new Date("2026-07-15T00:00:00.000Z"); const approval = { proposedBy: "integration-maker", approvedBy: "integration-checker", approvalRef: "approval/1" };
test("live integration activation requires India residency and complete adverse conformance", () => {
  assert.throws(() => approveLiveIntegrationOnboarding({}, { integrationId: "bad", providerFamily: "cic", providerId: "provider", contractRef: "contract", dataResidencyCountry: "US", credentialVaultRef: "vault", networkAllowlistRef: "allowlist", schemaVersion: "1", providerCertificationRef: "cert", validUntil: "2027-01-01T00:00:00.000Z", ...approval }, NOW), /residency/);
  const integration = approveLiveIntegrationOnboarding({}, { integrationId: "cic-live", providerFamily: "cic", providerId: "provider", contractRef: "contract", dataResidencyCountry: "IN", credentialVaultRef: "vault", networkAllowlistRef: "allowlist", schemaVersion: "1", providerCertificationRef: "cert", validUntil: "2027-01-01T00:00:00.000Z", ...approval }, NOW).integration;
  const scenarios = Object.fromEntries(["authentication_failure", "timeout", "schema_rejection", "duplicate_retry", "signed_callback", "reconciliation_mismatch"].map((name) => [name, { status: "passed", evidenceRef: `evidence/${name}` }]));
  const conformance = recordLiveIntegrationConformance({}, { liveIntegrations: { "cic-live": integration } }, { conformanceId: "conf1", integrationId: "cic-live", environmentRef: "sandbox", scenarios, loadTestRef: "load", securityTestRef: "security", reconciliationRef: "reconciliation", ...approval }, NOW).conformance;
  const active = activateLiveIntegration(integration, { liveIntegrationConformance: { conf1: conformance } }, { conformanceId: "conf1", credentialAccessTestRef: "credential/test", allowlistTestRef: "allowlist/test", monitoringDashboardRef: "monitor", runbookRef: "runbook", rollbackRef: "rollback", providerHealthRef: "health", ...approval }, NOW); assert.equal(active.status, "active");
  assert.equal(assessLiveIntegrationReadiness({ liveIntegrations: { "cic-live": active } }, ["cic", "ckyc"], NOW).status, "blocked");
});
