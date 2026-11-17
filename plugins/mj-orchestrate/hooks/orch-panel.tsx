import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Orch } from '../types'
import { OPTIONS, apply, clearPending, readMode, settle, shown, valueOf } from './orch-shared'

const pending = atom({ plugin: 'mj-orchestrate', key: 'pending' } as const, null)
const panel = atom({ plugin: 'mj-orchestrate', key: 'panel' } as const, null)

export const PANE = 'mj-orchestrate'
export const BUTTON = '▣'
const COMMAND = 'mj-orchestrate-panel'
const TITLE = '🎛 Orchestrator'
const HINT = `Closed it? Click ${BUTTON} in the band, or type /${COMMAND}`

let last = ''

async function refresh($: EngineInterface) {
  const next = await readMode($)
  await settle($, next)
  const key = JSON.stringify(next)
  if (key !== last) {
    last = key
    await update($, panel, () => next)
  }
}

// The one place the pane is opened, shared by the slash command and the band
// button (it never opens at session start), so the id and title cannot drift apart.
export function openPanel($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

async function startup<E>($: EngineInterface, e: E, next: (e: E) => Promise<{ cwd: string }>) {
  await clearPending($)
  try {
    await $.command.register({
      name: COMMAND,
      description: 'Open the orchestrator side panel',
    })
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
    const waiting = await read($, pending)
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
      const current = valueOf(shown(state, waiting))
      return (
        <Box flexDirection="column" width={width} gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Svg source={ICON} alt="Orchestrator dial" width={18} height={18} />
            <Text bold={!isOff} dimColor={isOff}>{header(state, true)}</Text>
          </Box>
          <Box flexWrap="wrap" gap={1}>
            {OPTIONS.map(option => (
              <Button
                key={`mode-${option.value}`}
                variant={option.value === current ? 'primary' : 'secondary'}
                onPress={() => void apply($, state, option.value)}
              >
                {option.label}
              </Button>
            ))}
          </Box>
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
          key="mode"
          label="Mode"
          options={OPTIONS}
          value={valueOf(shown(state, waiting))}
          onSelect={value => void apply($, state, value)}
        />
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
