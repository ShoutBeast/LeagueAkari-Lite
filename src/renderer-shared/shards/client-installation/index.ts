import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'

import { AkariIpcRenderer } from '../ipc'
import { LoggerRenderer } from '../logger'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import {
  CLIENT_INSTALLATION_MAIN_NAMESPACE,
  CLIENT_INSTALLATION_RENDERER_NAMESPACE,
  type ClientInstallationRendererContext
} from './context'
import { ClientInstallationLauncherService } from './launcher-service'
import { syncClientInstallationState } from './state-sync'

@Shard(ClientInstallationRenderer.id)
export class ClientInstallationRenderer implements IAkariShardInitDispose {
  static id = CLIENT_INSTALLATION_RENDERER_NAMESPACE

  private readonly _context: ClientInstallationRendererContext
  private readonly _launcherService: ClientInstallationLauncherService

  constructor(
    @Dep(AkariIpcRenderer) ipc: AkariIpcRenderer,
    @Dep(LoggerRenderer) logger: LoggerRenderer,
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) setting: SettingUtilsRenderer
  ) {
    this._context = {
      ipc,
      logger,
      piniaMobxUtils,
      setting
    }
    this._launcherService = new ClientInstallationLauncherService(this._context)
  }

  async onInit() {
    await syncClientInstallationState(this._context)
  }

  launchTencentTcls() {
    return this._launcherService.launchTencentTcls()
  }

  launchWeGameLeagueOfLegends() {
    return this._launcherService.launchWeGameLeagueOfLegends()
  }

  launchWeGame() {
    return this._launcherService.launchWeGame()
  }

  launchDefaultRiotClient() {
    return this._launcherService.launchDefaultRiotClient()
  }

  pickCustomInstallationPath(mode: 'directory' | 'executable') {
    return this._context.ipc.call(
      CLIENT_INSTALLATION_MAIN_NAMESPACE,
      'pickCustomInstallationPath',
      mode
    )
  }

  setCustomTencentInstallationPath(value: string) {
    return this._context.setting.set(
      CLIENT_INSTALLATION_MAIN_NAMESPACE,
      'customTencentInstallationPath',
      value
    )
  }
}
