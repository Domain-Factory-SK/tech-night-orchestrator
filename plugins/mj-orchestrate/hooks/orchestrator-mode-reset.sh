#!/usr/bin/env bash
# Resets this session's orchestrator-mode flag to "off" at session start.
# Per-session by design: a single global flag was being clobbered by every
# other window's SessionStart, switching the indicator off mid-session.
# A compaction fires SessionStart with source "compact" inside the same live
# session, so it leaves the flag alone; startup, resume, clear (and a payload
# with no source) still reset it.
payload=$(cat 2>/dev/null)
source=$(printf '%s' "$payload" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ "$source" = "compact" ] && exit 0
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -z "$sid" ] && sid="${CLAUDE_CODE_SESSION_ID:-}"
[ -z "$sid" ] && sid="global"
printf 'off|%s\n' "$(date +%s)" > "$HOME/.claude/.orchestrator-mode.$sid"
find "$HOME/.claude" -maxdepth 1 -name '.orchestrator-mode.*' -mtime +7 -delete 2>/dev/null
exit 0
