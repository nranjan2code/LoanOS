#!/usr/bin/env bash
set -Eeuo pipefail

# Installs a new immutable LoanOS server/browser release on an already
# bootstrapped generation-2 showcase host. The database, credentials and
# runtime state remain in place. Schema changes deliberately require a fresh
# stack because an automatic database rollback would not be trustworthy.

usage() {
  echo "Usage: sudo $0 BUCKET KEY SHA256 RELEASE_ID AWS_REGION STACK_NAME" >&2
}

[[ $# -eq 6 ]] || { usage; exit 2; }

SOURCE_BUCKET=$1
SOURCE_KEY=$2
SOURCE_SHA256=$3
RELEASE_ID=$4
AWS_REGION=$5
STACK_NAME=$6

[[ "$SOURCE_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || { echo "Invalid S3 bucket" >&2; exit 2; }
[[ "$SOURCE_KEY" =~ ^[A-Za-z0-9._/\!-]+$ ]] || { echo "Invalid S3 key" >&2; exit 2; }
[[ "$SOURCE_SHA256" =~ ^[a-f0-9]{64}$ ]] || { echo "Invalid SHA-256" >&2; exit 2; }
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]{7,64}$ ]] || { echo "Invalid release ID" >&2; exit 2; }
[[ "$AWS_REGION" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid AWS region" >&2; exit 2; }
[[ "$STACK_NAME" =~ ^[A-Za-z][-A-Za-z0-9]{0,127}$ ]] || { echo "Invalid stack name" >&2; exit 2; }

export PATH="/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

STATUS_PARAMETER="/loanos-demo/${STACK_NAME}/release-status"
RELEASE_PARAMETER="/loanos-demo/${STACK_NAME}/release"
RELEASES_DIR=/opt/loanos/releases
CURRENT_LINK=/opt/loanos/current
STAGING_DIR="${RELEASES_DIR}/.${RELEASE_ID}.$$.staging"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
ARCHIVE_PATH="${STAGING_DIR}.tar.gz"
PREVIOUS_TARGET=""
SWAPPED=false

put_status() {
  aws ssm put-parameter \
    --region "$AWS_REGION" \
    --name "$STATUS_PARAMETER" \
    --type String \
    --overwrite \
    --value "$1" >/dev/null
}

restore_previous_release() {
  if [[ "$SWAPPED" == true && -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    ln -sfn "$PREVIOUS_TARGET" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
    systemctl daemon-reload
    systemctl restart loanos-rules.service loanos-api.service nginx || true
    /usr/local/sbin/loanos-refresh-kill-switch || true
  fi
}

on_error() {
  local line=$1
  local code=$2
  trap - ERR
  restore_previous_release
  if [[ "$SWAPPED" == true && -d "$RELEASE_DIR" && "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" != "$RELEASE_DIR" ]]; then
    rm -rf "$RELEASE_DIR"
  fi
  put_status "FAILED release ${RELEASE_ID} at line ${line} (exit ${code}); previous release restored" || true
  rm -rf "$STAGING_DIR" "$ARCHIVE_PATH"
  exit "$code"
}
trap 'on_error "$LINENO" "$?"' ERR

[[ -L "$CURRENT_LINK" ]] || {
  echo "This host is not a generation-2 release layout; create a fresh stack" >&2
  exit 40
}
PREVIOUS_TARGET=$(readlink -f "$CURRENT_LINK")

if [[ -d "$RELEASE_DIR" ]]; then
  if [[ "$PREVIOUS_TARGET" == "$RELEASE_DIR" ]] &&
    [[ -f "$RELEASE_DIR/.loanos-release-sha256" ]] &&
    [[ "$(<"$RELEASE_DIR/.loanos-release-sha256")" == "$SOURCE_SHA256" ]]; then
    put_status "COMPLETE ${RELEASE_ID}"
    printf 'Release %s is already active; no host changes were required\n' "$RELEASE_ID"
    trap - ERR
    exit 0
  fi
  echo "Release already exists: $RELEASE_DIR" >&2
  exit 41
fi

put_status "INSTALLING ${RELEASE_ID}"
install -d -m 0755 "$RELEASES_DIR" "$STAGING_DIR"
aws s3 cp "s3://${SOURCE_BUCKET}/${SOURCE_KEY}" "$ARCHIVE_PATH" \
  --region "$AWS_REGION" --only-show-errors
printf '%s  %s\n' "$SOURCE_SHA256" "$ARCHIVE_PATH" | sha256sum --check --status
tar -xzf "$ARCHIVE_PATH" -C "$STAGING_DIR"

for required in package.json package-lock.json apps/api/src/server.js rules/Cargo.toml db/schema.sql; do
  [[ -f "$STAGING_DIR/$required" ]] || {
    echo "Release is missing $required" >&2
    exit 1
  }
done
if find "$STAGING_DIR/apps" -maxdepth 1 -type d -name 'android-*' | grep -q .; then
  echo "Android source was found in a server release" >&2
  exit 1
fi

if ! cmp -s "$PREVIOUS_TARGET/db/schema.sql" "$STAGING_DIR/db/schema.sql"; then
  put_status "REQUIRES_FRESH_STACK ${RELEASE_ID}: database schema changed"
  echo "Database schema changed; use a fresh stack and synthetic-data migration rehearsal" >&2
  rm -rf "$STAGING_DIR" "$ARCHIVE_PATH"
  trap - ERR
  exit 42
fi

cd "$STAGING_DIR"
npm ci --omit=dev
cargo build --manifest-path rules/Cargo.toml --release \
  --package rules-service --package rules-fleet

mv "$STAGING_DIR" "$RELEASE_DIR"
printf '%s\n' "$SOURCE_SHA256" >"$RELEASE_DIR/.loanos-release-sha256"
rm -f "$ARCHIVE_PATH"

ln -sfn "$RELEASE_DIR" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "$CURRENT_LINK"
SWAPPED=true

systemctl daemon-reload
systemctl restart loanos-rules.service
for _ in $(seq 1 60); do
  curl --fail --silent http://127.0.0.1:47311/health >/dev/null && break
  sleep 1
done
/usr/local/sbin/loanos-refresh-kill-switch
systemctl restart loanos-api.service nginx
for _ in $(seq 1 90); do
  curl --fail --silent http://127.0.0.1:3040/health >/dev/null && break
  sleep 1
done
curl --fail --silent http://127.0.0.1:3040/health >/dev/null
curl --fail --silent http://127.0.0.1:47311/health | jq -e '.kill_switch_fresh == true' >/dev/null

RELEASE_JSON=$(jq -n \
  --arg releaseId "$RELEASE_ID" \
  --arg sourceKey "$SOURCE_KEY" \
  --arg sha256 "$SOURCE_SHA256" \
  --arg installedAt "$(date --iso-8601=seconds)" \
  --arg previousRelease "$(basename "$PREVIOUS_TARGET")" \
  '{releaseId:$releaseId,sourceKey:$sourceKey,sha256:$sha256,installedAt:$installedAt,previousRelease:$previousRelease}')
aws ssm put-parameter \
  --region "$AWS_REGION" \
  --name "$RELEASE_PARAMETER" \
  --description "Currently installed LoanOS synthetic showcase release" \
  --type String \
  --overwrite \
  --value "$RELEASE_JSON" >/dev/null

put_status "COMPLETE ${RELEASE_ID}"
trap - ERR
printf 'Installed release %s from s3://%s/%s\n' "$RELEASE_ID" "$SOURCE_BUCKET" "$SOURCE_KEY"
