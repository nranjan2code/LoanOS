import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLoanOsServer } from "../apps/api/src/server.js";
import { totpCode } from "../apps/api/src/identity.js";

const PASSWORD = "TenantAccessPass1!";
const MFA = "JBSWY3DPEHPK3PXP";
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("product journey conformance API persists independent proposal, execution and assessment evidence", async (t) => {
  const tenant = { tenantId: "tenant_journey_api", name: "Journey Bank", apiKey: "journey-api-key" };
  const dataDir = await mkdtemp(join(tmpdir(), "loanos-journey-conformance-"));
  const server = createLoanOsServer({ dataDir, bootstrapTenants: [tenant] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/health`);

  const cookies = {};
  for (const userId of ["maker", "checker", "executor", "assessor"]) {
    let response = await fetch(`${base}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": tenant.apiKey },
      body: JSON.stringify({ userId, email: `${userId}@journey.example`, displayName: userId, password: PASSWORD, mustChangePassword: false, adminRoles: ["tenant_admin"], mfaRequired: true, mfaEnabled: true, mfaSecret: MFA })
    });
    assert.equal(response.status, 201, await response.clone().text());
    response = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.tenantId, email: `${userId}@journey.example`, password: PASSWORD, mfaCode: totpCode(MFA) })
    });
    assert.equal(response.status, 200, await response.clone().text());
    cookies[userId] = response.headers.get("set-cookie").split(";", 1)[0];
  }

  const request = (path, cookie, body) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body)
  });
  const campaignPath = "/admin/product-journey-conformance/campaigns/campaign-api-1";
  let response = await request("/admin/product-journey-conformance/campaigns", cookies.maker, {
    campaignId: "campaign-api-1",
    journeyType: "personal_loan",
    templateVersion: "1.0.0",
    templateChecksumSha256: digest("personal-loan-template-v1"),
    executionMode: "simulated",
    commerciallyLive: false,
    environmentRef: "simulator://tenant_journey_api",
    tenantConfigurationRef: "tenant-config://tenant_journey_api/v1"
  });
  assert.equal(response.status, 201, await response.clone().text());
  const proposed = await response.json();
  assert.equal(proposed.campaign.scenarioIds.length, 17);

  response = await request(`${campaignPath}/approval`, cookies.maker, { approvalRef: "approval://self" });
  assert.equal(response.status, 422);
  response = await request(`${campaignPath}/approval`, cookies.checker, { approvalRef: "approval://checker/campaign-api-1" });
  assert.equal(response.status, 200, await response.clone().text());

  for (const scenarioId of proposed.campaign.scenarioIds) {
    response = await request(`${campaignPath}/results`, cookies.executor, {
      scenarioId,
      outcome: "passed",
      evidenceRef: `evidence://campaign-api-1/${scenarioId}`,
      evidenceChecksumSha256: digest(`evidence:${scenarioId}`),
      sourceRunRef: "run://campaign-api-1"
    });
    assert.equal(response.status, 201, await response.clone().text());
  }

  response = await request(`${campaignPath}/assessment`, cookies.executor, {});
  assert.equal(response.status, 422);
  response = await request(`${campaignPath}/assessment`, cookies.assessor, {});
  assert.equal(response.status, 200, await response.clone().text());
  const assessed = await response.json();
  assert.equal(assessed.assessment.status, "controlled_first_slice");
  assert.equal(assessed.assessment.allPassed, true);

  response = await fetch(`${base}/admin/product-journey-conformance`, { headers: { cookie: cookies.assessor } });
  assert.equal(response.status, 200, await response.clone().text());
  const projection = await response.json();
  assert.equal(projection.catalogue.length, 21);
  assert.equal(projection.coverage.assessedCount, 1);
  assert.equal(projection.coverage.activationCandidateCount, 0);
  assert.equal(projection.coverage.productionReadyCount, 0);
  assert.equal(projection.campaigns.length, 1);
});
