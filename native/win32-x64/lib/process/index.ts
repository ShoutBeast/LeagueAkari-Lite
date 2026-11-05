import { NativeAddonBinding } from '../addon-binding'
import type {
  AkariProcessBinding,
  NativeCpuSetTopology,
  NativeIfeoValues,
  NativeProcessEntry,
  NativeProcessSnapshot,
  NativeRestrictionRequest,
  NativeRestrictionResult
} from '../bindings'

export type {
  NativeCpuSetTopology,
  NativeIfeoValues,
  NativeProcessEntry,
  NativeProcessSnapshot,
  NativeRestrictionRequest,
  NativeRestrictionResult
}

const addon = new NativeAddonBinding<AkariProcessBinding>('process', () =>
  require('../../addons/akari-process-win64.node')
)

/**
 * 进程调度控制。仅做资源分配层面的调整, 不涉及终止、挂起或注入。
 */
export class AkariNativeProcessControl implements AkariProcessBinding {
  load(): void {
    addon.load()
  }

  isLoaded(): boolean {
    return addon.isLoaded()
  }

  enumerateProcesses(names: string[]): NativeProcessEntry[] {
    return addon.get().enumerateProcesses(names)
  }

  getSystemCpuSets(): NativeCpuSetTopology {
    return addon.get().getSystemCpuSets()
  }

  snapshotProcess(pid: number): NativeProcessSnapshot {
    return addon.get().snapshotProcess(pid)
  }

  applyProcessRestrictions(
    pid: number,
    options: NativeRestrictionRequest
  ): NativeRestrictionResult {
    return addon.get().applyProcessRestrictions(pid, options)
  }

  isProcessInJob(pid: number): boolean | null {
    return addon.get().isProcessInJob(pid)
  }

  configureJobObject(cpuRate: number, idlePriority: boolean): number {
    return addon.get().configureJobObject(cpuRate, idlePriority)
  }

  assignProcessToJob(pid: number): number {
    return addon.get().assignProcessToJob(pid)
  }

  setIfeoPerfOptions(
    exeName: string,
    values: { cpu?: number; io?: number; page?: number }
  ): number {
    return addon.get().setIfeoPerfOptions(exeName, values)
  }

  getIfeoPerfOptions(exeName: string): NativeIfeoValues | null {
    return addon.get().getIfeoPerfOptions(exeName)
  }

  restoreIfeoPerfOptions(exeName: string, original: NativeIfeoValues): number {
    return addon.get().restoreIfeoPerfOptions(exeName, original)
  }
}

const processControl = new AkariNativeProcessControl()

export default processControl
