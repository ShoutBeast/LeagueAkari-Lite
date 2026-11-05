"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AkariNativeProcessControl = void 0;
const addon_binding_1 = require("../addon-binding");
const addon = new addon_binding_1.NativeAddonBinding('process', () => require('../../addons/akari-process-win64.node'));
/**
 * 进程调度控制。仅做资源分配层面的调整, 不涉及终止、挂起或注入。
 */
class AkariNativeProcessControl {
    load() {
        addon.load();
    }
    isLoaded() {
        return addon.isLoaded();
    }
    enumerateProcesses(names) {
        return addon.get().enumerateProcesses(names);
    }
    getSystemCpuSets() {
        return addon.get().getSystemCpuSets();
    }
    snapshotProcess(pid) {
        return addon.get().snapshotProcess(pid);
    }
    applyProcessRestrictions(pid, options) {
        return addon.get().applyProcessRestrictions(pid, options);
    }
    isProcessInJob(pid) {
        return addon.get().isProcessInJob(pid);
    }
    configureJobObject(cpuRate, idlePriority) {
        return addon.get().configureJobObject(cpuRate, idlePriority);
    }
    assignProcessToJob(pid) {
        return addon.get().assignProcessToJob(pid);
    }
    setIfeoPerfOptions(exeName, values) {
        return addon.get().setIfeoPerfOptions(exeName, values);
    }
    getIfeoPerfOptions(exeName) {
        return addon.get().getIfeoPerfOptions(exeName);
    }
    restoreIfeoPerfOptions(exeName, original) {
        return addon.get().restoreIfeoPerfOptions(exeName, original);
    }
}
exports.AkariNativeProcessControl = AkariNativeProcessControl;
const processControl = new AkariNativeProcessControl();
exports.default = processControl;
