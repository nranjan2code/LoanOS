import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const installScripts = [
  "deploy/aws/bootstrap-demo.sh",
  "deploy/aws/update-demo.sh"
];

test("AWS immutable releases do not run repository-only npm lifecycle scripts", async () => {
  for (const scriptPath of installScripts) {
    const script = await readFile(scriptPath, "utf8");
    assert.match(
      script,
      /^npm ci --omit=dev --ignore-scripts$/m,
      `${scriptPath} must not run the Git-worktree prepare hook inside a selective release archive`
    );
  }
});
