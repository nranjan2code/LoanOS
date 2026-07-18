#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildShowcaseDemoProfile,
  buildWorkshopTenantManifest,
  validateDemoProfile
} from "@loanos/core/platform/demo-system.js";

function usage() {
  console.error(`Usage:
  node scripts/demo-system.mjs audit
  node scripts/demo-system.mjs showcase [--tenant-id dev]
  node scripts/demo-system.mjs workshop --session <id> [--name <name>]
  node scripts/demo-system.mjs create-workshop --session <id> --base-url <url> \\
    --owner-email <email> --credentials-file <path> --confirm-synthetic-only

create-workshop requires LOANOS_PLATFORM_ADMIN_KEY and creates only the
synthetic tenant shell. A dedicated per-tenant business decision engine is
still required before decisioning can be demonstrated.`);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value.`);
  return value;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeOwnerId(email) {
  return `owner_${email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "workshop"}`;
}

async function createWorkshop() {
  if (!hasFlag("confirm-synthetic-only")) {
    throw new Error("create-workshop requires --confirm-synthetic-only.");
  }
  const sessionId = option("session");
  const baseUrl = option("base-url")?.replace(/\/$/, "");
  const ownerEmail = option("owner-email");
  const credentialsFile = option("credentials-file");
  const platformAdminKey = process.env.LOANOS_PLATFORM_ADMIN_KEY;
  if (!sessionId || !baseUrl || !ownerEmail || !credentialsFile || !platformAdminKey) {
    throw new Error("session, base-url, owner-email, credentials-file, and LOANOS_PLATFORM_ADMIN_KEY are required.");
  }
  const manifest = buildWorkshopTenantManifest({
    sessionId,
    name: option("name", "Customer Workshop Tenant")
  });
  const ownerPassword = `Demo-${randomBytes(18).toString("base64url")}`;
  const request = {
    ...manifest.tenantRequest,
    ownerUser: {
      userId: safeOwnerId(ownerEmail),
      email: ownerEmail,
      displayName: option("owner-name", "Workshop Tenant Owner"),
      password: ownerPassword,
      mustChangePassword: false,
      mfaRequired: false,
      country: "IN"
    }
  };
  const response = await fetch(`${baseUrl}/platform/tenants`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-platform-admin-key": platformAdminKey
    },
    body: JSON.stringify(request)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Workshop shell creation failed (${response.status}): ${payload.error?.message ?? "unknown error"}`);
  }
  const outputPath = resolve(credentialsFile);
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    tenantId: manifest.tenantId,
    tenantApiKey: payload.apiKey,
    ownerEmail,
    ownerPassword,
    engineProvisioning: manifest.engineProvisioning
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Created synthetic workshop tenant shell ${manifest.tenantId}.`);
  console.log(`Credentials written with mode 0600 to ${outputPath}.`);
  console.log("Decisioning remains fail-closed until a dedicated per-tenant business engine is provisioned.");
}

async function main() {
  const command = process.argv[2];
  if (command === "audit") {
    const profile = buildShowcaseDemoProfile();
    printJson({
      profileId: profile.profileId,
      tenantId: profile.tenantId,
      syntheticOnly: profile.syntheticOnly,
      validation: validateDemoProfile(profile),
      engineBoundaries: profile.engineBoundaries
    });
    return;
  }
  if (command === "showcase") {
    printJson(buildShowcaseDemoProfile({ tenantId: option("tenant-id", "dev") }));
    return;
  }
  if (command === "workshop") {
    printJson(buildWorkshopTenantManifest({
      sessionId: option("session"),
      name: option("name", "Customer Workshop Tenant")
    }));
    return;
  }
  if (command === "create-workshop") {
    await createWorkshop();
    return;
  }
  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
