#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"
env_file="${repo_root}/.poc-private/rest-poc/env.sh"

usage() {
  cat <<'USAGE'
Usage:
  ./run-private-scan.sh <group> [start] [limit] [region] [timeout-ms] [log-mode]

Examples:
  ./run-private-scan.sh maintenance 0 1000
  ./run-private-scan.sh messages 1000 1000
  ./run-private-scan.sh messages 0 50 tw 2000 interesting

Arguments:
  group       device | maintenance | messages | map | rooms | all
  start       zero-based candidate start index, default: 0
  limit       number of candidates, default: 1000
  region      probe region eu | tw, default: eu
  timeout-ms  per-request timeout, default: 10000 for eu, 2000 for tw
  log-mode    all | interesting | summary, default: interesting

The script loads private credentials from:
  ../../.poc-private/rest-poc/env.sh

That file must export PROSCENIC_EMAIL and PROSCENIC_PASSWORD and must stay
local/ignored.
USAGE
}

group="${1:-}"
if [[ -z "${group}" || "${group}" == "--help" || "${group}" == "-h" ]]; then
  usage
  exit 0
fi

case "${group}" in
  device | maintenance | messages | map | rooms | all) ;;
  *)
    echo "Unsupported group: ${group}" >&2
    usage >&2
    exit 2
    ;;
esac

start="${2:-0}"
limit="${3:-1000}"
region="${4:-eu}"
case "${region}" in
  eu | tw) ;;
  *)
    echo "Unsupported region: ${region}" >&2
    usage >&2
    exit 2
    ;;
esac

timeout="${5:-}"
if [[ -z "${timeout}" ]]; then
  if [[ "${region}" == "tw" ]]; then
    timeout="2000"
  else
    timeout="10000"
  fi
fi

log_mode="${6:-interesting}"
case "${log_mode}" in
  all | interesting | summary) ;;
  *)
    echo "Unsupported log mode: ${log_mode}" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ ! "${start}" =~ ^[0-9]+$ || ! "${limit}" =~ ^[0-9]+$ || ! "${timeout}" =~ ^[0-9]+$ ]]; then
  echo "start, limit, and timeout-ms must be non-negative integers." >&2
  exit 2
fi

if [[ ! -f "${env_file}" ]]; then
  echo "Missing private env file: ${env_file}" >&2
  echo "Create it with exports for PROSCENIC_EMAIL and PROSCENIC_PASSWORD." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${env_file}"

if [[ -z "${PROSCENIC_EMAIL:-}" || -z "${PROSCENIC_PASSWORD:-}" ]]; then
  echo "Private env file must export PROSCENIC_EMAIL and PROSCENIC_PASSWORD." >&2
  exit 1
fi

cd "${script_dir}"

export PROSCENIC_REGION="${region}"
export PROSCENIC_DEVICE_REGION="${PROSCENIC_DEVICE_REGION:-eu}"
export PROSCENIC_REST_GROUP="${group}"
export PROSCENIC_REST_START_INDEX="${start}"
export PROSCENIC_REST_MAX_CANDIDATES="${limit}"
export PROSCENIC_TIMEOUT_MS="${timeout}"
export PROSCENIC_REST_LOG_MODE="${log_mode}"

npm start
