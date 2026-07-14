# AWS synthetic demo deployment

This package deploys a **synthetic-data demonstration**, not a production
lending system. It preserves the important executable shape—PostgreSQL,
the Node control/data plane, and one tenant-bound active Rust rules-engine
runtime—but keeps all external providers in mock mode and runs the services
on one encrypted EC2 host to control cost.

Do not use borrower data, PAN/Aadhaar values, bureau files, bank details, or
real regulated submissions in this environment.

## What the stack creates

- one encrypted Ubuntu EC2 instance;
- one security group exposing HTTP port 80 only;
- an IAM role for Systems Manager Session Manager (no SSH port or key pair);
- an AWS Budget with forecasted 50%, actual 80%, and actual 100% alerts;
- local PostgreSQL with the repository schema and RLS role model;
- one active, tenant-bound Rust runtime for tenant `dev`;
- generated credentials stored in an SSM Parameter Store `SecureString`.

The default `t3.small` and 24 GB encrypted `gp3` volume consume AWS credits.
Budget notifications are alerts, not a hard spending cap. Delete the stack
before credits expire if continued paid usage is not acceptable.

## Package and upload the private source

The repository is private. Do not put a GitHub token in CloudFormation or EC2
user data. Generate a tracked-source archive locally:

```bash
./deploy/aws/package-demo.sh
```

Create a private, general-purpose S3 bucket in the same AWS region as the
stack and upload `loanos-demo-source.tar.gz`. Keep **Block all public access**
enabled. The instance role receives permission to read only the exact bucket
and object key entered as stack parameters.

## Create the stack in the AWS console

1. Open **CloudFormation → Stacks → Create stack → With new resources**.
2. Choose **Upload a template file** and upload `cloudformation-demo.yaml`.
3. Use a stack name such as `loanos-demo`.
4. Enter the private S3 bucket and object key, plus the billing-alert email.
   Keep `t3.small` for the first build.
5. Confirm the IAM-resource acknowledgement and create the stack.
6. Confirm the AWS Budget subscription email when it arrives.

The CloudFormation resource can reach `CREATE_COMPLETE` before the host build
finishes. The initial Rust release build commonly takes 15–25 minutes. Check
the output named `BootstrapStatusParameter` in Systems Manager Parameter
Store; it moves from `STARTED` to `COMPLETE` or `FAILED`.

## Retrieve credentials

Open **Systems Manager → Parameter Store**, select the parameter shown in the
stack's `CredentialsParameter` output, and choose **Show decrypted value**.
Do not paste that value into tickets, source control, screenshots, or chat.

The tenant staff login is:

- scope: tenant;
- tenant id: `dev`;
- email: `admin@dev.loanos.local`;
- password: generated in the secure parameter.

## Troubleshooting

Use **Systems Manager → Session Manager → Start session**, select the instance
from the stack output, and inspect:

```bash
sudo tail -n 200 /var/log/loanos-bootstrap.log
sudo systemctl status loanos-api loanos-rules loanos-kill-switch.timer nginx postgresql
curl -fsS http://127.0.0.1:3040/health
curl -fsS http://127.0.0.1:47311/health | jq
```

The bootstrap is idempotent for a fresh stack, but it is not an in-place
production upgrade mechanism. Recreate this disposable demo when changing
infrastructure assumptions.

## Teardown

Delete the CloudFormation stack. Its EBS volume has
`DeleteOnTermination: true`. CloudFormation also deletes the instance role,
profile, security group, and budget. The two SSM parameters written by the
instance are not CloudFormation resources, so delete this path afterward:

```text
/loanos-demo/<stack-name>/credentials
/loanos-demo/<stack-name>/status
```

Also check **EC2 Global View** and **Billing → Bills** after teardown. This
stack intentionally creates no NAT Gateway, load balancer, Elastic IP, RDS
database, or Route 53 hosted zone.

Delete the uploaded source archive and its S3 bucket after the stack is
healthy, or retain the private archive only if you need reproducible rebuilds.
