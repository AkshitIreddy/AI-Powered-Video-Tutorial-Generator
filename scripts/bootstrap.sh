#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if command -v node >/dev/null 2>&1; then
  NODE_COMMAND=node
elif command -v node.exe >/dev/null 2>&1; then
  NODE_COMMAND=node.exe
else
  echo "Node.js is required. Install the version in .node-version, then rerun this script." >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$NODE_COMMAND" scripts/setup.mjs "$@"
