import { makeAutoObservable, observable } from 'mobx'

export type AceLimitState = 'applied' | 'denied' | 'reverted' | 'skipped' | 'pending' | 'blocked'

export type AceGuardProfile = 'conservative' | 'standard' | 'aggressive'

export type AceLimitKey =
  'priority' | 'cpuSets' | 'ecoQos' | 'memoryPriority' | 'ioPriority' | 'pagePriority' | 'job'

export interface AceLimitReport {
  priority: AceLimitState
  cpuSets: AceLimitState
  ecoQos: AceLimitState
  memoryPriority: AceLimitState
  ioPriority: AceLimitState
  pagePriority: AceLimitState
  job: AceLimitState
}

export interface AceProcessReport {
  pid: number
  exeName: string
  limits: AceLimitReport

  /** 原始错误码描述, 不拼自然语言 */
  detail: string | null
}

export interface AceCpuSetInfo {
  available: boolean
  hybrid: boolean
  efficiencyCores: number[]
  performanceCores: number[]
}

/**
 * 默认目标进程。只调整这些进程的调度资源, 不做任何终止或挂起。
 */
export const DEFAULT_ACE_PROCESS_NAMES = [
  'SGuard64.exe',
  'SGuardSvc64.exe',
  'ACE-Tray.exe',
  'ACE-Service64.exe'
]

export const ACE_PROFILES: AceGuardProfile[] = ['conservative', 'standard', 'aggressive']

export class AceGuardSettings {
  /**
   * 默认关闭, 由用户主动开启
   */
  enabled: boolean = false

  profile: AceGuardProfile = 'conservative'

  targets: string[] = [...DEFAULT_ACE_PROCESS_NAMES]

  /**
   * 写入 IFEO PerfOptions (需要管理员权限), 影响之后启动的进程
   */
  writeIfeo: boolean = false

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  setProfile(profile: AceGuardProfile) {
    this.profile = profile
  }

  setTargets(targets: string[]) {
    this.targets = targets
  }

  setWriteIfeo(writeIfeo: boolean) {
    this.writeIfeo = writeIfeo
  }

  constructor() {
    makeAutoObservable(this, { targets: observable.ref })
  }
}

export class AceGuardState {
  /** 原生插件与平台是否可用 */
  available: boolean = false

  /** 当前进程是否具备管理员权限 */
  elevated: boolean = false

  scanning: boolean = false

  processes: AceProcessReport[] = []

  cpuSets: AceCpuSetInfo | null = null

  lastScanAt: number | null = null

  /** 已写入 IFEO 的进程名 */
  ifeoApplied: string[] = []

  jobConfigured: boolean = false

  lastError: string | null = null

  setAvailable(available: boolean) {
    this.available = available
  }

  setElevated(elevated: boolean) {
    this.elevated = elevated
  }

  setScanning(scanning: boolean) {
    this.scanning = scanning
  }

  setProcesses(processes: AceProcessReport[]) {
    this.processes = processes
  }

  setCpuSets(cpuSets: AceCpuSetInfo | null) {
    this.cpuSets = cpuSets
  }

  setLastScanAt(timestamp: number | null) {
    this.lastScanAt = timestamp
  }

  setIfeoApplied(names: string[]) {
    this.ifeoApplied = names
  }

  setJobConfigured(configured: boolean) {
    this.jobConfigured = configured
  }

  setLastError(error: string | null) {
    this.lastError = error
  }

  constructor() {
    makeAutoObservable(this, {
      processes: observable.ref,
      cpuSets: observable.ref,
      ifeoApplied: observable.ref
    })
  }
}
