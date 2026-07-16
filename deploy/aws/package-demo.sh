#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
MANIFEST_FILE="$ROOT_DIR/deploy/aws/demo-package-manifest.txt"
OUTPUT="$ROOT_DIR/loanos-server-web.tar.gz"
SOURCE_MODE=${PACKAGE_SOURCE_MODE:-commit}
OUTPUT_SET=false

usage() {
  cat <<'EOF'
Usage: ./deploy/aws/package-demo.sh [OUTPUT] [--include-worktree]

Creates the AWS server/browser release described by
deploy/aws/demo-package-manifest.txt. The default packages committed HEAD and
refuses relevant uncommitted changes. --include-worktree is a deliberate
development escape hatch: it packages current tracked and non-ignored content
under the same explicit allowlist.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --include-worktree) SOURCE_MODE=worktree ;;
    --help|-h) usage; exit 0 ;;
    --*) echo "Unknown option: $argument" >&2; usage >&2; exit 2 ;;
    *)
      if [[ "$OUTPUT_SET" == true ]]; then
        echo "Only one output path may be supplied" >&2
        usage >&2
        exit 2
      fi
      OUTPUT=$argument
      OUTPUT_SET=true
      ;;
  esac
done

cd "$ROOT_DIR"
[[ -f "$MANIFEST_FILE" ]] || { echo "Missing package manifest: $MANIFEST_FILE" >&2; exit 1; }

PATHS=()
while IFS= read -r path; do
  [[ -z "$path" || "$path" == \#* ]] && continue
  case "$path" in
    /*|../*|*/../*) echo "Unsafe package path: $path" >&2; exit 1 ;;
    apps/android-*) echo "Android applications are forbidden in the AWS runtime archive: $path" >&2; exit 1 ;;
  esac
  if [[ "$SOURCE_MODE" == "commit" ]]; then
    git cat-file -e "HEAD:${path}" 2>/dev/null || {
      echo "Package manifest path is not committed at HEAD: $path" >&2
      exit 1
    }
  else
    [[ -e "$path" ]] || {
      echo "Package manifest path does not exist in the worktree: $path" >&2
      exit 1
    }
  fi
  PATHS+=("$path")
done < "$MANIFEST_FILE"

[[ ${#PATHS[@]} -gt 0 ]] || { echo "Package manifest is empty" >&2; exit 1; }

if [[ "$SOURCE_MODE" == "commit" ]]; then
  if ! git diff --quiet HEAD -- "${PATHS[@]}"; then
    echo "AWS runtime paths have uncommitted changes; commit them before a real release" >&2
    echo "For a disposable development package only, pass --include-worktree" >&2
    exit 1
  fi
  git archive --format=tar.gz --output="$OUTPUT" HEAD -- "${PATHS[@]}"
elif [[ "$SOURCE_MODE" == "worktree" ]]; then
  FILE_LIST=$(mktemp "${TMPDIR:-/tmp}/loanos-demo-files.XXXXXX")
  trap 'rm -f "$FILE_LIST"' EXIT
  git ls-files -z --cached --others --exclude-standard -- "${PATHS[@]}" > "$FILE_LIST"
  tar --null -T "$FILE_LIST" -czf "$OUTPUT"
else
  echo "Unsupported PACKAGE_SOURCE_MODE: $SOURCE_MODE" >&2
  exit 2
fi

chmod 0600 "$OUTPUT"

ARCHIVE_LIST=$(mktemp "${TMPDIR:-/tmp}/loanos-demo-archive.XXXXXX")
trap 'rm -f "${FILE_LIST:-}" "$ARCHIVE_LIST"' EXIT
tar -tzf "$OUTPUT" > "$ARCHIVE_LIST"

for required in package.json package-lock.json apps/api/src/server.js rules/Cargo.toml db/schema.sql deploy/aws/bootstrap-demo.sh deploy/aws/update-demo.sh; do
  grep -Fxq "$required" "$ARCHIVE_LIST" || {
    echo "Release archive is missing required runtime file: $required" >&2
    exit 1
  }
done
if grep -Eq '(^|/)apps/android-|(^|/)node_modules/|(^|/)target/|(^|/)\.git/' "$ARCHIVE_LIST"; then
  echo "Release archive contains a forbidden Android, build, dependency, or Git path" >&2
  exit 1
fi

ARCHIVE_SHA256=$(shasum -a 256 "$OUTPUT" | awk '{print $1}')
COMMIT_SHA=$(git rev-parse --verify HEAD)
FILE_COUNT=$(wc -l < "$ARCHIVE_LIST" | tr -d ' ')

cat > "${OUTPUT}.manifest.json" <<EOF
{
  "schemaVersion": 2,
  "sourceMode": "${SOURCE_MODE}",
  "commitSha": "${COMMIT_SHA}",
  "archiveSha256": "${ARCHIVE_SHA256}",
  "fileCount": ${FILE_COUNT},
  "androidIncluded": false
}
EOF
chmod 0600 "${OUTPUT}.manifest.json"

printf 'Created %s\nManifest %s\nSource mode %s\nFiles %s\nSHA-256 %s\n' \
  "$OUTPUT" "${OUTPUT}.manifest.json" "$SOURCE_MODE" "$FILE_COUNT" "$ARCHIVE_SHA256"
