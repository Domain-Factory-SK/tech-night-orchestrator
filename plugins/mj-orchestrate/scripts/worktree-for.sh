#!/usr/bin/env bash
# worktree-for.sh <repo-path> <name> <target-ref> [branch-name]
#
# Creates a FRESH worktree at .claude/worktrees/<name> inside <repo-path>,
# checked out detached at the fetched <target-ref> (or on a new branch
# <branch-name> based at <target-ref> if given), then runs
# checkout-preflight.sh against it and prints its OK line.
#
# This is the companion to checkout-preflight.sh: the intended way for a
# review/implementation agent to get a verified-fresh checkout instead of
# ever reading a repo's main checkout.

set -u

usage() {
  echo "usage: worktree-for.sh <repo-path> <name> <target-ref> [branch-name]" >&2
  echo "  <target-ref> e.g. origin/feature/x, a PR head SHA, origin/main" >&2
  exit 2
}

[ $# -eq 3 ] || [ $# -eq 4 ] || usage

repo_path=$1
name=$2
target_ref=$3
branch_name=${4:-}

script_dir=$(cd "$(dirname "$0")" && pwd -P)
preflight="$script_dir/checkout-preflight.sh"
if [ ! -x "$preflight" ]; then
  echo "worktree-for.sh: cannot find executable checkout-preflight.sh next to this script ($preflight)" >&2
  exit 1
fi

if [ ! -d "$repo_path" ]; then
  echo "worktree-for.sh: no such directory: $repo_path" >&2
  exit 1
fi

repo_abs=$(cd "$repo_path" 2>/dev/null && pwd -P)
if ! git -C "$repo_abs" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "worktree-for.sh: $repo_abs is not a git repo" >&2
  exit 1
fi

# Always resolve from the repo's git-common-dir (works from a worktree too)
common_dir=$(git -C "$repo_abs" rev-parse --git-common-dir)
repo_root=$(cd "$repo_abs" && cd "$(dirname "$common_dir")" 2>/dev/null && pwd -P)
[ -n "$repo_root" ] || repo_root=$repo_abs

worktree_path="$repo_root/.claude/worktrees/$name"

if [ -e "$worktree_path" ]; then
  echo "worktree-for.sh: $worktree_path already exists; remove it first (git worktree remove) or pick a different name" >&2
  exit 1
fi

echo "Fetching origin (--prune)..." >&2
if ! git -C "$repo_abs" fetch origin --prune --quiet; then
  echo "worktree-for.sh: git fetch origin failed in $repo_abs" >&2
  exit 1
fi

target_sha=$(git -C "$repo_abs" rev-parse --verify --quiet "${target_ref}^{commit}")
if [ -z "$target_sha" ]; then
  echo "worktree-for.sh: cannot resolve target ref '$target_ref' in $repo_abs (after fetch)" >&2
  exit 1
fi

mkdir -p "$repo_root/.claude/worktrees"

if [ -n "$branch_name" ]; then
  if ! git -C "$repo_abs" worktree add -b "$branch_name" "$worktree_path" "$target_sha"; then
    echo "worktree-for.sh: git worktree add -b $branch_name failed" >&2
    exit 1
  fi
else
  if ! git -C "$repo_abs" worktree add --detach "$worktree_path" "$target_sha"; then
    echo "worktree-for.sh: git worktree add --detach failed" >&2
    exit 1
  fi
fi

exec "$preflight" "$worktree_path" "$target_ref"
