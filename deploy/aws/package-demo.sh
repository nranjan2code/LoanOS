#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
OUTPUT=${1:-"$ROOT_DIR/loanos-demo-source.tar.gz"}

cd "$ROOT_DIR"

if ! git diff --quiet -- deploy/aws; then
  echo "deploy/aws has uncommitted changes; commit them before packaging" >&2
  exit 1
fi
if ! git diff --cached --quiet -- deploy/aws; then
  echo "deploy/aws has staged but uncommitted changes; commit them before packaging" >&2
  exit 1
fi

git archive --format=tar.gz --output="$OUTPUT" HEAD
chmod 0600 "$OUTPUT"

ARCHIVE_SHA256=$(shasum -a 256 "$OUTPUT" | awk '{print $1}')
printf 'Created %s\nSHA-256 %s\n' "$OUTPUT" "$ARCHIVE_SHA256"
