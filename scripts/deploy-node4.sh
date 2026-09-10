#!/usr/bin/env bash
set -euo pipefail

readonly ADAPTER_NAME="proscenic"
readonly PACKAGE_NAME="iobroker.proscenic"
readonly IOBROKER_ROOT="${PROSCENIC_IOBROKER_ROOT:-/opt/iobroker}"
readonly EXPECTED_HOSTNAME="${PROSCENIC_DEPLOY_EXPECTED_HOSTNAME:-CM4-Node4}"
readonly REMOTE_EVIDENCE_ROOT="${PROSCENIC_DEPLOY_EVIDENCE_ROOT:-/opt/iobroker-proscenic-deploy}"
readonly SSH_TARGET="${PROSCENIC_DEPLOY_TARGET:?Set PROSCENIC_DEPLOY_TARGET, for example root@host}"
readonly MIN_FREE_KB="${PROSCENIC_DEPLOY_MIN_FREE_KB:-524288}"

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

if [[ -n "$(git status --porcelain)" ]]; then
	echo "Refusing to deploy a dirty working tree." >&2
	exit 1
fi

commit="$(git rev-parse HEAD)"
commit_prefix="${commit:0:12}"
work_dir="$(mktemp -d /tmp/proscenic-deploy-build.XXXXXX)"
archive_path="${work_dir}/${PACKAGE_NAME}-${commit_prefix}.tar"
artifact_dir="${work_dir}/artifact"
source_dir="${work_dir}/source"
mkdir -p "${artifact_dir}" "${source_dir}"

cleanup() {
	rm -rf "${work_dir}"
}
trap cleanup EXIT

git archive --format=tar --output="${archive_path}" "${commit}"
tar -xf "${archive_path}" -C "${source_dir}"

cd "${source_dir}"
npm ci
npm run check:full
npm pack --pack-destination "${artifact_dir}"

artifact_path="$(find "${artifact_dir}" -maxdepth 1 -type f -name "${PACKAGE_NAME}-*.tgz" -print -quit)"
if [[ -z "${artifact_path}" ]]; then
	echo "npm pack did not create an artifact." >&2
	exit 1
fi

artifact_file="$(basename "${artifact_path}")"
sha_file="${artifact_path}.sha256"
shasum -a 256 "${artifact_path}" | awk '{print $1}' > "${sha_file}"
artifact_sha="$(cat "${sha_file}")"

remote_dir="${REMOTE_EVIDENCE_ROOT}/${commit_prefix}"
ssh -o BatchMode=yes "${SSH_TARGET}" "mkdir -p '${remote_dir}'"
rsync -av "${artifact_path}" "${sha_file}" "${SSH_TARGET}:${remote_dir}/"

ssh -o BatchMode=yes "${SSH_TARGET}" \
	"EXPECTED_HOSTNAME='${EXPECTED_HOSTNAME}' IOBROKER_ROOT='${IOBROKER_ROOT}' REMOTE_DIR='${remote_dir}' ARTIFACT_FILE='${artifact_file}' ARTIFACT_SHA='${artifact_sha}' COMMIT='${commit}' ADAPTER_NAME='${ADAPTER_NAME}' MIN_FREE_KB='${MIN_FREE_KB}' bash -s" <<'REMOTE'
set -euo pipefail

actual_hostname="$(hostname)"
if [[ "${actual_hostname}" != "${EXPECTED_HOSTNAME}" ]]; then
	echo "Hostname mismatch: expected ${EXPECTED_HOSTNAME}, got ${actual_hostname}" >&2
	exit 1
fi

if [[ ! -d "${IOBROKER_ROOT}" ]]; then
	echo "ioBroker root not found: ${IOBROKER_ROOT}" >&2
	exit 1
fi

free_kb="$(df -Pk "${IOBROKER_ROOT}" | awk 'NR == 2 {print $4}')"
if [[ "${free_kb}" -lt "${MIN_FREE_KB}" ]]; then
	echo "Insufficient free disk space: ${free_kb} KiB available, need ${MIN_FREE_KB} KiB" >&2
	exit 1
fi

cd "${REMOTE_DIR}"
actual_sha="$(sha256sum "${ARTIFACT_FILE}" | awk '{print $1}')"
if [[ "${actual_sha}" != "${ARTIFACT_SHA}" ]]; then
	echo "Checksum mismatch for ${ARTIFACT_FILE}" >&2
	exit 1
fi

iobroker_user="$(stat -c '%U' "${IOBROKER_ROOT}")"
if [[ -z "${iobroker_user}" || "${iobroker_user}" == "UNKNOWN" ]]; then
	echo "Cannot determine ioBroker runtime user." >&2
	exit 1
fi

runuser -u "${iobroker_user}" -- bash -lc "cd '${IOBROKER_ROOT}' && npm install '${REMOTE_DIR}/${ARTIFACT_FILE}' --omit=dev"

runuser -u "${iobroker_user}" -- bash -lc "cd '${IOBROKER_ROOT}' && ./iobroker upload '${ADAPTER_NAME}'"

if runuser -u "${iobroker_user}" -- bash -lc "cd '${IOBROKER_ROOT}' && ./iobroker object get 'system.adapter.${ADAPTER_NAME}.0' >/dev/null 2>&1"; then
	runuser -u "${iobroker_user}" -- bash -lc "cd '${IOBROKER_ROOT}' && ./iobroker restart '${ADAPTER_NAME}.0'"
else
	runuser -u "${iobroker_user}" -- bash -lc "cd '${IOBROKER_ROOT}' && ./iobroker add '${ADAPTER_NAME}'"
fi

{
	echo "source_commit=${COMMIT}"
	echo "artifact=${ARTIFACT_FILE}"
	echo "sha256=${ARTIFACT_SHA}"
	echo "hostname=${actual_hostname}"
	echo "iobroker_root=${IOBROKER_ROOT}"
	echo "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${REMOTE_DIR}/deployment.env"
REMOTE

echo "Deployment completed for ${commit}."
echo "Artifact: ${artifact_file}"
echo "SHA-256: ${artifact_sha}"
