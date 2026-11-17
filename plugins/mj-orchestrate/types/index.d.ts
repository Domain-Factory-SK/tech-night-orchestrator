export type Orch = { level: string; scope: string; isStale: boolean }
export type Choice = { level: string; scope: string }

declare module 'claude-code' {
  interface PluginState {
    'mj-orchestrate': { orch: Orch | null; panel: Orch | null; pending: Choice | null }
  }
}
