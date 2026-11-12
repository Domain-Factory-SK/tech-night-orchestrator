#!/usr/bin/env bash
# checkout-preflight.sh <repo-path> <target-ref>
#
# Run BEFORE reading any repo for a review/implementation task. Guards
# against the STALE-CHECKOUT failure class: an agent reading a working
# tree that is not actually at the commit the dispatch named.
#
# Refuses (non-zero exit, clear message) when:
#   - <repo-path> is not inside a git work tree
#   - the path resolves to the repo's MAIN checkout (not a linked worktree)
#   - the working tree is dirty (uncommitted changes, staged or not)
#   - HEAD is not exactly the resolved <target-ref> commit
#
# On success prints exactly one line to stdout:
#   PREFLIGHT OK <repo> HEAD=<sha> == <target-ref>
# Quote that line verbatim in the agent's report as evidence the checkout
# was verified before any file was read.

set -u

usage() {
  echo "usage: checkout-preflight.sh <repo-path> <target-ref>" >&2
  echo "  <target-ref> e.g. origin/feature/x, a PR head SHA, origin/main" >&2
  exit 2
}

[ $# -eq 2 ] || usage

repo_path=$1
target_ref=$2

if [ ! -d "$repo_path" ]; then
  echo "PREFLIGHT FAIL: no such directory: $repo_path" >&2
  exit 1
fi

repo_abs=$(cd "$repo_path" 2>/dev/null && pwd -P)
if [ -z "$repo_abs" ]; then
  echo "PREFLIGHT FAIL: cannot resolve path: $repo_path" >&2
  exit 1
fi

if ! git -C "$repo_abs" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "PREFLIGHT FAIL: $repo_abs is not inside a git work tree" >&2
  exit 1
fi

# Main checkout vs linked worktree: for a linked worktree, --git-dir points
# inside <common-dir>/worktrees/<name>, which differs from --git-common-dir.
# For the main checkout, the two are identical.
git_dir=$(git -C "$repo_abs" rev-parse --git-dir)
common_dir=$(git -C "$repo_abs" rev-parse --git-common-dir)
git_dir_abs=$(cd "$repo_abs" && cd "$git_dir" 2>/dev/null && pwd -P)
common_dir_abs=$(cd "$repo_abs" && cd "$common_dir" 2>/dev/null && pwd -P)

if [ "$git_dir_abs" = "$common_dir_abs" ]; then
  echo "PREFLIGHT FAIL: $repo_abs is the repo's MAIN checkout, not a linked worktree." >&2
  echo "  Never read/run a review or implementation task from the main checkout." >&2
  echo "  Use worktree-for.sh to create a fresh worktree at the target ref instead." >&2
  exit 1
fi

echo "Fetching origin (--prune)..." >&2
if ! git -C "$repo_abs" fetch origin --prune --quiet; then
  echo "PREFLIGHT FAIL: git fetch origin failed in $repo_abs" >&2
  exit 1
fi

target_sha=$(git -C "$repo_abs" rev-parse --verify --quiet "${target_ref}^{commit}")
if [ -z "$target_sha" ]; then
  echo "PREFLIGHT FAIL: cannot resolve target ref '$target_ref' in $repo_abs (after fetch)" >&2
  exit 1
fi

dirty=$(git -C "$repo_abs" status --porcelain)
if [ -n "$dirty" ]; then
  echo "PREFLIGHT FAIL: working tree at $repo_abs is dirty:" >&2
  echo "$dirty" >&2
  exit 1
fi

head_sha=$(git -C "$repo_abs" rev-parse HEAD)
if [ "$head_sha" != "$target_sha" ]; then
  echo "PREFLIGHT FAIL: HEAD ($head_sha) != resolved target '$target_ref' ($target_sha) in $repo_abs" >&2
  echo "  This is the STALE-CHECKOUT failure: do not read this tree as-is." >&2
  echo "  Re-create the worktree at the target with worktree-for.sh, or 'git checkout <target-ref>' if this is a scratch worktree you own." >&2
  exit 1
fi

echo "PREFLIGHT OK $repo_abs HEAD=$head_sha == $target_ref"
