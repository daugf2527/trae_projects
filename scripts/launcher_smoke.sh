#!/usr/bin/env bash
set -euo pipefail

# Expect run.sh to support --help and exit 0
out=$(bash ./run.sh --help 2>/dev/null || true)
if [[ "$out" != *"Usage:"* ]]; then
  echo "Expected Usage output"
  exit 1
fi

# Expect dry-run command for python mode
cmd=$(bash ./run.sh --mode python --dry-run)
[[ "$cmd" == *"python3"*"main.py"* ]] || exit 1
