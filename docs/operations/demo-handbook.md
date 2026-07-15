# LoanOS Synthetic Demo Operator Handbook

This is the canonical field guide for preparing and running a serious LoanOS
platform demonstration. It covers the two supported demo modes, all 21 product
journeys, operator personas, mocked provider boundaries, AWS release handling,
custom domains, recovery, evidence, cost control, and teardown.

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
| Package committed source, upload it, deploy CloudFormation, wait, and smoke-test | Automated | `./deploy/aws/release-demo.sh deploy` |
| Read deployment/bootstrap status and run public smoke tests | Automated | `release-demo.sh status` and `release-demo.sh smoke` |
| Bind a custom hostname and existing ACM certificate | Template-owned | `AlternateDomainName` and `AcmCertificateArn` parameters |
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
npm test
(cd rules && cargo test --workspace)
(cd rules && cargo clippy --workspace --all-targets -- -D warnings)
npm run demo:audit
bash -n deploy/aws/bootstrap-demo.sh deploy/aws/package-demo.sh deploy/aws/release-demo.sh
cfn-lint deploy/aws/cloudformation-demo.yaml
```

The release archive contains committed `HEAD` only. Commit the exact revision
to be shown and record its SHA. Do not package a dirty tree and describe it as
the deployed revision.

The audit must report:

- profile `showcase-v1` for tenant `dev`;
- `syntheticOnly: true` and `productionReady: false`;
- exactly 21 products, 14 personas, 105 grants, and 15 mock integrations; and
- a dedicated `dev` business-engine boundary.

## 4. AWS release procedure

### 4.1 Preferred: replacement stack

A replacement stack provides a clean rollback and avoids mixing newly
generated encryption material with an older database. Set a new stack name,
deploy, test, then move DNS only after acceptance.

```bash
./deploy/aws/release-demo.sh deploy --email demo-ops@example.com
./deploy/aws/release-demo.sh status
./deploy/aws/release-demo.sh smoke
```

The wrapper generates the private source-bucket name and creates it with
public access blocked. Optional `--region`, `--stack`, and `--bucket` flags can
override defaults. For a custom domain, also provide the validated ACM
certificate values as environment variables before running `deploy`.

The certificate must be in `us-east-1`, even when the stack is in Mumbai. The
script packages committed source, uploads it under
`releases/<commit>/loanos-demo-source.tar.gz`, deploys the stack, waits up to 30
minutes for bootstrap `COMPLETE`, and tests the website and `/health`.

Keep the old stack and DNS target until the replacement passes the acceptance
checklist. Then change the `demo` CNAME to the new CloudFront hostname. Delete
the old stack only after DNS and application verification.

### 4.2 Same-stack update

Using the same `STACK_NAME` is suitable only for a disposable demo. A user-data
or infrastructure change may replace the EC2 instance and regenerate demo
credentials. Never treat bootstrap as an in-place database migration and never
rerun `bootstrap-demo.sh` manually against an existing database.

### 4.3 Deployment outputs

Record the non-secret values from CloudFormation:

- `DemoUrl` and, when configured, `CustomDemoUrl`;
- `InstanceId`;
- `BootstrapStatusParameter`;
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
| Guide and Academy | `/help/` |
| API health | `/health` |

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
3. Privately retrieve the tenant administrator credential from the stack's
   `CredentialsParameter`.
4. Sign in at `/t/dev/staff/`; never expose the password or API key on screen.
5. Open the two or three journeys that match discovery. Do not attempt to
   demonstrate all 21 in one meeting.
6. Prepare one fail-closed moment, one maker-checker moment, and one evidence
   export that directly address the customer's pain.
7. Keep the approved [sales demo narrative](../gtm/sales/demo-script.md) and
   claims register available for honest maturity answers.

### 6.1 Showcase personas

| Persona | Demo use |
| --- | --- |
| Tenant administrator | Tenant setup, products, roles, integrations, and readiness |
| Credit maker | Create or propose a credit action |
| Credit checker | Independently approve/reject the maker's exact proposal |
| Credit lead | Product ownership, deviations, queue, and policy oversight |
| Human reviewer | Resolve a referred decision without presenting AI as final authority |
| Loan officer | Origination work queue and customer evidence |
| Disbursement maker | Conditions precedent and controlled disbursement preparation |
| Compliance analyst | Regulatory controls, audit lineage, and evidence export |
| Collections manager | Contact policy, treatment strategy, and allocation |
| Collections lead | Escalation, approvals, and portfolio posture |
| Portfolio risk manager | Limits, concentration, stress, and model monitoring |
| Grievance officer | Complaint handling and time-bound resolution |
| Grievance lead | Escalation and independent closure oversight |
| KYC officer | Consent, identity evidence, screening, and deficiency handling |

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

Prefer `demo.example.com`. Create/validate an ACM certificate in `us-east-1`,
then pass its ARN and the hostname into the stack. At GoDaddy retain two
different CNAMEs:

1. ACM validation: `_token` to `_value.acm-validations.aws` (keep for renewal).
2. Traffic: `demo` to the current `d...cloudfront.net` hostname.

Never use `https://` or a path in either DNS target. A wildcard certificate
such as `*.example.com` covers `demo.example.com`, not the apex. Verify with:

```bash
dig +short demo.example.com @8.8.8.8
curl -fsS -o /dev/null -w '%{http_code}\n' https://demo.example.com/
curl -fsS https://demo.example.com/health
```

The alias and certificate are now CloudFormation-owned parameters; do not add
or change them only in the CloudFront console because that creates drift.

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

For blue/green, point DNS back to the last accepted CloudFront distribution.
Do not copy databases or key files between independently bootstrapped stacks.
For a code rollback, check out the known commit, validate it, and release it as
a new replacement stack so the deployed commit and archive digest remain
attributable.

### Teardown

1. Move/delete the traffic CNAME if it points to the stack being removed.
2. Delete the CloudFormation stack and wait for `DELETE_COMPLETE`.
3. Delete its two instance-created SSM parameters:
   `/loanos-demo/<stack>/credentials` and `/loanos-demo/<stack>/status`.
4. Delete the release object from the private S3 bucket when no rollback needs
   it.
5. Delete workshop credential files and any exported synthetic evidence that
   is no longer required.
6. Check EC2 Global View, EBS, public IPv4, CloudFront, S3, SSM, and Billing for
   leftovers.

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
