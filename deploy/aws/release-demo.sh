#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ACTION=${1:-deploy}
REGION=${REGION:-ap-south-1}
STACK_NAME=${STACK_NAME:-loanos-demo}
ALERT_EMAIL=${ALERT_EMAIL:-}
SOURCE_BUCKET=${SOURCE_BUCKET:-}
TEMPLATE_FILE="$ROOT_DIR/deploy/aws/cloudformation-demo.yaml"
ARCHIVE_PATH=""

usage() {
  echo "Usage: $0 deploy --email EMAIL [--region REGION] [--stack STACK] [--bucket BUCKET]"
  echo "       $0 status|smoke [--region REGION] [--stack STACK]"
}

parse_args() {
  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email) ALERT_EMAIL=${2:?--email requires a value}; shift 2 ;;
      --region) REGION=${2:?--region requires a value}; shift 2 ;;
      --stack) STACK_NAME=${2:?--stack requires a value}; shift 2 ;;
      --bucket) SOURCE_BUCKET=${2:?--bucket requires a value}; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
}

parse_args "$@"

cleanup() {
  if [[ -n "$ARCHIVE_PATH" ]]; then
    rm -f "$ARCHIVE_PATH"
  fi
}
trap cleanup EXIT

require_env() {
  local name=$1
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 2
  fi
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
}

stack_output() {
  local key=$1
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

status() {
  local stack_status status_parameter bootstrap_status
  stack_status=$(aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].StackStatus' \
    --output text)
  status_parameter=$(stack_output BootstrapStatusParameter)
  bootstrap_status=$(aws ssm get-parameter \
    --region "$REGION" \
    --name "$status_parameter" \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)
  printf 'Stack: %s\nBootstrap: %s\nDemo URL: %s\n' \
    "$stack_status" "${bootstrap_status:-NOT_REPORTED}" "$(stack_output DemoUrl)"
  local custom_url
  custom_url=$(stack_output CustomDemoUrl)
  if [[ "$custom_url" != "None" && "$custom_url" != "null" ]]; then
    printf 'Custom URL: %s\n' "$custom_url"
  fi
}

smoke() {
  local demo_url=${DEMO_URL:-$(stack_output CustomDemoUrl)}
  if [[ "$demo_url" == "None" || "$demo_url" == "null" || -z "$demo_url" ]]; then
    demo_url=$(stack_output DemoUrl)
  fi
  demo_url=${demo_url%/}
  curl -fsS "$demo_url/health" >/dev/null
  local website_status
  website_status=$(curl -fsS -o /dev/null -w '%{http_code}' "$demo_url/")
  [[ "$website_status" == "200" ]]
  printf 'Smoke test passed: %s (health OK, website HTTP %s)\n' "$demo_url" "$website_status"
}

deploy() {
  require_env ALERT_EMAIL
  ensure_source_bucket
  if [[ -n "${ALTERNATE_DOMAIN_NAME:-}" || -n "${ACM_CERTIFICATE_ARN:-}" ]]; then
    require_env ALTERNATE_DOMAIN_NAME
    require_env ACM_CERTIFICATE_ARN
  fi

  local commit_sha source_key archive_sha
  commit_sha=$(git -C "$ROOT_DIR" rev-parse --verify HEAD)
  ARCHIVE_PATH=$(mktemp "/tmp/loanos-demo-${commit_sha:0:12}.XXXXXX.tar.gz")
  "$ROOT_DIR/deploy/aws/package-demo.sh" "$ARCHIVE_PATH"
  archive_sha=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')
  source_key=${SOURCE_KEY:-"releases/${commit_sha}/loanos-demo-source.tar.gz"}
  aws s3 cp "$ARCHIVE_PATH" "s3://${SOURCE_BUCKET}/${source_key}" --region "$REGION" --only-show-errors

  local parameters=(
    "AlertEmail=${ALERT_EMAIL}"
    "SourceBucket=${SOURCE_BUCKET}"
    "SourceKey=${source_key}"
    "InstanceType=${INSTANCE_TYPE:-t3.small}"
    "MonthlyBudgetUsd=${MONTHLY_BUDGET_USD:-25}"
  )
  if [[ -n "${ALTERNATE_DOMAIN_NAME:-}" ]]; then
    parameters+=("AlternateDomainName=${ALTERNATE_DOMAIN_NAME}" "AcmCertificateArn=${ACM_CERTIFICATE_ARN}")
  fi
  aws cloudformation deploy \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides "${parameters[@]}" \
    --tags Environment=demo DataClassification=synthetic-only LoanOSCommit="$commit_sha"

  local status_parameter bootstrap_status=""
  status_parameter=$(stack_output BootstrapStatusParameter)
  for _ in {1..180}; do
    bootstrap_status=$(aws ssm get-parameter \
      --region "$REGION" \
      --name "$status_parameter" \
      --query 'Parameter.Value' \
      --output text 2>/dev/null || true)
    if [[ "$bootstrap_status" == "COMPLETE" ]]; then
      break
    fi
    if [[ "$bootstrap_status" == FAILED* ]]; then
      echo "$bootstrap_status" >&2
      exit 1
    fi
    sleep 10
  done
  if [[ "$bootstrap_status" != "COMPLETE" ]]; then
    echo "Bootstrap did not report COMPLETE within 30 minutes." >&2
    exit 1
  fi
  smoke
  printf 'Released commit %s\nArchive SHA-256 %s\nS3 key %s\n' "$commit_sha" "$archive_sha" "$source_key"
}

case "$ACTION" in
  deploy) deploy ;;
  status) status ;;
  smoke) smoke ;;
  *) usage >&2; exit 2 ;;
esac
