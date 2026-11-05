import { getProcessControl, isElevated, isProcessControlAvailable } from '@main/native'
import { IAkariShardInitDispose, Shard, SharedGlobalShard } from '@shared/akari-shard'
import type {
  NativeIfeoValues,
  NativeProcessSnapshot,
  NativeRestrictionRequest,
  NativeRestrictionResult
} from 'league-akari-native-win32/process'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { ACE_GUARD_MAIN_NAMESPACE, type AceGuardMainContext } from './context'
import {
  ACE_PROFILES,
  type AceGuardProfile,
  AceGuardSettings,
  AceGuardState,
  type AceLimitReport,
  type AceLimitState,
  type AceProcessReport,
  DEFAULT_ACE_PROCESS_NAMES
} from './state'

/** IDLE_PRIORITY_CLASS */
const IDLE_PRIORITY_CLASS = 0x40

/** BELOW_NORMAL_PRIORITY_CLASS */
const BELOW_NORMAL_PRIORITY_CLASS = 0x4000

const NORMAL_PRIORITY_CLASS = 0x20

/** ERROR_ALREADY_IN_JOB: 进程已被其它 Job 托管, 无法再叠加限制 */
const ERROR_ALREADY_IN_JOB = 298

const SCAN_INTERVAL_MS = 1000
const READBACK_DELAY_MS = 1000
const RECHECK_INTERVAL_MS = 5000

/** Job Object 的 CPU 硬上限, 单位为 0.01%, 10000 表示不限 */
const JOB_CPU_RATE_UNLIMITED = 10000

const PROFILE_JOB_CPU_RATE: Record<AceGuardProfile, number> = {
  conservative: JOB_CPU_RATE_UNLIMITED,
  standard: 500,
  aggressive: 300
}

interface AppliedRecord {
  pid: number
  exeName: string
  requested: NativeRestrictionRequest
  result: NativeRestrictionResult
  jobCode: number
  appliedAt: number
  verifiedAt: number | null
  report: AceProcessReport
}

function pendingReport(pid: number, exeName: string): AceProcessReport {
  return {
    pid,
    exeName,
    limits: {
      priority: 'pending',
      cpuSets: 'pending',
      ecoQos: 'pending',
      memoryPriority: 'pending',
      ioPriority: 'pending',
      pagePriority: 'pending',
      job: 'pending'
    },
    detail: null
  }
}

function emptyLimits(): AceLimitReport {
  return {
    priority: 'skipped',
    cpuSets: 'skipped',
    ecoQos: 'skipped',
    memoryPriority: 'skipped',
    ioPriority: 'skipped',
    pagePriority: 'skipped',
    job: 'skipped'
  }
}

function judge(code: number, matched: boolean): AceLimitState {
  if (code !== 0) {
    return 'denied'
  }

  return matched ? 'applied' : 'reverted'
}

/**
 * ACE 进程资源限制。
 *
 * 只调整目标进程的调度资源分配 (优先级、CPU Sets、EcoQoS、内存/IO/页优先级、Job 配额),
 * 不终止、不挂起、不注入, 也不触碰游戏本体与驱动。
 */
@Shard(AceGuardMain.id)
export class AceGuardMain implements IAkariShardInitDispose {
  static id = ACE_GUARD_MAIN_NAMESPACE

  static readonly DEFAULT_TARGETS = DEFAULT_ACE_PROCESS_NAMES
  static readonly PROFILES = ACE_PROFILES

  public readonly state = new AceGuardState()
  public readonly settings = new AceGuardSettings()

  private readonly _logger: AkariLogger
  private readonly _context: AceGuardMainContext
  private readonly _settingService: SetterSettingService<AceGuardSettings>

  private _timer: NodeJS.Timeout | null = null
  private readonly _applied = new Map<number, AppliedRecord>()
  private readonly _ifeoBackup = new Map<string, NativeIfeoValues>()

  constructor(
    _loggerFactory: LoggerFactoryMain,
    private readonly _ipc: AkariIpcMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _settingFactory: SettingFactoryMain,
    private readonly _shared: SharedGlobalShard
  ) {
    this._logger = _loggerFactory.create(AceGuardMain.id)
    this._context = {
      namespace: AceGuardMain.id,
      state: this.state,
      settings: this.settings,
      logger: this._logger,
      ipc: this._ipc,
      mobxUtils: this._mobxUtils,
      shared: this._shared
    }

    this._settingService = this._settingFactory.register(
      AceGuardMain.id,
      {
        enabled: { default: this.settings.enabled, schema: z.boolean() },
        profile: {
          default: this.settings.profile,
          schema: z.enum(['conservative', 'standard', 'aggressive'])
        },
        targets: { default: this.settings.targets, schema: z.array(z.string()) },
        writeIfeo: { default: this.settings.writeIfeo, schema: z.boolean() }
      },
      this.settings
    )
  }

  private _refreshAvailability() {
    this.state.setElevated(isElevated)
    this.state.setAvailable(process.platform === 'win32' && isProcessControlAvailable())

    if (this.state.available) {
      try {
        const topology = getProcessControl().getSystemCpuSets()
        this.state.setCpuSets({
          available: topology.available,
          hybrid: topology.hybrid,
          efficiencyCores: topology.efficiencyCores,
          performanceCores: topology.performanceCores
        })
      } catch (error) {
        this._logger.warn('Failed to query CPU set topology', error)
        this.state.setCpuSets(null)
      }
    }
  }

  private _buildRequest(profile: AceGuardProfile, cpuSetIds: number[]): NativeRestrictionRequest {
    const request: NativeRestrictionRequest = {
      priorityClass: profile === 'conservative' ? BELOW_NORMAL_PRIORITY_CLASS : IDLE_PRIORITY_CLASS
    }

    if (cpuSetIds.length > 0) {
      request.cpuSetIds = cpuSetIds
    }

    if (profile !== 'conservative') {
      request.ecoQos = true
      request.memoryPriority = 1
      request.ioPriority = 0
      request.pagePriority = 1
    }

    return request
  }

  private _verify(record: AppliedRecord, snapshot: NativeProcessSnapshot): AceProcessReport {
    const { requested, result, jobCode } = record
    const limits = emptyLimits()
    const details: string[] = []

    if (requested.priorityClass !== undefined) {
      limits.priority = judge(
        result.priorityClass,
        snapshot.priorityClass === requested.priorityClass
      )
      if (result.priorityClass !== 0) {
        details.push(`priority=${result.priorityClass}`)
      }
    }

    if (requested.cpuSetIds && requested.cpuSetIds.length > 0) {
      // 句柄级读取 default CPU Sets 需要额外接口, 此处以调用结果为准
      limits.cpuSets = result.cpuSets === 0 ? 'applied' : 'denied'
      if (result.cpuSets !== 0) {
        details.push(`cpuSets=${result.cpuSets}`)
      }
    }

    if (requested.ecoQos !== undefined) {
      limits.ecoQos = judge(
        result.ecoQos,
        snapshot.ecoQos === null ? true : snapshot.ecoQos === requested.ecoQos
      )
      if (result.ecoQos !== 0) {
        details.push(`ecoQos=${result.ecoQos}`)
      }
    }

    if (requested.memoryPriority !== undefined) {
      limits.memoryPriority = judge(
        result.memoryPriority,
        snapshot.memoryPriority === requested.memoryPriority
      )
      if (result.memoryPriority !== 0) {
        details.push(`memoryPriority=${result.memoryPriority}`)
      }
    }

    if (requested.ioPriority !== undefined) {
      limits.ioPriority = judge(result.ioPriority, snapshot.ioPriority === requested.ioPriority)
      if (result.ioPriority !== 0) {
        details.push(`ioPriority=${result.ioPriority}`)
      }
    }

    if (requested.pagePriority !== undefined) {
      limits.pagePriority = judge(
        result.pagePriority,
        snapshot.pagePriority === requested.pagePriority
      )
      if (result.pagePriority !== 0) {
        details.push(`pagePriority=${result.pagePriority}`)
      }
    }

    if (jobCode !== -1) {
      if (jobCode === 0) {
        limits.job = snapshot.inJob === true ? 'applied' : 'reverted'
      } else if (jobCode === ERROR_ALREADY_IN_JOB) {
        // 受保护进程可能被其它 Job 托管, 这类情况下无法再叠加 CPU 上限
        limits.job = 'blocked'
        details.push('job=already-in-job')
      } else {
        limits.job = 'denied'
        details.push(`job=${jobCode}`)
      }
    }

    return {
      pid: record.pid,
      exeName: record.exeName,
      limits,
      detail: details.length > 0 ? details.join(', ') : null
    }
  }

  private _applyJobProfile() {
    if (!this.state.available) {
      return
    }

    const cpuRate = PROFILE_JOB_CPU_RATE[this.settings.profile]
    const idlePriority = this.settings.profile !== 'conservative'
    const code = getProcessControl().configureJobObject(cpuRate, idlePriority)

    if (code !== 0) {
      this._logger.warn('Failed to configure job object', { code })
      this.state.setLastError(`job=${code}`)
      this.state.setJobConfigured(false)
      return
    }

    this.state.setJobConfigured(cpuRate !== JOB_CPU_RATE_UNLIMITED)
  }

  private _usesJob() {
    return PROFILE_JOB_CPU_RATE[this.settings.profile] !== JOB_CPU_RATE_UNLIMITED
  }

  private _applyIfeo() {
    if (!this.state.available) {
      return
    }

    const pc = getProcessControl()
    const applied: string[] = []

    for (const exeName of this.settings.targets) {
      if (!this._ifeoBackup.has(exeName)) {
        const original = pc.getIfeoPerfOptions(exeName)
        this._ifeoBackup.set(exeName, original ?? { cpu: null, io: null, page: null })
      }

      // Idle 优先级 + 最低 I/O 与页优先级, 只对之后创建的进程生效
      const code = pc.setIfeoPerfOptions(exeName, { cpu: 1, io: 0, page: 1 })
      if (code === 0) {
        applied.push(exeName)
      } else {
        this._logger.warn('Failed to write IFEO PerfOptions', { exeName, code })
        this.state.setLastError(`ifeo:${exeName}=${code}`)
      }
    }

    this.state.setIfeoApplied(applied)
  }

  private _restoreIfeo() {
    if (this._ifeoBackup.size === 0) {
      return
    }

    const pc = getProcessControl()

    for (const [exeName, original] of this._ifeoBackup) {
      const code = pc.restoreIfeoPerfOptions(exeName, original)
      if (code !== 0) {
        this._logger.warn('Failed to restore IFEO PerfOptions', { exeName, code })
      }
    }

    this._ifeoBackup.clear()
    this.state.setIfeoApplied([])
  }

  private _scan() {
    if (!this.state.available || this.state.scanning) {
      return
    }

    this.state.setScanning(true)

    try {
      const pc = getProcessControl()
      const now = Date.now()
      const targets = this.settings.targets.filter((name) => name.trim().length > 0)
      const cpuSetIds =
        this.state.cpuSets?.hybrid === true ? this.state.cpuSets.efficiencyCores : []

      const live = new Map<number, string>()
      for (const entry of pc.enumerateProcesses(targets)) {
        live.set(entry.pid, entry.exeName)
      }

      for (const pid of [...this._applied.keys()]) {
        if (!live.has(pid)) {
          this._applied.delete(pid)
        }
      }

      for (const [pid, exeName] of live) {
        let record = this._applied.get(pid)

        if (!record) {
          const requested = this._buildRequest(this.settings.profile, cpuSetIds)
          const result = pc.applyProcessRestrictions(pid, requested)
          const jobCode = this._usesJob() ? pc.assignProcessToJob(pid) : -1

          record = {
            pid,
            exeName,
            requested,
            result,
            jobCode,
            appliedAt: now,
            verifiedAt: null,
            report: pendingReport(pid, exeName)
          }

          this._applied.set(pid, record)
          continue
        }

        const needsVerify =
          record.verifiedAt === null || now - record.verifiedAt >= RECHECK_INTERVAL_MS
        if (!needsVerify || now - record.appliedAt < READBACK_DELAY_MS) {
          continue
        }

        record.report = this._verify(record, pc.snapshotProcess(pid))
        record.verifiedAt = now
      }

      this.state.setProcesses([...this._applied.values()].map((record) => record.report))
      this.state.setLastScanAt(now)
    } catch (error) {
      this._logger.warn('ACE guard scan failed', error)
      this.state.setLastError(String(error))
    } finally {
      this.state.setScanning(false)
    }
  }

  private _start() {
    if (!this.state.available) {
      return
    }

    this._stop()
    this._applyJobProfile()

    if (this.settings.writeIfeo) {
      this._applyIfeo()
    }

    this._scan()
    this._timer = setInterval(() => this._scan(), SCAN_INTERVAL_MS)
  }

  private _stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  /**
   * 撤销全部实际改动: Job 放开、IFEO 还原、目标进程优先级恢复默认。
   */
  private _rollback() {
    this._stop()

    const pids = [...this._applied.keys()]
    this._applied.clear()
    this.state.setProcesses([])
    this.state.setLastScanAt(null)

    if (!this.state.available) {
      return
    }

    try {
      const pc = getProcessControl()

      for (const pid of pids) {
        pc.applyProcessRestrictions(pid, { priorityClass: NORMAL_PRIORITY_CLASS })
      }

      pc.configureJobObject(JOB_CPU_RATE_UNLIMITED, false)
      this.state.setJobConfigured(false)

      this._restoreIfeo()
    } catch (error) {
      this._logger.warn('Failed to roll back ACE restrictions', error)
    }

    this.state.setLastError(null)
  }

  private _registerIpc() {
    this._ipc.onCall(this._context.namespace, 'setEnabled', async (_, enabled: boolean) => {
      await this._settingService.set('enabled', enabled)
    })

    this._ipc.onCall(this._context.namespace, 'setProfile', async (_, profile: AceGuardProfile) => {
      await this._settingService.set('profile', profile)
    })

    this._ipc.onCall(this._context.namespace, 'setWriteIfeo', async (_, writeIfeo: boolean) => {
      await this._settingService.set('writeIfeo', writeIfeo)
    })

    this._ipc.onCall(this._context.namespace, 'setTargets', async (_, targets: string[]) => {
      await this._settingService.set('targets', targets)
    })

    this._ipc.onCall(this._context.namespace, 'scanNow', () => {
      this._applied.clear()
      this._scan()
    })
  }

  private _watchSettings() {
    this._context.mobxUtils.reaction(
      () => [
        this.settings.enabled,
        this.settings.profile,
        this.settings.writeIfeo,
        this.settings.targets.join(',')
      ],
      () => {
        if (this.settings.enabled) {
          this._start()
        } else {
          this._rollback()
        }
      },
      { fireImmediately: false, delay: 300 }
    )
  }

  async onInit() {
    await this._settingService.applyToState()

    this._refreshAvailability()

    this._context.mobxUtils.propSync(AceGuardMain.id, 'state', this.state, [
      'available',
      'elevated',
      'scanning',
      'processes',
      'cpuSets',
      'lastScanAt',
      'ifeoApplied',
      'jobConfigured',
      'lastError'
    ])

    this._context.mobxUtils.propSync(AceGuardMain.id, 'settings', this.settings, [
      'enabled',
      'profile',
      'targets',
      'writeIfeo'
    ])

    this._registerIpc()
    this._watchSettings()

    if (this.settings.enabled) {
      this._start()
    }

    this._logger.info('ACE guard initialized', {
      available: this.state.available,
      elevated: this.state.elevated
    })
  }

  async onDispose() {
    this._rollback()
  }
}
