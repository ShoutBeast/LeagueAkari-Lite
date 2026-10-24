import { dialog } from 'electron'

import type { ClientInstallationLauncher } from './client-launcher'
import type { ClientInstallationMainContext } from './context'

export type CustomInstallationPickerMode = 'directory' | 'executable'

export class ClientInstallationIpcHandlers {
  constructor(
    private readonly _context: ClientInstallationMainContext,
    private readonly _launcher: ClientInstallationLauncher
  ) {}

  register() {
    this._context.ipc.onCall(this._context.namespace, 'launchTencentTcls', async () => {
      await this._launcher.launchTencentTcls()
    })

    this._context.ipc.onCall(this._context.namespace, 'launchWeGame', async () => {
      await this._launcher.launchWeGame()
    })

    this._context.ipc.onCall(this._context.namespace, 'launchDefaultRiotClient', async () => {
      await this._launcher.launchDefaultRiotClient()
    })

    this._context.ipc.onCall(this._context.namespace, 'launchWeGameLeagueOfLegends', async () => {
      await this._launcher.launchWeGameLeagueOfLegends()
    })

    this._context.ipc.onCall(
      this._context.namespace,
      'pickCustomInstallationPath',
      async (_, mode: CustomInstallationPickerMode) => {
        const result = await dialog.showOpenDialog({
          properties: mode === 'directory' ? ['openDirectory'] : ['openFile'],
          filters: mode === 'executable' ? [{ name: 'Client.exe', extensions: ['exe'] }] : undefined
        })

        if (result.canceled || result.filePaths.length === 0) {
          return null
        }

        return result.filePaths[0]
      }
    )
  }
}
