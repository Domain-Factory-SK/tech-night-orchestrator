import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Orch } from '../types'
import { BUTTON, openPanel } from './orch-panel'
import { OPTIONS, SCOPE_LABEL, apply, readMode, settle, shown, valueOf } from './orch-shared'

const pending = atom({ plugin: 'mj-orchestrate', key: 'pending' } as const, null)
const orch = atom({ plugin: 'mj-orchestrate', key: 'orch' } as const, null)

let last = ''

async function refresh($: EngineInterface) {
  const next = await readMode($)
  await settle($, next)
  const key = JSON.stringify(next)
  if (key !== last) {
    last = key
    await update($, orch, () => next)
  }
}

// Opens the pane directly: no command is run and nothing is typed into the
// prompt. A pane that is not drawn, or an open that throws, is logged.
async function openSidePanel($: EngineInterface) {
  try {
    const opened = await openPanel($)
    if (!opened.isPlaced) {
      $.ui.log(`mj-orchestrate: the panel is open but not drawn (${opened.reason})`)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mj-orchestrate: could not open the panel (${reason})`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.every(3000, () => refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, orch)
    if (e.props.hasSurvey || state === null) {
      return next(e)
    }

    const isOff = state.level === 'off'
    // Mobile apps draw a Select only if they asked for one, and a Box
    // otherwise, so there the band is the label and the panel button: the
    // pane's Buttons apply.
    if (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const label = `🎛 orch ${state.level}${state.isStale ? '?' : ''} · ${SCOPE_LABEL[state.scope]}`
      return (
        <Box>
          {isOff ? <Text dimColor>{label}</Text> : <Text bold color="claude">{label}</Text>}
          <Button key="orch-panel" hotkey="p" dimColor onPress={() => openSidePanel($)}>
            <Text dimColor> {BUTTON} </Text>
          </Button>
        </Box>
      )
    }

    const { Box, Button, Select, Text } = $.ui.resolve(e)
    const waiting = await read($, pending)
    return (
      <Box>
        <Select
          key="orch-mode"
          options={OPTIONS}
          value={valueOf(shown(state, waiting))}
          onSelect={value => void apply($, state, value)}
        />
        {state.isStale && !waiting && <Text dimColor> stale?</Text>}
        <Button key="orch-panel" hotkey="p" dimColor onPress={() => openSidePanel($)}>
          <Text dimColor> {BUTTON} </Text>
        </Button>
      </Box>
    )
  })
}
