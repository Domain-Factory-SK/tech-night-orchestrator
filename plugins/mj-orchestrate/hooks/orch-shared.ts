import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Choice, Orch } from '../types'

// What the band and the pane share: the pending pick (an atom the engine's scan
// must see declared in each file that reads or updates it, so band and pane
// repeat this one-line declaration; the reference is the same), the one apply
// path, the option list and the mode-file reader, so the two surfaces stay in
// step and neither duplicates the other.
const pending = atom({ plugin: 'mj-orchestrate', key: 'pending' } as const, null)

export const LEVELS = ['strict', 'standard', 'light', 'off']
export const SCOPES = ['build', 'discover']
export const SCOPE_LABEL: Record<string, string> = { build: '🔨 build', discover: '🔍 discover' }
const STALE_MS = 8 * 60 * 60 * 1000

// The seven picks the dropdown holds, strongest level first, then off. Band and
// pane draw this one list, so one pick is one command run on either.
export const OPTIONS = [
  ...LEVELS.filter(level => level !== 'off').flatMap(level =>
    SCOPES.map(scope => ({ value: `${level}:${scope}`, label: `🎛 ${level} · ${SCOPE_LABEL[scope]}` })),
  ),
  { value: 'off', label: '🎛 off' },
]

export const valueOf = (pick: Choice) => (pick.level === 'off' ? 'off' : `${pick.level}:${pick.scope}`)

export async function readMode($: EngineInterface): Promise<Orch> {
  const home = (await $.env.get('HOME')) ?? ''
  const sid = await $.session.id()
  const own = `${home}/.claude/.orchestrator-mode.${sid}`
  const file = (await $.fs.exists(own)) ? own : `${home}/.claude/.orchestrator-mode.global`
  const raw = await $.fs.read(file).catch(() => '')
  const [mode = '', ts = '0', scope = ''] = String(raw).trim().split('|')
  const level = LEVELS.includes(mode) ? mode : 'off'
  const now = await $.clock.now()
  return {
    level,
    scope: scope === 'discover' ? 'discover' : 'build',
    isStale: level !== 'off' && now - Number(ts) * 1000 > STALE_MS,
  }
}

// Scope does not count while the level is off: `off` carries none.
function isSame(a: Choice, b: Choice) {
  return a.level === b.level && (a.level === 'off' || a.scope === b.scope)
}

// What the dropdowns show: the pick still being applied, else what the file
// says, so the control does not snap back before the file catches up.
export function shown(state: Orch, waiting: Choice | null): Choice {
  return waiting ?? state
}

// Called with each fresh read of the mode file: once the file shows the pending
// pick it stops being pending. A pick that still differs (a later one, sent
// while an earlier run was landing) is kept.
export async function settle($: EngineInterface, state: Orch) {
  const waiting = await read($, pending)
  if (waiting && isSame(waiting, state)) {
    await update($, pending, cur => (cur && isSame(cur, state) ? null : cur))
  }
}

export async function clearPending($: EngineInterface) {
  await update($, pending, () => null).catch(() => {})
}

// Runs the slash command instead of writing the mode file: the discover guard
// reads that file, and a direct write would lift it without the conversation
// knowing. A failed run drops the pick it was sent for, so the dropdown returns
// to the file's value and the same pick can be applied again.
async function runCommand($: EngineInterface, args: string, owned: Choice) {
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
    await update($, pending, cur => (cur && isSame(cur, owned) ? null : cur))
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mj-orchestrate: could not run ${line} (${reason}); it is in the prompt box, press Enter`)
    await $.prompt.fill({ text: line })
  }
}

// A pick from either dropdown: exactly one command run. The pick is recorded as
// pending in the same write that decides whether it changes anything, so a
// repeated pick before the file updates sends nothing, a pick equal to the mode
// in force sends nothing, and two quick different picks each run once and the
// later one stays shown.
export async function apply($: EngineInterface, state: Orch, value: string) {
  const [level = '', scope = 'build'] = value.split(':')
  if (!LEVELS.includes(level) || !SCOPES.includes(scope)) {
    return
  }
  const choice: Choice = { level, scope: level === 'off' ? 'build' : scope }
  let fire = false
  await update($, pending, cur => {
    fire = !isSame(choice, cur ?? state)
    return fire ? choice : cur
  })
  if (fire) {
    await runCommand($, level === 'off' ? 'off' : `${level} ${scope}`, choice)
  }
}
