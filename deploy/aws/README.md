# AWS generation-2 synthetic showcase

This directory deploys the LoanOS India browser and server system as a
production-like **synthetic showcase** on AWS. It is a serious demonstration
environment, but it is not a production lending topology and must never hold
real borrower, bureau, bank, PAN, Aadhaar, or regulated-submission data.

The design replaces the original “zip the repository and rebuild everything”
flow with:

- an explicit server/browser package manifest;
- immutable, checksummed release objects in a private versioned S3 bucket;
- a stable CloudFormation-managed environment;
- first-boot provisioning only when the stack is created;
- version-aware in-place application releases through Systems Manager;
- automatic restoration of the last release when a health gate fails; and
- one CloudFront distribution serving canonical demo subdomains.

Android applications are excluded by construction. No path under
`apps/android-*` may enter the AWS release artifact.

Read this command-level runbook with the
[canonical deployment architecture](../../docs/architecture/aws-showcase-deployment.md),
[demo operator handbook](../../docs/operations/demo-handbook.md),
[current implementation map](../../docs/architecture/current-implementation.md),
and [production delivery boundary](../../docs/architecture/delivery-operations.md).
For presentation personas, all 21 product journeys, workshop tenants, mock
providers, claims discipline and demo-day operation, the handbook is the
operating source.

## 1. Scope and topology

The release includes the API, shared/domain packages, PostgreSQL schema, Rust
decision engine, and these browser applications:

- public platform website;
- tenant landing and administration;
- staff/loan-officer workspace;
- borrower portal;
- partner workspace;
- platform administration;
- Guide and Academy; and
- the specialised browser journey applications used by the server.

The stack creates one encrypted Ubuntu EC2 host, local PostgreSQL, one
tenant-bound Rust engine for tenant `dev`, Nginx, Systems Manager access,
CloudFront HTTPS, and an AWS Budget. The host has no SSH key or port 22.
CloudFront sends a stack-specific origin header and Nginx rejects direct origin
requests without it.

This co-located shape is appropriate only for synthetic demonstrations. A real
production system requires independent availability, database, secrets,
networking, observability, backup, tenant-engine isolation and operational
admission work.

## 2. Files and release contract

The architecture and this runbook are a pair: the architecture defines what
must remain true; this file explains how an operator performs and verifies it.

| File | Purpose |
| --- | --- |
| `demo-package-manifest.txt` | Explicit allowlist of deployable server/browser source roots |
| `package-demo.sh` | Builds and verifies the selective archive plus release manifest |
| `cloudformation-demo.yaml` | Stable generation-2 infrastructure and domain routing |
| `bootstrap-demo.sh` | One-time host/database/credential bootstrap for a new stack |
| `update-demo.sh` | Immutable in-place code installer with health gates and automatic restore |
| `release-demo.sh` | Operator CLI: create/update, domains, status, DNS plan and smoke tests |

The artifact is a temporary transport package, not the deployment model. Its
contents are selected by `demo-package-manifest.txt`, not by archiving the
repository root. The generated sidecar records schema version, Git SHA,
archive SHA-256, file count, source mode, and `androidIncluded: false`.

Normal releases package committed `HEAD` and refuse changes in runtime paths.
This makes the deployed code attributable. `--include-worktree` is an explicit
development-only escape hatch; it must not be presented as an approved release.

## 3. One-time operator prerequisites

1. Install and authenticate the AWS CLI for the intended account. An SSO or
   credential session may expire and need renewal, but the deployment does not
   create new long-lived access keys.
2. Use Mumbai (`ap-south-1`) unless the environment has an approved alternative.
3. Confirm AWS credits/free-tier eligibility and a monitored budget email.
   Budgets alert; they do not stop resources or guarantee zero cost.
4. For custom domains, request/retain a wildcard ACM certificate in
   `us-east-1`, for example `*.aitailorworkshop.in`. Keep the ACM DNS-validation
   CNAME in GoDaddy permanently so managed renewal can continue.
5. Validate the intended commit:

   ```bash
   npm test
   (cd rules && cargo test --workspace)
   (cd rules && cargo clippy --workspace --all-targets -- -D warnings)
   npm run demo:audit
   bash -n deploy/aws/bootstrap-demo.sh deploy/aws/update-demo.sh \
     deploy/aws/package-demo.sh deploy/aws/release-demo.sh
   aws cloudformation validate-template --region ap-south-1 \
     --template-body file://deploy/aws/cloudformation-demo.yaml
   ```

## 4. Create the new real demo environment

From the repository root, use a stable stack name. The script discovers the
AWS account, creates a private account/region-specific source bucket when
needed, enables versioning/encryption/public-access blocking, builds the
selective release, uploads it, creates the stack, waits for bootstrap, and
runs the full public smoke suite.

```bash
./deploy/aws/release-demo.sh deploy \
  --stack loanos-showcase \
  --email demo-ops@example.com
```

The first build installs Node, Rust and PostgreSQL and may take 15–40 minutes.
CloudFormation `CREATE_COMPLETE` alone is insufficient; the command also waits
for the bootstrap status parameter to report `COMPLETE`.

Inspect the environment at any time:

```bash
./deploy/aws/release-demo.sh status --stack loanos-showcase
./deploy/aws/release-demo.sh smoke --stack loanos-showcase
```

Use the returned CloudFront hostname until custom DNS is ready. This cleanly
separates infrastructure acceptance from public DNS cutover.

### Direct creation with domains

If none of the six names is attached to another CloudFront distribution, the
stack can be created with them immediately:

```bash
./deploy/aws/release-demo.sh deploy \
  --stack loanos-showcase \
  --email demo-ops@example.com \
  --domain-root aitailorworkshop.in \
  --certificate-arn 'arn:aws:acm:us-east-1:ACCOUNT:certificate/ID'
```

## 5. Canonical domains and GoDaddy DNS

One distribution and one wildcard certificate serve the following entry
points. CloudFront redirects only the root of each specialised hostname to its
canonical application path; all application/API traffic remains same-origin.

| Hostname | Experience | Canonical path |
| --- | --- | --- |
| `demo.aitailorworkshop.in` | Public showcase and product library | `/` |
| `staff.aitailorworkshop.in` | Tenant staff workspace | `/t/dev/staff/` |
| `portal.aitailorworkshop.in` | Borrower portal | `/t/dev/portal/` |
| `partners.aitailorworkshop.in` | Partner workspace | `/t/dev/partners/` |
| `admin.aitailorworkshop.in` | Platform administration login | `/t/dev/staff/?scope=platform` |
| `help.aitailorworkshop.in` | Guide and Academy | `/help/` |

Attach the domain to an already accepted stack:

```bash
./deploy/aws/release-demo.sh domains \
  --stack loanos-showcase \
  --domain-root aitailorworkshop.in \
  --certificate-arn 'arn:aws:acm:us-east-1:ACCOUNT:certificate/ID'
```

Then print the exact DNS plan:

```bash
./deploy/aws/release-demo.sh dns --stack loanos-showcase
```

In GoDaddy, add/update six traffic records. Each record is type `CNAME`; its
Name is `demo`, `staff`, `portal`, `partners`, `admin`, or `help`; its Value is
the returned `d....cloudfront.net` name without `https://` or a path. TTL may
be 30 minutes or one hour. These traffic records are separate from the ACM
validation CNAME, which must remain.

Verify after DNS and the CloudFront update have propagated:

```bash
dig +short demo.aitailorworkshop.in @8.8.8.8
curl -fsS https://demo.aitailorworkshop.in/health
curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://staff.aitailorworkshop.in/
```

### Migration from the old demo distribution

An alternate domain name can belong to only one CloudFront distribution. For
the existing `demo` hostname:

1. Create and accept generation 2 on its CloudFront hostname.
2. Record the old distribution and DNS target for rollback.
3. Remove the alias from the old distribution (or delete the old disposable
   stack/distribution) and wait for that change to deploy.
4. Run the `domains` command against `loanos-showcase`.
5. Point all six GoDaddy traffic CNAMEs to the new distribution.
6. Run custom-domain smoke tests before deleting remaining old resources.

Do not manually add aliases to the new distribution after CloudFormation owns
it; console-only changes create drift and can be removed by a later update.

## 6. Future code releases

For ordinary server/browser code changes, run the same command and same stack:

```bash
./deploy/aws/release-demo.sh deploy \
  --stack loanos-showcase \
  --email demo-ops@example.com
```

The script intelligently detects that generation 2 exists, reuses its source
bucket, uploads `releases/<commit>/loanos-server-web.tar.gz`, and installs the
release over Systems Manager. It does not update EC2 user data, rerun first
boot, recreate PostgreSQL, or rotate login/encryption material.

The host builds into `/opt/loanos/releases/<release-id>`, atomically changes
`/opt/loanos/current`, restarts rules first, refreshes the kill switch, then
restarts the API/Nginx. API and rules health must pass. On a post-switch error,
the installer restores the previous symlink and services automatically.

If `db/schema.sql` changed, the installer reports `REQUIRES_FRESH_STACK` and
does not apply it. Database migrations require an explicit reviewed migration
and rollback design. Until that exists, deploy a new synthetic stack, rehearse
the change, accept it, and cut DNS over.

Never rerun `bootstrap-demo.sh` as an update. It generates database,
encryption, API and login secrets and is intentionally first-boot only.

## 7. Status, release evidence, and credentials

`status` prints CloudFormation, bootstrap and release state, current release
metadata, the CloudFront URL, and configured custom entry points:

```bash
./deploy/aws/release-demo.sh status --stack loanos-showcase
```

CloudFormation outputs point to four SSM parameters:

- `/loanos-demo/<stack>/status` — first-boot state;
- `/loanos-demo/<stack>/release-status` — current update state;
- `/loanos-demo/<stack>/release` — release ID, S3 key, SHA and previous release;
- `/loanos-demo/<stack>/credentials` — generated `SecureString` credentials.

Retrieve credentials only in a private operator session:

```bash
aws ssm get-parameter --region ap-south-1 \
  --name /loanos-demo/loanos-showcase/credentials \
  --with-decryption --query Parameter.Value --output text | jq
```

Do not paste, screenshot, commit, or retain the decrypted JSON. Browser users
use passwords, not API keys:

- tenant administrator: `admin@dev.local` + `tenantAdminPassword`;
- platform administrator: `admin@platform.local` +
  `platformAdminPassword`, at `admin.<root>` or with Platform administration
  selected on the staff login;
- API keys are integration credentials and are not accepted by login forms.

## 8. Host operations

Use Systems Manager Session Manager, never SSH.

| Item | Location |
| --- | --- |
| Active application symlink | `/opt/loanos/current` |
| Immutable releases | `/opt/loanos/releases/<release-id>` |
| API environment | `/etc/loanos/api.env` |
| Rules environment | `/etc/loanos/rules.env` |
| Bootstrap log | `/var/log/loanos-bootstrap.log` |
| Services | `loanos-api`, `loanos-rules`, `loanos-kill-switch.timer`, `nginx`, `postgresql` |

```bash
sudo systemctl --no-pager --full status \
  loanos-api loanos-rules loanos-kill-switch.timer nginx postgresql
curl -fsS http://127.0.0.1:3040/health | jq
curl -fsS http://127.0.0.1:47311/health | jq
sudo tail -n 200 /var/log/loanos-bootstrap.log
```

The rules response must contain `kill_switch_fresh: true`. Unavailable or
stale decision infrastructure remains fail-closed.

## 9. Failure handling

| Symptom | Response |
| --- | --- |
| CloudFormation rolls back | Find the first `CREATE_FAILED` event; fix it and use a fresh stack name if rollback completed |
| Bootstrap reports `FAILED` | Inspect `/var/log/loanos-bootstrap.log` and relevant systemd journals through SSM |
| Release reports `FAILED ... previous release restored` | Verify old public health, inspect SSM command output, fix code, and release a new commit |
| Release reports `REQUIRES_FRESH_STACK` | Do not force the schema; create a new rehearsal stack |
| CloudFront alias conflict | Remove the hostname from the old distribution and wait until deployed before attaching it here |
| Deep product page asks for tenant auth | Old routing code is active; release the current committed server/browser artifact |
| Login rejects generated credentials | Confirm stack name/parameter, platform vs tenant scope, email field, and use the password rather than API/admin key |
| Rules health is stale | Refresh the kill switch; never bypass its gate |

The S3 archive and manifest, Git SHA, CloudFormation events, SSM release JSON,
and smoke result form the non-secret release evidence chain.

## 10. Cost and teardown

The stack deliberately avoids NAT Gateway, load balancer, RDS, Elastic IP and
Route 53. EC2, EBS, public IPv4, S3, CloudFront, data transfer and taxes can
still consume credits or incur charges. Review Billing; a Budget is not a cap.

To retire an environment:

1. Move or delete its six GoDaddy traffic CNAMEs.
2. Delete the CloudFormation stack and wait for `DELETE_COMPLETE`.
3. Delete its four instance-created SSM parameters (`credentials`, `status`,
   `release`, and `release-status`).
4. Retain the private versioned release bucket only while another environment
   or rollback evidence needs it; empty all object versions before deleting it.
5. Check EC2 Global View, EBS, public IPv4, CloudFront, S3, SSM and Billing for
   leftovers.

Do not manually delete a CloudFormation-owned distribution first. That creates
stack drift and is a common reason teardown becomes stuck. If drift already
exists, retry stack deletion after the distribution is fully deleted and use
CloudFormation’s retain/delete remediation only for the specific failed
resource.
