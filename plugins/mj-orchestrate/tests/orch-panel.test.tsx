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

test('a level pick runs the namespaced command with level and scope', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|discover`, [
    { name: 'mj-orchestrate:mj-orchestrate' },
  ])

  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.select({ key: 'level', value: 'strict' })
    await ui.unmount()
  }
  expect(seen.runs).toEqual(['/mj-orchestrate:mj-orchestrate strict discover'])
})

test('a scope pick keeps the level', async ($, on) => {
  const seen = world(on, `light|${NOW / 1000}|`, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'scope', value: 'discover' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate light discover'])
})

test('picking off sends off alone', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|discover`, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'off' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate off'])
})

test('with the mode off the scope control is hidden and a level pick uses the stored scope', async ($, on) => {
  const seen = world(on, 'off|0|', [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'scope' })).toBeUndefined()
  await ui.select({ key: 'level', value: 'standard' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate standard build'])
})

test('mobile has no Select: keyed Buttons run the command', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|`, [{ name: 'mj-orchestrate:mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'level-light' })
  await ui.press({ key: 'scope-discover' })
  await ui.press({ key: 'level-off' })
  await ui.press({ key: 'status' })
  await ui.unmount()
  expect(seen.runs).toEqual([
    '/mj-orchestrate:mj-orchestrate light build',
    '/mj-orchestrate:mj-orchestrate light discover',
    '/mj-orchestrate:mj-orchestrate off',
    '/mj-orchestrate:mj-orchestrate status',
  ])
})

test('the Status button runs status', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|`, [{ name: 'mj-orchestrate' }])

  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'status' })
    await ui.unmount()
  }
  expect(seen.runs).toEqual(['/mj-orchestrate status', '/mj-orchestrate status'])
})

test('a pick whose run fails logs and puts the command in the prompt box', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|discover`, [])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'level', value: 'light' })
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
    await ui.select({ key: 'level', value: 'off' })
    await ui.select({ key: 'scope', value: 'build' })
    await ui.press({ key: 'status' })
    await ui.unmount()
  }
  const mobile = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await mobile.press({ key: 'level-off' })
  await mobile.press({ key: 'scope-build' })
  await mobile.press({ key: 'status' })
  await mobile.unmount()
  expect(seen.writes).toEqual([])
})

test('the pane opens on an interactive start and the slash command opens it again', async ($, on) => {
  const seen = world(on, 'off|0|', [])

  await start($)
  expect(seen.opens).toEqual(['mj-orchestrate'])
  expect(seen.registered).toEqual(['mj-orchestrate-panel'])

  const ran = await $.command.run({ command: 'mj-orchestrate-panel' } as never)
  expect(seen.opens).toEqual(['mj-orchestrate', 'mj-orchestrate'])
  expect(ran.text).toMatch(/panel opened/)
})

test('an SDK-hosted start (no surface, not interactive) still opens the pane and fills it', async ($, on) => {
  const seen = world(on, `strict|${NOW / 1000}|discover`, [])

  await $.session.start({ cwd: '/', surface: null, isInteractive: false } as never)
  expect(seen.opens).toEqual(['mj-orchestrate'])
  expect(seen.registered).toEqual(['mj-orchestrate-panel'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /orch strict · 🔍 discover/ })).toBeDefined()
  await ui.unmount()
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
  expect(await band.find({ type: 'Text', text: /orch light · 🔨 build/ })).toBeDefined()
  await band.unmount()
})

test('two quick picks build on each other, and re-picking the shown value sends nothing', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|`, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'level', value: 'strict' })
  await ui.select({ key: 'scope', value: 'discover' })
  await ui.select({ key: 'scope', value: 'discover' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate strict build', '/mj-orchestrate strict discover'])
})

test('re-picking the current level sends nothing', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|`, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'level', value: 'standard' })
  await ui.unmount()
  expect(seen.runs).toEqual([])
})

for (const wait of [61_000, 10 * 60 * 1000]) {
  test(`a pick never expires: a pick ${wait / 1000}s later still builds on it`, async ($, on) => {
    const seen = world(on, `standard|${NOW / 1000}|build`, [{ name: 'mj-orchestrate' }])

    await start($)

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.select({ key: 'scope', value: 'discover' })
    await seen.clock.advance(wait)
    await ui.select({ key: 'level', value: 'strict' })
    await ui.unmount()
    expect(seen.runs).toEqual(['/mj-orchestrate standard discover', '/mj-orchestrate strict discover'])
  })
}

test('a failed run drops its pick, so the same pick runs again', async ($, on) => {
  const seen = world(on, `standard|${NOW / 1000}|build`, [])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'level', value: 'light' })
  await ui.select({ key: 'level', value: 'light' })
  await ui.unmount()
  expect(seen.runs).toEqual([])
  expect(seen.fills).toEqual(['/mj-orchestrate light build', '/mj-orchestrate light build'])
  expect(seen.logs.length).toBe(2)
})

test('once the file shows a pick, the next pick builds on the file', async ($, on) => {
  const file = { v: `standard|${NOW / 1000}|build` }
  const seen = world(on, file, [{ name: 'mj-orchestrate' }])

  await start($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'scope', value: 'discover' })
  file.v = `standard|${NOW / 1000}|discover`
  await seen.clock.advance(3_000)
  file.v = `light|${NOW / 1000}|build`
  await seen.clock.advance(3_000)
  await ui.select({ key: 'level', value: 'strict' })
  await ui.unmount()
  expect(seen.runs).toEqual(['/mj-orchestrate standard discover', '/mj-orchestrate strict build'])
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
