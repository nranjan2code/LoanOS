import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PRODUCT_JOURNEY_TYPES } from "../packages/core/src/product-journey-administration.js";
import { PERSISTENT_SPECIALIST_JOURNEY_TYPES } from "../packages/core/src/specialist-journey-service.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const audit = JSON.parse(await readFile(resolve(root, "docs/product/product-journey-platform-depth.json"), "utf8"));
const errors = [];
const expected = [...PRODUCT_JOURNEY_TYPES].sort();
const actual = audit.journeys.map((item) => item.journeyType).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push("audit journeys must exactly match the canonical PRODUCT_JOURNEY_TYPES");
if (new Set(actual).size !== actual.length) errors.push("journey types must be unique");
if (!Array.isArray(audit.dimensions) || audit.dimensions.length < 12) errors.push("deep audit dimensions are incomplete");
const persistentSpecialist = audit.journeys.filter((item) => item.apiDepth === "tenant_persistent_specialist_partial").map((item) => item.journeyType).sort();
if (JSON.stringify(persistentSpecialist) !== JSON.stringify([...PERSISTENT_SPECIALIST_JOURNEY_TYPES].sort())) errors.push("JD-02 persistent API claims must exactly cover the 17 specialist/trade journeys");
for (const ref of audit.completedBatchEvidence?.["JD-02"] ?? []) {
  try { await access(resolve(root, ref)); } catch { errors.push(`JD-02 evidence does not exist: ${ref}`); }
}
if ((audit.completedBatchEvidence?.["JD-02"] ?? []).length < 5) errors.push("JD-02 requires domain, API, restart and PostgreSQL evidence");

for (const journey of audit.journeys) {
  for (const field of ["journeyType", "archetype", "maturity", "apiDepth", "experienceDepth", "testDepth"]) if (!journey[field]) errors.push(`${journey.journeyType || "unknown"}.${field} is required`);
  if (!journey.kernelEvidence?.length) errors.push(`${journey.journeyType}.kernelEvidence is required`);
  for (const ref of journey.kernelEvidence ?? []) {
    try { await access(resolve(root, ref)); } catch { errors.push(`${journey.journeyType} evidence does not exist: ${ref}`); }
  }
  for (const gap of journey.gaps ?? []) if (!audit.batches[gap]) errors.push(`${journey.journeyType} references unknown batch ${gap}`);
}

const batches = Object.entries(audit.batches).map(([batchId, batch]) => ({
  batchId,
  name: batch.name,
  affectedJourneys: audit.journeys.filter((journey) => journey.gaps.includes(batchId)).map((journey) => journey.journeyType)
}));
const summary = {
  canonicalJourneys: expected.length,
  productionReady: 0,
  controlledFirstSlice: audit.journeys.filter((item) => item.maturity === "controlled_first_slice").length,
  configurablePattern: audit.journeys.filter((item) => item.maturity === "configurable_pattern").length,
  kernelNotPersisted: audit.journeys.filter((item) => item.apiDepth === "kernel_not_persisted").length,
  persistentSpecialistApi: persistentSpecialist.length,
  specialisedExperienceMissing: audit.journeys.filter((item) => item.experienceDepth === "missing_specialised").length,
  batches: batches.map((item) => ({ batchId: item.batchId, affectedCount: item.affectedJourneys.length }))
};

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors, summary, batches }, null, 2)}\n`);
else {
  process.stdout.write(`product journey platform-depth audit · journeys=${summary.canonicalJourneys} · controlled=${summary.controlledFirstSlice} · configurable=${summary.configurablePattern} · production-ready=0\n`);
  process.stdout.write(`kernel-not-persisted=${summary.kernelNotPersisted} · persistent-specialist-api=${summary.persistentSpecialistApi} · specialised-experience-missing=${summary.specialisedExperienceMissing}\n`);
  for (const batch of batches) process.stdout.write(`${batch.batchId} · ${batch.affectedJourneys.length}/21 · ${batch.name}\n`);
  if (errors.length) for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
}
if (errors.length) process.exitCode = 1;
