#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ACTION=${1:-deploy}
REGION=${REGION:-ap-south-1}
STACK_NAME=${STACK_NAME:-loanos-showcase}
ALERT_EMAIL=${ALERT_EMAIL:-}
SOURCE_BUCKET=${SOURCE_BUCKET:-}
DOMAIN_ROOT=${DOMAIN_ROOT:-}
ACM_CERTIFICATE_ARN=${ACM_CERTIFICATE_ARN:-}
PACKAGE_SOURCE_MODE=${PACKAGE_SOURCE_MODE:-commit}
TEMPLATE_FILE="$ROOT_DIR/deploy/aws/cloudformation-demo.yaml"
ARCHIVE_PATH=""

usage() {
  cat <<'EOF'
Usage:
  ./deploy/aws/release-demo.sh deploy --email EMAIL [options]
  ./deploy/aws/release-demo.sh domains --domain-root ROOT --certificate-arn ARN [options]
  ./deploy/aws/release-demo.sh status|smoke|dns [options]

Options:
  --region REGION             AWS region (default: ap-south-1)
  --stack STACK               Stack/environment name (default: loanos-showcase)
  --bucket BUCKET             Private release bucket (normally auto-created)
  --domain-root ROOT          e.g. aitailorworkshop.in
  --certificate-arn ARN       us-east-1 wildcard ACM certificate
  --include-worktree          Development only; committed tracked files are the default

deploy creates a generation-2 stack when absent. On an existing generation-2
stack it installs an immutable release through SSM without replacing the VM,
database, or credentials. Database-schema changes fail closed and require a
fresh stack.
EOF
}

parse_args() {
  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email) ALERT_EMAIL=${2:?--email requires a value}; shift 2 ;;
      --region) REGION=${2:?--region requires a value}; shift 2 ;;
      --stack) STACK_NAME=${2:?--stack requires a value}; shift 2 ;;
      --bucket) SOURCE_BUCKET=${2:?--bucket requires a value}; shift 2 ;;
      --domain-root) DOMAIN_ROOT=${2:?--domain-root requires a value}; shift 2 ;;
      --certificate-arn) ACM_CERTIFICATE_ARN=${2:?--certificate-arn requires a value}; shift 2 ;;
      --include-worktree) PACKAGE_SOURCE_MODE=worktree; shift ;;
      --help|-h) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
}

parse_args "$@"

cleanup() {
  if [[ -n "$ARCHIVE_PATH" ]]; then
    rm -f "$ARCHIVE_PATH" "${ARCHIVE_PATH}.manifest.json"
  fi
}
trap cleanup EXIT

require_value() {
  local name=$1
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 2
  fi
}

validate_domain_parameters() {
  if [[ -n "$DOMAIN_ROOT" || -n "$ACM_CERTIFICATE_ARN" ]]; then
    require_value DOMAIN_ROOT
    require_value ACM_CERTIFICATE_ARN
  fi
}

stack_exists() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" >/dev/null 2>&1
}

ensure_source_bucket() {
  if [[ -z "$SOURCE_BUCKET" ]]; then
    local account_id
    account_id=$(aws sts get-caller-identity --query Account --output text)
    SOURCE_BUCKET="loanos-demo-source-${account_id}-${REGION}"
  fi
  if aws s3api head-bucket --bucket "$SOURCE_BUCKET" --region "$REGION" 2>/dev/null; then
    return
  fi
  echo "Creating private source bucket: s3://${SOURCE_BUCKET}"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$SOURCE_BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$SOURCE_BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$SOURCE_BUCKET" --region "$REGION" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$SOURCE_BUCKET" --region "$REGION" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-bucket-versioning --bucket "$SOURCE_BUCKET" --region "$REGION" \
    --versioning-configuration Status=Enabled
}

stack_output() {
  local key=$1
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

stack_parameter() {
  local key=$1
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Parameters[?ParameterKey=='${key}'].ParameterValue | [0]" \
    --output text
}

optional_output() {
  local value
  value=$(stack_output "$1" 2>/dev/null || true)
  [[ "$value" == "None" || "$value" == "null" ]] && value=""
  printf '%s' "$value"
}

require_generation_two() {
  local generation
  generation=$(optional_output DeploymentGeneration)
  if [[ "$generation" != "2" ]]; then
    echo "Stack $STACK_NAME is a legacy archive/bootstrap stack." >&2
    echo "Create a new generation-2 environment with --stack loanos-showcase (or another new name)." >&2
    exit 3
  fi
}

dns_plan() {
  local distribution domain_root
  distribution=$(stack_output DemoUrl)
  distribution=${distribution#https://}
  distribution=${distribution%/}
  domain_root=${DOMAIN_ROOT:-$(stack_parameter DomainRoot 2>/dev/null || true)}
  if [[ -z "$domain_root" || "$domain_root" == "None" ]]; then
    echo "No custom domain is configured. CloudFront URL: https://${distribution}/"
    return
  fi
  printf 'GoDaddy traffic CNAME records (TTL 30 minutes or 1 hour):\n'
  local label
  for label in demo staff portal partners admin help; do
    printf '  %-10s -> %s\n' "$label" "$distribution"
  done
  printf 'Keep the separate ACM validation CNAME permanently for certificate renewal.\n'
}

status() {
  local stack_status status_parameter release_status_parameter bootstrap_status release_status release_parameter release_json
  stack_status=$(aws cloudformation describe-stacks \
    --region "$REGION" --stack-name "$STACK_NAME" \
    --query 'Stacks[0].StackStatus' --output text)
  status_parameter=$(stack_output BootstrapStatusParameter)
  release_status_parameter=$(optional_output ReleaseStatusParameter)
  release_parameter=$(optional_output ReleaseParameter)
  bootstrap_status=$(aws ssm get-parameter --region "$REGION" --name "$status_parameter" \
    --query 'Parameter.Value' --output text 2>/dev/null || true)
  if [[ -n "$release_status_parameter" ]]; then
    release_status=$(aws ssm get-parameter --region "$REGION" --name "$release_status_parameter" \
      --query 'Parameter.Value' --output text 2>/dev/null || true)
  fi
  if [[ -n "$release_parameter" ]]; then
    release_json=$(aws ssm get-parameter --region "$REGION" --name "$release_parameter" \
      --query 'Parameter.Value' --output text 2>/dev/null || true)
  fi
  printf 'Stack: %s\nBootstrap: %s\nRelease: %s\nRelease metadata: %s\nCloudFront: %s\n' \
    "$stack_status" "${bootstrap_status:-NOT_REPORTED}" "${release_status:-NOT_REPORTED}" \
    "${release_json:-NOT_REPORTED}" "$(stack_output DemoUrl)"
  local key value
  for key in CustomDemoUrl StaffUrl PortalUrl PartnerUrl PlatformAdminUrl HelpUrl; do
    value=$(optional_output "$key")
    [[ -n "$value" ]] && printf '%s: %s\n' "$key" "$value"
  done
}

smoke_url() {
  local base=${1%/}
  local path status_code
  curl -fsS "$base/health" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
  for path in / /t/dev/ /t/dev/staff/ /t/dev/portal/ /t/dev/partners/ /help/ '/t/dev/staff/?scope=platform'; do
    status_code=$(curl -fsS -o /dev/null -w '%{http_code}' "${base}${path}")
    [[ "$status_code" == "200" ]] || {
      echo "Smoke check failed: ${base}${path} returned ${status_code}" >&2
      return 1
    }
  done
  printf 'Smoke test passed: %s (health plus public, staff, portal, partner, admin-login, and help routes)\n' "$base"
}

smoke() {
  smoke_url "$(stack_output DemoUrl)"
  local custom_url
  custom_url=$(optional_output CustomDemoUrl)
  if [[ -n "$custom_url" ]]; then
    if curl -fsS --connect-timeout 5 "${custom_url%/}/health" >/dev/null 2>&1; then
      smoke_url "$custom_url"
    else
      printf 'Custom-domain smoke deferred (DNS or CloudFront deployment not ready): %s\n' "$custom_url"
    fi
  fi
}

package_and_upload() {
  ensure_source_bucket
  local commit_sha package_args=()
  commit_sha=$(git -C "$ROOT_DIR" rev-parse --verify HEAD)
  if [[ "$PACKAGE_SOURCE_MODE" == "worktree" ]]; then
    RELEASE_ID="${commit_sha:0:12}-worktree-$(date -u +%Y%m%d%H%M%S)"
    package_args+=(--include-worktree)
  else
    RELEASE_ID="$commit_sha"
  fi
  ARCHIVE_PATH=$(mktemp "/tmp/loanos-showcase-${commit_sha:0:12}.XXXXXX.tar.gz")
  "$ROOT_DIR/deploy/aws/package-demo.sh" "$ARCHIVE_PATH" "${package_args[@]}"
  ARCHIVE_SHA=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')
  SOURCE_KEY=${SOURCE_KEY:-"releases/${RELEASE_ID}/loanos-server-web.tar.gz"}
  aws s3 cp "$ARCHIVE_PATH" "s3://${SOURCE_BUCKET}/${SOURCE_KEY}" \
    --region "$REGION" --only-show-errors
  aws s3 cp "${ARCHIVE_PATH}.manifest.json" "s3://${SOURCE_BUCKET}/${SOURCE_KEY}.manifest.json" \
    --region "$REGION" --only-show-errors
}

wait_for_bootstrap() {
  local status_parameter bootstrap_status=""
  status_parameter=$(stack_output BootstrapStatusParameter)
  for _ in {1..240}; do
    bootstrap_status=$(aws ssm get-parameter --region "$REGION" --name "$status_parameter" \
      --query 'Parameter.Value' --output text 2>/dev/null || true)
    [[ "$bootstrap_status" == "COMPLETE" ]] && break
    if [[ "$bootstrap_status" == FAILED* ]]; then
      echo "$bootstrap_status" >&2
      exit 1
    fi
    sleep 10
  done
  [[ "$bootstrap_status" == "COMPLETE" ]] || {
    echo "Bootstrap did not report COMPLETE within 40 minutes." >&2
    exit 1
  }
}

create_stack() {
  require_value ALERT_EMAIL
  validate_domain_parameters
  local parameters=(
    "AlertEmail=${ALERT_EMAIL}"
    "SourceBucket=${SOURCE_BUCKET}"
    "SourceKey=${SOURCE_KEY}"
    "SourceSha256=${ARCHIVE_SHA}"
    "ReleaseId=${RELEASE_ID}"
    "InstanceType=${INSTANCE_TYPE:-t3.small}"
    "MonthlyBudgetUsd=${MONTHLY_BUDGET_USD:-25}"
  )
  if [[ -n "$DOMAIN_ROOT" ]]; then
    parameters+=("DomainRoot=${DOMAIN_ROOT}" "AcmCertificateArn=${ACM_CERTIFICATE_ARN}")
  fi
  aws cloudformation deploy \
    --region "$REGION" --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE_FILE" --capabilities CAPABILITY_IAM \
    --parameter-overrides "${parameters[@]}" \
    --tags Environment=showcase DataClassification=synthetic-only \
      DeploymentGeneration=2 LoanOSRelease="$RELEASE_ID"
  wait_for_bootstrap
}

install_release() {
  require_generation_two
  local instance_id command parameters command_id command_status stdout stderr
  instance_id=$(stack_output InstanceId)
  command="sudo /opt/loanos/current/deploy/aws/update-demo.sh '${SOURCE_BUCKET}' '${SOURCE_KEY}' '${ARCHIVE_SHA}' '${RELEASE_ID}' '${REGION}' '${STACK_NAME}'"
  parameters=$(printf '{"commands":["%s"]}' "$command")
  command_id=$(aws ssm send-command \
    --region "$REGION" --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --comment "Install LoanOS release ${RELEASE_ID}" \
    --parameters "$parameters" \
    --query 'Command.CommandId' --output text)
  command_status=Pending
  for _ in {1..240}; do
    command_status=$(aws ssm get-command-invocation --region "$REGION" \
      --command-id "$command_id" --instance-id "$instance_id" \
      --query Status --output text 2>/dev/null || true)
    case "$command_status" in
      Success|Cancelled|TimedOut|Failed|Cancelling) break ;;
    esac
    sleep 10
  done
  stdout=$(aws ssm get-command-invocation --region "$REGION" \
    --command-id "$command_id" --instance-id "$instance_id" \
    --query StandardOutputContent --output text)
  stderr=$(aws ssm get-command-invocation --region "$REGION" \
    --command-id "$command_id" --instance-id "$instance_id" \
    --query StandardErrorContent --output text)
  [[ -n "$stdout" && "$stdout" != "None" ]] && printf '%s\n' "$stdout"
  if [[ "$command_status" != "Success" ]]; then
    [[ -n "$stderr" && "$stderr" != "None" ]] && printf '%s\n' "$stderr" >&2
    echo "SSM release command failed: $command_status ($command_id)" >&2
    exit 1
  fi
}

deploy() {
  validate_domain_parameters
  if stack_exists && [[ -z "$SOURCE_BUCKET" ]]; then
    SOURCE_BUCKET=$(stack_parameter SourceBucket)
  fi
  package_and_upload
  if stack_exists; then
    install_release
  else
    create_stack
  fi
  smoke
  printf 'Released %s\nArchive SHA-256 %s\nS3 key %s\n' "$RELEASE_ID" "$ARCHIVE_SHA" "$SOURCE_KEY"
  dns_plan
}

configure_domains() {
  require_value DOMAIN_ROOT
  require_value ACM_CERTIFICATE_ARN
  stack_exists || { echo "Create the stack before configuring domains" >&2; exit 3; }
  require_generation_two
  local update_result
  if ! update_result=$(aws cloudformation update-stack \
    --region "$REGION" --stack-name "$STACK_NAME" \
    --template-body "file://${TEMPLATE_FILE}" \
    --capabilities CAPABILITY_IAM \
    --parameters \
      ParameterKey=AlertEmail,UsePreviousValue=true \
      ParameterKey=SourceBucket,UsePreviousValue=true \
      ParameterKey=SourceKey,UsePreviousValue=true \
      ParameterKey=SourceSha256,UsePreviousValue=true \
      ParameterKey=ReleaseId,UsePreviousValue=true \
      ParameterKey=InstanceType,UsePreviousValue=true \
      ParameterKey=MonthlyBudgetUsd,UsePreviousValue=true \
      ParameterKey=LatestUbuntuAmi,UsePreviousValue=true \
      ParameterKey=DomainRoot,ParameterValue="$DOMAIN_ROOT" \
      ParameterKey=AcmCertificateArn,ParameterValue="$ACM_CERTIFICATE_ARN" 2>&1); then
    if [[ "$update_result" == *"No updates are to be performed"* ]]; then
      echo "Domain configuration is already current."
    else
      printf '%s\n' "$update_result" >&2
      exit 1
    fi
  else
    aws cloudformation wait stack-update-complete --region "$REGION" --stack-name "$STACK_NAME"
  fi
  dns_plan
}

case "$ACTION" in
  deploy) deploy ;;
  domains) configure_domains ;;
  status) status ;;
  smoke) smoke ;;
  dns) dns_plan ;;
  --help|-h|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
