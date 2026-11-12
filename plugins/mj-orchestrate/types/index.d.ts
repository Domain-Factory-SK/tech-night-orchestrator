export type Orch = { level: string; scope: string; isStale: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mj-orchestrate': { orch: Orch | null; panel: Orch | null }
  }
}
