import type { On } from 'claude-code'
import type { RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const props = {
  title: '🎛 Orchestrator',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as unknown as RenderPropsOf['Pane']

const PANE = {
  plugin: 'mj-orchestrate',
  component: 'Pane',
  requestId: 'mj-orchestrate',
  props,
} as const

const NOW = 1_800_000_000_000

let registerFails = false

const start = ($: { session: { start: (a: never) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)

type Clock = ReturnType<typeof mock.clock>
type World = { runs: string[]; fills: string[]; writes: string[]; reads: string[]; logs: string[]; opens: string[]; registered: string[]; clock: Clock }

const world = (on: On, source: string | { v: string }, commands: { name: string }[], isSession = true): World => {
  const seen = { runs: [], fills: [], writes: [], reads: [], logs: [], opens: [], registered: [] } as unknown as World
  mock.env(on, { HOME: '/home/test' })
  seen.clock = mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'sid-1' }))
  on('fs.exists', (_$, e) => ({ value: isSession && String(e.path).endsWith('.sid-1') }))
  on('fs.read', (_$, e) => {
    seen.reads.push(String(e.path))
    return { value: typeof source === 'string' ? source : source.v }
  })
  on('fs.write', (_$, e) => {
    seen.writes.push(String(e.path))
    return { value: undefined } as never
  })
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    if (registerFails) {
      throw new Error('register refused')
    }
    seen.registered.push(String(e.name))
    return { value: { command: String(e.name) } }
  })
  on('ui.open', (_$, e) => {
    seen.opens.push(String(e.id))
    return { value: { isPlaced: true } }
  })
  on('ui.log', (_$, e) => {
    seen.logs.push(String(e.text))
    return { value: undefined } as never
  })
  on('command.list', () => ({ value: commands.map(c => ({ ...c, description: '', source: 'plugin' })) }) as never)
  on('command.run', (_$, e) => {
    seen.runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })
  on('prompt.fill', (_$, e) => {
    seen.fills.push(e.text)
    return { isFilled: true } as never
  })
  return seen
}

for (const [file, expected] of [
  [`standard|${NOW / 1000}|discover`, /orch standard · 🔍 discover/],
  ['off|0|', /orch off · 🔨 build/],
  [`strict|${NOW / 1000 - 9 * 3600}|`, /orch strict\? · 🔨 build/],
] as const) {
  test(`pane reads "${file}", on every surface`, async ($, on) => {
    const seen = world(on, file, [], false)

    await start($)

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: expected })).toBeDefined()
      await ui.unmount()
    }
    expect(seen.reads).toContain('/home/test/.claude/.orchestrator-mode.global')
  })
}

test('the session file wins over the global one', async ($, on) => {
  const seen = world(on, `light|${NOW / 1000}|`, [])

  await start($)

  expect([...new Set(seen.reads)]).toEqual(['/home/test/.claude/.orchestrator-mode.sid-1'])
})

const valueOf = async (ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, key: string) =>
  (await ui.find({ key }))?.props.value

const ORDER = [
  'strict:build', 'strict:discover', 'standard:build', 'standard:discover', 'light:build', 'light:discover', 'off',
]

test('the pane has the one combined Select with the seven options in order, and no Level, Scope or Go', async ($, on) => {
  world(on, `standard|${NOW / 1000}|discover`, [])

  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const select = await ui.find({ key: 'mode' })
    const options = select?.props.options as { value: string; label: string }[]
    expect(options.map(o => o.value)).toEqual(ORDER)
    expect(options[3]?.label).toBe('🎛 standard · 🔍 discover')
    expect(options[6]?.label).toBe('🎛 off')
    expect(select?.props.value).toBe('standard:discover')
    expect(await ui.find({ key: 'level' })).toBeUndefined()
    expect(await ui.find({ key: 'scope' })).toBeUndefined()
    expect(await ui.find({ key: 'go' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'Go' })).toBeUndefined()
    await ui.unmount()
  }
})

test('one pick in the pane is one namespaced command run', async ($, on) => {
  const seen = world(on, `strict|${NOW / 1000}|build`, [{ name: 'mj-orchestrate:mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'standard:discover' })
  expect(seen.runs).toEqual(['/mj-orchestrate:mj-orchestrate standard discover'])
  await ui.select({ key: 'mode', value: 'off' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate:mj-orchestrate standard discover', '/mj-orchestrate:mj-orchestrate off'])
})

test('a pick on the terminal runs the same single command', async ($, on) => {
  const seen = world(on, `light|${NOW / 1000}|build`, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'mode', value: 'light:discover' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate light discover'])
})

test('picking the mode in force runs nothing, stale or not', async ($, on) => {
  const seen = world(on, `strict|${NOW / 1000 - 9 * 3600}|build`, [{ name: 'mj-orchestrate' }])

  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'mode', value: 'strict:build' })
    await ui.unmount()
  }
  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await mobile.press({ key: 'mode-strict:build' })
  await mobile.unmount()
  expect(seen.runs).toEqual([])
})

test('mobile has no Select: seven Buttons apply on press, the current one primary', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|`, [{ name: 'mj-orchestrate:mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: 'mode' })).toBeUndefined()
  for (const value of ORDER) {
    expect(await ui.find({ key: `mode-${value}` })).toBeDefined()
  }
  expect(await ui.find({ key: 'mode-standard:build' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'mode-light:discover' })).toMatchObject({ props: { variant: 'secondary' } })
  await ui.press({ key: 'mode-light:discover' })
  expect(seen.runs).toEqual(['/mj-orchestrate:mj-orchestrate light discover'])
  expect(await ui.find({ key: 'mode-light:discover' })).toMatchObject({ props: { variant: 'primary' } })
  expect(await ui.find({ key: 'mode-standard:build' })).toMatchObject({ props: { variant: 'secondary' } })
  await ui.press({ key: 'mode-off' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate:mj-orchestrate light discover', '/mj-orchestrate:mj-orchestrate off'])
})

test('a restart drops a pending pick', async ($, on) => {
  const file = { v: `standard|${NOW / 1000}|build` }
  world(on, file, [{ name: 'mj-orchestrate' }])

  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'strict:build' })
  expect(await valueOf(ui, 'mode')).toBe('strict:build')
  await start($)
  expect(await valueOf(ui, 'mode')).toBe('standard:build')
  await ui.unmount()
})

test('there is no Status button on any surface', async ($, on) => {
  world(on, `standard|${NOW / 1000}|`, [])

  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'status' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'Status' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a pick whose run fails logs, fills the prompt box and returns to the file value', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|discover`, [])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'light:discover' })
  expect(await valueOf(ui, 'mode')).toBe('standard:discover')
  await ui.unmount()
  expect(seen.runs).toEqual([])
  expect(seen.fills).toEqual(['/mj-orchestrate light discover'])
  expect(seen.logs.length).toBe(1)
})

test('the module never writes the mode file', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|discover`, [{ name: 'mj-orchestrate' }])

  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'mode', value: 'off' })
    await ui.select({ key: 'mode', value: 'strict:build' })
    await ui.unmount()
  }
  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await mobile.press({ key: 'mode-off' })
  await mobile.unmount()
  expect(seen.writes).toEqual([])
})

test('the pane does not open on an interactive start; the slash command opens it, once per run', async ($, on) => {
  const seen = world(on, 'off|0|', [])

  await start($)
  expect(seen.opens).toEqual([])
  expect(seen.registered).toEqual(['mj-orchestrate-panel'])

  const ran = await $.command.run({ command: 'mj-orchestrate-panel' } as never)
  expect(seen.opens).toEqual(['mj-orchestrate'])
  expect(ran.text).toMatch(/panel opened/)
})

test('an SDK-hosted start (no surface, not interactive) does not open the pane, which still fills once mounted', async ($, on) => {
  const seen = world(on, `strict|${NOW / 1000}|discover`, [])

  await $.session.start({ cwd: '/', surface: null, isInteractive: false } as never)
  expect(seen.opens).toEqual([])
  expect(seen.registered).toEqual(['mj-orchestrate-panel'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /orch strict · 🔍 discover/ })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'mj-orchestrate-panel' } as never)
  expect(seen.opens).toEqual(['mj-orchestrate'])
})

test('a failing panel start does not stop the band from refreshing', async ($, on) => {
  world(on, `light|${NOW / 1000}|`, [])
  registerFails = true
  try {
    await start($)
  } finally {
    registerFails = false
  }

  const band = await $.ui.mount({
    plugin: 'mj-orchestrate',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never,
  })
  expect((await band.find({ key: 'orch-mode' }))?.props.value).toBe('light:build')
  await band.unmount()
})

test('a repeated pick before the file changes sends nothing, on the Select and the mobile Buttons', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|`, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'strict:discover' })
  await ui.select({ key: 'mode', value: 'strict:discover' })
  await ui.unmount()
  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await mobile.press({ key: 'mode-strict:discover' })
  await mobile.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate strict discover'])
})

test('a pending pick never expires: it is shown minutes later until the file reflects it', async ($, on) => {
  const file = { v: `standard|${NOW / 1000}|build` }
  const seen = world(on, file, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'strict:discover' })
  await seen.clock.advance(10 * 60 * 1000)
  expect(await valueOf(ui, 'mode')).toBe('strict:discover')
  file.v = `strict|${NOW / 1000}|discover`
  await seen.clock.advance(3_000)
  file.v = `light|${NOW / 1000}|build`
  await seen.clock.advance(3_000)
  expect(await valueOf(ui, 'mode')).toBe('light:build')
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate strict discover'])
})

test('two quick picks: the second is not undone when the first lands, and each runs once', async ($, on) => {
  const file = { v: `standard|${NOW / 1000}|build` }
  const seen = world(on, file, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'strict:build' })
  await ui.select({ key: 'mode', value: 'light:discover' })
  file.v = `strict|${NOW / 1000}|build`
  await seen.clock.advance(3_000)
  expect(await valueOf(ui, 'mode')).toBe('light:discover')
  file.v = `light|${NOW / 1000}|discover`
  await seen.clock.advance(3_000)
  expect(await valueOf(ui, 'mode')).toBe('light:discover')
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate strict build', '/mj-orchestrate light discover'])
})

test('a failed pick can be retried: the same pick runs the command again', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|build`, [])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mode', value: 'light:build' })
  await ui.select({ key: 'mode', value: 'light:build' })
  await ui.unmount()
  expect(seen.runs).toEqual([])
  expect(seen.fills).toEqual(['/mj-orchestrate light build', '/mj-orchestrate light build'])
  expect(seen.logs.length).toBe(2)
})

test('every surface ends with the reopen hint', async ($, on) => {
  world(on, `standard|${NOW / 1000}|`, [])

  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Closed it? Click ▣ in the band, or type /mj-orchestrate-panel' })).toBeDefined()
    await ui.unmount()
  }
})

test('the header carries an Svg dial where the surface has one, and the emoji where it has not', async ($, on) => {
  world(on, `standard|${NOW / 1000}|`, [])

  await start($)

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /orch standard/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /🎛/ })).toBeUndefined()
    await ui.unmount()
  }
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /🎛 orch standard/ })).toBeDefined()
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  await terminal.unmount()
})
