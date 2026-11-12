#!/usr/bin/env bash
# PreToolUse backstop for the orchestrator's `discover` (read-only) scope.
# Blocks repo writes while this session's mode file says <level>|<epoch>|discover.
# A backstop, not the control: Bash cannot be fully pattern-matched, so the
# charter text and the `mode: discover` field in every dispatch carry the rule.
# FAILS OPEN: any missing file, unknown scope or unparseable payload exits 0.
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
[ "$o_scope" = "discover" ] || exit 0
[ "$o_mode" = "off" ] && exit 0

block() {
  printf 'discover scope is read-only: %s. Run /mj-orchestrate build to leave it.\n' "$1" >&2
  exit 2
}

tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit)
    path=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -z "$path" ] && path=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -z "$path" ] && exit 0
    case "$path" in
      */../*|*/..) block "$tool on $path (path traversal)" ;;
    esac
    tmpd=${TMPDIR:-/tmp}
    tmpd=${tmpd%/}
    case "$path" in
      "$tmpd"/claude-*|/private/tmp/claude-*|/tmp/claude-*|"$HOME"/.claude/plans/*|"$HOME"/.claude/.orchestrator-mode.*) exit 0 ;;
    esac
    block "$tool on $path is outside the scratchpad"
    ;;
  Bash)
    cmd=$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)/\1/p')
    cmd=${cmd%%\",\"*}
    cmd=${cmd%%\"\}*}
    [ -z "$cmd" ] && exit 0
    case "$cmd" in
      *git*|*gh*|*worktree-for.sh*) ;;
      *) exit 0 ;;
    esac

    lead='(^|\\[nt]|[^[:alnum:]_-])'
    arg='([^[:space:]]+|\\"[^"]*\\"|'"'"'[^'"'"']*'"'"')'
    gitpre="git[[:space:]]+((-C|-c)[[:space:]]+${arg}[[:space:]]+|-P[[:space:]]+|--[a-z-]+(=[^[:space:]]*)?[[:space:]]+)*"
    end='([[:space:]]|$|;|&|\||\\)'
    name='([^-[:space:]|;&<>()`0-9]|[0-9]+[^>0-9])'
    case "$cmd" in *git*) gitcmd=1 ;; *) gitcmd=0 ;; esac
    if [ "$gitcmd" = 1 ] && printf '%s' "$cmd" | grep -Eq "${lead}${gitpre}(commit|push|merge|rebase|reset|cherry-pick)${end}"; then
      block "git history or remote change"
    fi
    if [ "$gitcmd" = 1 ] && printf '%s' "$cmd" | grep -Eq "${lead}${gitpre}(checkout[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-[bB]|switch[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*(-[cC]|--create|--force-create))${end}"; then
      block "branch creation"
    fi
    if [ "$gitcmd" = 1 ] && printf '%s' "$cmd" | grep -Eq "${lead}${gitpre}branch[[:space:]]+(-[dDmMcC]|--delete|--move|--copy|${name})"; then
      block "branch creation or change"
    fi
    if [ "$gitcmd" = 1 ] && printf '%s' "$cmd" | grep -Eq "${lead}${gitpre}tag[[:space:]]+(-[adfsmFu]|--delete|--force|--annotate|--sign|--message|--file|--local-user|${name})"; then
      block "tag change"
    fi
    if [ "$gitcmd" = 1 ] && printf '%s' "$cmd" | grep -Eq "${lead}${gitpre}stash${end}" \
      && ! printf '%s' "$cmd" | grep -Eq "${lead}${gitpre}stash[[:space:]]+(list|show)${end}"; then
      block "stash change"
    fi
    case "$cmd" in *gh*) ghcmd=1 ;; *) ghcmd=0 ;; esac
    if [ "$ghcmd" = 1 ] && printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+((-R|--repo)[[:space:]=]+[^[:space:]]+[[:space:]]+)?(create|merge|edit|close|comment|review)([[:space:]]|$|;|&|\||\\)'; then
      block "gh pr write"
    fi
    if [ "$ghcmd" = 1 ] && printf '%s' "$cmd" | grep -Eiq 'gh[[:space:]]+api[[:space:]].*(-X|--method)[[:space:]=]*[^[:alnum:]]*(POST|PATCH|PUT|DELETE)'; then
      block "gh api write"
    fi
    rem=$cmd
    while :; do
      case "$rem" in *worktree-for.sh*) ;; *) break ;; esac
      rest=${rem#*worktree-for.sh}
      rem=$rest
      rest=${rest%%\\n*}
      rest=${rest%%[;\&|]*}
      n=0
      set -f
      for w in $rest; do
        case "$w" in
          [0-9]*'>'*|'>'*|'&>'*|'<'*) continue ;;
        esac
        n=$((n + 1))
      done
      set +f
      [ "$n" -ge 4 ] && block "worktree-for.sh with a branch argument creates a branch; use a detached worktree (3 args)"
    done
    exit 0
    ;;
esac
exit 0
