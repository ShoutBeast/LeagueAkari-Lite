#ifndef LEAGUE_AKARI_NATIVE_PROCESS_H
#define LEAGUE_AKARI_NATIVE_PROCESS_H

#include <napi.h>
#include <string>
#include <windows.h>

/**
 * 进程资源调度控制 (优先级 / CPU Sets / EcoQoS / 内存与 IO 优先级 / Job 配额 / IFEO)
 *
 * 只做调度层面的资源分配, 不涉及终止、挂起、注入、Hook 等行为。
 */
Napi::Value EnumerateProcesses(const Napi::CallbackInfo& info);
Napi::Value GetSystemCpuSets(const Napi::CallbackInfo& info);
Napi::Value SnapshotProcess(const Napi::CallbackInfo& info);
Napi::Value ApplyProcessRestrictions(const Napi::CallbackInfo& info);
Napi::Value IsProcessInJobNode(const Napi::CallbackInfo& info);
Napi::Value ConfigureJobObject(const Napi::CallbackInfo& info);
Napi::Value AssignProcessToJob(const Napi::CallbackInfo& info);
Napi::Value SetIfeoPerfOptions(const Napi::CallbackInfo& info);
Napi::Value GetIfeoPerfOptions(const Napi::CallbackInfo& info);
Napi::Value RestoreIfeoPerfOptions(const Napi::CallbackInfo& info);
Napi::Value IsDebugPrivilegeEnabled(const Napi::CallbackInfo& info);

#endif // LEAGUE_AKARI_NATIVE_PROCESS_H
