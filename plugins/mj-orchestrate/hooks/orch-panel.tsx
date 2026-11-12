import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Orch } from '../types'

const panel = atom({ plugin: 'mj-orchestrate', key: 'panel' } as const, null)

export const PANE = 'mj-orchestrate'
export const BUTTON = '▣'
const COMMAND = 'mj-orchestrate-panel'
const TITLE = '🎛 Orchestrator'
const HINT = `Closed it? Click ${BUTTON} in the band, or type /${COMMAND}`
const LEVELS = ['strict', 'standard', 'light', 'off']
const SCOPES = ['build', 'discover']
const STALE_MS = 8 * 60 * 60 * 1000

let last = ''
type Pick = { level: string; scope: string }

let pending: Pick | null = null

async function refresh($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const sid = await $.session.id()
  const own = `${home}/.claude/.orchestrator-mode.${sid}`
  const file = (await $.fs.exists(own)) ? own : `${home}/.claude/.orchestrator-mode.global`
  const raw = await $.fs.read(file).catch(() => '')
  const [mode = '', ts = '0', scope = ''] = String(raw).trim().split('|')
  const level = LEVELS.includes(mode) ? mode : 'off'
  const now = await $.clock.now()
  const next: Orch = {
    level,
    scope: scope === 'discover' ? 'discover' : 'build',
    isStale: level !== 'off' && now - Number(ts) * 1000 > STALE_MS,
  }
  if (pending && pending.level === next.level && (next.level === 'off' || pending.scope === next.scope)) {
    pending = null
  }
  const key = JSON.stringify(next)
  if (key !== last) {
    last = key
    await update($, panel, () => next)
  }
}

// Runs the slash command instead of writing the mode file: the discover guard
// reads that file, and a direct write would lift it without the conversation
// knowing. A failed run drops the pick it was sent for, so the same pick can be
// made again.
async function runCommand($: EngineInterface, args: string, owned?: Pick) {
  const line = `/mj-orchestrate ${args}`
  try {
    const commands = await $.command.list()
    const hit =
      commands.find(c => c.name === 'mj-orchestrate') ??
      commands.find(c => c.name.endsWith(':mj-orchestrate'))
    if (!hit) {
      throw new Error('no mj-orchestrate command in this session')
    }
    await $.command.run({ command: hit.name, args })
  } catch (error) {
    if (owned && pending === owned) {
      pending = null
    }
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mj-orchestrate: could not run ${line} (${reason}); it is in the prompt box, press Enter`)
    await $.prompt.fill({ text: line })
  }
}

// A pick is built on the last pick the person made, not on the file: the file
// only changes once the queued command has run, so two quick picks would
// otherwise undo each other. The pick never expires by time; it ends when the
// file shows it, when its run fails, or when the module restarts. A pick that
// changes nothing sends nothing.
async function setMode($: EngineInterface, state: Orch, change: { level?: string; scope?: string }) {
  const base = pending ?? state
  const level = change.level ?? base.level
  const scope = change.scope ?? base.scope
  if (level === base.level && scope === base.scope && !(base === state && state.isStale)) {
    return
  }
  const mine = { level, scope }
  pending = mine
  await runCommand($, level === 'off' ? 'off' : `${level} ${scope}`, mine)
}

// The one place the pane is opened, shared by session start, the slash command
// and the band button, so the id and title cannot drift apart.
export function openPanel($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

async function startup<E>($: EngineInterface, e: E, next: (e: E) => Promise<{ cwd: string }>) {
  pending = null
  try {
    await $.command.register({
      name: COMMAND,
      description: 'Open the orchestrator side panel',
    })
    openPanel($).catch(() => {})
  } catch {}
  const result = await next(e)
  try {
    await refresh($)
    $.clock.every(3000, () => refresh($))
  } catch {}
  return result
}

export const register: Register = on => {
  // The band owns the matcherless session.start and turn.complete hooks and a
  // plugin may not register an event twice without a matcher, so the panel
  // registers its start under both values of isInteractive (an SDK-hosted
  // session, as the desktop app and VS Code run, is not interactive) and lets
  // the 3s tick stand in for turn.complete.
  on('session.start', { isInteractive: true }, ($, e, next) => startup($, e, next))
  on('session.start', { isInteractive: false }, ($, e, next) => startup($, e, next))

  on('command.run', { command: COMMAND }, async $ => {
    await openPanel($)
    return { text: 'Orchestrator panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, panel)
    const width = e.props.bodyColumns

    if (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      if (state === null) {
        return (
          <Box flexDirection="column" width={width}>
            <Text dimColor>Reading the orchestrator mode...</Text>
          </Box>
        )
      }
      const isOff = state.level === 'off'
      const row = (name: string, options: string[], current: string, pick: (value: string) => void) => (
        <Box flexDirection="column">
          <Text dimColor>{name}</Text>
          <Box flexWrap="wrap" gap={1}>
            {options.map(value => (
              <Button
                key={`${name.toLowerCase()}-${value}`}
                variant={value === current ? 'primary' : 'secondary'}
                onPress={() => pick(value)}
              >
                {value}
              </Button>
            ))}
          </Box>
        </Box>
      )
      return (
        <Box flexDirection="column" width={width} gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Svg source={ICON} alt="Orchestrator dial" width={18} height={18} />
            <Text bold={!isOff} dimColor={isOff}>{header(state, true)}</Text>
          </Box>
          {row('Level', LEVELS, state.level, level => void setMode($, state, { level }))}
          {!isOff && row('Scope', SCOPES, state.scope, scope => void setMode($, state, { scope }))}
          <Button key="status" hotkey="s" onPress={() => void runCommand($, 'status')}>
            Status
          </Button>
          <Text dimColor>{HINT}</Text>
        </Box>
      )
    }

    const ui = $.ui.resolve(e)
    const { Box, Button, Select, Text } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    if (state === null) {
      return (
        <Box flexDirection="column" width={width}>
          <Text dimColor>Reading the orchestrator mode...</Text>
        </Box>
      )
    }
    const isOff = state.level === 'off'
    return (
      <Box flexDirection="column" width={width} gap={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {Svg && <Svg source={ICON} alt="Orchestrator dial" width={18} height={18} />}
          <Text bold={!isOff} dimColor={isOff}>{header(state, Svg !== null)}</Text>
        </Box>
        <Select
          key="level"
          label="Level"
          options={LEVELS.map(value => ({ value }))}
          value={state.level}
          onSelect={level => void setMode($, state, { level })}
        />
        {!isOff && (
          <Select
            key="scope"
            label="Scope"
            options={SCOPES.map(value => ({ value }))}
            value={state.scope}
            onSelect={scope => void setMode($, state, { scope })}
          />
        )}
        <Button key="status" hotkey="s" onPress={() => void runCommand($, 'status')}>
          Status
        </Button>
        <Text dimColor>{HINT}</Text>
      </Box>
    )
  })
}

// Fixed mid-tone strokes: an Svg takes no theme color, so the dial has to read
// on both a light and a dark pane.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#7b8794" stroke-width="1.6" stroke-linecap="round">' +
  '<circle cx="10" cy="10" r="8"/><path d="M10 10 L14 5.5"/><circle cx="10" cy="10" r="1" fill="#7b8794"/>' +
  '<path d="M4.2 14.6 L5.4 13.6 M15.8 14.6 L14.6 13.6 M10 2.6 L10 4"/></svg>'

// Svg surfaces draw the dial, so their text drops the emoji it would repeat.
function header(state: Orch, hasIcon = false) {
  const scope = state.scope === 'discover' ? '🔍 discover' : '🔨 build'
  return `${hasIcon ? '' : '🎛 '}orch ${state.level}${state.isStale ? '?' : ''} · ${scope}`
}
