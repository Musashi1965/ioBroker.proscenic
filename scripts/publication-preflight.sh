#!/usr/bin/env bash
set -euo pipefail

requested_version="${1:-}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

package_name="$(node -p "require('./package.json').name")"
package_version="$(node -p "require('./package.json').version")"
io_package_version="$(node -p "require('./io-package.json').common.version")"
target_version="${requested_version:-$package_version}"
tag_name="v${target_version}"

printf 'Publication preflight for %s %s\n' "$package_name" "$target_version"
printf 'Repository: %s\n' "$repo_root"
current_branch="$(git branch --show-current)"
printf 'Branch: %s\n' "$current_branch"
printf 'HEAD: %s\n' "$(git rev-parse HEAD)"

if [[ "$current_branch" != "main" ]]; then
  printf 'ERROR: releases must be prepared on main, not %s\n' "$current_branch" >&2
  exit 1
fi

if [[ "$package_version" != "$io_package_version" ]]; then
  printf 'ERROR: package.json version (%s) differs from io-package.json version (%s)\n' \
    "$package_version" "$io_package_version" >&2
  exit 1
fi

if [[ "$target_version" != "$package_version" ]]; then
  printf 'ERROR: requested version (%s) differs from package.json version (%s)\n' \
    "$target_version" "$package_version" >&2
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  printf 'ERROR: working tree is not clean\n' >&2
  git status --short >&2
  exit 1
fi

if git rev-parse "$tag_name" >/dev/null 2>&1; then
  printf 'ERROR: local tag %s already exists\n' "$tag_name" >&2
  exit 1
fi

remote_tag_check="$(mktemp)"
if git ls-remote --exit-code --tags origin "$tag_name" >"$remote_tag_check" 2>&1; then
  printf 'ERROR: remote tag %s already exists on origin\n' "$tag_name" >&2
  exit 1
else
  remote_tag_status=$?
  if [[ "$remote_tag_status" -ne 2 ]]; then
    printf 'ERROR: could not verify remote tag %s on origin\n' "$tag_name" >&2
    cat "$remote_tag_check" >&2
    exit 1
  fi
fi

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    printf 'ERROR: HEAD does not match origin/main; push or pull main before release\n' >&2
    exit 1
  fi
else
  printf 'WARNING: origin/main is not available locally; branch synchronization must be verified separately.\n' >&2
fi

git diff --check
npm run check:full
npm pack --dry-run

printf 'npm registry state for %s:\n' "$package_name"
npm view "$package_name" versions dist-tags --json || true

printf 'Publication preflight completed for %s.\n' "$tag_name"
