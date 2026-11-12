import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Orch } from '../types'
import { BUTTON, openPanel } from './orch-panel'

const orch = atom({ plugin: 'mj-orchestrate', key: 'orch' } as const, null)

const LEVELS = ['strict', 'standard', 'light', 'off']
const STALE_MS = 8 * 60 * 60 * 1000

let last = ''

async function refresh($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const sid = await $.session.id()
  const own = `${home}/.claude/.orchestrator-mode.${sid}`
  const file = (await $.fs.exists(own)) ? own : `${home}/.claude/.orchestrator-mode`
  const raw = await $.fs.read(file).catch(() => '')
  const [mode = '', ts = '0', scope = ''] = String(raw).trim().split('|')
  const level = LEVELS.includes(mode) ? mode : 'off'
  const now = await $.clock.now()
  const next: Orch = {
    level,
    scope: scope === 'discover' ? 'discover' : 'build',
    isStale: level !== 'off' && now - Number(ts) * 1000 > STALE_MS,
  }
  const key = JSON.stringify(next)
  if (key !== last) {
    last = key
    await update($, orch, () => next)
  }
}

async function openStatus($: EngineInterface) {
  const line = '/mj-orchestrate status'
  try {
    const commands = await $.command.list()
    const hit =
      commands.find(c => c.name === 'mj-orchestrate') ??
      commands.find(c => c.name.endsWith(':mj-orchestrate'))
    if (!hit) {
      throw new Error('no mj-orchestrate command in this session')
    }
    await $.command.run({ command: hit.name, args: 'status' })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mj-orchestrate: could not run ${line} (${reason}); it is in the prompt box, press Enter`)
    await $.prompt.fill({ text: line })
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

    const { Box, Button, Text } = $.ui.resolve(e)
    const scope = state.scope === 'discover' ? '🔍 discover' : '🔨 build'
    const isOff = state.level === 'off'
    const label = `🎛 orch ${state.level}${state.isStale ? '?' : ''} · ${scope}`

    return (
      <Box>
        <Button
          key="orch-status"
          hotkey="o"
          dimColor={isOff}
          variant={isOff ? undefined : 'primary'}
          onPress={() => openStatus($)}
        >
          {isOff ? <Text dimColor>{label}</Text> : <Text bold color="claude">{label}</Text>}
        </Button>
        <Button key="orch-panel" hotkey="p" dimColor onPress={() => openSidePanel($)}>
          <Text dimColor> {BUTTON} </Text>
        </Button>
      </Box>
    )
  })
}
