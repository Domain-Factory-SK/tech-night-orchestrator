---
name: mj-keep
description: Keep this session in a local archive — a token-masked copy of the transcript plus a readable digest, filed under a personal or work profile folder, so it can be searched with /mj-recall and resumed later. Runs only when invoked; never automatic.
argument-hint: "[personal|work] [name]"
allowed-tools: Bash, AskUserQuestion
---

# Keep this session

`$ARGUMENTS`

This archives the **current** session to a folder you configured, in a subfolder named after the workspace (the git repository, or the folder outside git). It is a snapshot: turns after the moment of keeping are not included, and running it again refreshes the same entry. It never writes to the live transcript and never renames the session.

## 1. Resolve the arguments

The first word is the profile and must be exactly `personal` or `work`; the rest of the argument is an optional name for the entry.

- **First word is not `personal` or `work`, or the argument is empty — always ask the profile.** Call `AskUserQuestion` once (header `Profile`, options `personal` and `work`, one-line description each). Never infer the profile from the session's topic or repo, and never default one. If `AskUserQuestion` is unavailable (headless run), stop and say: `/mj-keep needs a profile: run /mj-keep personal [name] or /mj-keep work [name]`. Treat the whole argument as the name when the profile was asked for.
- **Empty name** — pass none; the script falls back to the session's own title, then its first prompt. Do not ask for a name.

## 2. Check the session id

```bash
printf 'session=%s\n' "${CLAUDE_CODE_SESSION_ID:-}"
```

Empty means this runtime does not expose its session id. **Stop** and say so. Never guess "the newest transcript file" — that is how the wrong session gets archived.

## 3. Write the summary

Write one line of at most 300 characters from your own context: what the session was about, what was decided or produced, and what is still open. Plain facts only — no secrets, no tokens, no credentials. This line is stored in the index and the digest and is what `/mj-recall` shows first.

## 4. Keep

The script lives in the plugin. `${CLAUDE_PLUGIN_ROOT}` normally expands in a command body; the second line is the fallback when it is empty (newest installed version).

```bash
ROOT="${CLAUDE_PLUGIN_ROOT}"
[ -z "$ROOT" ] && ROOT=$(ls -d "$HOME"/.claude/plugins/cache/*/mj-orchestrate/* 2>/dev/null | sort -V | tail -1)
TMPD=$(mktemp -d)
cat > "$TMPD/name" <<'MJ_NAME'
<the name, verbatim, or leave this line empty>
MJ_NAME
cat > "$TMPD/summary" <<'MJ_SUMMARY'
<the summary, verbatim>
MJ_SUMMARY
bash "$ROOT/scripts/session-archive.sh" keep --profile <personal|work> --name "$(cat "$TMPD/name")" --summary "$(cat "$TMPD/summary")"
rc=$?; rm -rf "$TMPD"; echo "exit code: $rc"
```

The name and the summary are free text, so they are written to files through **quoted heredocs** (`<<'MJ_NAME'`, `<<'MJ_SUMMARY'`: nothing inside is expanded, and an apostrophe is safe, which it is not inside a heredoc nested in `$(...)` on macOS bash 3.2) and passed back as `"$(cat ...)"`. Never paste them inside double quotes on the command line: backticks, `$(...)` or `$VAR` in the text would be executed or expanded by the shell. An empty name is fine; the script falls back to the session title. If the text itself contains a line equal to a heredoc delimiter, pick a different delimiter.

- **Exit 3** (configuration) — relay the script's message verbatim, including the config template it prints. Do not create the config file or the folders yourself: an unmounted drive must not be shadowed by a fresh local folder.
- **Any other non-zero exit** — relay the error and stop. Do not retry with a different session id.

## 5. Report

Report in a few lines: the profile, the workspace subfolder, the entry name, the full absolute paths of the `.jsonl` and `.md` files, `keeps=N` from the index, the turn counts, and the masking line ("tokens masked in both files"). Pass on any `WARNING:` line (the same session id already kept under the other profile). End with: *snapshot as of now; later turns are not included; run /mj-keep again to refresh.*
