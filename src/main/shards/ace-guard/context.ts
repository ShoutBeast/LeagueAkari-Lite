import type { SharedGlobalShard } from '@shared/akari-shard'

import type { AkariIpcMain } from '../ipc'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { AceGuardSettings, AceGuardState } from './state'

export const ACE_GUARD_MAIN_NAMESPACE = 'ace-guard-main'

export interface AceGuardMainContext {
  namespace: string
  state: AceGuardState
  settings: AceGuardSettings
  logger: AkariLogger
  ipc: AkariIpcMain
  mobxUtils: MobxUtilsMain
  shared: SharedGlobalShard
}
