#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Usage: ./run.sh --mode <python|pw> [--env <path>] [--accounts <path>] [--headless] [--base-url <url>] [--artifacts-dir <path>] [--dry-run]
USAGE
  exit 0
fi

echo "Usage: ./run.sh --mode <python|pw> ..." >&2
exit 2
