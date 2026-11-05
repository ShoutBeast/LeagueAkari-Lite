import type { AkariProcessBinding, NativeCpuSetTopology, NativeIfeoValues, NativeProcessEntry, NativeProcessSnapshot, NativeRestrictionRequest, NativeRestrictionResult } from '../bindings';
export type { NativeCpuSetTopology, NativeIfeoValues, NativeProcessEntry, NativeProcessSnapshot, NativeRestrictionRequest, NativeRestrictionResult };
/**
 * 进程调度控制。仅做资源分配层面的调整, 不涉及终止、挂起或注入。
 */
export declare class AkariNativeProcessControl implements AkariProcessBinding {
    load(): void;
    isLoaded(): boolean;
    enumerateProcesses(names: string[]): NativeProcessEntry[];
    getSystemCpuSets(): NativeCpuSetTopology;
    snapshotProcess(pid: number): NativeProcessSnapshot;
    applyProcessRestrictions(pid: number, options: NativeRestrictionRequest): NativeRestrictionResult;
    isProcessInJob(pid: number): boolean | null;
    configureJobObject(cpuRate: number, idlePriority: boolean): number;
    assignProcessToJob(pid: number): number;
    setIfeoPerfOptions(exeName: string, values: {
        cpu?: number;
        io?: number;
        page?: number;
    }): number;
    getIfeoPerfOptions(exeName: string): NativeIfeoValues | null;
    restoreIfeoPerfOptions(exeName: string, original: NativeIfeoValues): number;
}
declare const processControl: AkariNativeProcessControl;
export default processControl;
