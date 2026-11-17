#!/usr/bin/env bash
# UserPromptSubmit + SessionStart hook: names the session after its first orchestrated
# task, so a session whose first message is just "/mj-orchestrate standard build" is not
# left named after that command. Only a session that BEGINS with the orchestrator is
# titled; a resumed session, or one that already had a normal prompt, is left alone.
# UserPromptSubmit: emits {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
# "sessionTitle":"🎛 <task>"}} once per session. Marker file
# ~/.claude/.orchestrator-title.<session_id> holds the title, or "-" when the session is
# closed to titling. Pure mode switches (/mj-orchestrate with only level/scope/control
# words, off, stop, normal, status) and other slash commands neither title nor mark. An
# ordinary prompt titles only while orchestrator mode is on; with the mode off or no mode
# file it writes the "-" marker and stays silent, since the host names that session from
# this real prompt.
# SessionStart: source resume or compact writes the "-" marker (if none exists); any
# other source does nothing. SessionStart never prints anything.
# FAILS OPEN: missing session id, missing jq, unparseable payload or unwritable
# marker exits 0 silently. Runs on every prompt: the marker check comes before jq.
payload=$(cat 2>/dev/null)
[ -n "$payload" ] || exit 0
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$sid" ] && exit 0
case "$sid" in
  *[!A-Za-z0-9._-]*) exit 0 ;;
esac
marker="$HOME/.claude/.orchestrator-title.$sid"
[ -e "$marker" ] && exit 0
write_marker() {
  mkdir -p "$HOME/.claude" 2>/dev/null
  { printf '%s\n' "$1" > "$marker"; } 2>/dev/null
}
event=$(printf '%s' "$payload" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if [ "$event" = "SessionStart" ]; then
  source=$(printf '%s' "$payload" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  case "$source" in
    resume|compact) write_marker "-" ;;
  esac
  exit 0
fi
command -v jq >/dev/null 2>&1 || exit 0
prompt=$(printf '%s' "$payload" | jq -r '.prompt // empty' 2>/dev/null) || exit 0
[ -n "$prompt" ] || exit 0

ws=$' \t\r\n'
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
trim() {
  local s=$1
  while [ -n "$s" ] && case ${s:0:1} in [$ws]) true ;; *) false ;; esac; do s=${s:1}; done
  while [ -n "$s" ] && case ${s: -1} in [$ws]) true ;; *) false ;; esac; do s=${s%?}; done
  printf '%s' "$s"
}

prompt=$(trim "$prompt")
[ -n "$prompt" ] || exit 0
case "$prompt" in
  /*)
    first=${prompt%%[[:space:]]*}
    case "$first" in
      /mj-orchestrate|/mj-orchestrate:mj-orchestrate) ;;
      *) exit 0 ;;
    esac
    task=${prompt#"$first"}
    while :; do
      task=$(trim "$task")
      word=${task%%[[:space:]]*}
      case "$(lower "$word")" in
        strict|standard|light|discover|build|no-code|mode|scope|level) task=${task#"$word"} ;;
        *) break ;;
      esac
    done
    case "$(lower "$task")" in
      ""|off|stop|normal|status|"normal mode") exit 0 ;;
    esac
    ;;
  *)
    mode_file="$HOME/.claude/.orchestrator-mode.$sid"
    [ -f "$mode_file" ] || { write_marker "-"; exit 0; }
    IFS='|' read -r o_mode _ < "$mode_file" 2>/dev/null
    case "$o_mode" in
      strict|standard|light) ;;
      *) write_marker "-"; exit 0 ;;
    esac
    task=$prompt
    ;;
esac

task=${task:0:2000}
title=$(jq -nr --arg t "$task" --arg p '🎛 ' '
  ($t | gsub("\\s+"; " ") | gsub("\\p{Cc}"; "") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) as $c
  | if ($c | length) == 0 then empty
    else
      (if ($c | length) <= 50 then $c
       else
         $c[0:50] as $h
         | (if $c[50:51] == " " or ($h | test(" ") | not) then $h
            else ($h | sub(" [^ ]*$"; "")) end)
         | rtrimstr(" ") + "…"
       end) as $s
      | $p + $s
    end' 2>/dev/null) || exit 0
[ -n "$title" ] || exit 0
out=$(jq -nc --arg t "$title" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",sessionTitle:$t}}' 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0
printf '%s\n' "$out"
write_marker "$title"
exit 0
