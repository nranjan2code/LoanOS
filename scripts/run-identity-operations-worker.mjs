import { createServer } from "node:http";

import {
  IdentityOperationsWorkerRuntime,
  createIdentityOperationsExecutionHandlers,
  createIdentityOperationsWorkerApiClient
} from "@loanos/core";

const env = process.env;
const executionMode = env.LOANOS_IDENTITY_WORKER_EXECUTION_MODE ?? "simulated";
if (executionMode === "live") {
  throw new Error("The generic runner has no commercial identity-provider adapter. Inject certified live ports in a vendor deployment before selecting live mode.");
}
if (env.NODE_ENV === "production" && env.LOANOS_ALLOW_SIMULATED_IDENTITY_WORKER !== "true") {
  throw new Error("Production refuses the simulated identity worker unless LOANOS_ALLOW_SIMULATED_IDENTITY_WORKER=true is deliberately set for a non-live conformance environment.");
}

const runtime = new IdentityOperationsWorkerRuntime({
  client: createIdentityOperationsWorkerApiClient({
    baseUrl: required("LOANOS_API_URL"),
    apiKey: required("LOANOS_IDENTITY_WORKER_API_KEY"),
    requestTimeoutMs: number("LOANOS_IDENTITY_WORKER_REQUEST_TIMEOUT_MS", 10_000, 100, 3_600_000)
  }),
  handlers: createIdentityOperationsExecutionHandlers({}, { executionMode }),
  workerId: env.LOANOS_IDENTITY_WORKER_ID,
  executionMode,
  maxJobsPerRun: number("LOANOS_IDENTITY_WORKER_MAX_JOBS", 25, 1, 100),
  leaseMs: number("LOANOS_IDENTITY_WORKER_LEASE_MS", 30_000, 1_000, 3_600_000),
  jobTimeoutMs: number("LOANOS_IDENTITY_WORKER_JOB_TIMEOUT_MS", 10_000, 10, 3_599_999)
});

const healthPort = number("LOANOS_IDENTITY_WORKER_HEALTH_PORT", 3041, 1, 65_535);
const intervalMs = number("LOANOS_IDENTITY_WORKER_INTERVAL_MS", 15_000, 1_000, 3_600_000);
const runOnceOnly = env.LOANOS_IDENTITY_WORKER_RUN_ONCE === "true";
const healthServer = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(runtime.prometheus());
    return;
  }
  if (path === "/healthz" || path === "/readyz") {
    const snapshot = runtime.health();
    const ok = path === "/healthz" ? snapshot.status !== "stopping" : snapshot.ready;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(snapshot));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_found", message: "Worker endpoint not found." } }));
});

await new Promise((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(healthPort, "0.0.0.0", resolve);
});

let shuttingDown = false;
const stop = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await runtime.shutdown();
  await new Promise((resolve) => healthServer.close(resolve));
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

do {
  const result = await runtime.runOnce();
  process.stdout.write(`${JSON.stringify({ component: "identity-operations-worker", ...result })}\n`);
  if (runOnceOnly || shuttingDown) break;
  await delay(intervalMs);
} while (!shuttingDown);

await stop();
if (runtime.health().metrics.runsFailedClosed > 0) process.exitCode = 1;

function required(name) {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
function number(name, fallback, min, max) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
