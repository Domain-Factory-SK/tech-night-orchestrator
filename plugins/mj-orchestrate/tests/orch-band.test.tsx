import type { On } from 'claude-code'
import type { RenderPropsOf } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
} as unknown as RenderPropsOf['AbovePrompt']

const NOW = 1_800_000_000_000

const mount = (
  $: { ui: { mount: (a: never) => Promise<any> } },
  surface: 'terminal' | 'desktop' | 'mobile',
) => $.ui.mount({ plugin: 'mj-orchestrate', surface, component: 'AbovePrompt', props } as never)

for (const [file, value, stale] of [
  [`standard|${NOW / 1000}|discover`, 'standard:discover', false],
  ['off|0|', 'off', false],
  [`strict|${NOW / 1000 - 9 * 3600}|`, 'strict:build', true],
] as const) {
  test(`band reads "${file}": the dropdown shows it on terminal and desktop`, async ($, on) => {
    mock.env(on, { HOME: '/home/test' })
    mock.clock(on, { now: NOW })
    on('session.id', () => ({ value: 'sid-1' }))
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: file }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
    on('turn.complete', () => ({ text: '' }) as never)

    await $.turn.complete({ answer: '' } as never)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface)
      expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe(value)
      expect(Boolean(await ui.find({ type: 'Text', text: /stale\?/ }))).toBe(stale)
      expect(await ui.find({ key: 'orch-go' })).toBeUndefined()
      expect(await ui.find({ key: 'orch-panel' })).toBeDefined()
      expect(await ui.find({ key: 'orch-status' })).toBeUndefined()
      await ui.unmount()
    }
  })
}

test('the dropdown holds the seven combined options in order', async ($, on) => {
  bandWorld(on)
  await $.turn.complete({ answer: '' } as never)

  const ui = await mount($, 'desktop')
  const options = (await ui.find({ key: 'orch-mode' }))?.props.options as { value: string; label: string }[]
  expect(options.map(o => o.value)).toEqual([
    'strict:build', 'strict:discover', 'standard:build', 'standard:discover', 'light:build', 'light:discover', 'off',
  ])
  expect(options[2]?.label).toBe('🎛 standard · 🔨 build')
  expect(options[1]?.label).toBe('🎛 strict · 🔍 discover')
  expect(options[6]?.label).toBe('🎛 off')
  await ui.unmount()
})

for (const [file, expected] of [
  [`standard|${NOW / 1000}|discover`, /orch standard · 🔍 discover/],
  ['off|0|', /orch off · 🔨 build/],
  [`strict|${NOW / 1000 - 9 * 3600}|`, /orch strict\? · 🔨 build/],
] as const) {
  test(`the compact fallback (mobile, no Select) reads "${file}", with no Go`, async ($, on) => {
    mock.env(on, { HOME: '/home/test' })
    mock.clock(on, { now: NOW })
    on('session.id', () => ({ value: 'sid-1' }))
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: file }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
    on('turn.complete', () => ({ text: '' }) as never)

    await $.turn.complete({ answer: '' } as never)

    const ui = await mount($, 'mobile')
    expect(await ui.find({ type: 'Text', text: expected })).toBeDefined()
    expect(await ui.find({ key: 'orch-go' })).toBeUndefined()
    expect(await ui.find({ key: 'orch-mode' })).toBeUndefined()
    expect(await ui.find({ key: 'orch-panel' })).toBeDefined()
    await ui.unmount()
  })
}

const bandWorld = (on: On, logs: string[] = [], file: string | { v: string } = `standard|${NOW / 1000}|`) => {
  mock.env(on, { HOME: '/home/test' })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'sid-1' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: typeof file === 'string' ? file : file.v }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.log', (_$, e) => {
    logs.push(String(e.text))
    return { value: undefined } as never
  })
}

const commandsOf = (name: string) => [{ name, description: '', source: 'plugin' }]

test('a pick runs exactly one namespaced command for that pick, and off runs off', async ($, on) => {
  const runs: string[] = []
  bandWorld(on)
  on('command.list', () => ({ value: commandsOf('mj-orchestrate:mj-orchestrate') }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await mount($, 'desktop')
  await ui.select({ key: 'orch-mode', value: 'standard:discover' })
  expect(runs).toEqual(['/mj-orchestrate:mj-orchestrate standard discover'])
  await ui.select({ key: 'orch-mode', value: 'off' })
  await ui.unmount()
  expect(runs).toEqual(['/mj-orchestrate:mj-orchestrate standard discover', '/mj-orchestrate:mj-orchestrate off'])
})

test('a pick runs one command on the terminal too', async ($, on) => {
  const runs: string[] = []
  bandWorld(on)
  on('command.list', () => ({ value: commandsOf('mj-orchestrate') }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await mount($, 'terminal')
  await ui.select({ key: 'orch-mode', value: 'light:discover' })
  await ui.unmount()
  expect(runs).toEqual(['/mj-orchestrate light discover'])
})

test('picking the mode already in force runs nothing, stale or not', async ($, on) => {
  const runs: string[] = []
  bandWorld(on, [], `strict|${NOW / 1000 - 9 * 3600}|build`)
  on('command.list', () => ({ value: commandsOf('mj-orchestrate') }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.turn.complete({ answer: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    await ui.select({ key: 'orch-mode', value: 'strict:build' })
    expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('strict:build')
    await ui.unmount()
  }
  expect(runs).toEqual([])
})

test('there is no Go button in the band, on any surface', async ($, on) => {
  bandWorld(on)
  await $.turn.complete({ answer: '' } as never)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ key: 'orch-go' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'Go' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a pick stays shown while it is pending, and the file catching up settles it', async ($, on) => {
  const file = { v: `standard|${NOW / 1000}|build` }
  const runs: string[] = []
  bandWorld(on, [], file)
  on('command.list', () => ({ value: commandsOf('mj-orchestrate') }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await mount($, 'desktop')
  await ui.select({ key: 'orch-mode', value: 'strict:discover' })
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('strict:discover')
  await $.turn.complete({ answer: '' } as never)
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('strict:discover')
  await ui.select({ key: 'orch-mode', value: 'strict:discover' })
  file.v = `strict|${NOW / 1000}|discover`
  await $.turn.complete({ answer: '' } as never)
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('strict:discover')
  file.v = `light|${NOW / 1000}|build`
  await $.turn.complete({ answer: '' } as never)
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('light:build')
  await ui.unmount()
  expect(runs).toEqual(['/mj-orchestrate strict discover'])
})

test('two quick picks: each runs once and the second is not undone when the first lands', async ($, on) => {
  const file = { v: `standard|${NOW / 1000}|build` }
  const runs: string[] = []
  bandWorld(on, [], file)
  on('command.list', () => ({ value: commandsOf('mj-orchestrate') }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await mount($, 'desktop')
  await ui.select({ key: 'orch-mode', value: 'strict:build' })
  await ui.select({ key: 'orch-mode', value: 'light:discover' })
  file.v = `strict|${NOW / 1000}|build`
  await $.turn.complete({ answer: '' } as never)
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('light:discover')
  file.v = `light|${NOW / 1000}|discover`
  await $.turn.complete({ answer: '' } as never)
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('light:discover')
  await ui.unmount()
  expect(runs).toEqual(['/mj-orchestrate strict build', '/mj-orchestrate light discover'])
})

test('a pick whose run fails puts the command in the prompt box, falls back to the file value, and can be retried', async ($, on) => {
  const fills: string[] = []
  const logs: string[] = []
  bandWorld(on, logs)
  on('command.list', () => ({ value: [] }) as never)
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await mount($, 'desktop')
  await ui.select({ key: 'orch-mode', value: 'light:build' })
  expect((await ui.find({ key: 'orch-mode' }))?.props.value).toBe('standard:build')
  await ui.select({ key: 'orch-mode', value: 'light:build' })
  await ui.unmount()
  expect(fills).toEqual(['/mj-orchestrate light build', '/mj-orchestrate light build'])
  expect(logs.length).toBe(2)
})

test('band and pane share one pending pick, and one pane pick is one run', async ($, on) => {
  const runs: string[] = []
  bandWorld(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: String(e.name) } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.list', () => ({ value: commandsOf('mj-orchestrate') }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)

  const band = await mount($, 'desktop')
  const pane = await $.ui.mount({
    plugin: 'mj-orchestrate',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'mj-orchestrate',
    props: { title: '', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as never,
  })
  await band.select({ key: 'orch-mode', value: 'strict:discover' })
  expect((await pane.find({ key: 'mode' }))?.props.value).toBe('strict:discover')
  await pane.select({ key: 'mode', value: 'off' })
  expect((await band.find({ key: 'orch-mode' }))?.props.value).toBe('off')
  await band.select({ key: 'orch-mode', value: 'off' })
  expect(runs).toEqual(['/mj-orchestrate strict discover', '/mj-orchestrate off'])
  await band.unmount()
  await pane.unmount()
})

test('pressing the panel button opens the pane and runs nothing', async ($, on) => {
  const opens: string[] = []
  const runs: string[] = []
  const fills: string[] = []
  const logs: string[] = []
  bandWorld(on, logs)
  on('ui.open', (_$, e) => {
    opens.push(String(e.id))
    return { value: { isPlaced: true } }
  })
  on('command.list', () => ({ value: [{ name: 'mj-orchestrate', description: '', source: 'plugin' }] }) as never)
  on('command.run', (_$, e) => {
    runs.push(String(e.command))
    return { text: '' } as never
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true } as never
  })

  await $.turn.complete({ answer: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mj-orchestrate', surface, component: 'AbovePrompt', props })
    await ui.press({ key: 'orch-panel' })
    await ui.unmount()
  }
  expect(opens).toEqual(['mj-orchestrate', 'mj-orchestrate'])
  expect(runs).toEqual([])
  expect(fills).toEqual([])
  expect(logs).toEqual([])
})

test('a panel that is not drawn is logged, never typed into the prompt', async ($, on) => {
  const logs: string[] = []
  const runs: string[] = []
  const fills: string[] = []
  bandWorld(on, logs)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface places panes' } }))
  on('command.run', (_$, e) => {
    runs.push(String(e.command))
    return { text: '' } as never
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await $.ui.mount({ plugin: 'mj-orchestrate', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'orch-panel' })
  await ui.unmount()
  expect(logs).toEqual(['mj-orchestrate: the panel is open but not drawn (no surface places panes)'])
  expect(runs).toEqual([])
  expect(fills).toEqual([])
})

test('an open that throws is logged, never typed into the prompt', async ($, on) => {
  const logs: string[] = []
  const fills: string[] = []
  bandWorld(on, logs)
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await $.ui.mount({ plugin: 'mj-orchestrate', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'orch-panel' })
  await ui.unmount()
  expect(logs).toEqual(['mj-orchestrate: could not open the panel (no implementation for ui.open)'])
  expect(fills).toEqual([])
})
