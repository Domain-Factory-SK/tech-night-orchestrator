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

for (const [file, expected] of [
  [`standard|${NOW / 1000}|discover`, /orch standard · 🔍 discover/],
  ['off|0|', /orch off · 🔨 build/],
  [`strict|${NOW / 1000 - 9 * 3600}|`, /orch strict\? · 🔨 build/],
] as const) {
  test(`band reads "${file}"`, async ($, on) => {
    mock.env(on, { HOME: '/home/test' })
    mock.clock(on, { now: NOW })
    on('session.id', () => ({ value: 'sid-1' }))
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: file }))
    on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
    on('turn.complete', () => ({ text: '' }) as never)

    await $.turn.complete({ answer: '' } as never)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mj-orchestrate', surface, component: 'AbovePrompt', props })
      expect(await ui.find({ type: 'Text', text: expected })).toBeDefined()
      await ui.unmount()
    }
  })
}

const bandWorld = (on: On, logs: string[] = []) => {
  mock.env(on, { HOME: '/home/test' })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'sid-1' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: `standard|${NOW / 1000}|` }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.log', (_$, e) => {
    logs.push(String(e.text))
    return { value: undefined } as never
  })
}

test('pressing the band runs the namespaced mj-orchestrate status command', async ($, on) => {
  const runs: string[] = []
  bandWorld(on)
  on('command.list', () => ({ value: [{ name: 'mj-orchestrate:mj-orchestrate', description: '', source: 'plugin' }] }) as never)
  on('command.run', (_$, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' } as never
  })

  await $.turn.complete({ answer: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mj-orchestrate', surface, component: 'AbovePrompt', props })
    await ui.press({ key: 'orch-status' })
    await ui.unmount()
  }
  expect(runs).toEqual(['/mj-orchestrate:mj-orchestrate status', '/mj-orchestrate:mj-orchestrate status'])
})

test('a press whose run fails puts the command in the prompt box', async ($, on) => {
  const fills: string[] = []
  bandWorld(on)
  on('command.list', () => ({ value: [] }) as never)
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true } as never
  })

  await $.turn.complete({ answer: '' } as never)

  const ui = await $.ui.mount({ plugin: 'mj-orchestrate', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'orch-status' })
  await ui.unmount()
  expect(fills).toEqual(['/mj-orchestrate status'])
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
