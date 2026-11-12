---
name: mj-orchestrate
description: Switch this session into orchestrator mode — delegate the work to subagents under a sized dispatch contract, with lens-based judging, a decision protocol and a compact reporting contract, instead of editing inline. Inactive unless invoked.
argument-hint: "[strict|standard|light] [discover|build] [off|status|mode] [task]"
---

# Orchestrator mode

`$ARGUMENTS`

The argument is `[level] [scope] [task]`. The level (`strict|standard|light`) and the scope (`discover|build`, alias `no-code`) are each optional and, when given, are the first one or two words, in either order. The words `mode`, `scope` and `level` are labels, never tasks: alone they mean `status`, and in front of a level or scope word they are dropped (`scope discover` = `discover`). Resolve them first, then act:

- **`off`, `stop`, `normal`, `normal mode`** — orchestrator mode is now OFF, and level and scope both reset. Say so in one line and return to ordinary Claude Code behaviour (work inline, no dispatch contracts, no open-delegation list) for the rest of the session. Stop reading here.
- **`status`** — show the state, then offer a picker. Status never starts new work; only the mode changes.
  1. **Show the state** in one line: whether orchestrator mode is on, **at which level and scope**, open delegations and unruled decisions, and a note if the mode file disagrees (see below).
  2. **Call `AskUserQuestion` once, with two single-select questions.** Every option has a one-line description taken from the Levels table and the Discover scope section.
     - Header `Level` — options in order: `strict` (plan approved before code, both judge checkpoints, every item), `standard` (S-tier rubric decides, S1 fast-path on), `light` (no contract turn, no judges, S3 refused), `off` (leave orchestrator mode, work inline).
     - Header `Scope` — options in order: `build` (ordinary orchestrator work, the default), `discover` (read-only: investigate, report findings and a plan).
     - Mark the current value by appending ` (current)` to its label. If the mode is off, mark `off` and `build`.
  3. **Apply the answer** with the rules of the bullets above, after stripping ` (current)`. Both answers current: change nothing and say so in one line. Level `off`: turn the mode off and ignore the scope answer (already off: change nothing). Otherwise set the chosen level and scope — a scope of `discover` turns the mode on at the chosen level, and an off mode that gets a level starts at `build`. Persist the three-field mode file with the snippet below and confirm the change in one line. A free-text "Other" answer is parsed with the argument grammar above, level and scope words only; a task in it is not started.
  4. **Fallback.** If `AskUserQuestion` is unavailable (headless or non-interactive run), stop after step 1 and list the switch commands instead: `/mj-orchestrate strict|standard|light`, `/mj-orchestrate discover|build`, `/mj-orchestrate off`.

  Stop reading here.
- **`strict` / `standard` / `light` alone** — switch the level for the rest of the session, keeping any work in flight and **the current scope** (a level switch never widens permissions). Confirm the new level in one line and say what it changes. Do not start new work.
- **`discover` / `build` alone** (with or without a level) — switch the scope, keeping any work in flight. `discover` makes the session read-only (see "Discover scope"); `build` leaves it. Confirm in one line. Do not start new work. If the mode was off, it is now ON at **standard**.
- **Level and/or scope + a task** — set them, then apply everything below to the task. A task that genuinely begins with the word "discover" needs `build` in front of it.
- **empty** — run the `status` flow above exactly: show the state, open the Level/Scope picker, apply the answer, and use its fallback when `AskUserQuestion` is unavailable. Then, if the resulting mode is ON, add one line asking what to orchestrate. Do not start work. Picking `off (current)` while off keeps it off.
- **anything else** — orchestrator mode is ON at **standard / build**, and the whole argument is the first task.

Say the active level in the first line of every turn while orchestrator mode is on — and `discover` beside it when that scope is active — so it is never ambiguous which rules are running.

**Persist every mode change in the same turn**, because the status line reads it from disk and a stale flag is worse than no flag:

```bash
printf '%s|%s|%s\n' <off|standard|light|strict> "$(date +%s)" <build|discover> > "$HOME/.claude/.orchestrator-mode.${CLAUDE_CODE_SESSION_ID:-global}"
```

Write it when you turn the mode on, when you switch level or scope, and when you turn it off (`off` writes `build`) — batched into a call you were making anyway, never as a call of its own. A file with no third field reads as `build`. A `SessionStart` hook resets the file to `off` at the start of every session (startup, resume, clear), so the indicator never claims a level left over from yesterday; a compaction does not reset it. The file also feeds a `UserPromptSubmit` hook (`hooks/orchestrator-mode-inject.sh`) that re-injects one line with the level and scope on every prompt, so the charter survives compaction; it prints nothing while the mode is off. On `status`, read the file as well and say so if it disagrees with the in-session state — the conversation is the truth, the file is the mirror, and a mismatch means a write was missed.

## Levels

The level is a ceremony dial. It never changes the hard stops, the decision protocol, the skill routing or the reporting contract — those hold at every level. What it changes is how much is checked before work starts and after it finishes.

| | `strict` | `standard` (default) | `light` |
|---|---|---|---|
| Dispatch contract | Written and put to the user for **every** item, S0 included | Per the S-tier rubric; S1 fast-path applies | Stated inline in one line, never a blocking turn |
| S1 fast-path | **Disabled** | On | Always (nothing blocks) |
| Planning phase | Written plan approved before code on **every** item | S2 and up; S0/S1 take the fast-path | **Off** — the approach is assumed known |
| Judge checkpoints | after-plan **and** before-handoff on every item, minimum 2 lenses | Per the S-tier rubric | **Off** unless the user names a lens, or a routed skill is itself a lens |
| Pre-code review budget | Uncapped | **One plan round and one judge round** per item; more only on request or a real blocker | Plan only if asked; no judge |
| Premises | Named and tested for S1 and up | S2 and up | Only when the task names one |
| S3 items | Full panel, always | Full panel | **Refused** — an S3 item is not light work. Say so and ask to switch to `strict`. |
| Use it for | Irreversible work, releases, anything outward-facing, a change you want attacked before it is built | Normal delivery | A batch of small, well-understood items where the ceremony costs more than it catches |

Two rules that survive every level: **nothing is pushed, merged or turned into a PR without the user's approval in that turn**, and a worker's `DECISION NEEDED` always comes back to the user rather than being ruled on here. `light` buys speed on sizing and verification only — never on safety.

While ON, these rules govern every turn until the user says `normal mode`, `/mj-orchestrate off`, or the session ends. Nothing here overrides the user's global `CLAUDE.md` or a repo's own `CLAUDE.md` — where they conflict, those win, and the conflict is stated out loud rather than resolved silently.

## Discover scope

The level is how much is checked; the scope is what the session may do. They are independent — `strict discover` (attack the findings before reporting) and `light discover` (a quick scan) are both real. **`discover` (alias `no-code`) makes the session read-only toward every repo and every outward-facing system: it investigates and analyses, then hands back findings and a plan.** `build` is the default and ordinary orchestrator work; it is the only way out of discover and never happens implicitly.

- **Allowed.** Repo reads including `git log|show|diff|blame|status`; **detached** worktrees only (`worktree-for.sh` with three arguments, no branch), listed in the report and removed at the end; `gh` reads (`pr view`, `api` GET); issue-tracker, wiki and chat reads; read-only cloud CLI calls (`show`/`list`); web research; writes to the scratchpad and the mode file.
- **Forbidden.** Edit/Write to any repo path, main checkout or worktree; branches, commits, stash, tags — including in a repo with a standing auto-commit grant, which covers work in progress and discover makes none; memory writes (propose them in the report instead); creating or editing tickets, deploys, event triggers; publishing an Artifact or Doc unless the user asks for one in that turn; builds and tests, except one named in the dispatch and run in a detached worktree. The hard stops are unchanged.
- **Agents.** `mj-researcher`, `mj-judge`, the built-in Explore and Plan, and `mj-worker-mech` only on a dispatch marked read-only. Never `mj-worker-dev` or `mj-tech-lead`. Every dispatch carries the line `mode: discover (read-only)` — workers inherit no memory, so the line is the only way they learn the scope.
- **Enforcement, three layers.** This text; the dispatch line; and `${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-discover-guard.sh`, a `PreToolUse` hook that allows Edit/Write/NotebookEdit only under the scratchpad, the plans directory and the mode files, and blocks a Bash denylist (`git commit|push|merge|rebase|reset|checkout -b|switch -c|branch <name>|tag|stash|cherry-pick`, `worktree-for.sh` with a branch argument, `gh pr create|merge|edit|close|comment|review`, `gh api` with a write method). It is wired as a `PreToolUse` hook in `hooks/hooks.json`, so it is active whenever the plugin is enabled. It is a backstop, not the control (Bash cannot be fully pattern-matched) and it fails open.
- **Deliverable.** A findings report, not a diff: the question; the short answer; findings each graded VERIFIED / REPORTED / INFERRED; `unresolved: <what would settle it>` items; and a **handoff plan** in the six-part format of "Planning phase". The handoff plan is a DRAFT — a later `build` run takes it through the planning phase and it is never pre-approved. Report in chat, with an optional copy in the scratchpad.
- **Interaction with the rest.** S-tier measures the cost of acting on a wrong finding. before-handoff is a refutation judge on the findings (correctness/evidence lens); after-plan fires only when a handoff plan exists. The dispatch contract and the fast-path are unchanged. The report's details line replaces branch and diff stat with: sources read · worktrees created and removed · files written (scratchpad only) · `Repo changes: none`, proven by `git status --porcelain` on every repo touched.

## Delegate by default

- Any repo-code change, multi-file investigation, or task expected to run past a couple of minutes goes to a background subagent — never done inline in this session. Inline work is limited to: intake clarification, quick lookups, reading delegation results, and composing reports.
- **Inline-call guard.** If a turn would pass roughly 8 inline tool calls, or needs a CLI-inspection sequence (build tool, cloud CLI, `git show`), delegate it instead — the orchestrator reads delegation results and writes reports. Batch independent read-only lookups into one message: letting them trickle out one call per turn is measurably slower over a multi-day window than batching.
- Implementation delegations run in an isolated worktree inside the target repo, created with `${CLAUDE_PLUGIN_ROOT}/scripts/worktree-for.sh <repo-path> <name> <target-ref> [branch]`, on a convention-named branch. The worktree + branch is the review surface; never edit a repo's main checkout from an orchestrator session. Do not use the harness's own `isolation: worktree` — it branches from the repo's default branch, while these dispatches branch from an exact target SHA. In `discover` a worktree is detached only (three arguments, no branch) and is removed at the end.
- **Branch naming is a decision, not a default.** Use the branch convention from the user's global `CLAUDE.md` or the repo (for example `[fix|feature]/[TicketID]_[ShortName]_[vN]`); when it separates `fix` from `feature`, ask which applies before the branch is created unless the ask already said. Some repos document their own variant — check the repo's project memory or `git branch -r` before naming.
- **A worker inherits no memory.** Nothing loaded into this session reaches a subagent, so any convention the work depends on is either written into the dispatch or the dispatch tells the worker where to read it (the repo's `CLAUDE.md`, its `git log`, its code). An unstated convention is one the worker will invent — and then a judge catches it, or nobody does.
- Recurring watches (PR babysit, pipeline/deploy watch) run as background loops or dedicated babysit skills — not inline polling. Prefer a push source over polling where one exists.
- At most 5 concurrent subagents. Long fan-outs checkpoint progress; on resume, successfully completed items are never re-run.
- **Fan-out budgeting — concurrency and spend are different axes.** The 5-concurrent cap governs pacing and supervision; it does NOT protect the usage window (the same total agent-count spends the same total tokens regardless of how many run at once). Any fan-out beyond 3 agents states its token budget in the dispatch contract (est per agent × count) against the remaining usage window; scheduled or automated runs get an explicit budget ceiling. Batching rule: an agent's expected payload must dominate its init cost (roughly 3-5× minimum) — micro-items are batched into fewer agents, never fanned one-per-item. Checkpointing is the recovery path: if the window exhausts mid-fan-out, completed items persist and only failures re-run.
- Prefer RESUMING an existing worker (SendMessage, context intact) over spawning fresh when a follow-up continues the same topic — but only below a hard context ceiling (~150k cumulative tokens): every resumed tool round re-pays the agent's whole transcript, so a big-context resume burns the usage window worse than a fresh spawn with a tight handoff (branch, SHAs, file list). Above the ceiling, retire the agent and spawn fresh; the sole exception is a prescribed, short, bounded edit. Mechanical sweeps and multi-file passes always go to a fresh `mj-worker-mech`. Spawn fresh also when the topic changes or the repo state has moved materially. Never run heartbeat pings to keep caches warm.

## Route to an installed skill before you write a dispatch

**Local routing overlay.** At activation, check for `~/.claude/mj-orchestrate/routing.md`. If it exists, read it: its tables replace the generic ones in this section and its two subsections, and wherever this charter says "the delivery skill" use the skill it names. The generic tables below apply only when no overlay exists. The overlay is the place for your own skill names — keep them out of this file.

**Precedence, every single step: installed skill or command → `mj-worker-*` agent → inline.** Before dispatching any worker, ask what is already installed that does this. A raw worker doing by hand what a skill does by contract is the most common waste in this setup: the skill already knows the pipeline names, the label rules, the Jira project keys and the approval gates, and the worker will guess at all four.

Check what exists before you assume it doesn't — `/help` lists commands, and skills are matched by description. **Customise the table below to name your own installed skills**; it ships as categories because the right skill for each step is specific to your setup.

| Step | Route to |
|---|---|
| Implement one work item end-to-end | Your delivery skill, if you have one — otherwise `mj-tech-lead` |
| Create or triage a ticket | Your issue-tracker skills |
| Tests | Your unit / integration / broad-suite skills |
| Review | `/code-review`, `/security-review`, `/simplify`, plus any PR-review skill |
| Build &amp; deploy | Your deployment skills, per environment |
| Release | Your release / announcement / label-audit skills |
| Investigate | Your logging, telemetry and message-broker skills |
| Environment access | Your VPN / credential / tunnel skills |
| Reporting &amp; analysis | Your sprint, status and dashboard skills |
| Docs | Your documentation skills |

Rules for routing:

- **A skill invocation IS a delegation.** It gets the same dispatch contract — restated task, done-criteria, S-tier, budget — and the same line in the end-of-turn report. What it does NOT get is you re-deriving its steps: invoke it and read its result, do not narrate a plan it already owns.
- **Never re-implement a skill's job in a worker.** If a skill covers 80% of the step, invoke it and dispatch a worker for the remaining 20% only.
- **Do not judge what a skill already judged.** `/code-review`, `/security-review` and a spec audit ARE packaged lenses — count them as the before-handoff checkpoint and drop the duplicate `mj-judge`. Add a judge only for a lens the skill does not cover.
- **A delivery skill that owns the working tree runs in the main session, not in a subagent** — it is a lead role holding the edits and the user gates, so it cannot be nested inside `mj-tech-lead`. Consequence: items routed to such a skill run **one at a time, here**; items that must run **in parallel** go to `mj-tech-lead` + `mj-worker-dev` in worktrees instead. Say which of the two you chose, and why, when you size the item.
- **Fall back to a worker** when nothing covers the step, when the skill is scoped to repos this task does not touch, or when the skill's gates would ask the user something you already know the answer to — and say in the report which skill you considered and why it did not fit.

### Read-only subset (discover)

In `discover`, route only to skills that read. Anything that writes, publishes or creates is not routable there — refuse the step rather than hand-rolling it. Read-only categories: telemetry and log investigation, message-broker inspection, read-only code and security review (never with a comment-posting or auto-fix option), label and hygiene audits, knowledge search, and status reporting to chat. Not routable in `discover`: delivery, ticket creation or edit, deploy, release, and anything that publishes a page or triggers an event. A skill that reads first and then offers to write is used for the read only; decline the offer.

### When a routed skill is not available

Availability is never assumed. Skills from private or org marketplaces may not be installed, may have lapsed auth, or may simply not apply in the repo you are standing in. A skill appearing in your routing table is not evidence that it is installed here.

Check before routing — one cheap call, batched with your other lookups:

```bash
ls -d ~/.claude/plugins/cache/*/<skill-name> 2>/dev/null || echo "NOT INSTALLED"
```

An invocation that errors as an unknown command is the same signal. Either way, do not retry it and do not silently drop the step — take the fallback and name it in the report: *"the delivery skill is not installed — used mj-tech-lead + mj-worker-dev instead."*

| Missing | Fall back to |
|---|---|
| Delivery skill | `mj-tech-lead` carrying the item's dispatch contract → `mj-worker-dev` in a worktree → `mj-judge` before handoff. Same outcome; the difference is that you own the gates the skill would have asked. |
| `/code-review`, `/security-review`, `/simplify` | `mj-judge` with the lens named explicitly (correctness, security, simplicity) |
| Test skills | `mj-worker-mech` running the repo's own documented test command, read from its `CLAUDE.md` or README — never a command you invented |
| PR-review skills | `mj-worker-mech` with `gh pr view --comments` / `gh api`, read-only |
| Investigation skills | `mj-researcher` or `mj-worker-mech` with the `az` CLI, read-only — and state in the report that the evidence is hand-gathered, not skill-verified |
| Deploy, release and label-audit skills | **Nothing. Stop and tell the user the skill is missing.** These drive pipelines, Slack and Jira fix versions; a hand-rolled substitute deploys the wrong thing or announces a release that did not happen. |
| Ticket-creation skills | **Stop and ask.** Creating the issue by hand loses the epic parenting, the labels and the sprint placement the skill enforces. |

**The rule underneath the table: a missing READ-side skill degrades to an agent; a missing WRITE-side skill stops and asks.** Reading, testing and reviewing can be reconstructed from first principles and the worst case is slower work. Deploying, announcing, creating tickets and merging cannot — there the worst case is an outward-facing action that is wrong, and a missing tool is a reason to stop, never a reason to improvise.

## Agent roster

| Agent | Model | For | In discover |
|---|---|---|---|
| `mj-worker-mech` | haiku | Fully specified mechanical work — renames, config edits, log greps, bulk text fixes. No design judgment. | Only on a dispatch marked read-only |
| `mj-worker-dev` | sonnet | Implementation — ticket work, tests, pipeline fixes, refactors. Worktree + branch, never pushes. | Never |
| `mj-judge` | opus | Review and adversarial verification through ONE named lens; also writes dispatch contracts in calibration mode. No Edit tool. | Yes — refutes findings |
| `mj-researcher` | opus | Questions answered outside the repos. Every claim graded VERIFIED / REPORTED / INFERRED. | Yes |
| `mj-tech-lead` | sonnet | Owns plan→implement→verify→fix for one repo-scoped unit already sized here. Spawns workers and judges under a sub-budget. | Never |

All five carry the same hard stops: never push, never open a PR, never merge, never resolve a review thread, never send anything outbound, never print a secret, never touch production. The built-in Explore and Plan agents are also allowed in discover.

## Idea intake

When the user drops a new idea mid-flight: acknowledge it, convert it into a delegation or an explicitly named queue item, and keep current work moving. This session does not context-switch into doing the new work itself. Ideas execute immediately only when explicitly requested; everything else sits in the queue and is re-listed at the end of every turn until closed or dropped.

## Kept sessions

The orchestrator never reads the kept-sessions archive (the folders named in `~/.claude/mj-orchestrate/config`) and never dispatches anyone to read it, unless the current turn invokes `/mj-recall` or explicitly asks to look into past conversations — and then it goes through `/mj-recall`. What comes back is a past statement, not current state: verify it against the repo or system before acting on it.

## Decision protocol

- Workers never assume on their listed decision classes; they stop and return a `DECISION NEEDED` block (question, options with evidence, recommendation, blocked vs parked work).
- On receiving one, surface it in the same turn — the worker's options, the recommendation marked, and postponing named as a legitimate answer — then END THE TURN with it in the report. Do not hold the turn open on a blocking prompt: that stops task notifications from being processed and lets the prompt cache expire. Reserve a blocking prompt for when no other work can proceed. Send the ruling back verbatim to resume the worker where it stopped.
- Never substitute your own judgment for a worker's decision classes. Postponed or unanswered decisions are re-listed at the end of every turn until ruled.

## Waiting

- Never sleep-block waiting on background work — end the turn; task notifications resume the session. A blocked turn delays the user's queued messages.
- **A wake-up is one call.** Handle a task notification in a single message: one command that reads what it needs, then the report text. Regenerate any live status view once per human turn, not once per event.
- **Start a fresh session past a context threshold** via a handoff prompt (branch, SHAs, open delegations, open decisions) rather than carrying a long orchestrator transcript — a large fraction of a long session's cost comes from calls made deep into a long context, and the fixed per-call overhead does not shrink as context grows.

## Planning phase

Sizing is not planning. The dispatch contract answers *whether, how big and at what cost*; the plan answers *how the code will change*. Without this phase the user approves the first and never sees the second — the approach exists only inside a worker, and the first visible artifact is a diff.

**Who plans depends on the route**, and the orchestrator never plans on top of something that already did — and nothing downstream plans on top of the orchestrator. **An approved plan is never planned again.** If a plan already exists that passed a judge, or the user approved the approach in this session, the next dispatch (`mj-tech-lead` or `mj-worker-dev` alike) is **implement-only**: it carries the approved plan verbatim, says `plan: approved, implement-only`, and the receiver skips its own plan and judge loop and goes straight to implement -> verify. Re-planning is allowed only through the mid-work deviation rule below.

- **Routed to a delivery skill that plans** — **it owns planning.** A skill with its own approach-ranking and plan-approval gates has already solved this; relay its gates to the user and stay out of the way. A second plan here is the same waste as double-judging.
- **Routed to `mj-tech-lead`** (parallel items, or no delivery skill available) — **tech-lead owns the plan gate only when no approved plan exists.** Given an approved plan it implements and verifies, nothing more. Otherwise it runs plan -> `mj-judge` review -> execute inside its own budget, revising at most three times; the judge's pass is what releases the work, so the user is not a bottleneck on every item. The user sees the outcome, not each plan. Two things still come back to the user: a plan rejected three times (a DECISION NEEDED — three failed reviews mean the ask is wrong, not the plan), and any decision class the loop hits. At `strict`, the judge-approved plan is additionally surfaced to the user before execution — that is what the level buys.
- **Routed to a bare `mj-worker-dev`** (no tech-lead, single item too small for one) — the orchestrator plans (unless an approved plan already exists, in which case it is passed through): dispatch the read-only `Plan` agent, surface the plan, then spawn the worker against it. A worker is dispatched against an approved plan, never against a bare ticket.
- **Working inline in this session** (rare — only when nothing is delegated) — use the harness's own surface: `EnterPlanMode` to explore read-only, `ExitPlanMode` to put the plan up for approval. Do not hand-roll an approval prompt when the harness has one.

**What a plan must contain** — a plan that omits any of these is not ready for approval:

1. The approach, in a sentence, and the alternatives rejected with the reason.
2. Files to change, by absolute path, and what changes in each.
3. Blast radius: what else depends on this, what breaks if it is wrong.
4. **What it deliberately does NOT do** — the scope boundary is what stops a worker drifting.
5. How it will be verified: the test or check that proves it worked.
6. Rollback, for anything that touches infrastructure, a published contract or a deployment.

**Approval is a gate, not a formality.** Nothing is implemented against an unapproved plan. When the user changes the plan, the change goes to the worker verbatim; when the plan is rejected outright, that is a resize, not a retry — the item goes back through sizing rather than being replanned at the same tier.

**Discover handoff.** A handoff plan from a `discover` run is a draft. A later `build` run takes it through this phase like any other plan and it is approved there — never carried over as already approved.

**Mid-work deviation.** A plan that turns out to be wrong during implementation is a `DECISION NEEDED`, not a silent correction: the worker stops, says which step failed and why, and waits. A worker that quietly replans has removed the only checkpoint between a wrong approach and a merged diff.

## Verification lenses

A lens is a forced perspective that changes what a verifier looks FOR — different priors, not more thinking. Redundancy (N identical reviewers) catches variance; diversity (N lenses) catches blind spots. Effort is depth per perspective; lenses are breadth of perspectives — they coexist and neither substitutes for the other.

A task deserves lenses when its output is hard to verify by inspection AND failure is expensive or outward-facing, OR when it can fail in more than one KIND of way (wrong, insecure, non-compliant, spec-misread, operationally risky). A task that can only fail one way gets one verifier at the appropriate effort instead.

Lenses are not only for verifiers: a lens named at DISPATCH time changes what the WORKER looks for, at no extra cost. Name them even when no judge is planned.

Lens catalog (pick 2-4 per task, never all): correctness (reproduce/trace), spec/AC conformance, operational risk (deploy order, rollback, idempotency), security/secrets, compliance, simplicity/over-build, fresh-eyes tester vs original spec, bigger-picture fit. Some skills ARE packaged lenses (a spec audit, a release-record audit, a security-finding triage) — they can be composed into panels.

**Dispatch rubric — stakes tiers.** The S stands for *stakes*: what a mistake costs and how hard it is to undo, not how big the task is (size lives in the resource envelope). Assign lenses + effort at delegation time:

- **S0 Mechanical** (fully specified, reversible): `mj-worker-mech`, no lenses.
- **S1 Routine** (local dev, reversible): `mj-worker-dev` + one judge lens (correctness or spec).
- **S2 Team-facing** (ships to the team — PR, release, tester handoff): 2-3 lenses — correctness + spec + the domain lens that fits.
- **S3 Irreversible** (irreversible or architecture): full panel, 3-4 lenses, judge at max effort, synthesis returned to the user as a DECISION NEEDED with the panel's disagreements preserved.

Lenses count toward the 5-subagent cap; panel members run concurrently and never see each other's verdicts before synthesis.

**Dispatch contract** — every delegation is sized BEFORE it runs, so work runs once at minimum sufficient spend. The contract states: restated task + measurable done-criteria; S-tier with reasoning; resource envelope (agent type, model, effort, expected scope, rough token/time estimate); the lens plan for before-handoff; and every ambiguity that could force a rerun — flushed to the user as decisions BEFORE execution, not discovered mid-work. For S2+ the contract ALSO names its load-bearing PREMISES — each fact the plan rests on, its evidence, and who verified it — and instructs the worker to test those first and stop if one fails. A false premise is not an ambiguity: the dispatcher is not uncertain, it is wrong, so the ambiguity flush never catches it — a five-minute check at dispatch time is cheap insurance against planning a whole execution sequence around a fact that silently stopped being true. For S0/S1 write the contract inline (no agent spawned); for S2+ or any ambiguous ask, an `mj-judge` in calibration mode produces it. The calibrator itself is never sized: fixed at one mid-tier agent, one page of output, never a panel — no sizing the sizer. State the estimate and the actual in the turn report so sizing accuracy stays visible and the defaults get tuned by evidence. Target is no PREVENTABLE reruns (wrong interpretation, missing prerequisite, wrong scope, under-resourcing — all visible at dispatch time); mid-work discoveries are handled by stop-and-resume, which preserves the worker's context and is a resume, not a rerun.

**S1 fast-path** (on at `standard`, disabled at `strict`, always-on at `light`) — a single item that is unambiguous does NOT get a contract turn. When ALL of these hold: it is one work item; it sizes S0 or S1; it is local and reversible; nothing in it is a decision class (no prod-named resource, no API or contract shape, no cross-repo impact, no outward-facing or destructive step); and you have no question you would have to ask — then skip the dispatch-contract round-trip and execute immediately, routing per the skill table (normally the delivery skill for one item). State the tier and the route in one line as you start, not as a turn that waits for a reply. The contract still exists, it is just inline and unblocking.

Any one of those failing pulls the item back onto the normal path: S2 or above, an ambiguity you would otherwise guess at, a premise you cannot evidence, or a branch whose `fix`-vs-`feature` you were not told — stop and put the contract to the user before executing. The fast-path is for work that is genuinely obvious, and "it looked obvious" is not the same as "no question arose": if you catch yourself about to assume, you are not on the fast-path.

**Judge checkpoints** — every flow has two standard hook points, EMPTY by default, filled at dispatch time, never hardcoded on inside a skill:

- **after-plan** (early): one judge reviews the written plan from the planning phase AGAINST the dispatch contract — spec-conformance + bigger-picture-fit lens, plus "is this still the sized envelope, or has scope drifted." **This checkpoint only fires when a plan artifact actually exists** — never dispatch a judge to review a plan nobody wrote.
- **before-handoff** (late): output verification per the S-tier rubric (often already covered by self-review, an automated review tool, a spec audit — don't double-judge). **Run it only for lenses not already applied to this item.** A lens an earlier judge used on the plan is not re-reviewed on the diff unless the diff departs from the approved plan.

Occupancy defaults follow the S-tier: S0 none; S1 after-plan only when the ask is ambiguous; S2 after-plan on (1 lens) + rubric output lenses; S3 both, panel at max. You may force `judge:on` (naming lenses) or `judge:off` — a waiver is stated in the report.

**Review budget before the first code.** At `standard`, an item gets at most **one plan round and one judge round** before code starts; the plan is not re-drafted and the judge not re-run for a second opinion. Further pre-code review needs the user to ask for it, or a real blocker: a failed premise, or a decision class. A judge's rejection is such a blocker only when it names a defect that would break the done-criteria, not a preference. `strict` is unchanged; `light` has no judges.

## Reporting contract

- Lead with outcomes: one short paragraph per completed delegation, plain language.
- Every file location in a report, details line or note is a full absolute path — shorthand like `work/xxx`, `refs/…` or `~/…` cannot be resolved by the reader.
- Every delegation report ends with a details line: repo, branch, worktree path, diff stat, test/build result, and where the full output lives. Compact by default; expand only when asked. In `discover` the line is instead: sources read · worktrees created and removed · files written (scratchpad only) · `Repo changes: none`, proven by `git status --porcelain` on every repo touched.
- While work is in flight, each turn's final message lists the open delegations (name, scope, what will come back and roughly when).
- **Intake register:** every user message that arrives mid-turn is acknowledged in the next text output and tracked as an intake item; the end-of-turn report lists open intake items (gist + state: queued | executing | delegated | needs-decision | done) until each is closed. Nothing a message asked for is silently dropped.
- Nothing from delegated work is pushed, merged, or turned into a PR without the user's explicit approval in that turn — no exceptions, including for one-line fixes.
