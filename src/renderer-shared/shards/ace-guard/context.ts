import type { AkariIpcRenderer } from '../ipc'
import type { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'

export const ACE_GUARD_MAIN_NAMESPACE = 'ace-guard-main'
export const ACE_GUARD_RENDERER_NAMESPACE = 'ace-guard-renderer'

export interface AceGuardRendererContext {
  ipc: AkariIpcRenderer
  piniaMobxUtils: PiniaMobxUtilsRenderer
}
