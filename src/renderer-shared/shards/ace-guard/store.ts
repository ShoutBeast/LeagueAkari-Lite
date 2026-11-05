import { defineStore } from 'pinia'
import { reactive, ref, shallowRef } from 'vue'

export type AceLimitState = 'applied' | 'denied' | 'reverted' | 'skipped' | 'pending' | 'blocked'

export type AceGuardProfile = 'conservative' | 'standard' | 'aggressive'

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
  detail: string | null
}

export interface AceCpuSetInfo {
  available: boolean
  hybrid: boolean
  efficiencyCores: number[]
  performanceCores: number[]
}

export const DEFAULT_ACE_TARGETS = [
  'SGuard64.exe',
  'SGuardSvc64.exe',
  'ACE-Tray.exe',
  'ACE-Service64.exe'
]

export const useAceGuardStore = defineStore('shard:ace-guard-renderer', () => {
  const available = ref(false)
  const elevated = ref(false)
  const scanning = ref(false)
  const processes = shallowRef<AceProcessReport[]>([])
  const cpuSets = shallowRef<AceCpuSetInfo | null>(null)
  const lastScanAt = ref<number | null>(null)
  const ifeoApplied = shallowRef<string[]>([])
  const jobConfigured = ref(false)
  const lastError = ref<string | null>(null)

  const settings = reactive({
    enabled: false,
    profile: 'conservative' as AceGuardProfile,
    targets: [...DEFAULT_ACE_TARGETS] as string[],
    writeIfeo: false
  })

  return {
    available,
    elevated,
    scanning,
    processes,
    cpuSets,
    lastScanAt,
    ifeoApplied,
    jobConfigured,
    lastError,
    settings
  }
})
