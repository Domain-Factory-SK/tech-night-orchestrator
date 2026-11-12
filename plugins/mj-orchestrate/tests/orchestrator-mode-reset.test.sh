#!/usr/bin/env bash
# Tests hooks/orchestrator-mode-reset.sh: compaction keeps the mode file,
# every other session start resets it. Run: bash tests/orchestrator-mode-reset.test.sh
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../hooks/orchestrator-mode-reset.sh"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/.claude"
fail=0

run() { printf '%s' "$1" | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"; }
file() { printf '%s/.claude/.orchestrator-mode.%s' "$tmp" "$1"; }

check_unchanged() {
  local name=$1 sid=$2 payload=$3 seed=$4
  printf '%s\n' "$seed" > "$(file "$sid")"
  run "$payload"
  local got; got=$(cat "$(file "$sid")")
  if [ "$got" = "$seed" ]; then echo "PASS $name"; else echo "FAIL $name: expected '$seed', got '$got'"; fail=1; fi
}

check_reset() {
  local name=$1 sid=$2 payload=$3
  printf 'standard|1|build\n' > "$(file "$sid")"
  run "$payload"
  local got; got=$(cat "$(file "$sid")")
  case $got in
    off\|[0-9]*) echo "PASS $name" ;;
    *) echo "FAIL $name: expected 'off|<ts>', got '$got'"; fail=1 ;;
  esac
}

check_unchanged "compact keeps the mode file" t1 '{"session_id":"t1","source":"compact"}' 'standard|1|build'
check_reset     "startup resets to off"       t2 '{"session_id":"t2","source":"startup"}'
check_reset     "resume resets to off"        t3 '{"session_id":"t3","source":"resume"}'
check_reset     "missing source resets to off" t4 '{"session_id":"t4"}'
check_reset     "clear resets to off"         t5 '{"session_id":"t5","source":"clear"}'
check_unchanged "compact with spaced JSON"    t6 '{"session_id": "t6", "source" : "compact"}' 'strict|2|discover'

exit $fail
