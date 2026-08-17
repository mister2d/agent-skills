#!/usr/bin/env bash
# install.sh — installs nomad-ops to a PATH-visible location.
#
# Creates a symlink: <PREFIX>/bin/nomad-ops -> <skill_root>/scripts/nomad
# Default prefix: ~/.local  (override with --prefix /your/prefix)
#
# Safe to invoke by absolute path, relative path, or from any CWD:
#   bash /any/path/to/nomad-ops-skill/install.sh
#   bash scripts/install.sh
#   ./install.sh
#
# After install:
#   nomad-ops jobs list
#   nomad-ops jobs register my-job.nomad
set -euo pipefail

# Resolve the real path of this script and derive the skill root from it.
# This is the same readlink-based approach used in scripts/nomad so the
# script is always location-independent regardless of how it is invoked.
_resolve_real_dir() {
  local target="${BASH_SOURCE[0]}"
  if readlink -f "$target" &>/dev/null 2>&1; then
    dirname "$(readlink -f "$target")"
  else
    # macOS / BSD readlink lacks -f; walk the symlink chain manually.
    local dir
    while [[ -L "$target" ]]; do
      dir="$(cd "$(dirname "$target")" && pwd)"
      target="$(readlink "$target")"
      [[ "$target" != /* ]] && target="${dir}/${target}"
    done
    cd "$(dirname "$target")" && pwd
  fi
}

# install.sh may live at the skill root OR in scripts/; handle both.
SELF_DIR="$(_resolve_real_dir)"
if [[ -f "${SELF_DIR}/scripts/nomad" ]]; then
  SKILL_DIR="${SELF_DIR}"             # invoked from / lives at skill root
elif [[ -f "${SELF_DIR}/nomad" ]]; then
  SKILL_DIR="$(dirname "${SELF_DIR}")" # lives inside scripts/
else
  printf 'error: cannot locate scripts/nomad relative to %s\n' "${SELF_DIR}" >&2
  exit 1
fi

PREFIX="${HOME}/.local"
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)    PREFIX="$2"; shift 2 ;;
    --prefix=*)  PREFIX="${1#--prefix=}"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

BIN_DIR="${PREFIX}/bin"
TARGET="${BIN_DIR}/nomad-ops"
SOURCE="${SKILL_DIR}/scripts/nomad"

if [[ "${UNINSTALL}" == "1" ]]; then
  if [[ -L "${TARGET}" ]]; then
    rm "${TARGET}"
    printf 'removed %s\n' "${TARGET}"
  else
    printf 'nothing to remove at %s\n' "${TARGET}"
  fi
  exit 0
fi

mkdir -p "${BIN_DIR}"
ln -sf "${SOURCE}" "${TARGET}"
chmod +x "${SOURCE}"

printf 'installed: %s -> %s\n' "${TARGET}" "${SOURCE}"

if ! printf '%s' "${PATH}" | tr ':' '\n' | grep -qx "${BIN_DIR}"; then
  printf '\nNote: %s is not in your PATH.\n' "${BIN_DIR}"
  printf 'Add this to your shell profile:\n'
  printf '  export PATH="%s:$PATH"\n' "${BIN_DIR}"
fi
