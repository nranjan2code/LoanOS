import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PRODUCT_JOURNEY_TYPES } from "@loanos/core/journeys/product-journey-administration.js";
import { PERSISTENT_SPECIALIST_JOURNEY_TYPES } from "@loanos/core/journeys/specialist-journey-service.js";
import { JOURNEY_WORKSPACE_ARCHETYPES, PRODUCT_TO_WORKSPACE_ARCHETYPE, validateJourneyWorkspaceCatalogue } from "@loanos/core/journeys/journey-workspace.js";
import { COMPOSED_JOURNEY_STAGES, validateComposedJourneyLifecycleCatalogue } from "@loanos/core/journeys/composed-journey-lifecycle.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const audit = JSON.parse(await readFile(resolve(root, "docs/product/product-journey-platform-depth.json"), "utf8"));
const errors = [];
const expected = [...PRODUCT_JOURNEY_TYPES].sort();
const actual = audit.journeys.map((item) => item.journeyType).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push("audit journeys must exactly match the canonical PRODUCT_JOURNEY_TYPES");
if (new Set(actual).size !== actual.length) errors.push("journey types must be unique");
if (!Array.isArray(audit.dimensions) || audit.dimensions.length < 12) errors.push("deep audit dimensions are incomplete");
const persistentSpecialist = audit.journeys.filter((item) => PERSISTENT_SPECIALIST_JOURNEY_TYPES.includes(item.journeyType)).map((item) => item.journeyType).sort();
if (JSON.stringify(persistentSpecialist) !== JSON.stringify([...PERSISTENT_SPECIALIST_JOURNEY_TYPES].sort())) errors.push("JD-02 persistent service evidence must exactly cover the 17 specialist/trade journeys");
for (const ref of audit.completedBatchEvidence?.["JD-02"] ?? []) {
  try { await access(resolve(root, ref)); } catch { errors.push(`JD-02 evidence does not exist: ${ref}`); }
}
if ((audit.completedBatchEvidence?.["JD-02"] ?? []).length < 5) errors.push("JD-02 requires domain, API, restart and PostgreSQL evidence");
const workspaceValidation = validateJourneyWorkspaceCatalogue();
if (!workspaceValidation.valid) errors.push(...workspaceValidation.errors);
if (JOURNEY_WORKSPACE_ARCHETYPES.length !== 11 || Object.keys(PRODUCT_TO_WORKSPACE_ARCHETYPE).length !== 21) errors.push("JD-03 must map the canonical 21 to exactly 11 workspace schemas");
for (const ref of audit.completedBatchEvidence?.["JD-03"] ?? []) {
  try { await access(resolve(root, ref)); } catch { errors.push(`JD-03 evidence does not exist: ${ref}`); }
}
if ((audit.completedBatchEvidence?.["JD-03"] ?? []).length < 7) errors.push("JD-03 requires schema, API, UI, test and architecture evidence");
const lifecycleValidation = validateComposedJourneyLifecycleCatalogue();
if (!lifecycleValidation.valid) errors.push(...lifecycleValidation.errors);
if (COMPOSED_JOURNEY_STAGES.length !== 13 || COMPOSED_JOURNEY_STAGES.at(-1) !== "completed") errors.push("JD-04 must define the 12 ordered lending stages and terminal completed target");
for (const ref of audit.completedBatchEvidence?.["JD-04"] ?? []) {
  try { await access(resolve(root, ref)); } catch { errors.push(`JD-04 evidence does not exist: ${ref}`); }
}
if ((audit.completedBatchEvidence?.["JD-04"] ?? []).length < 5) errors.push("JD-04 requires kernel, API, domain/API tests and architecture evidence");

for (const journey of audit.journeys) {
  for (const field of ["journeyType", "archetype", "maturity", "apiDepth", "experienceDepth", "testDepth"]) if (!journey[field]) errors.push(`${journey.journeyType || "unknown"}.${field} is required`);
  if (!journey.kernelEvidence?.length) errors.push(`${journey.journeyType}.kernelEvidence is required`);
  for (const ref of journey.kernelEvidence ?? []) {
    try { await access(resolve(root, ref)); } catch { errors.push(`${journey.journeyType} evidence does not exist: ${ref}`); }
  }
  for (const gap of journey.gaps ?? []) if (!audit.batches[gap]) errors.push(`${journey.journeyType} references unknown batch ${gap}`);
  if (journey.gaps?.includes("JD-04")) errors.push(`${journey.journeyType} must not retain JD-04 after composed-lifecycle evidence exists`);
  if (journey.apiDepth !== "composed_lifecycle_partial") errors.push(`${journey.journeyType} must use the truthful JD-04 API depth`);
  if (journey.testDepth !== "composed_lifecycle_partial") errors.push(`${journey.journeyType} must use the truthful JD-04 test depth`);
  for (const openBatch of ["JD-01", "JD-05", "JD-06"]) if (!journey.gaps?.includes(openBatch)) errors.push(`${journey.journeyType} must retain open production boundary ${openBatch}`);
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
  schemaWorkspacePartial: audit.journeys.filter((item) => item.experienceDepth === "schema_workspace_partial").length,
  composedLifecyclePartial: audit.journeys.filter((item) => item.apiDepth === "composed_lifecycle_partial" && item.testDepth === "composed_lifecycle_partial").length,
  batches: batches.map((item) => ({ batchId: item.batchId, affectedCount: item.affectedJourneys.length }))
};

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors, summary, batches }, null, 2)}\n`);
else {
  process.stdout.write(`product journey platform-depth audit · journeys=${summary.canonicalJourneys} · controlled=${summary.controlledFirstSlice} · configurable=${summary.configurablePattern} · production-ready=0\n`);
  process.stdout.write(`kernel-not-persisted=${summary.kernelNotPersisted} · persistent-specialist-api=${summary.persistentSpecialistApi} · schema-workspace-partial=${summary.schemaWorkspacePartial} · composed-lifecycle-partial=${summary.composedLifecyclePartial} · specialised-experience-missing=${summary.specialisedExperienceMissing}\n`);
  for (const batch of batches) process.stdout.write(`${batch.batchId} · ${batch.affectedJourneys.length}/21 · ${batch.name}\n`);
  if (errors.length) for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
}
if (errors.length) process.exitCode = 1;
