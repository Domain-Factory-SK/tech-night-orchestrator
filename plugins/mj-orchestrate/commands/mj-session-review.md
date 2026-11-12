---
name: mj-session-review
description: Review this session — report what was actually done, then propose concrete additions, edits and deletions to the project memory store. Proposes only; writes nothing until approved.
argument-hint: "[nothing | memory-only | report-only | <path to another session's transcript>]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Session review

`$ARGUMENTS`

Resolve the argument: empty runs the whole flow; `report-only` stops after step 3; `memory-only` skips the narrative report and goes straight to candidates; a path runs against that transcript instead of this session.

**Nothing is written to any memory store, CLAUDE.md or repository file until the user approves the specific diff.** This command proposes. That is its whole contract — memory is durable, silently reused for months, and a wrong memory is more expensive than a missing one.

## 1. Establish the facts

Do not reconstruct the session from impression. Derive it, batched into one Bash call:

```bash
# this repo's memory store (path encoding: every '/' and '.' in the cwd becomes '-')
CWD=$(pwd); SLUG=$(printf '%s' "$CWD" | sed -e 's/\./-/g' -e 's/\//-/g')
STORE="$HOME/.claude/projects/$SLUG/memory"
ls -la "$STORE" 2>/dev/null || echo "NO STORE YET: $STORE"
git -C "$CWD" log --oneline -15 2>/dev/null
git -C "$CWD" status --short 2>/dev/null
git -C "$CWD" branch --show-current 2>/dev/null
```

For a transcript run, the session files live at `~/.claude/projects/<slug>/*.jsonl`; each user turn carries `cwd`, `gitBranch`, `sessionId` and `timestamp`, so "what was done, where, when" is extractable rather than guessed.

State plainly anything you could not establish. An unverifiable claim in a session report becomes a false memory tomorrow.

## 2. Report what was done

Lead with outcomes, in plain language:

- **Done** — what actually changed, with absolute paths and, where relevant, the commit or branch.
- **Decided** — decisions the user made this session and the reasoning, especially where an earlier assumption was overturned.
- **Failed or abandoned** — what was tried and did not work. This is the most valuable section and the one most often dropped.
- **Unfinished** — what is open, and what the next session needs in order to pick it up.

Failures and skips are stated as plainly as successes. "Not attempted" and "attempted and it worked" must never read the same.

## 3. Find the memory candidates

A candidate is a fact that is **durable**, **non-obvious**, and **not already recorded somewhere the next session will read anyway**.

**Do not propose** — these are the common false positives:

- Anything the repository already records: code structure, a fix that is now in `git log`, a convention already in `CLAUDE.md`.
- Anything that only mattered inside this conversation: which file you opened first, an intermediate error you then fixed.
- A restatement of a rule that already exists. If it is already in `~/.claude/CLAUDE.md` or the repo's `CLAUDE.md`, it is not a memory candidate — it is at most an argument for editing that file.
- Anything you could not verify in step 1.

**Do propose**, classified by `type`:

| `type` | What belongs there |
|---|---|
| `feedback` | A correction or confirmed way of working the user gave you — with the incident that caused it |
| `project` | Ongoing work, goals or constraints not derivable from the code or git history |
| `reference` | A pointer to something external: a dashboard, a ticket, a doc, a URL |
| `user` | Something about how the user works, their role, their preferences |

## 4. Check the candidates against what is already stored

Before proposing anything, read the existing store — `MEMORY.md` plus any file whose index line looks close. For each candidate say which it is:

- **New** — nothing covers it.
- **Update** — an existing file covers it but is now incomplete or out of date. Propose an edit to that file, never a second file on the same topic.
- **Contradiction** — an existing memory says the opposite of what this session established. Surface both, say which the evidence supports, and propose deleting or correcting the loser. Never let two memories disagree silently.
- **Stale** — an existing memory refers to a file, flag, command or process that no longer exists. Verify before claiming this: a memory that names something is checked against reality, not against your recollection.

## 5. Route what does not belong in memory

- A rule about **how to work in this repo** that the whole team needs → the repo's `CLAUDE.md`, via `/revise-claude-md`. Don't duplicate that command's job.
- A rule that applies **everywhere** → `~/.claude/CLAUDE.md`, proposed as an exact diff.
- **Per-ticket status** → not memory at all. Memory holds durable knowledge; ticket state goes stale and pollutes recall.

Say which route each item took, including the ones you dropped and why.

## 6. Propose the diff

Present every proposed change in full — the user approves specific text, not an intention. For each new memory file, show the complete content in the store's real format:

```markdown
---
name: <type>_<short_snake_case_name>
description: <one line, what this fact is — this drives recall matching>
metadata:
  node_type: memory
  type: feedback | project | reference | user
  originSessionId: <this session's id>
  modified: <ISO 8601 timestamp>
---

**<The fact, stated as a bold claim in one or two sentences.>**

**Why:** <the dated incident or evidence that produced it — a memory with no why gets ignored the first time it is inconvenient>

**How to apply:** <what a future session should actually do differently> Related: [[other_memory_name]]
```

Plus the one-line `MEMORY.md` index entry for each: `- [Title](file.md) — hook`. Keep the hook under roughly 140 characters: index lines are recall hooks, not summaries, so entity names and ticket keys stay and the narrative lives in the file body.

Then stop and ask. Offer the list as numbered items so the user can accept a subset.

## 7. On approval, write and verify

Write only what was approved. Then verify it landed — re-read each file and confirm the `MEMORY.md` index has exactly one line per file, no duplicates and no orphans. Report the absolute path of every file written.

If the store did not exist, create it and say so: a new store is a change to how this repo will be remembered, not a detail.

## What this command must never do

- Write a memory the user did not approve, including "obvious" ones.
- Invent a `Why:` — if you cannot name the incident or the evidence, the candidate is not ready and is dropped rather than padded.
- Propose a memory that restates a rule already in a `CLAUDE.md` in force.
- Report a session as clean when something failed. The failures are the reason this command exists.
