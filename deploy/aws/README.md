# AWS synthetic demo deployment runbook

This runbook deploys the complete LoanOS India **synthetic-data demo** to AWS:

- the public platform website (`apps/web`);
- the tenant landing page (`apps/tenant`);
- the staff workspace (`apps/dashboard`);
- the borrower portal (`apps/customer`);
- the Node control/data-plane API;
- PostgreSQL with the repository schema and tenant RLS roles; and
- one active, tenant-bound Rust decision-engine runtime for tenant `dev`.

It is deliberately a low-cost demonstration topology. The services are
co-located on one encrypted EC2 host, external providers run in mock mode, and
CloudFront is the HTTPS entry point. It is **not** a production topology and
must never contain borrower data, PAN/Aadhaar values, bureau files, bank data,
or real regulated submissions.

For customer-facing preparation, personas, all 21 journeys, workshop tenants,
mock boundaries, claims discipline, recovery and demo-day checklists, use the
[synthetic demo operator handbook](../../docs/operations/demo-handbook.md).

## Repository deployment files

| File | Purpose |
| --- | --- |
| `cloudformation-demo.yaml` | VPC, EC2, IAM, CloudFront, and AWS Budget infrastructure |
| `bootstrap-demo.sh` | Host installation, database setup, service units, credentials, and health gates |
| `package-demo.sh` | Reproducible archive of committed repository source |
| `release-demo.sh` | Versioned S3 upload, CloudFormation deploy, bootstrap wait, status, and smoke tests |
| `README.md` | This operator runbook |

`package-demo.sh` packages `HEAD`, not uncommitted working-tree changes. This
keeps the deployed revision attributable to a commit. Commit and validate the
intended code before packaging it.

## What the stack creates

- one VPC, public subnet, route table, and internet gateway;
- one encrypted Ubuntu EC2 instance (`t3.small` by default) with a 24 GB `gp3`
  root volume and public IPv4 address;
- one security group exposing only origin HTTP port 80;
- one CloudFront distribution providing the public HTTPS endpoint, disabling
  caching for the dynamic application, and adding a stack-specific secret
  origin header;
- Nginx rejecting direct EC2 requests that do not contain that origin header;
- one IAM instance role and profile for private S3 download, Parameter Store,
  and Systems Manager Session Manager—there is no SSH key or port 22;
- an AWS Budget with forecasted 50%, actual 80%, and actual 100% alerts;
- local PostgreSQL, Node, Nginx, and systemd services;
- one active Rust runtime bound to tenant `dev`, plus a periodic kill-switch
  freshness job; and
- generated credentials in an SSM Parameter Store `SecureString`.

AWS credits are still consumed. EC2, EBS, public IPv4, S3, and CloudFront may
all be billable. A Budget sends alerts; it is not a hard spending cap.

## 1. Prerequisites and safety controls

Before creating resources:

1. Sign in to the intended AWS account and choose one region. The tested
   deployment used **Asia Pacific (Mumbai), `ap-south-1`**.
2. In **Billing and Cost Management**, confirm credits/free-tier eligibility.
3. Create an AWS Budget or use the stack's `MonthlyBudgetUsd` parameter. Use a
   real monitored email and confirm its subscription email.
4. Keep screenshots free of account IDs, decrypted parameters, passwords,
   tokens, API keys, and session cookies.
5. Run the repository checks appropriate to the revision being deployed:

   ```bash
   npm test
   (cd rules && cargo test --workspace)
   (cd rules && cargo clippy --workspace --all-targets -- -D warnings)
   bash -n deploy/aws/bootstrap-demo.sh deploy/aws/package-demo.sh deploy/aws/release-demo.sh
   cfn-lint deploy/aws/cloudformation-demo.yaml
   ```

## 2. Automated committed release (recommended)

Run the wrapper from the repository root. It discovers the AWS account,
generates an account/region-specific private source bucket when one is not
provided, packages committed `HEAD`, uploads a versioned source object, deploys
the template, waits for the SSM bootstrap status, and runs GET-based health and
website smoke tests. The budget-alert email is the only required deployment
input.

```bash
./deploy/aws/release-demo.sh deploy --email demo-ops@example.com
```

Optional settings can be supplied as flags (`--region`, `--stack`, and
`--bucket`) or environment variables. Custom-domain values remain environment
variables because they are certificate and DNS-controlled:

```bash
ALTERNATE_DOMAIN_NAME="demo.example.com" \
ACM_CERTIFICATE_ARN="arn:aws:acm:us-east-1:<account>:certificate/<id>" \
./deploy/aws/release-demo.sh deploy --email demo-ops@example.com
```

After deployment, inspect or smoke-test the same stack with:

```bash
./deploy/aws/release-demo.sh status
./deploy/aws/release-demo.sh smoke
```

Use a new `STACK_NAME` for the preferred blue/green update. `deploy` can also
update an existing disposable stack, but infrastructure changes may replace
the host and regenerate credentials. AWS CLI authentication, account/region
selection, billing review, certificate validation, DNS cutover, and decrypted
credential retrieval remain human-guarded actions.

The remaining steps document the equivalent console/manual procedure and are
also the troubleshooting reference for the automated path.

## 3. Package the committed source manually

From the repository root:

```bash
./deploy/aws/package-demo.sh
```

The command creates `loanos-demo-source.tar.gz`, mode `0600`, and prints its
SHA-256 digest. Record the commit SHA and archive digest in the deployment
ticket or release note; do not commit the archive.

The repository may be private. Never put a GitHub token in CloudFormation,
EC2 user data, or the archive. The private S3 handoff avoids that requirement.

## 4. Create the private source bucket

In the same region as the stack:

1. Open **S3 → Create bucket**.
2. Select **General purpose** and keep **Block all public access** enabled.
3. Use a globally unique name, for example `loanos-demo-source-<random>`.
4. Create the bucket and upload `loanos-demo-source.tar.gz` at its root.
5. Keep default server-side encryption enabled.

The stack grants its instance read access only to the exact bucket and object
key supplied as parameters. The bucket itself remains private.

## 5. Create the CloudFormation stack

1. Open **CloudFormation → Stacks → Create stack → With new resources**.
2. Choose **Upload a template file** and select
   `deploy/aws/cloudformation-demo.yaml`.
3. Use a stack name such as `loanos-demo`.
4. Enter the parameters:

   | Parameter | Recommended demo value |
   | --- | --- |
   | `AlertEmail` | monitored operator email |
   | `SourceBucket` | private bucket created above |
   | `SourceKey` | `loanos-demo-source.tar.gz` |
   | `InstanceType` | `t3.small` |
   | `MonthlyBudgetUsd` | `25` or a lower operator-approved threshold |
   | `LatestUbuntuAmi` | keep the supplied SSM public-parameter default |
   | `AlternateDomainName` | optional full hostname such as `demo.example.com`; leave empty when unused |
   | `AcmCertificateArn` | optional `us-east-1` ACM certificate covering that hostname; must be paired with `AlternateDomainName` |

5. Leave stack options at their defaults unless the account has a required
   tagging or CloudFormation service-role policy.
6. On review, acknowledge creation of named/managed IAM resources and create
   the stack.
7. Wait for `CREATE_COMPLETE`. CloudFront is global and is expected to take
   several minutes.

CloudFormation completion means the AWS resources exist; it does not mean the
host bootstrap has completed.

## 6. Verify bootstrap completion

Open the stack's **Outputs** tab and record:

- `DemoUrl`;
- `InstanceId`;
- `CredentialsParameter`;
- `BootstrapStatusParameter`; and
- `BootstrapLogCommand`.

Then open **Systems Manager → Parameter Store** in the stack region and inspect
the parameter named by `BootstrapStatusParameter`:

- `STARTED`: installation is still running;
- `COMPLETE`: both services passed their fail-closed health gates and the
  encrypted credentials parameter was written;
- `FAILED at bootstrap line ...`: use the diagnostics section below.

The first Rust release build can take 15–25 minutes. Do not rerun the bootstrap
while it is still active.

## 7. Application URLs and smoke tests

All applications share the CloudFront hostname:

| Application | URL path |
| --- | --- |
| Public platform website | `/` |
| Tenant landing page | `/t/dev/` |
| Tenant staff workspace | `/t/dev/staff/` |
| Borrower/customer portal | `/t/dev/portal/` |
| API health | `/health` |

After status is `COMPLETE`, open `DemoUrl` and each application path. A CLI
smoke test can be run from any trusted machine:

```bash
curl -fsS "${DEMO_URL}health" | jq
curl -fsS -o /dev/null -w '%{http_code}\n' "$DEMO_URL"
```

Expected results are API status `ok` and website HTTP `200`. A `HEAD` request
(`curl -I`) is not a substitute for the website GET test because static routes
are GET routes.

## 8. Optional custom domain with external DNS (GoDaddy)

Prefer a dedicated subdomain such as `demo.example.com`. It keeps the apex
domain independent and can be routed to CloudFront with a standard CNAME.

1. In **AWS Certificate Manager**, switch to **US East (N. Virginia),
   `us-east-1`** and request a public certificate covering the complete
   hostname or wildcard. CloudFront requires its certificate in `us-east-1`
   even when the stack and origin are elsewhere. A wildcard such as
   `*.example.com` covers subdomains but not the apex `example.com`.
2. Choose DNS validation and record the validation CNAME shown by ACM.
3. In GoDaddy DNS, create the CNAME shown by ACM for domain validation:
   - **Name**: enter only ACM's host portion, such as `_validation-token`;
     GoDaddy appends the zone name;
   - **Value**: enter the complete `*.acm-validations.aws` target; and
   - **TTL**: the default value is suitable.
4. Keep that validation CNAME permanently. ACM uses it for automatic
   certificate renewal. Wait for ACM status `Issued` and copy its ARN.
5. Supply the hostname as `AlternateDomainName` and the ARN as
   `AcmCertificateArn` when creating/updating the stack. With the release
   wrapper, export both variables and run `release-demo.sh deploy`.
6. Wait until CloudFormation completes and the distribution reports
   `Deployed`.
7. Add the traffic-routing CNAME in GoDaddy:
   - **Name**: `demo` (or the chosen subdomain);
   - **Value**: the distribution hostname, for example
     `d123example.cloudfront.net`; and
   - do not include `https://`, a path, or the custom hostname itself.

The ACM-validation and traffic-routing CNAMEs are separate records and both
must remain present. Verify public DNS and HTTPS after propagation:

```bash
dig +short demo.example.com @8.8.8.8
curl -fsS -o /dev/null -w '%{http_code}\n' https://demo.example.com/
curl -fsS https://demo.example.com/health | jq
```

If public DNS works but a Mac still reports that it cannot find the server,
wait for its negative cache to expire or flush the local cache:

```bash
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

GoDaddy cannot place a conventional CNAME at the zone apex. Keep
`example.com`/`www` separate, or move authoritative DNS to Route 53 and use an
Alias record if the apex must serve this distribution.

### CloudFormation ownership and drift

The template owns the alternate hostname and certificate through explicit
parameters. Do not add or change the alias only in the CloudFront console; that
creates drift and can be removed by a later stack update. Never embed GoDaddy
credentials or certificate-validation tokens in the source archive.

## 9. Retrieve credentials and sign in

Open **Systems Manager → Parameter Store**, select the `SecureString` named by
the stack's `CredentialsParameter` output, and choose **Show decrypted value**.
Do this privately. Never paste the JSON into chat, tickets, logs, or screenshots.

Tenant staff login:

- scope: tenant;
- tenant ID: `dev`;
- email: `admin@dev.local`;
- password: `tenantAdminPassword` from the secure parameter.

The synthetic showcase also seeds the role personas listed in the
[demo handbook](../../docs/operations/demo-handbook.md#61-showcase-personas).
Each persona signs in at the same tenant URL with its documented `@dev.local`
email and the same `tenantAdminPassword`. This shared password is strictly a
synthetic-demo convenience and must never be copied into a real tenant.

Platform administration login:

- URL: `/t/dev/staff/`; choose **Platform administration** on the sign-in page;
- email: `admin@platform.local`;
- password: `platformAdminPassword` from the secure parameter.

`platformAdminKey` is an integration credential. It is not accepted by the
browser sign-in form.

The same parameter contains synthetic-demo API and platform credentials for
automated testing. Treat them as secrets even though the data is synthetic.

## 10. Service layout and operations

Use **Systems Manager → Session Manager**, not SSH. Important paths and units:

| Item | Location |
| --- | --- |
| Application source | `/opt/loanos/app` |
| API environment | `/etc/loanos/api.env` (root-readable only) |
| Rules environment | `/etc/loanos/rules.env` (root-readable only) |
| Bootstrap log | `/var/log/loanos-bootstrap.log` |
| API service | `loanos-api.service` |
| Rules service | `loanos-rules.service` |
| Kill-switch timer | `loanos-kill-switch.timer` |
| Reverse proxy | `nginx.service` |
| Database | `postgresql.service` |

Health and status commands:

```bash
sudo systemctl --no-pager --full status \
  loanos-api loanos-rules loanos-kill-switch.timer nginx postgresql
curl -fsS http://127.0.0.1:3040/health | jq
curl -fsS http://127.0.0.1:47311/health | jq
sudo tail -n 200 /var/log/loanos-bootstrap.log
```

The rules health response must report `kill_switch_fresh: true`. A stale or
unreachable rules engine is not a permissive condition; decision paths fail
closed.

## 11. Updating application code

### Recommended: replacement stack (blue/green demo update)

This demo is disposable and its bootstrap generates database, encryption, API,
and login secrets. The safest update is immutable replacement:

1. Complete and validate the code change locally.
2. Commit it; record the commit SHA.
3. Set a new `STACK_NAME` and run `release-demo.sh deploy`. The script packages
   `HEAD`, uploads under `releases/<commit-sha>/`, waits, and smoke-tests.
4. Manually smoke-test all application and product-journey deep links.
5. Retrieve the new credentials privately and verify staff login.
6. Move the external-DNS CNAME only after the replacement is accepted.
7. Delete the old stack and its two SSM parameters after the rollback window.

This gives a clean rollback: keep using the old URL until the replacement has
passed. It also avoids mixing old encrypted rows with new key material.

### Do not rerun bootstrap as an upgrade

`bootstrap-demo.sh` is first-boot installation, not a migration runner. It
generates new encryption and authentication material. Rerunning it against an
existing database can make existing encrypted tenant envelopes unreadable.
Never run it to deploy a code update.

### Emergency in-place demo patch

Use only for a disposable synthetic demo when replacement is impractical:

1. Preserve `/etc/loanos/api.env`, `/etc/loanos/rules.env`, and the database.
2. Back up the current `/opt/loanos/app` and record its commit.
3. Copy a reviewed archive to a staging directory.
4. Run schema changes explicitly as the database owner and review grants/RLS.
5. Build/install dependencies in staging.
6. Atomically switch the application directory.
7. Restart rules first, refresh the kill switch, then restart the API and
   Nginx.
8. Run all local and CloudFront smoke tests. Restore the prior directory on
   failure.

Do not automate this path by sourcing or printing secret environment files.
For repeatable updates, create a replacement stack instead.

## 12. Troubleshooting

### CloudFormation fails or rolls back

Open **Events → View root cause** and capture the first `CREATE_FAILED` status
reason. Fix the template, delete the rolled-back disposable stack, and create a
new one. Do not infer the root cause from the final rollback event.

### Bootstrap status is `FAILED`

Start an SSM session using the stack's `InstanceId`, then run:

```bash
sudo tail -n 200 /var/log/loanos-bootstrap.log
```

Inspect the service associated with the final error:

```bash
sudo journalctl -u loanos-api.service -n 80 --no-pager
sudo journalctl -u loanos-rules.service -n 80 --no-pager
```

Redact secrets before sharing logs. Older application revisions printed the
development API key at startup; current code logs only that the key was loaded.
Rotate any credential that appears in a log or screenshot.

### Website returns JSON `internal_error`

Test `/health`, then inspect the API journal for the matching request ID. A
healthy CloudFront response carrying application JSON means TLS and origin
routing work; diagnose the application rather than recreating networking.

### PostgreSQL permission errors

Use `db/schema.sql` as the source of truth. The tenant hot-path role remains
RLS-constrained; the control-plane role alone has the cross-tenant cleanup
privilege needed for explicit offboarding/whole-state synchronization. Do not
solve permission errors with superuser application credentials or by disabling
RLS.

### Encrypted tenant data cannot be authenticated

Do not discard or replace the active master-key ring for any environment with
data. For this synthetic disposable demo, prefer creating a replacement stack.
Never apply a synthetic-data reset procedure to real or production data.

## 13. Cost controls and teardown

Confirm the AWS Budget email subscription. Review **Billing → Bills** and the
Free Tier/credit pages regularly. The stack intentionally creates no NAT
Gateway, load balancer, Elastic IP, RDS database, or Route 53 hosted zone.

To remove the demo:

1. If a custom domain was configured, delete its traffic-routing CNAME before
   deleting the distribution. Detach the ACM certificate from all CloudFront
   distributions before deleting it. Remove the ACM-validation CNAME only when
   the certificate is no longer required anywhere.
2. Delete the CloudFormation stack and wait for `DELETE_COMPLETE`. The root EBS
   volume has `DeleteOnTermination: true`.
3. Manually delete the two instance-created parameters:

   ```text
   /loanos-demo/<stack-name>/credentials
   /loanos-demo/<stack-name>/status
   ```

4. Delete the versioned source object and private S3 bucket when no longer
   needed.
5. Check EC2 Global View, CloudFront, S3, Systems Manager Parameter Store, and
   Billing for leftovers.
6. Retain only non-secret deployment evidence: commit SHA, template version,
   archive SHA-256, stack timestamps, and smoke-test results.
