import type { AkariIpcRenderer } from '../ipc'
import type { LoggerRenderer } from '../logger'
import type { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import type { SettingUtilsRenderer } from '../setting-utils'

export const CLIENT_INSTALLATION_MAIN_NAMESPACE = 'client-installation-main'
export const CLIENT_INSTALLATION_RENDERER_NAMESPACE = 'client-installation-renderer'

export interface ClientInstallationRendererContext {
  ipc: AkariIpcRenderer
  logger: LoggerRenderer
  piniaMobxUtils: PiniaMobxUtilsRenderer
  setting: SettingUtilsRenderer
}
