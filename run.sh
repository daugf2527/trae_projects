#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
Usage: ./run.sh --mode <python|pw> [--env <path>] [--accounts <path>] [--headless] [--base-url <url>] [--artifacts-dir <path>] [--dry-run]
USAGE
  exit 0
fi

MODE=""; ENV_FILE=""; ACCOUNTS=""; HEADLESS="false"; BASE_URL=""; ARTIFACTS_DIR=""; DRY_RUN="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --env) ENV_FILE="$2"; shift 2;;
    --accounts) ACCOUNTS="$2"; shift 2;;
    --headless) HEADLESS="true"; shift 1;;
    --base-url) BASE_URL="$2"; shift 2;;
    --artifacts-dir) ARTIFACTS_DIR="$2"; shift 2;;
    --dry-run) DRY_RUN="true"; shift 1;;
    --help|-h) cat <<'USAGE'
Usage: ./run.sh --mode <python|pw> [--env <path>] [--accounts <path>] [--headless] [--base-url <url>] [--artifacts-dir <path>] [--dry-run]
USAGE
      exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
 done

if [[ -z "$MODE" ]]; then echo "Missing --mode" >&2; exit 2; fi
if [[ "$HEADLESS" == "true" && "$MODE" == "python" ]]; then
  echo "--headless is not supported in python mode (MetaMask automation requires headed browser)." >&2
  exit 2
fi

ENV_EXPORTS=()
[[ -n "$ENV_FILE" ]] && ENV_EXPORTS+=("DOTENV_PATH=$ENV_FILE")
[[ -n "$ACCOUNTS" ]] && ENV_EXPORTS+=("ACCOUNTS_FILE=$ACCOUNTS")
[[ -n "$BASE_URL" ]] && ENV_EXPORTS+=("BASE_URL=$BASE_URL")
[[ -n "$ARTIFACTS_DIR" ]] && ENV_EXPORTS+=("ARTIFACTS_DIR=$ARTIFACTS_DIR")
[[ "$HEADLESS" == "true" && "$MODE" == "pw" ]] && ENV_EXPORTS+=("HEADLESS=true")

if [[ "$MODE" == "python" ]]; then
  CMD=(python3 main.py)
else
  CMD=(npm --prefix enterprise_pw test)
fi

if [[ "$DRY_RUN" == "true" ]]; then
  prefix=""
  if ((${#ENV_EXPORTS[@]})); then
    prefix="${ENV_EXPORTS[*]} "
  fi
  echo "${prefix}${CMD[*]}"
  exit 0
fi

if ((${#ENV_EXPORTS[@]})); then
  export ${ENV_EXPORTS[*]}
fi
"${CMD[@]}"
