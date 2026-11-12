---
name: mj-recall
description: Answer a question from your kept sessions — search the local archive written by /mj-keep (personal and work folders, or one of them), cite what was said and when, and optionally restore a session so it can be resumed. With no question, list the kept sessions and let you pick one to continue, summarise or ask about. Runs only when invoked; never automatic.
argument-hint: "[personal|work] [question]"
allowed-tools: Bash, Read, Grep, AskUserQuestion, Agent
---

# Recall from kept sessions

`$ARGUMENTS`

This looks things up in the archive that `/mj-keep` wrote. It reads digests only. **Never read a raw `.jsonl` transcript** — it is huge, and the digest already holds the conversation.

## 1. Resolve the arguments

If the first word is `personal` or `work`, use only that profile; otherwise use both. The rest of the argument is the question. **No question** (empty, or only a profile word): go to step 1a and let the user pick a session instead of searching.

## 1a. Pick a session (no question given)

List the kept sessions, newest first:

```bash
ROOT="${CLAUDE_PLUGIN_ROOT}"
[ -z "$ROOT" ] && ROOT=$(ls -d "$HOME"/.claude/plugins/cache/*/mj-orchestrate/* 2>/dev/null | sort -V | tail -1)
bash "$ROOT/scripts/session-archive.sh" list [--profile <personal|work>]
```

Exit 3: relay the config message and stop. `no kept sessions`: say so, mention `/mj-keep`, and stop. In a headless run, print the list and stop: say to re-run with a question or `continue <short-id>`.

Otherwise ask with **one `AskUserQuestion` call holding two questions**:

1. Header `Session` — "Which kept session?" One option per session, at most 4: the label is the session name (shortened to about 40 characters), the description is `[profile] date · workspace · short-id — summary`. With more than 4 sessions, offer the 4 newest and first show the whole numbered list from the script in the message text, saying that "Other" takes a number, a short id or a name from that list.
2. Header `Action` — "What should I do with it?" Options in this order: `Continue it (Recommended)` (restore it if needed and print the resume commands), `Summarise it` (what was asked, decided and left open), `Ask a question` (the question goes in "Other" or follows next).

Apply the answer. **Continue** → step 4 for that session (the user's pick is the explicit ask to resume). **Summarise** → read the session's digest (the `digest:` path in the list output; `Read` it in windows of about 80 lines, never the `.jsonl`) and answer in the step 3 format. **Ask a question** → take the question, then search and answer as in steps 2 and 3, preferring that session's digest.

## 2. Search

Extract 3 to 8 search terms from the question: the key nouns, plus synonyms and alternative spellings. Sessions may be in Slovak or English — include both, and each Slovak word both with and without diacritics. The search is a literal match that ignores case for plain ASCII letters only: it does **not** fold the case of accented letters (`čas` does not match `ČAS`, `š` does not match `Š`). So for every term with a diacritic, add its capitalised or upper-case accented form as an extra term as well (for example `čas` and `Čas` and `ČAS`).

```bash
ROOT="${CLAUDE_PLUGIN_ROOT}"
[ -z "$ROOT" ] && ROOT=$(ls -d "$HOME"/.claude/plugins/cache/*/mj-orchestrate/* 2>/dev/null | sort -V | tail -1)
bash "$ROOT/scripts/session-archive.sh" search [--profile <personal|work>] -- 'term1' 'term2' 'term3'
```

Write every term in single quotes, exactly as shown (a literal `'` inside a term is written `'\''`), and never in double quotes or bare: the terms come from the user's question, and backticks or `$` in them would otherwise be expanded by the shell.

The output ranks sessions by how many distinct terms hit and shows a few excerpts each, with line numbers into the digest. Run **at most one refinement search** (different or broader terms) if the first found nothing useful. Exit 3 means the archive is not configured: relay the script's message, including the config template, and stop.

## 3. Read and answer

For the best hits, `Read` only the line ranges of the `.md` digest around the excerpts (a window of roughly 40 to 80 lines), never the whole file and never a `.jsonl`. If more than about eight sessions look relevant and each needs deep reading, offer to dispatch `mj-researcher` to read them in parallel instead of reading all of them here; do it only if that is accepted.

Answer the question directly, short first. Tag every claim with its source as `[profile · date · short-id]` and grade it:

- **VERIFIED** — the digest says it in so many words (quote or close paraphrase).
- **INFERRED** — you concluded it from what the digest says.

Close with this caveat in one line: this proves what was said in that session at that time, not that it is still true. If nothing relevant turned up, say so plainly and list the terms tried; do not fill the gap from general knowledge.

## 4. Resume — only on an explicit ask

Only when the user asks to continue, reopen or resume a session, run restore for that session (the profile and id come from the search output; the short id is enough):

```bash
ROOT="${CLAUDE_PLUGIN_ROOT}"
[ -z "$ROOT" ] && ROOT=$(ls -d "$HOME"/.claude/plugins/cache/*/mj-orchestrate/* 2>/dev/null | sort -V | tail -1)
bash "$ROOT/scripts/session-archive.sh" restore --profile <personal|work> --id '<short or full id>'
```

Restore copies the masked transcript back into the Claude projects folder only if that session is not already there, and never overwrites. Relay its output: whether it restored or found it present, and the two printed commands (plain resume, and resume as a fork that leaves the original untouched) for the user to run in a terminal. Mention that a restored session is the masked copy. Never run `claude -r` yourself.
