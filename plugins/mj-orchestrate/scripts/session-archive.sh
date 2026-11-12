#!/usr/bin/env bash
# session-archive.sh - archive, search and restore Claude Code sessions.
#
#   keep    --profile personal|work [--name N] [--summary S] [--session-id ID]
#   search  [--profile personal|work] -- term [term ...]
#   list    [--profile personal|work] [--limit N]
#   restore --profile personal|work --id ID
#
# Each profile maps to one local folder named in a config file (never committed):
#   keep.personal=<absolute path>
#   keep.work=<absolute path>
# Kept files go into a subfolder per workspace (the git repository name, or the
# cwd's folder name outside git); index.jsonl stays at the profile root and
# stores file paths relative to it (<workspace>/<file>).
# Env overrides (for tests): MJ_KEEP_CONFIG, MJ_PROJECTS_DIR.
#
# Exit codes: 0 ok, 1 error, 2 usage, 3 configuration problem.
# Portable to macOS (BSD tools, bash 3.2) and GNU/Linux: no grep -P, no sed -i.
set -u
umask 077

CONFIG="${MJ_KEEP_CONFIG:-$HOME/.claude/mj-orchestrate/config}"
PROJECTS="${MJ_PROJECTS_DIR:-$HOME/.claude/projects}"

TMP_LIST=""
LOCK_HELD=""
CFG_DIR=""
CFG_ERR=""

cleanup() {
  local f
  while IFS= read -r f; do
    [ -n "$f" ] && rm -f -- "$f"
  done <<EOT
$TMP_LIST
EOT
  [ -n "$LOCK_HELD" ] && rmdir "$LOCK_HELD" 2>/dev/null
  return 0
}
trap cleanup EXIT

die() { # die CODE MESSAGE
  local code="$1"; shift
  printf 'session-archive: %s\n' "$*" >&2
  exit "$code"
}

note_tmp() { TMP_LIST="$TMP_LIST
$1"; }

config_template() {
  cat <<'EOF'
Create the config file with these two lines (absolute paths of existing folders):

  # mj-orchestrate local config - never committed
  keep.personal=<absolute path to personal kept-sessions folder>
  keep.work=<absolute path to work kept-sessions folder>
EOF
}

config_fail() {
  printf 'session-archive: %s\n\n' "$1" >&2
  config_template >&2
  exit 3
}

# cfg_resolve PROFILE -> sets CFG_DIR, or returns 1 and sets CFG_ERR.
# Never call it inside $(...): the globals would be lost in the subshell.
cfg_resolve() {
  local p="$1" val
  CFG_ERR=""; CFG_DIR=""
  if [ ! -f "$CONFIG" ]; then
    CFG_ERR="config file not found: $CONFIG"; return 1
  fi
  val=$(sed -n "s/^keep\\.$p=//p" "$CONFIG" | tr -d '\r' | tail -1)
  val=${val#"${val%%[![:space:]]*}"}
  val=${val%"${val##*[![:space:]]}"}
  case "$val" in
    "") CFG_ERR="key keep.$p is missing or empty in $CONFIG"; return 1 ;;
    "<"*) CFG_ERR="key keep.$p in $CONFIG is still the placeholder"; return 1 ;;
    "~") val=$HOME ;;
    "~/"*) val="$HOME/${val#\~/}" ;;
  esac
  if [ ! -d "$val" ]; then
    CFG_ERR="folder for keep.$p does not exist (not created on purpose, it may be an unmounted drive): $val"; return 1
  fi
  CFG_DIR="$val"
}

need_dir() { # need_dir PROFILE -> sets CFG_DIR or exits 3
  cfg_resolve "$1" || config_fail "$CFG_ERR"
  [ -n "$CFG_DIR" ] && [ -d "$CFG_DIR" ] || config_fail "folder for keep.$1 could not be resolved"
}

check_profile() {
  case "${1:-}" in
    personal|work) ;;
    *) die 2 "--profile must be personal or work" ;;
  esac
}

shquote() { # single-quote a string for the shell
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# ---------------------------------------------------------------- jq programs

read -r -d '' JQ_DEFS <<'EOF'
def SECW: "password|passwd|secret|token|api[_-]?key|access[_-]?key|functions[_-]?key|account[_-]?key|connection[_-]?string";
def SECK: "[A-Za-z0-9_-]{0,40}(?:" + SECW + ")[A-Za-z0-9_-]{0,40}";
def red:
  gsub("-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----";"[REDACTED]")
  | gsub("sk-ant-[A-Za-z0-9_-]{8,}";"[REDACTED]")
  | gsub("sk-[A-Za-z0-9_-]{20,}";"[REDACTED]")
  | gsub("gh[pousr]_[A-Za-z0-9]{20,}";"[REDACTED]")
  | gsub("github_pat_[A-Za-z0-9_]{20,}";"[REDACTED]")
  | gsub("xox[abpr]-[A-Za-z0-9-]{10,}";"[REDACTED]")
  | gsub("AKIA[0-9A-Z]{16}";"[REDACTED]")
  | gsub("eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]*";"[REDACTED]")
  | gsub("bearer\\s+[A-Za-z0-9._~+/=-]{8,}";"Bearer [REDACTED]";"i")
  | gsub("(?<k>" + SECK + ")(?<s>[\"']?\\s*[=:]\\s*[\"']?)[^\\s\"']+";"\(.k)\(.s)[REDACTED]";"i");
def rw($f):
  if type=="string" then (if $f and length > 0 then "[REDACTED]" else red end)
  elif type=="array" then map(rw($f))
  elif type=="object" then with_entries(.key as $k | if $k=="signature" then . else .value |= rw($f or ($k | test(SECW;"i"))) end)
  else . end;
def rw: rw(false);
def cmd:
  if test("^\\s*(?:<command-message>[^<]*</command-message>\\s*)?<command-name>") then
    . as $t
    | ([$t | capture("<command-name>(?<n>[^<]*)</command-name>")] | first) as $c
    | if $c == null then $t
      else $c.n + (([$t | capture("<command-args>(?<a>[^<]*)</command-args>")] | first | .a // "") | if . == "" then "" else " " + . end)
      end
  else . end;
def strip:
  gsub("<system-reminder>[\\s\\S]*?</system-reminder>";"")
  | gsub("<local-command-[a-z]+>[\\s\\S]*?</local-command-[a-z]+>";"");
def clean: strip | gsub("^\\s+|\\s+$";"");
def oneline: gsub("\\s+";" ");
def sts: ((. // "") | .[0:16] | sub("T";" "));
def trunc: if length > 4000 then .[0:4000] + "\n[... truncated " + ((length - 4000) | tostring) + " chars]" else . end;
def events:
  .[] |
  if (.type == "user") and (.isMeta != true) and (.isSidechain != true)
     and (((.origin.kind // "human") as $k | ($k != "task-notification" and $k != "peer"))) then
    (.message.content) as $c
    | (if ($c | type) == "string" then $c
       elif ([$c[]? | .type] | index("tool_result")) != null then empty
       else ([$c[]? | if .type == "text" then .text elif .type == "image" then "[image]" else empty end] | join("\n")) end) as $raw
    | ($raw | cmd | clean) as $t
    | select(($t | length) > 0)
    | {r: "U", ts: .timestamp, id: null, t: $t}
  elif (.type == "assistant") and (.isSidechain != true) then
    ([.message.content[]? | select(.type == "text") | .text] | join("\n")) as $raw
    | ($raw | clean) as $t
    | select(($t | length) > 0)
    | {r: "A", ts: .timestamp, id: .message.id, t: $t}
  else empty end;
def turns:
  reduce events as $e ([];
    if ($e.r == "A") and (length > 0) and (.[-1].r == "A") and (.[-1].id == $e.id)
    then .[-1].t += "\n\n" + $e.t
    else . + [$e] end);
EOF

read -r -d '' JQ_META <<'EOF'
def encdir: gsub("[^A-Za-z0-9]";"-");
. as $all
| [$all[] | select(.cwd != null) | .cwd] as $cwds
| turns as $tn
| {
    started: ([$all[] | .timestamp // empty] | first // ""),
    last_activity: ([$all[] | .timestamp // empty] | last // ""),
    cwd: (($cwds | map(select(encdir == $pd)) | first)
          // ([$all[] | select(.type == "relocated") | .relocatedCwd // empty] | last)
          // ($cwds | first) // ""),
    git_branches: ([$all[] | .gitBranch // empty | select(length > 0)] | unique),
    custom_title: ([$all[] | select(.type == "custom-title") | .customTitle // empty] | last // ""),
    ai_title: ([$all[] | select(.type == "ai-title") | .aiTitle // empty] | last // ""),
    first_prompt: ([$tn[] | select(.r == "U") | .t | oneline] | first // ""),
    human_turns: ([$tn[] | select(.r == "U")] | length),
    ai_turns: ([$tn[] | select(.r == "A")] | length)
  }
EOF

read -r -d '' JQ_DIGEST <<'EOF'
$meta[0] as $m
| ("kept_at: " + $kept_at),
  ("name: " + ($name | oneline | red)),
  ("session_id: " + $sid),
  ("profile: " + $profile),
  ("cwd: " + ($m.cwd | oneline | red)),
  ("project_dir: " + $pd),
  ("git_branches: " + ($m.git_branches | join(", ") | red)),
  ("started: " + $m.started),
  ("last_activity: " + $m.last_activity),
  ("human_turns: " + ($m.human_turns | tostring)),
  ("ai_title: " + ($m.ai_title | oneline | red)),
  ("summary: " + ($summary | oneline | red)),
  "snapshot: copy as of kept_at",
  "",
  "---",
  "",
  (turns[] | "### " + .r + " " + (.ts | sts) + "\n" + (.t | red | trunc) + "\n")
EOF

# ---------------------------------------------------------------------- keep

slugify() {
  local s
  s=$(printf '%s' "$1" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C sed -e 's/[^a-z0-9]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-40)
  s=$(printf '%s' "$s" | LC_ALL=C sed -e 's/-$//')
  [ -z "$s" ] && s=session
  printf '%s' "$s"
}

lock_acquire() {
  local n=0
  while ! mkdir "$1" 2>/dev/null; do
    n=$((n + 1))
    [ "$n" -gt 100 ] && die 1 "could not take the index lock $1 (stale? remove that empty folder if no keep is running)"
    sleep 0.1
  done
  LOCK_HELD="$1"
}

lock_release() {
  [ -n "$LOCK_HELD" ] && rmdir "$LOCK_HELD" 2>/dev/null
  LOCK_HELD=""
}

workspace_of() { # workspace_of CWD -> slug of the git repository name, else of the folder name
  local c="$1" common top=""
  if [ -n "$c" ] && [ -d "$c" ]; then
    common=$(git -C "$c" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
    case "$common" in
      */.git) top=$(dirname -- "$common") ;;
      ?*) top="$common" ;;
    esac
  fi
  [ -z "$top" ] && top="$c"
  top=${top%/}
  slugify "$(basename -- "${top:-unknown}")"
}

safe_relpath() { # safe_relpath NAME -> 0 when NAME is FILE or WORKSPACE/FILE with no dot-leading part
  case "$1" in ""|.*|*/.*|*/*/*|*/) return 1 ;; esac
  return 0
}

safe_delete_old() { # safe_delete_old DIR NAME EXT
  local d="$1" n="$2" ext="$3"
  [ -z "$n" ] && return 0
  safe_relpath "$n" || return 0
  case "$n" in *."$ext") rm -f -- "$d/$n" ;; esac
}

cmd_keep() {
  local profile="" name="" summary="" sid="${CLAUDE_CODE_SESSION_ID:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) [ $# -ge 2 ] || die 2 "$1 needs a value"; profile="$2"; shift 2 ;;
      --name) [ $# -ge 2 ] || die 2 "$1 needs a value"; name="$2"; shift 2 ;;
      --summary) [ $# -ge 2 ] || die 2 "$1 needs a value"; summary="$2"; shift 2 ;;
      --session-id) [ $# -ge 2 ] || die 2 "$1 needs a value"; sid="$2"; shift 2 ;;
      *) die 2 "keep: unknown argument: $1" ;;
    esac
  done
  check_profile "$profile"
  [ -z "$sid" ] && die 2 "keep: no session id (CLAUDE_CODE_SESSION_ID is empty); refusing to guess the newest transcript"
  case "$sid" in *[!A-Za-z0-9-]*) die 2 "keep: session id has unexpected characters" ;; esac

  local dir
  need_dir "$profile"; dir="$CFG_DIR"

  local found src count
  found=$(find "$PROJECTS" -mindepth 2 -maxdepth 2 -name "$sid.jsonl" 2>/dev/null)
  [ -z "$found" ] && die 1 "keep: no transcript $sid.jsonl found under $PROJECTS"
  count=$(printf '%s\n' "$found" | grep -c .)
  src=$(printf '%s\n' "$found" | head -1)
  if [ "$count" -gt 1 ]; then
    local c
    src=""
    while IFS= read -r c; do
      if [ -z "$src" ] || [ "$c" -nt "$src" ]; then src="$c"; fi
    done <<EOF2
$found
EOF2
    printf 'WARNING: %s copies of this session exist; using %s\n' "$count" "$src"
  fi
  local pd
  pd=$(basename "$(dirname "$src")")

  jq -n --arg id "$sid" 'any(inputs; .sessionId == $id)' "$src" 2>/dev/null | grep -q true \
    || die 1 "keep: $src does not contain sessionId $sid"

  local tmpd="$dir/.keep.$$"
  local meta="$tmpd.meta" tmp_md="$tmpd.md.tmp" tmp_jl="$tmpd.jsonl.tmp"
  note_tmp "$meta"; note_tmp "$tmp_md"; note_tmp "$tmp_jl"

  jq -s -c --arg pd "$pd" "$JQ_DEFS $JQ_META" "$src" > "$meta" 2>/dev/null \
    || die 1 "keep: could not read transcript metadata"

  local started cwd branch
  started=$(jq -r '.started' "$meta")
  cwd=$(jq -r '.cwd' "$meta")
  branch=$(jq -r '.git_branches | last // ""' "$meta")

  if [ -z "$name" ]; then
    name=$(jq -r '(.custom_title | select(length > 0)) // (.ai_title | select(length > 0)) // (.first_prompt[0:60]) // ""' "$meta")
  fi
  [ -z "$name" ] && name=session
  local kept_at base date_part
  kept_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  date_part=${started:0:10}
  [ -z "$date_part" ] && date_part=$(date -u +%F)
  base="${date_part}_$(slugify "$name")_${sid:0:8}"
  local ws rel
  ws=$(workspace_of "$cwd")
  rel="$ws/$base"
  mkdir -p -- "$dir/$ws" || die 1 "keep: could not create $dir/$ws"

  # digest
  jq -s -r --slurpfile meta "$meta" --arg pd "$pd" --arg sid "$sid" --arg profile "$profile" \
    --arg name "$name" --arg summary "$summary" --arg kept_at "$kept_at" \
    "$JQ_DEFS $JQ_DIGEST" "$src" > "$tmp_md" 2>/dev/null \
    || die 1 "keep: digest generation failed"

  # redacted jsonl copy, validated line by line
  jq -c "$JQ_DEFS rw" "$src" > "$tmp_jl" 2>/dev/null \
    || die 1 "keep: redacted copy generation failed"
  jq -c . "$tmp_jl" > /dev/null 2>&1 || die 1 "keep: redacted copy has an invalid line, nothing written"
  local n_src n_dst
  n_src=$(jq -c . "$src" 2>/dev/null | wc -l | tr -d ' ')
  n_dst=$(wc -l < "$tmp_jl" | tr -d ' ')
  [ "$n_src" = "$n_dst" ] || die 1 "keep: redacted copy has $n_dst lines, source has $n_src, nothing written"

  local masked
  masked=$(cat "$tmp_jl" "$tmp_md" | grep -o '\[REDACTED\]' | wc -l | tr -d ' ')

  mv -f -- "$tmp_md" "$dir/$rel.md" || die 1 "keep: could not write $dir/$rel.md"
  mv -f -- "$tmp_jl" "$dir/$rel.jsonl" || die 1 "keep: could not write $dir/$rel.jsonl"

  # index upsert under lock
  local idx="$dir/index.jsonl" tmp_idx="$tmpd.idx.tmp" old="" keeps=1 first_kept="$kept_at" old_jl="" old_md=""
  note_tmp "$tmp_idx"
  lock_acquire "$dir/.index.lock"
  if [ -f "$idx" ]; then
    jq -c . "$idx" > /dev/null 2>&1 || { lock_release; die 1 "keep: $idx is not valid JSONL, left untouched (the new files are written, index not updated)"; }
    old=$(jq -c --arg id "$sid" 'select(.session_id == $id)' "$idx" | tail -1)
  fi
  if [ -n "$old" ]; then
    keeps=$(printf '%s' "$old" | jq -r '(.keeps // 1) + 1')
    first_kept=$(printf '%s' "$old" | jq -r --arg k "$kept_at" '.first_kept // $k')
    old_jl=$(printf '%s' "$old" | jq -r '.files.jsonl // ""')
    old_md=$(printf '%s' "$old" | jq -r '.files.md // ""')
  fi
  local rec
  rec=$(jq -nc --arg sid "$sid" --arg profile "$profile" --arg name "$name" --arg summary "$summary" \
    --arg kept_at "$kept_at" --arg first_kept "$first_kept" --argjson keeps "$keeps" \
    --arg started "$started" --arg cwd "$cwd" --arg pd "$pd" --arg branch "$branch" \
    --arg fj "$rel.jsonl" --arg fm "$rel.md" --arg ws "$ws" \
    '{session_id: $sid, short_id: $sid[0:8], profile: $profile, workspace: $ws, name: ($name | gsub("\\s+";" ")), summary: ($summary | gsub("\\s+";" ")),
      kept_at: $kept_at, first_kept: $first_kept, keeps: $keeps, started: $started, cwd: $cwd, project_dir: $pd,
      git_branch: $branch, files: {jsonl: $fj, md: $fm}}' | jq -c "$JQ_DEFS (.name |= red) | (.summary |= red)")
  [ -z "$rec" ] && { lock_release; die 1 "keep: could not build the index record"; }
  {
    if [ -f "$idx" ]; then jq -c --arg id "$sid" 'select(.session_id != $id)' "$idx"; fi
    printf '%s\n' "$rec"
  } > "$tmp_idx" && mv -f -- "$tmp_idx" "$idx"
  local rc=$?
  lock_release
  [ "$rc" -ne 0 ] && die 1 "keep: could not update $idx"

  if [ -n "$old_jl" ] && [ "$old_jl" != "$rel.jsonl" ]; then safe_delete_old "$dir" "$old_jl" jsonl; fi
  if [ -n "$old_md" ] && [ "$old_md" != "$rel.md" ]; then safe_delete_old "$dir" "$old_md" md; fi
  case "$old_jl" in */*) rmdir -- "$dir/${old_jl%%/*}" 2>/dev/null ;; esac

  local other od
  if [ "$profile" = personal ]; then other=work; else other=personal; fi
  od=""
  cfg_resolve "$other" && od="$CFG_DIR"
  [ -n "$od" ] && [ -f "$od/index.jsonl" ] \
    && jq -e --arg id "$sid" 'select(.session_id == $id)' "$od/index.jsonl" > /dev/null 2>&1 \
    && printf 'WARNING: this session id is also kept in the %s profile (%s). Allowed, but check it was not meant to go there.\n' "$other" "$od"

  printf 'kept: %s\n' "$profile"
  printf 'session: %s (%s)\n' "$sid" "$name"
  printf 'workspace: %s\n' "$ws"
  printf 'jsonl: %s\n' "$dir/$rel.jsonl"
  printf 'digest: %s\n' "$dir/$rel.md"
  printf 'index: %s (keeps=%s)\n' "$idx" "$keeps"
  printf 'turns: %s human, %s assistant\n' "$(jq -r '.human_turns' "$meta")" "$(jq -r '.ai_turns' "$meta")"
  printf 'tokens masked in both files: %s markers\n' "$masked"
  printf 'snapshot as of %s; later turns are not included; re-run to refresh\n' "$kept_at"
}

# -------------------------------------------------------------------- search

cmd_search() {
  local profile="" terms="" t
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) [ $# -ge 2 ] || die 2 "$1 needs a value"; profile="$2"; shift 2 ;;
      --) shift; break ;;
      *) break ;;
    esac
  done
  [ -n "$profile" ] && check_profile "$profile"
  [ $# -eq 0 ] && die 2 "search: no search terms"

  local profiles
  if [ -n "$profile" ]; then profiles="$profile"; else profiles="personal work"; fi

  local out
  out=$(mktemp "${TMPDIR:-/tmp}/mj-search.XXXXXX") || die 1 "search: mktemp failed"
  note_tmp "$out"
  local scores
  scores=$(mktemp "${TMPDIR:-/tmp}/mj-search-s.XXXXXX") || die 1 "search: mktemp failed"
  note_tmp "$scores"

  local p dir f s hits nterms searched=0 skipped=""
  for p in $profiles; do
    if ! cfg_resolve "$p"; then
      if [ -n "$profile" ]; then config_fail "$CFG_ERR"; fi
      skipped="$skipped $p"
      continue
    fi
    dir="$CFG_DIR"
    searched=$((searched + 1))
    for f in "$dir"/*.md "$dir"/*/*.md; do
      [ -f "$f" ] || continue
      s=0; hits=0
      for t in "$@"; do
        [ -z "$t" ] && continue
        if grep -q -i -F -e "$t" -- "$f" 2>/dev/null; then
          s=$((s + 1))
          hits=$((hits + $(grep -c -i -F -e "$t" -- "$f" 2>/dev/null)))
        fi
      done
      [ "$s" -gt 0 ] && printf '%s\t%s\t%s\t%s\n' "$s" "$hits" "$p" "$f" >> "$scores"
    done
  done
  if [ "$searched" -eq 0 ]; then config_fail "no profile folder is configured"; fi

  local g_args=()
  for t in "$@"; do [ -n "$t" ] && g_args+=(-e "$t"); done
  [ "${#g_args[@]}" -eq 0 ] && die 2 "search: all search terms are empty"

  local total
  total=$(grep -c . "$scores")
  {
    printf 'terms: %s\n' "$*"
    [ "$total" -eq 0 ] && printf 'no matches in the kept-sessions digests\n'
    [ -n "$skipped" ] && printf 'not searched (not configured):%s\n' "$skipped"
    printf 'sessions with a hit: %s (showing up to 8)\n\n' "$total"
  } > "$out"

  local score hit prof file name started shortid summ
  sort -t "$(printf '\t')" -k1,1nr -k2,2nr "$scores" | head -8 | while IFS="$(printf '\t')" read -r score hit prof file; do
    name=$(head -20 "$file" | sed -n 's/^name: //p' | head -1)
    started=$(head -20 "$file" | sed -n 's/^started: //p' | head -1)
    shortid=$(head -20 "$file" | sed -n 's/^session_id: //p' | head -1)
    summ=$(head -20 "$file" | sed -n 's/^summary: //p' | head -1)
    printf '[%s] %s | %s | %s | terms %s/%s, %s hits\n' "$prof" "${started:0:10}" "$name" "${shortid:0:8}" "$score" "$#" "$hit"
    printf '  digest: %s\n' "$file"
    [ -n "$summ" ] && printf '  summary: %s\n' "$(printf '%s' "$summ" | cut -c1-300)"
    grep -n -i -F -m6 -C1 "${g_args[@]}" -- "$file" 2>/dev/null | cut -c1-300 | sed 's/^/    /'
    printf '\n'
  done >> "$out"

  local size
  size=$(wc -c < "$out" | tr -d ' ')
  head -c 12000 "$out"
  if [ "$size" -gt 12000 ]; then printf '\n[output truncated at 12000 bytes; refine the terms]\n'; fi
  return 0
}

# ---------------------------------------------------------------------- list

cmd_list() {
  local profile="" limit=20
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) [ $# -ge 2 ] || die 2 "$1 needs a value"; profile="$2"; shift 2 ;;
      --limit) [ $# -ge 2 ] || die 2 "$1 needs a value"; limit="$2"; shift 2 ;;
      *) die 2 "list: unknown argument: $1" ;;
    esac
  done
  [ -n "$profile" ] && check_profile "$profile"
  case "$limit" in ""|*[!0-9]*) die 2 "list: --limit must be a number" ;; esac

  local profiles p searched=0 skipped="" recs=""
  if [ -n "$profile" ]; then profiles="$profile"; else profiles="personal work"; fi
  for p in $profiles; do
    if ! cfg_resolve "$p"; then
      if [ -n "$profile" ]; then config_fail "$CFG_ERR"; fi
      skipped="$skipped $p"
      continue
    fi
    searched=$((searched + 1))
    [ -f "$CFG_DIR/index.jsonl" ] || continue
    recs="$recs
$(jq -c --arg p "$p" --arg d "$CFG_DIR" 'select(type == "object" and .session_id != null) | .profile = $p | .dir = $d' "$CFG_DIR/index.jsonl" 2>/dev/null)"
  done
  if [ "$searched" -eq 0 ]; then config_fail "no profile folder is configured"; fi

  local total
  total=$(printf '%s\n' "$recs" | grep -c .)
  [ -n "$skipped" ] && printf 'not listed (not configured):%s\n' "$skipped"
  if [ "$total" -eq 0 ]; then printf 'no kept sessions\n'; return 0; fi
  printf 'kept sessions: %s (newest first, showing up to %s)\n' "$total" "$limit"
  printf '%s\n' "$recs" | grep . | jq -s -r --argjson n "$limit" '
    sort_by(.kept_at // "") | reverse | .[0:$n] | to_entries[]
    | "\(.key + 1). [\(.value.profile)] \((.value.kept_at // "")[0:10]) | \(.value.workspace // "-") | \(.value.name // "session") | \(.value.short_id // .value.session_id[0:8])"
      + (if (.value.summary // "") != "" then "\n   summary: " + (.value.summary | .[0:200]) else "" end)
      + (if (.value.files.md // "") != "" then "\n   digest: " + .value.dir + "/" + .value.files.md else "" end)'
}

# ------------------------------------------------------------------- restore

cmd_restore() {
  local profile="" id=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) [ $# -ge 2 ] || die 2 "$1 needs a value"; profile="$2"; shift 2 ;;
      --id) [ $# -ge 2 ] || die 2 "$1 needs a value"; id="$2"; shift 2 ;;
      *) die 2 "restore: unknown argument: $1" ;;
    esac
  done
  check_profile "$profile"
  [ -z "$id" ] && die 2 "restore: --id is required"
  local dir
  need_dir "$profile"; dir="$CFG_DIR"
  local idx="$dir/index.jsonl"
  [ -f "$idx" ] || die 1 "restore: no index.jsonl in $dir"

  local recs nrec
  recs=$(jq -c --arg id "$id" 'select(.session_id == $id or .short_id == $id)' "$idx")
  nrec=$(printf '%s' "$recs" | grep -c .)
  [ "$nrec" -eq 0 ] && die 1 "restore: no kept session matches '$id' in the $profile profile"
  [ "$nrec" -gt 1 ] && die 1 "restore: '$id' is ambiguous ($nrec matches); use the full session id"

  local sid pd cwd fj
  sid=$(printf '%s' "$recs" | jq -r '.session_id')
  pd=$(printf '%s' "$recs" | jq -r '.project_dir')
  cwd=$(printf '%s' "$recs" | jq -r '.cwd')
  fj=$(printf '%s' "$recs" | jq -r '.files.jsonl')
  case "$sid" in ""|*[!A-Za-z0-9-]*) die 1 "restore: index record has an unusable session id" ;; esac
  case "$pd" in ""|.|..|*/*) die 1 "restore: index record has an unusable project_dir" ;; esac
  safe_relpath "$fj" || die 1 "restore: index record has an unusable file name"
  local srcf="$dir/$fj" target="$PROJECTS/$pd/$sid.jsonl"
  [ -f "$srcf" ] || die 1 "restore: kept transcript missing: $srcf"

  local existing
  existing=$(find "$PROJECTS" -mindepth 2 -maxdepth 2 -name "$sid.jsonl" 2>/dev/null | head -1)
  if [ -n "$existing" ]; then
    printf 'present, not touched: %s\n' "$existing"
  else
    ( umask 022; mkdir -p -- "$PROJECTS/$pd" ) || die 1 "restore: cannot create $PROJECTS/$pd"
    local tmp="$PROJECTS/$pd/.restore.$$.tmp"
    note_tmp "$tmp"
    cp -- "$srcf" "$tmp" || die 1 "restore: copy failed"
    cmp -s -- "$srcf" "$tmp" || die 1 "restore: copy verification failed, nothing restored"
    mv -n -- "$tmp" "$target"
    if [ -e "$tmp" ]; then die 1 "restore: target appeared meanwhile, not touched: $target"; fi
    cmp -s -- "$srcf" "$target" || die 1 "restore: verification failed for $target"
    printf 'restored: %s\n' "$target"
    printf 'note: the restored transcript is the masked copy (tokens replaced by [REDACTED]).\n'
  fi

  if [ -n "$cwd" ] && [ ! -d "$cwd" ]; then
    printf 'WARNING: the original working directory no longer exists: %s\n' "$cwd"
  fi
  local qcwd
  qcwd=$(shquote "$cwd")
  printf 'resume (continues the session itself):\n  cd %s && claude -r %s\n' "$qcwd" "$sid"
  printf 'resume as a fork (original stays unchanged):\n  cd %s && claude -r %s --fork-session\n' "$qcwd" "$sid"
  printf 'note: claude -r finds the session by id from any directory; the cd only restores the working directory.\n'
}

# ---------------------------------------------------------------------- main

usage() {
  cat <<'EOF'
usage:
  session-archive.sh keep    --profile personal|work [--name N] [--summary S] [--session-id ID]
  session-archive.sh search  [--profile personal|work] -- term [term ...]
  session-archive.sh list    [--profile personal|work] [--limit N]
  session-archive.sh restore --profile personal|work --id ID
EOF
}

command -v jq > /dev/null 2>&1 || die 1 "jq is required"

sub="${1:-}"
[ $# -gt 0 ] && shift
case "$sub" in
  keep) cmd_keep "$@" ;;
  search) cmd_search "$@" ;;
  list) cmd_list "$@" ;;
  restore) cmd_restore "$@" ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
