#!/usr/bin/env bash
# Tests hooks/orchestrator-session-title.sh: pure mode switches and other slash commands
# never title, a real first task or an ordinary prompt under an active mode titles once
# per session, output is valid JSON, and every failure path exits 0 silently.
# Run: bash tests/orchestrator-session-title.test.sh
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../hooks/orchestrator-session-title.sh"
command -v jq >/dev/null 2>&1 || { echo "SKIP jq not installed"; exit 0; }
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/.claude"
fail=0
dial='🎛 '

payload() { jq -nc --arg s "$1" --arg p "$2" '{session_id:$s,prompt:$p,hook_event_name:"UserPromptSubmit"}'; }
run() { printf '%s' "$1" | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"; }
marker() { printf '%s/.claude/.orchestrator-title.%s' "$tmp" "$1"; }
modefile() { printf '%s/.claude/.orchestrator-mode.%s' "$tmp" "$1"; }
title_of() { printf '%s' "$1" | jq -r '.hookSpecificOutput.sessionTitle' 2>/dev/null; }
pass() { echo "PASS $1"; }
bad() { echo "FAIL $1: $2"; fail=1; }

check_silent() {
  local name=$1 sid=$2 prompt=$3 out rc
  out=$(run "$(payload "$sid" "$prompt")"); rc=$?
  if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$(marker "$sid")" ]; then pass "$name"
  else bad "$name" "rc=$rc out='$out' marker=$([ -e "$(marker "$sid")" ] && echo yes || echo no)"; fi
}

check_marked() {
  local name=$1 sid=$2 prompt=$3 out rc
  out=$(run "$(payload "$sid" "$prompt")"); rc=$?
  if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ "$(cat "$(marker "$sid")" 2>/dev/null)" = "-" ]; then pass "$name"
  else bad "$name" "rc=$rc out='$out' marker='$(cat "$(marker "$sid")" 2>/dev/null)'"; fi
}

event_payload() { jq -nc --arg s "$1" --arg e "$2" --arg src "$3" '{session_id:$s,hook_event_name:$e,source:$src}'; }
event_payload_p() { jq -nc --arg s "$1" --arg e "$2" --arg src "$3" --arg p "$4" '{session_id:$s,hook_event_name:$e,source:$src,prompt:$p}'; }

check_title() {
  local name=$1 sid=$2 prompt=$3 want=$4 out got
  out=$(run "$(payload "$sid" "$prompt")")
  got=$(title_of "$out")
  if [ "$got" = "$want" ] && [ -f "$(marker "$sid")" ]; then pass "$name"
  else bad "$name" "expected '$want', got '$got' (marker $([ -f "$(marker "$sid")" ] && echo yes || echo no))"; fi
}

check_silent "mj-orchestrate standard build is a mode switch"  s1 '/mj-orchestrate standard build'
check_silent "namespaced light discover is a mode switch"      s2 '/mj-orchestrate:mj-orchestrate light discover'
check_silent "bare command is a mode switch"                   s3 '/mj-orchestrate'
check_silent "off is a mode switch"                            s4 '/mj-orchestrate off'
check_silent "status is a mode switch"                         s5 '/mj-orchestrate status'
check_silent "scope discover is a mode switch"                 s6 '/mj-orchestrate scope discover'
check_silent "normal mode is a mode switch"                    s7 '/mj-orchestrate normal mode'
check_silent "no-code strict is a mode switch"                 s8 '/mj-orchestrate strict no-code'
check_silent "other slash command is ignored"                  s9 '/reload-plugins'

check_title "level words then a task"  t1 '/mj-orchestrate standard build fix the login timeout' "${dial}fix the login timeout"
check_title "namespaced command with a task" t2 '/mj-orchestrate:mj-orchestrate fix the login timeout' "${dial}fix the login timeout"
check_title "task without level words" t3 '/mj-orchestrate add a retry to the upload client' "${dial}add a retry to the upload client"

printf 'standard|1|build\n' > "$(modefile o1)"
check_title "ordinary prompt with mode on is titled" o1 'refactor the config loader' "${dial}refactor the config loader"
printf 'off|1\n' > "$(modefile o2)"
check_marked "ordinary prompt with mode off writes a - marker" o2 'refactor the config loader'
check_marked "ordinary prompt with no mode file writes a - marker" o3 'refactor the config loader'
printf 'bogus|1|build\n' > "$(modefile o4)"
check_marked "ordinary prompt with unknown mode writes a - marker" o4 'refactor the config loader'

out=$(run "$(payload o2 '/mj-orchestrate standard build some task')")
if [ -z "$out" ]; then pass "task after a mode-off prompt is not titled"; else bad "task after a mode-off prompt" "got '$out'"; fi
printf 'standard|1|build\n' > "$(modefile o3)"
out=$(run "$(payload o3 'continue with the next step')")
if [ -z "$out" ]; then pass "late-enabled orchestration does not retitle an old session"; else bad "late-enabled orchestration" "got '$out'"; fi

for src in resume compact; do
  sid=r_$src
  out=$(run "$(event_payload_p "$sid" SessionStart "$src" 'a prompt field that must be ignored')"); rc=$?
  if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ "$(cat "$(marker "$sid")" 2>/dev/null)" = "-" ]; then pass "SessionStart $src marks the session, prints nothing"
  else bad "SessionStart $src" "rc=$rc out='$out' marker='$(cat "$(marker "$sid")" 2>/dev/null)'"; fi
  printf 'standard|1|build\n' > "$(modefile "$sid")"
  out=$(run "$(payload "$sid" 'ok continue')")
  if [ -z "$out" ]; then pass "after SessionStart $src an ordinary prompt is not titled"; else bad "after $src ordinary prompt" "got '$out'"; fi
  out=$(run "$(payload "$sid" '/mj-orchestrate standard build some task')")
  if [ -z "$out" ]; then pass "after SessionStart $src a task command is not titled"; else bad "after $src task command" "got '$out'"; fi
done

for src in startup clear bogus; do
  sid=f_$src
  out=$(run "$(event_payload_p "$sid" SessionStart "$src" 'prompt ignored')"); rc=$?
  if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$(marker "$sid")" ]; then pass "SessionStart $src prints nothing and writes no marker"
  else bad "SessionStart $src" "rc=$rc out='$out'"; fi
  check_title "first task after SessionStart $src still titles" "$sid" '/mj-orchestrate standard build some task' "${dial}some task"
done
out=$(printf '%s' '{"session_id":"f_nosrc","hook_event_name":"SessionStart"}' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$(marker f_nosrc)" ]; then pass "SessionStart without source does nothing"; else bad "SessionStart without source" "rc=$rc out='$out'"; fi

out=$(run "$(payload t1 'second prompt in the same session')")
if [ -z "$out" ]; then pass "second prompt in the same session is silent"; else bad "second prompt in the same session is silent" "got '$out'"; fi
printf 'light|1|build\n' > "$(modefile t3)"
out=$(run "$(payload t3 'another prompt')")
if [ -z "$out" ]; then pass "marker beats an active mode"; else bad "marker beats an active mode" "got '$out'"; fi

out=$(run "$(payload l1 '/mj-orchestrate standard build investigate why the nightly export job keeps failing on large tenants')")
got=$(title_of "$out")
body=${got#"$dial"}
case $got in
  "$dial"*"…") 
    stripped=${body%…}
    if [ "$stripped" = "investigate why the nightly export job keeps" ] && [ "${stripped: -1}" != " " ]; then pass "long prompt cut at a word boundary"
    else bad "long prompt cut at a word boundary" "got '$got'"; fi
    chars=$(printf '%s' "$stripped" | jq -Rr 'length')
    if [ "$chars" -le 50 ]; then pass "long prompt text is at most 50 characters ($chars)"; else bad "long prompt length" "$chars"; fi ;;
  *) bad "long prompt ends with an ellipsis" "got '$got'" ;;
esac

out=$(run "$(payload l2 '/mj-orchestrate fixthelongestwordwithoutanyspacesatallbecauseitkeepsgoingandgoingforever')")
got=$(title_of "$out"); chars=$(printf '%s' "${got#"$dial"}" | jq -Rr 'length')
case $got in
  "$dial"*"…") [ "$chars" -eq 51 ] && pass "no space: hard cut at 50 plus ellipsis" || bad "hard cut" "chars=$chars got '$got'" ;;
  *) bad "hard cut" "got '$got'" ;;
esac

out=$(run "$(payload l4 '/mj-orchestrate aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeee zzz')")
if [ "$(title_of "$out")" = "${dial}aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeee…" ]; then pass "space right after character 50 keeps all 50"; else bad "boundary at 50" "got '$(title_of "$out")'"; fi

out=$(run "$(payload l3 '/mj-orchestrate ääääääääääääääääääääääääääääääääääääääääääääääääääääääääääää ö')")
got=$(title_of "$out"); chars=$(printf '%s' "${got#"$dial"}" | jq -Rr 'length')
if [ "$chars" -eq 51 ]; then pass "multibyte text counted by characters"; else bad "multibyte text counted by characters" "chars=$chars got '$got'"; fi

tricky=$(printf '/mj-orchestrate fix "quoted" and back\\slash\n\tsecond line\r\nthird')
out=$(run "$(payload q1 "$tricky")")
if printf '%s' "$out" | jq -e . >/dev/null 2>&1; then pass "tricky prompt yields valid JSON"; else bad "tricky prompt yields valid JSON" "out='$out'"; fi
got=$(title_of "$out")
case $got in
  *$'\n'*|*$'\r'*|*$'\t'*) bad "title has no raw newline, tab or CR" "got '$got'" ;;
  *) [ "$got" = "${dial}fix \"quoted\" and back\\slash second line third" ] && pass "title has whitespace collapsed" || bad "title has whitespace collapsed" "got '$got'" ;;
esac
lines=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
if [ "$lines" -eq 1 ]; then pass "output is a single line"; else bad "output is a single line" "$lines lines"; fi

out=$(run "$(payload j1 '/mj-orchestrate go')")
if [ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName')" = "UserPromptSubmit" ]; then pass "hookEventName is UserPromptSubmit"
else bad "hookEventName is UserPromptSubmit" "out='$out'"; fi

out=$(printf '%s' '{"prompt":"/mj-orchestrate fix it"}' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "no session id and empty env is silent"; else bad "no session id" "rc=$rc out='$out'"; fi
ls "$tmp/.claude" | grep -q 'global' && bad "no global marker" "found a global file" || pass "no global marker is created"

out=$(printf '%s' '{"prompt":"/mj-orchestrate fix it"}' | HOME="$tmp" CLAUDE_CODE_SESSION_ID=envsid bash "$script")
if [ "$(title_of "$out")" = "${dial}fix it" ] && [ -f "$(marker envsid)" ]; then pass "env session id is used when payload has none"
else bad "env session id fallback" "out='$out'"; fi

out=$(printf '%s' 'this is not json {{{' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "garbage payload exits 0 silently"; else bad "garbage payload" "rc=$rc out='$out'"; fi
out=$(printf '%s' '{"session_id":"g2","prompt":' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$(marker g2)" ]; then pass "truncated JSON exits 0 silently"; else bad "truncated JSON" "rc=$rc out='$out'"; fi
out=$(printf '' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "empty payload exits 0 silently"; else bad "empty payload" "rc=$rc"; fi
check_silent "payload without a prompt field is silent" n1 ''
out=$(printf '%s' '{"session_id":"n2"}' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "missing prompt field exits 0 silently"; else bad "missing prompt field" "rc=$rc"; fi
out=$(printf '%s' '{"session_id":"../x","prompt":"/mj-orchestrate fix it"}' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "path-like session id is refused"; else bad "path-like session id" "rc=$rc out='$out'"; fi

nojq=$(mktemp -d); ln -s /bin/cat "$nojq/cat"; ln -s "$(command -v sed)" "$nojq/sed"; ln -s "$(command -v head)" "$nojq/head"
out=$(payload j2 '/mj-orchestrate fix it' | HOME="$tmp" CLAUDE_CODE_SESSION_ID= PATH="$nojq" "$BASH" "$script"); rc=$?
rm -rf "$nojq"
if [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -e "$(marker j2)" ]; then pass "missing jq fails open"; else bad "missing jq fails open" "rc=$rc out='$out'"; fi

ro=$(mktemp -d); mkdir -p "$ro/.claude"; chmod 555 "$ro/.claude"
out=$(payload w1 '/mj-orchestrate fix it' | HOME="$ro" CLAUDE_CODE_SESSION_ID= bash "$script"); rc=$?
chmod 755 "$ro/.claude"; rm -rf "$ro"
if [ "$rc" -eq 0 ]; then pass "unwritable marker directory still exits 0"; else bad "unwritable marker directory" "rc=$rc"; fi

exit $fail
