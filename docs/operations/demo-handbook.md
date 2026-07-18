# LoanOS Synthetic Demo Operator Handbook

This is the canonical field guide for preparing and running a serious LoanOS
platform demonstration. It covers the two supported demo modes, all 21 product
journeys, operator personas, mocked provider boundaries, AWS release handling,
custom domains, recovery, evidence, cost control, and teardown.

Read it with the
[AWS showcase deployment architecture](../architecture/aws-showcase-deployment.md)
for the technical contract and the
[AWS deployment runbook](../../deploy/aws/README.md) for exact commands. The
[sales demo narrative](../gtm/sales/demo-script.md) governs the presentation
sequence and approved claim language.

The demo proves platform behavior with **synthetic data only**. It is not a
production deployment, a regulatory certification, or evidence that a live
provider is connected. Never enter real borrower data, PAN or Aadhaar values,
bureau files, bank statements, payment instructions, production credentials,
or regulated submissions.

## 1. Supported demo modes

| Mode | Tenant | Purpose | Starting state | Decision-engine boundary |
| --- | --- | --- | --- | --- |
| Showcase | `dev` | A dependable, broad demonstration of the implemented platform | Deterministically preconfigured with 21 products, 14 personas, 105 product-role grants, one all-product subscription, and 15 mocked integration families | One dedicated business rules runtime bound to `dev`; no production control-engine fleet |
| Customer workshop | `workshop-<session>` | Build a tenant shell and first product live with a customer | Synthetic sandbox with one personal-loan product and a generated owner; expand configuration during the session | A new dedicated business runtime is required before decisioning. It must never reuse the showcase runtime |

Both modes are marked `syntheticOnly`, force every external service to mock
mode, and are explicitly `productionReady: false`. The showcase seed is
repeatable. The workshop flow is intentionally incomplete until its own engine
boundary is provisioned: decisioning must fail closed rather than silently use
another tenant's runtime.

The AWS demo co-locates PostgreSQL, Node, Nginx, and one Rust engine on one EC2
host to control cost. Production requires separate per-tenant business and
`ctrl-*` platform-control engines, stronger infrastructure isolation, live
provider certification, managed data services, and the full controls in the
architecture documents.

## 2. What is automated and what remains guarded

| Activity | Status | Command or control |
| --- | --- | --- |
| Validate the canonical showcase definition | Automated | `npm run demo:audit` |
| Generate a deterministic showcase profile | Automated | `node scripts/demo-system.mjs showcase --tenant-id dev` |
| Seed/repair the showcase records during API bootstrap | Automated | API bootstrap applies `showcase-v1` without removing unrelated operational records |
| Generate a workshop manifest | Automated | `node scripts/demo-system.mjs workshop --session <id>` |
| Create a synthetic workshop tenant shell | Automated with explicit confirmation | `npm run demo:create-workshop -- ... --confirm-synthetic-only` |
| Build the selective server/browser release, upload it, create/update the environment, wait, and smoke-test | Automated | `./deploy/aws/release-demo.sh deploy`; Android apps are excluded by the package manifest |
| Read infrastructure/bootstrap/release status and run public smoke tests | Automated | `release-demo.sh status` and `release-demo.sh smoke` |
| Install a committed code release without recreating the database or credentials | Automated with fail-closed health gates | Re-run `release-demo.sh deploy` against a generation-2 stack |
| Bind the six canonical subdomains and existing ACM certificate | Template-owned | `release-demo.sh domains --domain-root ... --certificate-arn ...` |
| AWS sign-in, MFA, account/region choice, billing review | Human guarded | Operator verifies identity, account, credits, and budget |
| ACM DNS validation and external DNS cutover | Human guarded | DNS-provider change; independently verify record and target |
| Retrieve generated demo credentials | Human guarded | SSM `SecureString`; never print, paste, or screenshot |
| Provision a dedicated engine for a workshop tenant | Guarded and not yet one-command | Required before workshop decisioning; use the decision-engine runbook and preserve tenant isolation |
| Connect a live provider or use real data | Prohibited in this topology | Create a production-readiness programme instead |

Automation deliberately stops where an action selects an AWS account, exposes
a secret, changes public DNS, creates a tenant-specific trust boundary, spends
money without a bounded stack, or could be mistaken for production admission.

## 3. Repository and environment preflight

Run from the repository root:

```bash
git status --short
npm ci
npm test
(cd rules && cargo test --workspace)
(cd rules && cargo clippy --workspace --all-targets -- -D warnings)
npm run demo:audit
bash -n deploy/aws/bootstrap-demo.sh deploy/aws/update-demo.sh \
  deploy/aws/package-demo.sh deploy/aws/release-demo.sh
aws cloudformation validate-template --region ap-south-1 \
  --template-body file://deploy/aws/cloudformation-demo.yaml
```

The generation-2 release contains only the paths allowlisted in
`deploy/aws/demo-package-manifest.txt`; Android applications, repository
history, local dependencies and build outputs are forbidden. Normal releases
contain committed `HEAD` only. Commit the exact revision to be shown and
record its SHA. `--include-worktree` is for disposable development checks and
must not be described as an approved release.

The audit must report:

- profile `showcase-v1` for tenant `dev`;
- `syntheticOnly: true` and `productionReady: false`;
- exactly 21 products, 14 personas, 105 grants, and 15 mock integrations; and
- a dedicated `dev` business-engine boundary.

## 4. AWS release procedure

### 4.1 Create the generation-2 showcase

Use a stable stack name. The first invocation creates the private versioned
release bucket, selective artifact, CloudFormation environment and immutable
release layout, then waits for first-boot bootstrap and public smoke checks.

```bash
./deploy/aws/release-demo.sh deploy \
  --stack loanos-showcase \
  --email demo-ops@example.com
./deploy/aws/release-demo.sh status --stack loanos-showcase
./deploy/aws/release-demo.sh smoke --stack loanos-showcase
```

The wrapper generates the account/region-specific source-bucket name and
creates it with public access blocked, AES-256 encryption and versioning.
Optional `--region`, `--stack`, and `--bucket` flags override defaults.

The script packages committed source under
`releases/<commit>/loanos-server-web.tar.gz`, verifies its SHA-256 on the host,
waits up to 40 minutes for bootstrap `COMPLETE`, and tests health and every
browser entry point. Accept the CloudFront hostname before public DNS cutover.

### 4.2 Ordinary same-environment code release

Re-run the same command against `loanos-showcase`. The wrapper detects
generation 2, reuses its bucket, and installs the immutable release through
Systems Manager. It does not update EC2 user data, rerun bootstrap, recreate
PostgreSQL, or rotate credentials/encryption keys.

The installer builds in a staging release directory, atomically changes
`/opt/loanos/current`, restarts rules first, refreshes the kill switch, restarts
the API and checks both health endpoints. A failed post-switch gate restores
the previous release. A `db/schema.sql` difference fails with
`REQUIRES_FRESH_STACK`; it is never applied as an unreviewed migration.

### 4.3 Replacement stack for infrastructure/schema change

Create a second stack name, accept it on the CloudFront hostname, then cut DNS
over. Keep the old target until acceptance. An alternate domain can belong to
only one CloudFront distribution, so remove it from the old distribution and
wait for deployment before attaching it to the replacement. Never rerun
`bootstrap-demo.sh` as an upgrade.

### 4.4 Deployment outputs

Record the non-secret values from CloudFormation:

- `DemoUrl` and, when configured, all six custom entry-point URLs;
- `InstanceId`;
- `BootstrapStatusParameter`;
- `ReleaseStatusParameter` and `ReleaseParameter`;
- `CredentialsParameter`; and
- `BootstrapLogCommand`.

Retrieve the credentials only from the SSM `SecureString` in a private
operator session. Do not include the decrypted JSON in a ticket or terminal
recording.

## 5. URL map and smoke tests

| Experience | Path |
| --- | --- |
| Public platform website | `/` |
| Product journey library and deep pages | `/loan-types/` and `/loan-types/<journey>/` |
| Tenant landing | `/t/dev/` |
| Staff workspace | `/t/dev/staff/` |
| Borrower portal | `/t/dev/portal/` |
| Partner workspace | `/t/dev/partners/` |
| Platform administration | `/t/dev/staff/?scope=platform` |
| Guide and Academy | `/help/` |
| API health | `/health` |

With a configured domain root, the canonical entry points are `demo`, `staff`,
`portal`, `partners`, `admin`, and `help` under that root. Root requests on the
five specialised hosts redirect to the corresponding path above; the public
showcase remains on `demo`.

Run a GET-based check; `curl -I` exercises `HEAD` and can produce a different
authentication result from the browser route.

```bash
export DEMO_URL="https://demo.example.com"
curl -fsS "$DEMO_URL/health"
curl -fsS -o /dev/null -w 'website=%{http_code}\n' "$DEMO_URL/"
curl -fsS -o /dev/null -w 'journey=%{http_code}\n' \
  "$DEMO_URL/loan-types/commercial-vehicle-finance/"
curl -fsS -o /dev/null -w 'tenant=%{http_code}\n' "$DEMO_URL/t/dev/"
curl -fsS -o /dev/null -w 'staff=%{http_code}\n' "$DEMO_URL/t/dev/staff/"
curl -fsS -o /dev/null -w 'portal=%{http_code}\n' "$DEMO_URL/t/dev/portal/"
```

Expected public page results are HTTP `200`; `/health` must report `status:
ok`. In an SSM session also confirm both local services and the freshness gate:

```bash
curl -fsS http://127.0.0.1:3040/health
curl -fsS http://127.0.0.1:47311/health
sudo systemctl --no-pager --full status \
  loanos-api loanos-rules loanos-kill-switch.timer nginx postgresql
```

The rules response must show `kill_switch_fresh: true`.

## 6. Showcase tenant: prepare and present

The bootstrap tenant is `dev`, displayed as **LoanOS Showcase**. It contains a
synthetic regulated entity and governed product policies for every canonical
journey. Re-running API bootstrap repairs the deterministic demo records but
does not delete unrelated operational state or tenant-created products.

Before the customer joins:

1. Confirm CloudFormation and SSM status are `CREATE_COMPLETE` and `COMPLETE`.
2. Run the public and local smoke checks.
3. Privately retrieve the required administrator credential from the stack's
   `CredentialsParameter`.
4. For the tenant workspace, sign in at `/t/dev/staff/` as
   `admin@dev.local` using `tenantAdminPassword`. For the platform
   workspace, select **Platform administration** on the same page and sign in
   as `admin@platform.local` using `platformAdminPassword`. Never expose a
   password or API key on screen; `platformAdminKey` is not a browser password.
5. Open the two or three journeys that match discovery. Do not attempt to
   demonstrate all 21 in one meeting.
6. Prepare one fail-closed moment, one maker-checker moment, and one evidence
   export that directly address the customer's pain.
7. Keep the approved [sales demo narrative](../gtm/sales/demo-script.md) and
   claims register available for honest maturity answers.

### 6.1 Showcase personas

All tenant personas below use the `tenantAdminPassword` from the private
`CredentialsParameter`; there are no separate role passwords in the synthetic
showcase. The platform administrator uses the separate
`platformAdminPassword`. API keys are not accepted by browser sign-in.

| Persona | Sign-in email | Demo use |
| --- | --- | --- |
| Tenant administrator | `admin@dev.local` | Tenant setup, products, roles, integrations, and readiness |
| Credit maker | `credit-maker-1@dev.local` | Create or propose a credit action |
| Credit checker | `credit-checker-1@dev.local` | Independently approve/reject the maker's exact proposal |
| Credit lead | `credit-lead-1@dev.local` | Product ownership, deviations, queue, and policy oversight |
| Human reviewer | `credit-reviewer-1@dev.local` | Resolve a referred decision without presenting AI as final authority |
| Loan officer | `loan-officer-1@dev.local` | Work a lending case through the operational queue |
| Disbursement maker | `disbursement-maker-1@dev.local` | Prepare the controlled disbursement handoff |
| Compliance analyst | `compliance-analyst-1@dev.local` | Review controls, evidence, and exceptions |
| Collections manager | `collections-manager-1@dev.local` | Show delinquency and collections operations |
| Collections lead | `collections-lead-1@dev.local` | Oversee collections workflow and queue assignment |
| Portfolio risk manager | `portfolio-risk-1@dev.local` | Review portfolio risk signals and oversight |
| Grievance officer | `grievance-officer-1@dev.local` | Handle borrower grievance workflow and evidence |
| Grievance lead | `grievance-lead-1@dev.local` | Oversee grievance operations and queues |
| KYC officer | `kyc-officer-1@dev.local` | Complete KYC evidence and exception handling |

These are scenario identities, not a claim that a customer should copy the
same staffing model. The five product-admin roles (`journey_admin`,
`product_owner`, `checker`, `operator`, and `auditor`) are granted across all
21 products to make navigation complete.

### 6.2 The 21 canonical product journeys

| Family | Product journeys |
| --- | --- |
| Business and MSME | MSME term loan; MSME working capital; secured business loan; professional practice loan; co-lending programme |
| Asset and productive finance | Commercial vehicle finance; equipment and machinery finance; green equipment finance; personal vehicle loan; consumer durable finance; agriculture and allied finance |
| Trade and supply chain | Invoice discounting; purchase-order finance; supply-chain finance; trade-finance workflow |
| Retail, secured, and specialised | Personal loan; education loan; home loan; loan against property; gold loan; microfinance group lending |

The public journey pages are presentation material. Platform coverage for all
21 means a canonical template, governed configuration, a workspace archetype,
lifecycle composition, simulator evidence, and tests. It does **not** mean all
provider dependencies are live or that every tenant is production-ready. Use
the [journey support matrix](../product/product-journey-support-matrix.md) and
[platform-depth audit](../product/product-journey-platform-depth-audit.md) for
the exact evidence tier.

## 7. Customer workshop tenant

Use a short lower-case session identifier that is safe to disclose in a demo,
for example `acme-jul15`. Generate and review the manifest first:

```bash
node scripts/demo-system.mjs workshop --session acme-jul15 \
  --name "Acme Lending Workshop" > /tmp/acme-workshop-manifest.json
```

Use the direct `node` command when redirecting JSON; `npm run` adds npm output
around the command. The manifest must say `syntheticOnly: true`, all
integrations `mock`, and `engineProvisioning.status:
required_before_decisioning`.

To create the shell, retrieve the platform-admin key privately, keep it only in
the current shell, and write newly generated credentials outside the repo:

```bash
export LOANOS_PLATFORM_ADMIN_KEY="<retrieve privately from SSM>"
npm run demo:create-workshop -- \
  --session acme-jul15 \
  --name "Acme Lending Workshop" \
  --base-url https://demo.example.com \
  --owner-email workshop-owner@example.com \
  --credentials-file /tmp/acme-workshop-credentials.json \
  --confirm-synthetic-only
unset LOANOS_PLATFORM_ADMIN_KEY
```

The credentials file is written mode `0600`; securely delete it after the
session. The API returns a one-time `lsk_test_*` tenant key because this is a
synthetic sandbox.

### 7.1 Live-build sequence

1. Show the empty/small starting tenant and explain that isolation precedes
   configuration.
2. Confirm the synthetic regulated-entity profile and India data-residency
   posture.
3. Choose the first launch product and review its policy, evidence, channel,
   and role requirements.
4. Assign maker/checker/operator/auditor responsibilities using synthetic
   identities.
5. Select mock providers and show their readiness boundary.
6. Configure the tenant-specific business engine. Until it is healthy, bound
   to the workshop tenant, and using the correct signed bundle, decisioning
   remains unavailable/fail-closed.
7. Run a controlled synthetic application and show policy lineage, a human
   referral, maker-checker approval, and evidence output.
8. Export non-secret workshop evidence and record customer questions and
   configuration decisions.

The current AWS template provisions the showcase engine only. A workshop
tenant shell therefore supports administration and configuration, not safe
decision execution, until a dedicated runtime is added. Never point the
workshop tenant at the `dev` rules URL.

## 8. Mock provider catalogue

All integrations below are forced to mock mode by the sandbox manager. The
mock is used to demonstrate the platform contract, evidence, failure handling,
and operator experience—not the provider's production service.

| Integration | Demonstrated boundary |
| --- | --- |
| Account Aggregator | Consent-bound financial-information receipt and lineage |
| Bank account | Account verification and ownership evidence |
| Bureau | Synthetic credit report, timeout, and adverse-response paths |
| CERSAI | Governed security-interest submission slice |
| CIC | Credit-information-company reporting slice |
| CKYCRR | KYC registry request/response and evidence boundary |
| Core banking | Account/disbursement/servicing instruction contract |
| Email | Notification delivery attempt and evidence |
| Escrow | Controlled fund-flow evidence |
| eSign | Contract execution request/callback boundary |
| FIU | Governed regulatory-reporting submission slice |
| Payment rail | Synthetic payment initiation and reconciliation |
| SMS | Notification and consented-contact behavior |
| V-CIP | Video KYC workflow and India-storage controls |
| WhatsApp | Consented messaging and delivery evidence |

When asked whether an integration is live, state: “This demo uses the governed
mock contract. Production activation requires provider due diligence,
certification, credentials, India-residency evidence, adverse-case testing,
monitoring, and tenant approval.”

## 9. Recommended customer narrative

Use discovery to choose two or three beats rather than touring menus:

1. **Control:** run one customer-specific journey and show that policy,
   authority, and tenant context are explicit.
2. **Fail closed:** cause a referral, missing evidence, stale kill switch, or
   unverified account to block progress safely.
3. **Human authority:** show maker-checker or human review on the exact proposal.
4. **Evidence:** finish on the audit record, decision lineage, or export pack.
5. **Honesty:** distinguish implemented platform behavior, mock provider
   behavior, tenant configuration, and production admission.

Do not promise a capability from a polished public page alone. Tie every claim
to its support matrix and current evidence.

## 10. Custom domain and DNS

Use the six canonical one-level subdomains of one DNS root. Create/validate a
wildcard ACM certificate in `us-east-1`, then attach the root and ARN using:

```bash
./deploy/aws/release-demo.sh domains \
  --stack loanos-showcase \
  --domain-root example.com \
  --certificate-arn 'arn:aws:acm:us-east-1:ACCOUNT:certificate/ID'
./deploy/aws/release-demo.sh dns --stack loanos-showcase
```

At GoDaddy retain two classes of records:

1. ACM validation: `_token` to `_value.acm-validations.aws` (keep for renewal).
2. Traffic: six CNAMEs named `demo`, `staff`, `portal`, `partners`, `admin`,
   and `help`, all targeting the current `d...cloudfront.net` hostname.

Never use `https://` or a path in either DNS target. A wildcard certificate
such as `*.example.com` covers `demo.example.com`, not the apex. Verify with:

```bash
dig +short demo.example.com @8.8.8.8
curl -fsS -o /dev/null -w '%{http_code}\n' https://demo.example.com/
curl -fsS https://demo.example.com/health
```

The aliases, certificate and host-router function are CloudFormation-owned; do
not add or change them only in the CloudFront console because that creates
drift. A hostname can belong to only one distribution. During blue/green
cutover, detach it from the old distribution before attaching it to the new
one.

## 11. Troubleshooting decision tree

| Symptom | Likely cause and safe response |
| --- | --- |
| CloudFormation `ROLLBACK_COMPLETE` | Open Events and capture the first `CREATE_FAILED`; delete the disposable failed stack after fixing the template |
| CloudFront says cache policy does not exist | Template referenced an invalid managed policy; use the current reviewed template rather than editing the distribution manually |
| SSM status `FAILED at bootstrap line ... (exit 22)` | A `curl -f` health gate failed; inspect `/var/log/loanos-bootstrap.log` and the service journal, not just the line number |
| `schema.sql: Permission denied` | File ownership/mode prevents the database user reading it; use the current bootstrap permissions and run schema as the database owner—never disable RLS |
| Rules health has `kill_switch_fresh: false` | Run `sudo /usr/local/sbin/loanos-refresh-kill-switch`, then recheck; do not bypass the gate |
| API `Unsupported state or unable to authenticate data` | Active encryption material does not match stored envelopes; never rotate/discard the key ring in place—replace the synthetic stack |
| Website GET is 200 but `curl -I /` is 401 | `HEAD` and `GET` are different routes; use the documented GET smoke test |
| Deep product page returns `tenant_auth_required` | Old server/static-route code is deployed; deploy a current committed release and smoke-test a journey deep link |
| CloudFront root returns `internal_error` | TLS/routing may be healthy while the API failed; use the request ID in `journalctl -u loanos-api.service` |
| New custom hostname cannot resolve | Traffic CNAME is missing/incorrect or DNS is still cached; verify public DNS and CloudFront deployment |

Useful SSM commands:

```bash
sudo tail -n 200 /var/log/loanos-bootstrap.log
sudo journalctl -u loanos-api.service -n 100 --no-pager
sudo journalctl -u loanos-rules.service -n 100 --no-pager
sudo nginx -t
```

Redact secrets. Older revisions may have printed a development API key at API
startup; rotate any exposed credential.

## 12. Rollback, teardown, and cost

### Rollback

For a failed generation-2 in-place release, `update-demo.sh` automatically
restores the previously active symlink and services before reporting failure.
Verify the old public health immediately. For infrastructure/schema blue/green,
keep the previous stack and CloudFront hostname until acceptance; restore its
aliases and DNS if cutover must be reversed. Do not copy databases or key files
between independently bootstrapped stacks.

### Teardown

1. Move/delete all six traffic CNAMEs if they point to the stack being removed.
2. Delete the CloudFormation stack and wait for `DELETE_COMPLETE`.
3. Delete its four instance-created SSM parameters: `credentials`, `status`,
   `release`, and `release-status` under `/loanos-demo/<stack>/`.
4. Delete the release object from the private S3 bucket when no rollback needs
   it.
5. Delete workshop credential files and any exported synthetic evidence that
   is no longer required.
6. Check EC2 Global View, EBS, public IPv4, CloudFront, S3, SSM, and Billing for
   leftovers.

Do not manually delete a CloudFormation-owned distribution before its stack;
that creates drift and commonly causes `DELETE_FAILED` cleanup.

The stack avoids NAT Gateway, load balancer, RDS, Elastic IP, and Route 53, but
EC2, EBS, public IPv4, S3, CloudFront, and data transfer may still consume
credits or incur charges. A Budget alerts; it is not a hard cap.

## 13. Demo evidence record

For every customer-facing environment retain only non-secret evidence:

- date, operator, approved purpose, customer/session alias;
- git commit SHA and archive SHA-256;
- stack name, region, template revision, and CloudFormation timestamps;
- showcase profile ID/checksum or workshop manifest checksum;
- smoke-test results and relevant journey/support evidence;
- DNS cutover and rollback target;
- discovered gaps, claims made, owner, and next action; and
- teardown confirmation.

Do not retain decrypted SSM parameters, session cookies, API keys, passwords,
or mock records containing customer-provided information.

## 14. Demo-day checklist

### T-24 hours

- [ ] Committed revision validated; Node and Rust gates pass.
- [ ] Replacement stack is `CREATE_COMPLETE`; bootstrap is `COMPLETE`.
- [ ] Budget email is confirmed and account credits reviewed.
- [ ] DNS, TLS, all app paths, and a journey deep link return expected results.
- [ ] Showcase profile audit passes; requested customer journeys are rehearsed.
- [ ] Claims/support matrix reviewed; mock/live boundaries prepared.

### T-30 minutes

- [ ] API and rules health pass; kill switch is fresh.
- [ ] Credentials retrieved privately; screen sharing excludes AWS/SSM/secrets.
- [ ] Synthetic cases reset/prepared; no real customer data is present.
- [ ] Old accepted URL remains available as rollback.

### After the session

- [ ] Customer questions, evidence, claims, and gaps recorded without secrets.
- [ ] Workshop tenant/credentials deleted unless an approved follow-up needs it.
- [ ] Temporary stack, SSM parameters, S3 objects, and DNS are retired when due.
- [ ] Billing checked and the demo evidence record closed.
