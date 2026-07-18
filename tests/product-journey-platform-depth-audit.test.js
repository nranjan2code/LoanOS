import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { PRODUCT_JOURNEY_TYPES } from "@loanos/core/journeys/product-journey-administration.js";
import { COMPOSED_JOURNEY_STAGES, validateComposedJourneyLifecycleCatalogue } from "@loanos/core/journeys/composed-journey-lifecycle.js";

const auditUrl = new URL("../docs/product/product-journey-platform-depth.json", import.meta.url);

test("platform-depth audit covers the canonical 21 and never infers production readiness", async () => {
  const audit = JSON.parse(await readFile(auditUrl, "utf8"));
  assert.deepEqual(audit.journeys.map((item) => item.journeyType).sort(), [...PRODUCT_JOURNEY_TYPES].sort());
  assert.equal(new Set(audit.journeys.map((item) => item.journeyType)).size, 21);
  assert.equal(audit.journeys.filter((item) => item.maturity === "controlled_first_slice").length, 3);
  assert.equal(audit.journeys.filter((item) => item.maturity === "configurable_pattern").length, 18);
  assert.equal(audit.journeys.some((item) => item.maturity === "production_ready"), false);
  assert.ok(audit.dimensions.length >= 12);
});

test("every depth claim has repository evidence and maps only to governed shared batches", async () => {
  const audit = JSON.parse(await readFile(auditUrl, "utf8"));
  for (const journey of audit.journeys) {
    assert.ok(journey.kernelEvidence.length > 0, `${journey.journeyType} needs kernel evidence`);
    for (const ref of journey.kernelEvidence) await access(new URL(`../${ref}`, import.meta.url));
    assert.ok(journey.gaps.length > 0, `${journey.journeyType} must retain truthful gaps`);
    for (const batchId of journey.gaps) assert.ok(audit.batches[batchId], `${journey.journeyType} references ${batchId}`);
  }
  assert.equal(audit.journeys.filter((item) => item.apiDepth === "kernel_not_persisted").length, 0);
  assert.equal(audit.journeys.filter((item) => item.apiDepth === "tenant_persistent_specialist_partial").length, 0);
  assert.equal(audit.journeys.filter((item) => item.gaps.includes("JD-02")).length, 0);
  for (const ref of audit.completedBatchEvidence["JD-02"]) await access(new URL(`../${ref}`, import.meta.url));
  assert.equal(audit.journeys.filter((item) => item.gaps.includes("JD-03")).length, 0);
  for (const ref of audit.completedBatchEvidence["JD-03"]) await access(new URL(`../${ref}`, import.meta.url));
  assert.equal(audit.journeys.filter((item) => item.experienceDepth === "missing_specialised").length, 0);
  assert.equal(audit.journeys.filter((item) => item.experienceDepth === "schema_workspace_partial").length, 21);
  assert.equal(audit.journeys.filter((item) => item.gaps.includes("JD-04")).length, 0);
  assert.equal(audit.journeys.filter((item) => item.apiDepth === "composed_lifecycle_partial").length, 21);
  assert.equal(audit.journeys.filter((item) => item.testDepth === "composed_lifecycle_partial").length, 21);
  assert.deepEqual([...COMPOSED_JOURNEY_STAGES].slice(-1), ["completed"]);
  assert.equal(validateComposedJourneyLifecycleCatalogue().valid, true);
  assert.equal(audit.journeys.filter((item) => item.gaps.includes("JD-01")).length, 0);
  for (const ref of audit.completedBatchEvidence["JD-01"]) await access(new URL(`../${ref}`, import.meta.url));
  for (const journey of audit.journeys) assert.deepEqual(journey.gaps, ["JD-05", "JD-06"]);
  for (const ref of audit.completedBatchEvidence["JD-04"]) await access(new URL(`../${ref}`, import.meta.url));
});
