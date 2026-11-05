export interface NativeKeyState {
  vkCode: number
  pressed: boolean
  scanCode: number
}

export type NativeKeyEventCallback = (rawEvent: string) => void

export interface AkariInputBinding {
  install(): void
  uninstall(): void
  onKeyEvent(callback: NativeKeyEventCallback): void
  sendString(text: string): Promise<void>
  sendKey(virtualKeyCode: number, pressed: boolean): Promise<void>
  getKeyStates(): NativeKeyState[]
}

export interface FixLeagueClientWindowConfig {
  baseWidth?: number
  baseHeight?: number
}

export interface LeagueClientWindowPlacementInfo {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  shownState: number
  isMinimized: boolean
  isMaximized: boolean
  isNormal: boolean
}

export interface AkariToolsBinding {
  fixWindowMethodA(clientZoom: number, config: FixLeagueClientWindowConfig): boolean | null
  isElevated(): boolean
  getLeagueClientWindowPlacementInfo(): LeagueClientWindowPlacementInfo | null
  getCommandLine1(pid: number): string
  getPidsByName(processName: string): number[]
  terminateProcess(pid: number): boolean
  isProcessForeground(pid: number): boolean
  isProcessRunning(pid: number): boolean
}

export interface NativeProcessEntry {
  pid: number
  exeName: string
}

export interface NativeCpuSetTopology {
  available: boolean
  hybrid: boolean
  efficiencyCores: number[]
  performanceCores: number[]
}

/**
 * 进程当前调度状态快照, 无法读取的项为 null。
 * `error` 仅在打开进程失败时出现。
 */
export interface NativeProcessSnapshot {
  priorityClass: number | null
  memoryPriority: number | null
  ioPriority: number | null
  pagePriority: number | null
  ecoQos: boolean | null
  inJob: boolean | null
  error?: number
}

export interface NativeRestrictionRequest {
  priorityClass?: number
  cpuSetIds?: number[]
  ecoQos?: boolean
  memoryPriority?: number
  ioPriority?: number
  pagePriority?: number
}

/**
 * 每项为错误码, 0 表示成功, -1 表示未请求。
 * NTSTATUS 失败时为负数, Win32 失败时为 GetLastError 的正数。
 */
export interface NativeRestrictionResult {
  priorityClass: number
  cpuSets: number
  ecoQos: number
  memoryPriority: number
  ioPriority: number
  pagePriority: number
}

export interface NativeIfeoValues {
  cpu: number | null
  io: number | null
  page: number | null
}

export interface AkariProcessBinding {
  enumerateProcesses(names: string[]): NativeProcessEntry[]
  getSystemCpuSets(): NativeCpuSetTopology
  snapshotProcess(pid: number): NativeProcessSnapshot
  applyProcessRestrictions(pid: number, options: NativeRestrictionRequest): NativeRestrictionResult
  isProcessInJob(pid: number): boolean | null
  configureJobObject(cpuRate: number, idlePriority: boolean): number
  assignProcessToJob(pid: number): number
  setIfeoPerfOptions(exeName: string, values: { cpu?: number; io?: number; page?: number }): number
  getIfeoPerfOptions(exeName: string): NativeIfeoValues | null
  restoreIfeoPerfOptions(exeName: string, original: NativeIfeoValues): number
}
