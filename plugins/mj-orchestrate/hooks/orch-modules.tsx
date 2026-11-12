import type { Register } from 'claude-code'

import { register as band } from './orch-band'
import { register as panel } from './orch-panel'

export const register: Register = (on, options) => {
  band(on, options)
  panel(on, options)
}
