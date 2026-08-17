#!/usr/bin/env bash
# sync-docs.sh — sparse-clones only the Nomad v1.11.x API docs from HashiCorp web-unified-docs.
# Run once to seed references/raw-docs/, then re-run to update.
# No Node.js required — pure git + bash.
set -euo pipefail

REPO="https://github.com/hashicorp/web-unified-docs.git"
SPARSE_PATH="content/nomad/v1.11.x/content/api-docs"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${SKILL_DIR}/references/raw-docs"

# Clone dir lives at project root, NOT inside TARGET_DIR.
# Placing it inside TARGET_DIR caused rsync --delete to try removing .git internals.
CLONE_DIR="${SKILL_DIR}/.nomad-docs-clone"

echo "▶ Nomad API docs sync"
echo "  repo   : ${REPO}"
echo "  path   : ${SPARSE_PATH}"
echo "  target : ${TARGET_DIR}"
echo ""

if [[ -d "${CLONE_DIR}/.git" ]]; then
  echo "▶ Updating existing sparse clone ..."
  git -C "${CLONE_DIR}" fetch --depth=1 origin main
  git -C "${CLONE_DIR}" checkout FETCH_HEAD
else
  echo "▶ Initial sparse clone (only ${SPARSE_PATH}) ..."
  mkdir -p "${CLONE_DIR}"
  git -C "${CLONE_DIR}" init -q
  git -C "${CLONE_DIR}" remote add origin "${REPO}"

  # sparse-checkout must be configured BEFORE fetch so the working tree
  # is restricted to the target path on checkout.
  git -C "${CLONE_DIR}" config core.sparseCheckout true
  git -C "${CLONE_DIR}" config advice.detachedHead false
  echo "${SPARSE_PATH}/" > "${CLONE_DIR}/.git/info/sparse-checkout"

  git -C "${CLONE_DIR}" fetch --depth=1 origin main
  git -C "${CLONE_DIR}" checkout FETCH_HEAD
fi

if [[ ! -d "${CLONE_DIR}/${SPARSE_PATH}" ]]; then
  echo "error: sparse checkout did not produce ${SPARSE_PATH}" >&2
  exit 1
fi

echo "▶ Syncing .mdx files to ${TARGET_DIR} ..."
mkdir -p "${TARGET_DIR}"

# rsync exit code 24 = "files vanished before transfer" — benign when git
# touches the working tree concurrently. Propagate all other non-zero codes.
rsync -a --delete \
  --include="*/" --include="*.mdx" --exclude="*" \
  "${CLONE_DIR}/${SPARSE_PATH}/" \
  "${TARGET_DIR}/" || { rc=$?; [[ ${rc} -eq 24 ]] || exit ${rc}; }

MDX_COUNT=$(find "${TARGET_DIR}" -name "*.mdx" | wc -l | tr -d ' ')
echo "✔ Synced ${MDX_COUNT} .mdx files"
echo ""
echo "Usage:"
echo "  cat references/raw-docs/<resource>.mdx"
echo "  grep -r 'AccessMode' references/raw-docs/"
echo "  ls references/raw-docs/acl/"
