# mj-orchestrate

Orchestrator mode for Claude Code: the session stops editing code and starts
delegating it, under a sized contract, to a roster of specialised agents.

**Off by default.** Installing this plugin changes nothing about a normal
session. Orchestrator mode only applies once `/mj-orchestrate` is invoked, and
ends at `/mj-orchestrate off` or when the session ends.

## What ships here

| Path | What it is |
|---|---|
| `commands/mj-orchestrate.md` | The orchestrator charter — mode gate, levels, routing, plan gate, lens rubric, reporting contract |
| `agents/mj-worker-mech.md` | Mechanical worker (haiku) — fully specified tasks, no design judgment |
| `agents/mj-worker-dev.md` | Implementation worker (sonnet) — worktree + branch, never pushes |
| `agents/mj-judge.md` | Reviewer (opus) — one named lens, no Edit tool; also sizes tasks in calibration mode |
| `agents/mj-researcher.md` | Research (opus) — claims graded VERIFIED / REPORTED / INFERRED |
| `agents/mj-tech-lead.md` | Coordinator (sonnet) — runs plan → judge → execute for one repo-scoped unit, or implement → verify only when handed an approved plan |
| `commands/mj-keep.md` | `/mj-keep [personal\|work] [name]` — archives the current session (masked transcript copy + readable digest) to a profile folder |
| `commands/mj-recall.md` | `/mj-recall [personal\|work] [question]` — answers from the kept digests with cited, graded claims; with no question, lists the kept sessions to pick one to continue, summarise or ask about; can restore a session for resuming |
| `scripts/session-archive.sh` | The `keep`, `search` and `restore` engine behind the two commands (bash + jq, macOS and Linux) |
| `scripts/worktree-for.sh` | Creates a fresh worktree at an exact target ref and preflights it |
| `scripts/checkout-preflight.sh` | Refuses a stale, dirty, or main checkout before any file is read |
| `hooks/orchestrator-mode-reset.sh` | Resets this session's mode flag at session start (not on compaction); tested by `tests/orchestrator-mode-reset.test.sh` |
| `hooks/orchestrator-discover-guard.sh` | Optional `PreToolUse` backstop that blocks repo writes while the `discover` scope is on |
| `hooks/orch-band.tsx` | Function-hooks module: an always-visible band above the prompt (`🎛 orch <level> · 🔨 build`), drawn in the terminal and the desktop app — reads the same mode flag as the status line, refreshed every 3s; a button — click it (or `o` with the band focused) to run `/mj-orchestrate status`; a second small `▣` button (or `p`) opens the side panel directly, running no command and typing nothing into the prompt; tested by `tests/orch-band.test.tsx` |
| `hooks/orch-panel.tsx` | Function-hooks module: an `Orchestrator` side panel (opens at session start; closed it? click the `▣` button in the band, or run `/mj-orchestrate-panel`) showing the level and scope, with Level and Scope pickers (Buttons on mobile) and a Status button; every change runs `/mj-orchestrate <level> <scope>`, never writes the mode file, so the discover guard stays in step with the conversation; tested by `tests/orch-panel.test.tsx` |
| `hooks/orch-modules.tsx` | The single hooks module `hooks.json` loads (the engine allows one per plugin): it registers the band and the panel |

## Levels

`/mj-orchestrate [strict|standard|light] [task]` — a ceremony dial that never
changes the hard stops, only how much is checked.

- **`strict`** — a written plan approved before code on every item, both judge
  checkpoints, minimum two lenses.
- **`standard`** (default) — at most one plan round and one judge round before the first code, and an approved plan is never planned again; the S0–S3 stakes tiers decide (S = stakes: Mechanical, Routine, Team-facing, Irreversible); a single unambiguous
  S0/S1 item takes the fast path and does not block on a contract turn.
- **`light`** — no contract turn, no judges. S3 items are refused rather than
  run light.

`/mj-orchestrate status` reports the state (on/off, level, scope, open
delegations and unruled decisions), then opens a picker for level and scope so
you never have to remember the mode names. The current values are marked
"(current)"; picking them changes nothing. In a non-interactive run it stops
after the report and lists the switch commands instead. A bare
`/mj-orchestrate` with no argument does the same, then asks what to
orchestrate if the mode is on.

## Discover scope

`/mj-orchestrate [strict|standard|light] discover [task]` (alias `no-code`) runs
the session read-only. The level is how much is checked; the scope is what the
session may do, and the two are independent. In `discover` the session
investigates and analyses — repo reads, detached worktrees, read-only lookups,
web research — and never edits a repo, commits, branches, creates tickets or
deploys. `build` leaves it; a level switch keeps the current scope, and `off`
resets both.

The deliverable is a findings report: each finding graded VERIFIED / REPORTED /
INFERRED, what would settle the unresolved ones, and a handoff plan in the
six-part plan format. The handoff plan is a draft that a later `build` run takes
through its planning phase — it is never pre-approved. Only `mj-researcher`,
`mj-judge`, Explore/Plan and (on a read-only dispatch) `mj-worker-mech` run in
`discover`; `mj-worker-dev` and `mj-tech-lead` refuse it.

The rule lives in the charter and in a `mode: discover (read-only)` line on
every dispatch. `hooks/orchestrator-discover-guard.sh` is an optional third
layer, described under "Optional wiring".

## Customise before you rely on it

**The routing table in `commands/mj-orchestrate.md` ships as categories, not
skill names.** The plugin's core rule is *installed skill → agent → inline* —
routing a step to a skill that already knows your pipelines, labels and gates
beats a worker guessing at all three. That only works once the table names the
skills you actually have, so edit it to list them, and edit the fallback table
to say what should happen when each is missing.

The rule underneath the fallback table is worth keeping whatever you put in it:
**a missing read-side skill degrades to an agent; a missing write-side skill
stops and asks.** Reading, testing and reviewing can be reconstructed and the
worst case is slower work. Deploying, releasing and creating tickets cannot.

## Wiring

The plugin registers its two hooks itself (`hooks/hooks.json`): the
session-start reset and the discover guard, described under 3 and 4 below.
The same file loads `hooks/orch-band.tsx`, the band above the prompt that
shows the mode where no status line is drawn (the desktop app), and
`hooks/orch-panel.tsx`, the side panel with level and scope toggles; the
engine allows one hooks module per plugin, so `hooks/orch-modules.tsx` is the
entry that registers both.
The keyword trigger and the status line are user configuration and stay
optional; the routing overlay (5) is optional too.

**1. A keyword trigger.** To arm the mode by saying "orchestrate" in a prompt
rather than typing the command, add to your `~/.claude/CLAUDE.md`:

```markdown
## Orchestrator mode — off by default

Sessions run in normal mode: do the work inline, as usual. Orchestrator mode is
not active unless the current turn invokes `/mj-orchestrate` or says
"orchestrate" in the prompt. On that trigger, follow that command's charter for
the rest of the session, until "normal mode" or `/mj-orchestrate off`. Never
infer the mode from how big the task looks.
```

**2. A status-line indicator.** The command records the active level in
`~/.claude/.orchestrator-mode.<session_id>` as `<level>|<epoch>|<scope>`, where
scope is `build` or `discover`; a file with only two fields reads as `build`. A
status line that reads that file can show the mode and scope (for example
`orch standard · discover`), and colour it by remaining budget so an expensive
level warns earlier than a cheap one.

**3. The session-start reset** (shipped). A `SessionStart` hook runs
`hooks/orchestrator-mode-reset.sh` so a level left on yesterday never reads as
live today. It resets on startup, resume and clear, but not on a compaction
(`source` is `compact`), so the mode survives it. The flag is per-session by design: a single global file gets
clobbered by every other window's session start.

**4. The discover guard** (shipped). `hooks/orchestrator-discover-guard.sh` runs as a
`PreToolUse` hook on `Edit|Write|MultiEdit|NotebookEdit|Bash`. It exits at once unless the
session's mode file says `discover`; then it allows writes only under the
scratchpad, the plans directory and the mode files, and blocks a Bash denylist
(`git commit|push|merge|rebase|reset|checkout -b|switch -c|branch <name>|tag|stash|cherry-pick`,
`worktree-for.sh` with a branch argument, `gh pr create|merge|edit|close|comment|review`,
`gh api` with a write method). It is a backstop, not a sandbox — Bash cannot be
fully pattern-matched — and it fails open on any error, so a broken hook never
blocks a session.

If you registered either hook in `settings.json` before installing the plugin,
remove those entries, or each hook runs twice.

**5. A local routing overlay.** The charter's skill-routing tables ship generic.
To name your own installed skills — including which ones are allowed in
`discover` and what to do when one is missing — write them to
`~/.claude/mj-orchestrate/routing.md`. The command reads that file at
activation and uses it in place of the generic tables. It stays on your machine,
so private skill names never land in this repo.

## Session review

`/mj-session-review` ships with this plugin. It reports what a session actually
did — done, decided, failed, open — and proposes memory changes from it,
writing nothing until each change is approved. Useful at the end of an
orchestrated run, but it works in any session and does not need orchestrator
mode to be on.

## Kept sessions

`/mj-keep` and `/mj-recall` archive a session to a local folder and bring it
back later. They run only when invoked: nothing auto-archives, no hook is
involved, and the orchestrator charter forbids reading the archive unless a turn
invokes `/mj-recall`.

**Config.** The folders are named in `~/.claude/mj-orchestrate/config`, which
stays on your machine (like the routing overlay) and is never committed:

```
# mj-orchestrate local config — never committed
keep.personal=<absolute path to personal kept-sessions folder>
keep.work=<absolute path to work kept-sessions folder>
```

Each path must be an existing folder; the script never creates one, so an
unmounted drive is reported rather than shadowed by a fresh local folder.
Missing file, key or folder stops with exit 3 and prints this template.

**`/mj-keep`** files each session under a subfolder per workspace — the git
repository's name (worktrees count as their main repository), or the folder
name outside git: `<profile folder>/<workspace>/<date>_<name>_<id8>.jsonl`, a
redacted copy of the transcript, plus a `.md` digest beside it (header fields
plus the human and assistant text turns only — no tool calls, no system
reminders). One `index.jsonl` at the profile folder's root is upserted for
every workspace, so `/mj-recall` searches them all; entries kept before 1.8.0
sit flat in the root and move into their workspace folder on the next keep. Keeping the same
session again refreshes the entry (`keeps` counts the refreshes); a new name
renames the files. The snapshot is as of that moment. Token-shaped secrets
(`sk-…`, `ghp_…`, `Bearer …`, `password=…`, PEM blocks and similar) are masked
in both the `.jsonl` and the `.md`, and so is every string value stored under a
secret-looking key (`password`, `token`, `api_key`, `SECRET_KEY` and the like)
in tool inputs and results; the `.jsonl` stays valid line by line. Masking is
pattern-based, so it is a safety net, not a guarantee — keep the folders
private. The files are written with mode 0600.

**`/mj-recall`** searches the digests (never the raw transcripts), ranks
sessions by how many distinct terms hit, and answers with each claim tagged
`[profile · date · short-id]` and graded VERIFIED or INFERRED. It proves what
was said then, not that it is still true. On an explicit ask to continue a
session it runs `restore`, which copies the masked transcript back into
`~/.claude/projects` only when that session id is not already present (never
overwrites) and prints the `cd … && claude -r <id>` commands, plain and as a
`--fork-session`. A restored session is the masked copy.

The discover guard does not block the script's writes: they go to the profile
folders and `~/.claude/projects`, which are not repo files.
