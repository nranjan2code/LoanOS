#!/usr/bin/env node
import { runResilienceProbe } from "../apps/api/src/resilience-probe.js";

const targetUrl = process.env.LOANOS_PROBE_URL ?? process.argv[2];
if (!targetUrl) {
  console.error("Usage: LOANOS_PROBE_URL=https://service/health node scripts/run-resilience-probe.mjs");
  process.exitCode = 2;
} else {
  const headers = {};
  if (process.env.LOANOS_PROBE_BEARER_TOKEN) headers.authorization = `Bearer ${process.env.LOANOS_PROBE_BEARER_TOKEN}`;
  if (process.env.LOANOS_PROBE_API_KEY) headers["x-api-key"] = process.env.LOANOS_PROBE_API_KEY;
  try {
    const result = await runResilienceProbe({
      targetUrl,
      headers,
      concurrency: Number(process.env.LOANOS_PROBE_CONCURRENCY ?? 5),
      iterations: Number(process.env.LOANOS_PROBE_ITERATIONS ?? 100),
      timeoutMs: Number(process.env.LOANOS_PROBE_TIMEOUT_MS ?? 5000)
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.errorCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
