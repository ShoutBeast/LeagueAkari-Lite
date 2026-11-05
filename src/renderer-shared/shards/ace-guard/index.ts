import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import {
  ACE_GUARD_MAIN_NAMESPACE,
  ACE_GUARD_RENDERER_NAMESPACE,
  type AceGuardRendererContext
} from './context'
import { type AceGuardProfile, useAceGuardStore } from './store'

@Shard(AceGuardRenderer.id)
export class AceGuardRenderer implements IAkariShardInitDispose {
  static id = ACE_GUARD_RENDERER_NAMESPACE

  private readonly _context: AceGuardRendererContext

  constructor(
    @Dep(AkariIpcRenderer) ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer
  ) {
    this._context = { ipc, piniaMobxUtils }
  }

  async onInit() {
    const store = useAceGuardStore()

    await this._context.piniaMobxUtils.sync(ACE_GUARD_MAIN_NAMESPACE, 'state', store)
    await this._context.piniaMobxUtils.sync(ACE_GUARD_MAIN_NAMESPACE, 'settings', store.settings)
  }

  setEnabled(enabled: boolean) {
    return this._context.ipc.call(ACE_GUARD_MAIN_NAMESPACE, 'setEnabled', enabled)
  }

  setProfile(profile: AceGuardProfile) {
    return this._context.ipc.call(ACE_GUARD_MAIN_NAMESPACE, 'setProfile', profile)
  }

  setWriteIfeo(writeIfeo: boolean) {
    return this._context.ipc.call(ACE_GUARD_MAIN_NAMESPACE, 'setWriteIfeo', writeIfeo)
  }

  setTargets(targets: string[]) {
    return this._context.ipc.call(ACE_GUARD_MAIN_NAMESPACE, 'setTargets', targets)
  }

  scanNow() {
    return this._context.ipc.call(ACE_GUARD_MAIN_NAMESPACE, 'scanNow')
  }
}
