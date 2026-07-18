---
name: aws-showcase-change
description: Use when changing anything under deploy/aws/ or the synthetic-showcase release surface — packaging manifest, bootstrap, CloudFormation, updates, domains, smoke tests, credentials, recovery or teardown. Enforces the release boundary and the five-document review set.
---

# Change the AWS showcase safely

The generation-2 AWS showcase has an explicit, fail-closed release boundary and
a documentation set that must move with it. The canonical contract is
`docs/architecture/aws-showcase-deployment.md`; the operational runbook is
`deploy/aws/README.md`. Read both before touching `deploy/aws/`.

## The release boundary (non-negotiable)

- `deploy/aws/demo-package-manifest.txt` is the **allowlist**. Never archive the
  repository root, never add `apps/android-*`, never package local
  dependencies/build outputs, never bypass the committed-`HEAD` default.
- Releases use immutable S3 keys plus SHA-256 verification. Bootstrap is
  first-boot only; ordinary updates go through SSM with an atomic release
  switch and health rollback.
- A database-schema difference must fail closed until a reviewed migration or
  replacement-stack path exists.
- Never manually mutate CloudFormation-owned CloudFront, IAM, network,
  instance, or alias resources.

## Workflow

1. Read the contract sections that govern what you are changing
   (`docs/architecture/aws-showcase-deployment.md`, `deploy/aws/README.md`).
2. Make the change within the boundary above.
3. Validate locally:
   ```bash
   npm run demo:audit                      # canonical synthetic profile still valid
   ./deploy/aws/package-demo.sh --help     # packaging options / manifest behavior
   ```
   For deployed-stack work: `./deploy/aws/release-demo.sh status`, then
   `./deploy/aws/release-demo.sh smoke` after any release, and
   `./deploy/aws/release-demo.sh dns` when aliases change.
4. Update the **five-document review set** (the currency advisory names the
   first three; the rest is an AGENTS.md non-negotiable):
   - `docs/architecture/aws-showcase-deployment.md`
   - `deploy/aws/README.md`
   - `docs/operations/demo-handbook.md`
   - `docs/architecture/current-implementation.md`
   - `AGENTS.md` (if commands or agent-facing rules changed)
5. If the externally visible capability changed, update the sales demo
   narrative and the claim register (`update-gtm-claim` skill).
6. Run `npm run knowledge:check` and commit citing what part of the release
   lifecycle changed.

## Notes

- Synthetic data only — the showcase must never carry real personal or
  production data.
- Cost discipline is part of the contract: the stack is disposable; prefer
  teardown/recreate over long-lived mutation.
