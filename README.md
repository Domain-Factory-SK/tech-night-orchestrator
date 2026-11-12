# tech-night-orchestrator

A Claude Code plugin marketplace holding the orchestrator plugin shown at a
Tech Night talk: `mj-orchestrate` switches a session into orchestrator mode, in
which the session delegates work to a roster of subagents under a sized
dispatch contract instead of editing code itself.

It is off by default. Installing it changes nothing about a normal session; the
mode only applies once `/mj-orchestrate` is invoked.

## Install

```
/plugin marketplace add Domain-Factory-SK/tech-night-orchestrator
/plugin install mj-orchestrate@tech-night-orchestrator
```

## Commands

| Command | What it does |
|---|---|
| `/mj-orchestrate [strict\|standard\|light] [discover] [task]` | Turns orchestrator mode on, sets the level and scope, or reports status; `off` ends it |
| `/mj-session-review` | Reports what a session actually did and proposes memory changes (proposes only, writes nothing until approved) |
| `/mj-keep [personal\|work] [name]` | Archives the current session to a local profile folder |
| `/mj-recall [personal\|work] [question]` | Searches the kept sessions, cites what was said, and can restore one for resuming |
| `/mj-orchestrate-panel` | Reopens the side panel that shows the level and scope |

## More

See the plugin's own README for the agent roster, levels, hooks and setup:
[plugins/mj-orchestrate/README.md](plugins/mj-orchestrate/README.md).

## Slides

The talk's slides: [slides/i-dont-code-i-delegate.pdf](slides/i-dont-code-i-delegate.pdf).

## License

MIT
