#!/usr/bin/env bash
# UserPromptSubmit hook: re-injects the active orchestrator mode into every prompt,
# so the charter keeps applying after compaction drops the /mj-orchestrate text.
# Reads this session's mode file <level>|<epoch>|<scope>; prints nothing when off.
# FAILS OPEN: any missing file, unknown mode or unparseable payload exits 0 silently.
payload=$(cat 2>/dev/null)
case "$payload" in
  *'"session_id":"'*) sid=${payload#*'"session_id":"'}; sid=${sid%%\"*} ;;
  *) sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p') ;;
esac
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$sid" ] && sid="global"
mode_file="$HOME/.claude/.orchestrator-mode.$sid"
[ -f "$mode_file" ] || exit 0
IFS='|' read -r o_mode _ o_scope < "$mode_file" 2>/dev/null
case "$o_mode" in
  strict|standard|light) ;;
  *) exit 0 ;;
esac
[ "$o_scope" = "discover" ] || o_scope="build"
root="${CLAUDE_PLUGIN_ROOT:-}"
printf 'Orchestrator mode is ON: %s · %s. Follow the /mj-orchestrate charter for this turn (delegate by default, dispatch contracts, decision protocol, reporting contract). If the charter text is no longer in context, re-read %s/commands/mj-orchestrate.md before acting.\n' "$o_mode" "$o_scope" "${root:-<plugin root>}"
[ "$o_scope" = "discover" ] && printf 'Scope discover = read-only: no repo edits, commits, branches or publishing.\n'
exit 0
