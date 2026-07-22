# AWS Synthetic Showcase Deployment Architecture

Status: Implemented generation-2 synthetic-showcase architecture; not approved
for production or real borrower data.

Last verified: 2026-07-22

## Purpose and document relationships

This document is the canonical technical contract for deploying the LoanOS
browser and server showcase to AWS. It defines the release boundary,
infrastructure ownership, update and rollback lifecycle, domain topology,
security assumptions, and production gaps.

Use it with these operating documents:

- [AWS deployment runbook](../../deploy/aws/README.md) — exact commands,
  prerequisites, DNS records, credentials, troubleshooting, and teardown;
- [synthetic demo operator handbook](../operations/demo-handbook.md) — showcase
  and workshop modes, presentation flow, personas, mocks, evidence, recovery,
  and demo-day controls;
- [current implementation map](current-implementation.md) — what exists in the
  repository today;
- [release, configuration, and resilience operations](delivery-operations.md)
  — the production control-plane boundary that this showcase does not satisfy;
  and
- [sales demo narrative](../gtm/sales/demo-script.md) — the approved claims and
  presentation sequence.

If this document and the scripts disagree, treat the mismatch as a defect. Do
not broaden the artifact, weaken a health gate, or make a console-only
infrastructure change until the contract and implementation are reconciled.

## Scope and non-goals

Generation 2 provides a stable, production-like demonstration environment for
synthetic LoanOS workflows. It includes:

- the Node API and shared/domain packages;
- local PostgreSQL with RLS-backed tenant storage;
- one tenant-bound Rust business-rules runtime for the canonical `dev` tenant;
- Nginx and the browser applications required by the showcase;
- private, versioned S3 release storage;
- Systems Manager Session Manager and in-place release execution;
- CloudFront HTTPS and optional custom subdomains; and
- an AWS Budget notification.

It deliberately does **not** provide:

- a production multi-AZ or independently scalable topology;
- managed PostgreSQL, backup/PITR, DR, SIEM/SOC, WAF, or production secrets
  custody;
- a separately operated per-tenant business and `ctrl-*` control-engine fleet;
- live bureau, KYC, banking, payment, messaging, regulatory, or model providers;
- real-data admission, production regulatory certification, or customer SLA;
- an automatic database migration framework; or
- Android artifacts. Both Android applications remain separate deliverables.

Only synthetic data may enter this environment. Real PAN, Aadhaar, bureau,
bank-statement, payment, borrower, production credential, or regulatory
submission data is prohibited.

## Topology and ownership

```text
GoDaddy DNS (external, human-controlled)
  demo/staff/portal/partners/admin/help.<root>
                    |
                    v
CloudFront distribution + host router (CloudFormation-owned)
                    |
        stack-specific origin header
                    |
                    v
Encrypted Ubuntu EC2 (no SSH/22; SSM only)
  Nginx -> Node API/static browser apps -> local PostgreSQL
                                  \-----> tenant `dev` Rust rules runtime

Private versioned S3 bucket -> immutable release archive + sidecar manifest
AWS Systems Manager        -> update command, status, release and credentials
AWS Budget                 -> notification only; never an automatic cost stop
```

CloudFormation owns the VPC, subnet, route table, internet gateway, security
group, IAM role/profile, EC2 instance, CloudFront distribution/function, SSM
parameter names, and budget. Operators must not manually mutate those
resources. A console-only alias, behavior, origin, security-group, or role
change creates drift and can be removed by a later stack update.

The DNS provider remains outside the stack. ACM certificates used by
CloudFront must be issued in `us-east-1`; their DNS-validation CNAMEs should be
retained for managed renewal. Traffic CNAMEs are a separate public cutover.

## Release artifact contract

The release unit is a selective server/browser archive, not a repository
snapshot and not a long-lived deployment image.

1. [`demo-package-manifest.txt`](../../deploy/aws/demo-package-manifest.txt)
   is the allowlist of deployable roots.
2. [`package-demo.sh`](../../deploy/aws/package-demo.sh) packages committed
   `HEAD` by default and refuses uncommitted changes under runtime paths.
3. It rejects repository history, local dependencies, build outputs, Rust
   targets, Android paths, and other forbidden content.
4. It emits a sidecar manifest recording schema version, source mode, Git SHA,
   archive SHA-256, file count, and `androidIncluded: false`.
5. [`release-demo.sh`](../../deploy/aws/release-demo.sh) uploads the archive to
   an immutable `releases/<commit>/...` S3 key and passes its release ID, key,
   and checksum into the installation lifecycle.
6. The host verifies the checksum and contents again before building or
   switching the active release.

`--include-worktree` is a development-only escape hatch for disposable
verification. It is not an attributable approved release and must not be used
for a customer demonstration claimed to represent a committed revision.

Android exclusion is defense in depth: the allowlist omits Android, the
packager rejects it, the sidecar declares its absence, and the host installer
validates the extracted artifact. Adding Android requires an independent
mobile distribution architecture; it must not be achieved by widening this
manifest.

## Environment lifecycle

### First creation

For a new stack, `release-demo.sh deploy`:

1. authenticates through the operator's active AWS CLI session and discovers
   the account and region;
2. creates or reuses an account/region-specific private S3 bucket with public
   access blocked, AES-256 encryption, and versioning;
3. packages and uploads the immutable committed release;
4. creates the CloudFormation stack;
5. EC2 user data runs
   [`bootstrap-demo.sh`](../../deploy/aws/bootstrap-demo.sh) exactly once;
6. bootstrap installs system dependencies, PostgreSQL, Node and Rust release
   binaries without running repository-only package lifecycle scripts,
   generates demo-only secrets, seeds the deterministic showcase, and starts
   services;
7. bootstrap records `STARTED`, `COMPLETE`, or `FAILED` in SSM; and
8. the controller waits for application completion and runs public smoke
   checks. `CREATE_COMPLETE` alone is not acceptance.

Bootstrap is not an updater. Rerunning it may regenerate or desynchronise
database, encryption, API, and login secrets.

### Ordinary code release

For an existing generation-2 stack, the same `deploy` command:

1. packages and uploads a new immutable release;
2. invokes [`update-demo.sh`](../../deploy/aws/update-demo.sh) through SSM;
3. downloads and verifies the release under `/opt/loanos/releases/<release-id>`;
4. installs dependencies without repository-only package lifecycle scripts
   and builds the Node/Rust runtime without mutating the currently active
   release;
5. refuses a database-schema difference with `REQUIRES_FRESH_STACK`;
6. atomically moves `/opt/loanos/current` to the new release;
7. restarts the rules runtime first, refreshes the model kill switch, and then
   restarts the API and Nginx;
8. requires rules and API health checks to pass; and
9. records the active and previous release in SSM.

If a post-switch step fails, the installer restores the prior symlink and
services and removes the failed release. Reinstalling an already active
release is idempotent.

### Database changes

The generation-2 updater intentionally has no implicit schema migration. A
change to `db/schema.sql` fails closed. Until a reviewed migration, backup,
rollback, compatibility, and rehearsal mechanism exists, create a replacement
synthetic stack, test it through the CloudFront hostname, and cut DNS over.

Never bypass this check by editing the host database or removing the schema
from the package. That creates an unrepeatable environment and can make the
previous release unsafe to restore.

## Canonical domain model

One CloudFront distribution and one wildcard certificate serve six stable
entry points. Root requests on specialised hosts are redirected to canonical
same-origin paths; API and asset traffic remains on the same host.

| Host | Experience | Canonical root target |
| --- | --- | --- |
| `demo.<root>` | Public showcase and product library | `/` |
| `staff.<root>` | Tenant staff workspace | `/t/dev/staff/` |
| `portal.<root>` | Borrower portal | `/t/dev/portal/` |
| `partners.<root>` | Partner workspace | `/t/dev/partners/` |
| `admin.<root>` | Platform administration login | `/t/dev/staff/?scope=platform` |
| `help.<root>` | Guide and Academy | `/help/` |

`DomainRoot` and `AcmCertificateArn` are paired CloudFormation parameters. The
template, not the console, owns aliases and the host-routing function. External
DNS publishes one CNAME per host to the distribution domain. An alternate
domain may be attached to only one CloudFront distribution at a time, so old
aliases must be removed before generation-2 cutover.

## State, secrets, and evidence

The stack exposes parameter names through CloudFormation outputs. The
parameters are scoped under `/loanos-demo/<stack>/`:

- `status` — first-boot state and diagnostic line;
- `release-status` — current update state;
- `release` — current/previous release, S3 key, checksum, and timestamps; and
- `credentials` — generated demo credentials in a `SecureString`.

Credentials must be decrypted only in a private operator session. Never paste,
screenshot, commit, or retain the JSON. Browser logins use the generated
tenant/platform passwords; API keys are integration credentials and are not
accepted by login forms.

The minimum release evidence retained for a demonstration is:

- Git commit and archive SHA-256;
- S3 object key/version and sidecar manifest;
- CloudFormation stack and outputs;
- bootstrap/release SSM status;
- public smoke-test result; and
- demo profile audit result (`showcase-v1`, 21 products, 14 personas, 105
  grants, 15 mocked integration families).

Public release smoke coverage includes the platform homepage, one product
journey deep link, `robots.txt`, `sitemap.xml`, `llms.txt`, the specialised
browser entry points, and both runtime health gates. Discovery files are exact
public allow-list entries; this does not broaden tenant or API access.

This evidence demonstrates repeatability of the synthetic showcase. It is not
production release, security, compliance, backup, or regulatory evidence.

## Security and cost boundary

- SSH and port 22 are absent; operators use Systems Manager.
- The host security group accepts origin HTTP only from the public network, but
  Nginx additionally requires a stack-specific secret origin header. This is a
  demo control, not a substitute for a private origin/VPC origin architecture.
- Release storage is private, versioned, encrypted, and checksummed.
- Login/encryption/API material is generated on first boot and stored in SSM;
  it is not embedded in the artifact.
- External integrations remain deterministic mocks and are labelled
  `productionReady: false`.
- The AWS Budget sends alerts only. Credits, free-tier eligibility, CloudFront
  transfer, EC2, storage, public IPv4, and other pricing can change; the stack
  cannot guarantee zero cost or automatically stop spend.

Operators must verify the AWS account, region, credits, budget recipient, and
teardown state. The runbook is the source for current commands and teardown.

## Failure and recovery contract

| Failure | Required response |
| --- | --- |
| CloudFormation create fails | Inspect the first failing event; do not treat rollback completion as acceptance. Correct template/input and create or update deliberately. |
| CloudFront alias conflict | Identify the old distribution, record rollback details, remove the old alias, wait for deployment, then attach via CloudFormation. |
| Bootstrap reports `FAILED` | Read the SSM status and `/var/log/loanos-bootstrap.log` through Session Manager. Correct code and release a new artifact; do not edit around attribution. |
| Release checksum/content fails | Reject the artifact. Repackage from committed source; never change the recorded checksum. |
| Build or health gate fails | Allow `update-demo.sh` to restore the previous release; inspect release status/logs and fix forward. |
| Database schema differs | Create and rehearse a replacement stack or implement a reviewed migration path. |
| DNS does not resolve | Check the six traffic CNAMEs separately from the ACM validation CNAME and wait for provider/CloudFront propagation. |
| Stack delete fails on CloudFront | Disable/delete conflicting aliases or distributions, retain evidence, and retry stack deletion; do not abandon billable resources. |

Manual hot-fixes on the EC2 host are diagnostic only. A durable fix must be
committed, packaged, deployed, and smoke-tested so the environment remains
reproducible.

## Production gap and promotion boundary

The showcase may inform production design, but it cannot be promoted in place.
A production programme needs, at minimum:

- separately admitted networking, private ingress/egress, WAF and workload
  identity;
- managed multi-AZ data services, encryption/KMS/HSM, backup/PITR, DR and
  restore evidence;
- independent per-tenant business and control rules runtimes;
- a signed build/SBOM/vulnerability/provenance chain and human maker-checker
  promotion;
- reviewed online/expand-contract database migrations;
- India-residency and provider admission evidence;
- centralized telemetry, alerting, incident response, SIEM/SOC and service
  management;
- capacity, availability, recovery, accessibility and security testing; and
- real tenant onboarding, secrets, DNS, certificate, offboarding, retention,
  legal-hold, and cost-allocation controls.

The production release authority remains the one defined in
[delivery operations](delivery-operations.md). AI agents and the synthetic
release script may prepare artifacts and evidence; they cannot approve or
promote a production release.

## Change obligations

Any change to `deploy/aws/` must review and, where relevant, update all of:

1. this architecture contract;
2. the [AWS deployment runbook](../../deploy/aws/README.md);
3. the [demo operator handbook](../operations/demo-handbook.md);
4. the [current implementation map](current-implementation.md);
5. [`AGENTS.md`](../../AGENTS.md); and
6. the sales demo narrative or claim register if public capability or
   presentation behavior changes.

Before merging a deployment change, validate shell syntax, the CloudFormation
template, the selective package (including zero Android paths), the canonical
demo audit, Node tests, Rust tests/clippy, documentation links, and public smoke
checks in a disposable or accepted synthetic environment.
