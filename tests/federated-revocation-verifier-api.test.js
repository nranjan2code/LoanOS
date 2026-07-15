import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoanOsServer } from "../apps/api/src/server.js";
import { loadState, saveState } from "../apps/api/src/file-store.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MAKER_MFA = "JBSWY3DPEHPK3PXP";
const CHECKER_MFA = "KRSXG5DSNFXGOIDB";

test("revocation verifier API binds authenticated maker-checker and activates public-key lineage", async (t) => {
  const tenant = { tenantId: "tenant_verifier", name: "Verifier Bank", apiKey: "verifier-service-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-verifier-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/health`);
  const serviceHeaders = { "content-type": "application/json", "x-api-key": tenant.apiKey };
  for (const user of [{ userId: "maker", email: "maker@bank.in", mfaSecret: MAKER_MFA }, { userId: "checker", email: "checker@bank.in", mfaSecret: CHECKER_MFA }]) {
    const response = await fetch(`${base}/admin/users`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ ...user, displayName: user.userId, password: PASSWORD, mustChangePassword: false, adminRoles: ["security_admin"], mfaRequired: true, mfaEnabled: true }) });
    assert.equal(response.status, 201, await response.clone().text());
  }
  const login = async (email, mfaSecret) => {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: tenant.tenantId, email, password: PASSWORD, mfaCode: totpCode(mfaSecret) }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get("set-cookie").split(";", 1)[0];
  };
  const maker = await login("maker@bank.in", MAKER_MFA); const checker = await login("checker@bank.in", CHECKER_MFA);
  const state = await loadState(dataDir); state.tenants[tenant.tenantId].federationPolicies.idp = { policyId: "idp", status: "active", issuer: "https://idp.bank.in", audience: "loanos" }; await saveState(state, dataDir);
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const body = { profileId: "verifier-api-1", policyId: "idp", protocol: "oidc_backchannel_logout", providerProfileRef: "candidate-idp", verificationEvidenceRef: "evidence://provider-uat", keys: [{ keyId: "key-1", algorithm: "RS256", publicJwk: keyPair.publicKey.export({ format: "jwk" }), validUntil: new Date(Date.now() + 86_400_000).toISOString(), keyEvidenceRef: "evidence://key-1" }] };
  let response = await fetch(`${base}/admin/federation/revocation-verifiers/proposals`, { method: "POST", headers: { "content-type": "application/json", cookie: maker }, body: JSON.stringify(body) });
  assert.equal(response.status, 201, await response.clone().text()); assert.equal((await response.json()).profile.proposedBy, "maker");
  response = await fetch(`${base}/admin/federation/revocation-verifiers/verifier-api-1/approval`, { method: "POST", headers: { "content-type": "application/json", cookie: maker }, body: JSON.stringify({ approvalRef: "approval://self" }) });
  assert.equal(response.status, 409, "maker cannot approve the same verifier");
  response = await fetch(`${base}/admin/federation/revocation-verifiers/verifier-api-1/approval`, { method: "POST", headers: { "content-type": "application/json", cookie: checker }, body: JSON.stringify({ approvalRef: "approval://checker" }) });
  assert.equal(response.status, 200, await response.clone().text()); const profile = (await response.json()).profile; assert.equal(profile.status, "active"); assert.equal(profile.approvedBy, "checker"); assert.equal(profile.keys[0].publicJwk.d, undefined);
});
