#include "process.h"

#include <TlHelp32.h>
#include <winternl.h>

#include <cstring>
#include <cwchar>
#include <vector>

// ---------------------------------------------------------------------------
// 动态加载的 kernel32 接口: 避免依赖 SDK 的 _WIN32_WINNT 版本宏
// ---------------------------------------------------------------------------

typedef BOOL(WINAPI* PFN_SetProcessInformation)(HANDLE, int, LPCVOID, DWORD);
typedef BOOL(WINAPI* PFN_GetProcessInformation)(HANDLE, int, LPVOID, DWORD);
typedef BOOL(WINAPI* PFN_SetProcessDefaultCpuSets)(HANDLE, const ULONG*, ULONG);
typedef BOOL(WINAPI* PFN_GetProcessDefaultCpuSets)(HANDLE, PULONG, ULONG, PULONG);
typedef BOOL(WINAPI* PFN_GetSystemCpuSetInformation)(PVOID, ULONG, PULONG, HANDLE, ULONG);

extern "C" NTSTATUS NTAPI NtSetInformationProcess(HANDLE, PROCESSINFOCLASS, PVOID, ULONG);

namespace {

// PROCESS_INFORMATION_CLASS
constexpr int kProcessMemoryPriority = 0;
constexpr int kProcessPowerThrottling = 4;

// PROCESSINFOCLASS
constexpr int kProcessIoPriorityClass = 33;
constexpr int kProcessPagePriorityClass = 39;

constexpr ULONG kPowerThrottlingExecutionSpeed = 0x1;
constexpr ULONG kPowerThrottlingIgnoreTimerResolution = 0x4;

// JOB_OBJECT_*
constexpr ULONG kJobObjectLimitPriority = 0x20;
constexpr ULONG kJobObjectCpuRateControlEnable = 0x1;
constexpr ULONG kJobObjectCpuRateControlHardCap = 0x4;
constexpr int kJobObjectCpuRateControlInformation = 15;

constexpr UCHAR kCpuSetTypeCpuSet = 0;
constexpr UCHAR kCpuSetFlagAllocated = 0x2;

/** ERROR_ALREADY_IN_JOB, 部分 SDK 头文件未导出该宏 */
constexpr int kErrorAlreadyInJob = 298;

struct MemoryPriorityInfo {
  ULONG MemoryPriority;
};

struct PowerThrottlingState {
  ULONG Version;
  ULONG ControlMask;
  ULONG StateMask;
};

/**
 * SYSTEM_CPU_SET_INFORMATION 的前缀布局。
 * 只按 Size 字段步进遍历, 不依赖完整结构大小。
 */
struct CpuSetInfoLite {
  ULONG Size;
  USHORT Type;
  UCHAR Padding[2];
  ULONG Id;
  USHORT Group;
  UCHAR LogicalProcessorIndex;
  UCHAR CoreIndex;
  UCHAR LastLevelCacheIndex;
  UCHAR NumaNodeIndex;
  UCHAR EfficiencyClass;
  UCHAR AllFlags;
};

struct JobCpuRateControlInformation {
  ULONG ControlFlags;
  union {
    ULONG CpuRate;
    ULONG Weight;
  };
};

PFN_SetProcessInformation pSetProcessInformation = nullptr;
PFN_GetProcessInformation pGetProcessInformation = nullptr;
PFN_SetProcessDefaultCpuSets pSetProcessDefaultCpuSets = nullptr;
PFN_GetProcessDefaultCpuSets pGetProcessDefaultCpuSets = nullptr;
PFN_GetSystemCpuSetInformation pGetSystemCpuSetInformation = nullptr;

HANDLE g_job = nullptr;

void EnsureKernel32Procs() {
  static bool initialized = false;
  if (initialized) {
    return;
  }
  initialized = true;

  HMODULE kernel32 = GetModuleHandleW(L"kernel32.dll");
  if (!kernel32) {
    return;
  }

  pSetProcessInformation =
      (PFN_SetProcessInformation)GetProcAddress(kernel32, "SetProcessInformation");
  pGetProcessInformation =
      (PFN_GetProcessInformation)GetProcAddress(kernel32, "GetProcessInformation");
  pSetProcessDefaultCpuSets =
      (PFN_SetProcessDefaultCpuSets)GetProcAddress(kernel32, "SetProcessDefaultCpuSets");
  pGetProcessDefaultCpuSets =
      (PFN_GetProcessDefaultCpuSets)GetProcAddress(kernel32, "GetProcessDefaultCpuSets");
  pGetSystemCpuSetInformation =
      (PFN_GetSystemCpuSetInformation)GetProcAddress(kernel32, "GetSystemCpuSetInformation");
}

HANDLE EnsureJobObject() {
  if (!g_job) {
    g_job = CreateJobObjectW(nullptr, nullptr);
  }
  return g_job;
}

bool g_debugPrivilegeEnabled = false;
bool g_debugPrivilegeAttempted = false;

bool EnableDebugPrivilege() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
    return false;
  }

  LUID luid = {};
  if (!LookupPrivilegeValueW(nullptr, L"SeDebugPrivilege", &luid)) {
    CloseHandle(token);
    return false;
  }

  TOKEN_PRIVILEGES privileges = {};
  privileges.PrivilegeCount = 1;
  privileges.Privileges[0].Luid = luid;
  privileges.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;

  BOOL adjusted =
      AdjustTokenPrivileges(token, FALSE, &privileges, sizeof(privileges), nullptr, nullptr);
  const DWORD lastError = GetLastError();
  CloseHandle(token);

  // 特权不存在时 AdjustTokenPrivileges 依然返回 TRUE, 必须结合 GetLastError 判定
  return adjusted != FALSE && lastError == ERROR_SUCCESS;
}

/**
 * 管理员 token 中的 SeDebugPrivilege 默认处于关闭状态, 必须显式启用;
 * 否则对受保护进程调用 OpenProcess 会直接得到 ERROR_ACCESS_DENIED。
 */
void EnsureDebugPrivilege() {
  if (g_debugPrivilegeAttempted) {
    return;
  }

  g_debugPrivilegeAttempted = true;
  g_debugPrivilegeEnabled = EnableDebugPrivilege();
}

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return std::wstring();
  }

  int length = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), (int)value.size(), nullptr, 0);
  if (length <= 0) {
    return std::wstring();
  }

  std::wstring out((size_t)length, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), (int)value.size(), &out[0], length);
  return out;
}

Napi::String WideToNapiString(Napi::Env env, const std::wstring& value) {
  std::u16string text(reinterpret_cast<const char16_t*>(value.data()), value.size());
  return Napi::String::New(env, text);
}

/**
 * 枚举 CPU Set 拓扑, 并区分能效核 (EfficiencyClass 最低) 与性能核 (最高)。
 * 非混合架构时 hybrid 为 false, 两组列表均为空。
 */
struct CpuSetTopology {
  bool available = false;
  bool hybrid = false;
  std::vector<ULONG> efficiencyCores;
  std::vector<ULONG> performanceCores;
};

CpuSetTopology QueryCpuSetTopology() {
  CpuSetTopology topology;
  EnsureKernel32Procs();

  if (!pGetSystemCpuSetInformation) {
    return topology;
  }

  ULONG required = 0;
  pGetSystemCpuSetInformation(nullptr, 0, &required, nullptr, 0);
  if (required == 0) {
    return topology;
  }

  std::vector<UCHAR> buffer(required);
  ULONG returned = 0;
  if (!pGetSystemCpuSetInformation(buffer.data(), required, &returned, nullptr, 0)) {
    return topology;
  }

  topology.available = true;

  struct Entry {
    ULONG id;
    UCHAR efficiencyClass;
  };

  std::vector<Entry> entries;
  UCHAR minEfficiency = 0xFF;
  UCHAR maxEfficiency = 0;

  ULONG offset = 0;
  while (offset + sizeof(CpuSetInfoLite) <= returned) {
    CpuSetInfoLite* item = reinterpret_cast<CpuSetInfoLite*>(buffer.data() + offset);
    if (item->Size == 0) {
      break;
    }

    if (item->Type == kCpuSetTypeCpuSet && (item->AllFlags & kCpuSetFlagAllocated) != 0) {
      entries.push_back({item->Id, item->EfficiencyClass});
      if (item->EfficiencyClass < minEfficiency) {
        minEfficiency = item->EfficiencyClass;
      }
      if (item->EfficiencyClass > maxEfficiency) {
        maxEfficiency = item->EfficiencyClass;
      }
    }

    offset += item->Size;
  }

  if (entries.empty() || maxEfficiency == minEfficiency) {
    return topology;
  }

  topology.hybrid = true;
  for (const Entry& entry : entries) {
    if (entry.efficiencyClass == minEfficiency) {
      topology.efficiencyCores.push_back(entry.id);
    } else if (entry.efficiencyClass == maxEfficiency) {
      topology.performanceCores.push_back(entry.id);
    }
  }

  return topology;
}

Napi::Array ToNapiArray(Napi::Env env, const std::vector<ULONG>& values) {
  Napi::Array array = Napi::Array::New(env, values.size());
  for (size_t i = 0; i < values.size(); i++) {
    array.Set((uint32_t)i, Napi::Number::New(env, values[i]));
  }
  return array;
}

bool RequirePid(const Napi::CallbackInfo& info, DWORD* pid) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "pid expected").ThrowAsJavaScriptException();
    return false;
  }

  *pid = info[0].As<Napi::Number>().Uint32Value();
  return true;
}

std::wstring IfeoPerfOptionsPath(const std::wstring& exeName) {
  return L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\" +
         exeName + L"\\PerfOptions";
}

} // namespace

Napi::Value EnumerateProcesses(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);

  std::vector<std::wstring> names;
  if (info.Length() >= 1 && info[0].IsArray()) {
    Napi::Array input = info[0].As<Napi::Array>();
    for (uint32_t i = 0; i < input.Length(); i++) {
      Napi::Value value = input.Get(i);
      if (value.IsString()) {
        names.push_back(Utf8ToWide(value.As<Napi::String>().Utf8Value()));
      }
    }
  }

  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return result;
  }

  PROCESSENTRY32W entry;
  entry.dwSize = sizeof(entry);

  uint32_t index = 0;
  if (Process32FirstW(snapshot, &entry)) {
    do {
      bool matched = names.empty();
      for (const std::wstring& name : names) {
        if (_wcsicmp(entry.szExeFile, name.c_str()) == 0) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        continue;
      }

      Napi::Object item = Napi::Object::New(env);
      item.Set("pid", Napi::Number::New(env, entry.th32ProcessID));
      item.Set("exeName", WideToNapiString(env, std::wstring(entry.szExeFile)));
      result.Set(index++, item);
    } while (Process32NextW(snapshot, &entry));
  }

  CloseHandle(snapshot);
  return result;
}

Napi::Value GetSystemCpuSets(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  CpuSetTopology topology = QueryCpuSetTopology();

  Napi::Object result = Napi::Object::New(env);
  result.Set("available", Napi::Boolean::New(env, topology.available));
  result.Set("hybrid", Napi::Boolean::New(env, topology.hybrid));
  result.Set("efficiencyCores", ToNapiArray(env, topology.efficiencyCores));
  result.Set("performanceCores", ToNapiArray(env, topology.performanceCores));
  return result;
}

Napi::Value SnapshotProcess(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  result.Set("priorityClass", env.Null());
  result.Set("memoryPriority", env.Null());
  result.Set("ioPriority", env.Null());
  result.Set("pagePriority", env.Null());
  result.Set("ecoQos", env.Null());
  result.Set("inJob", env.Null());

  DWORD pid = 0;
  if (!RequirePid(info, &pid)) {
    return result;
  }

  EnsureKernel32Procs();
  EnsureDebugPrivilege();

  HANDLE process =
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_QUERY_INFORMATION, FALSE, pid);
  if (!process) {
    result.Set("error", Napi::Number::New(env, (int)GetLastError()));
    return result;
  }

  DWORD priorityClass = GetPriorityClass(process);
  if (priorityClass != 0) {
    result.Set("priorityClass", Napi::Number::New(env, priorityClass));
  }

  ULONG returned = 0;
  ULONG ioPriority = 0;
  if (NtQueryInformationProcess(process, (PROCESSINFOCLASS)kProcessIoPriorityClass, &ioPriority,
                                sizeof(ioPriority), &returned) == 0) {
    result.Set("ioPriority", Napi::Number::New(env, ioPriority));
  }

  ULONG pagePriority = 0;
  if (NtQueryInformationProcess(process, (PROCESSINFOCLASS)kProcessPagePriorityClass, &pagePriority,
                                sizeof(pagePriority), &returned) == 0) {
    result.Set("pagePriority", Napi::Number::New(env, pagePriority));
  }

  if (pGetProcessInformation) {
    MemoryPriorityInfo memoryPriority = {};
    if (pGetProcessInformation(process, kProcessMemoryPriority, &memoryPriority,
                               sizeof(memoryPriority))) {
      result.Set("memoryPriority", Napi::Number::New(env, memoryPriority.MemoryPriority));
    }

    PowerThrottlingState throttling = {};
    throttling.Version = 1;
    if (pGetProcessInformation(process, kProcessPowerThrottling, &throttling,
                               sizeof(throttling))) {
      result.Set("ecoQos", Napi::Boolean::New(
                               env, (throttling.StateMask & kPowerThrottlingExecutionSpeed) != 0));
    }
  }

  BOOL inJob = FALSE;
  if (IsProcessInJob(process, nullptr, &inJob)) {
    result.Set("inJob", Napi::Boolean::New(env, inJob != FALSE));
  }

  CloseHandle(process);
  return result;
}

Napi::Value ApplyProcessRestrictions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  result.Set("priorityClass", Napi::Number::New(env, -1));
  result.Set("cpuSets", Napi::Number::New(env, -1));
  result.Set("ecoQos", Napi::Number::New(env, -1));
  result.Set("memoryPriority", Napi::Number::New(env, -1));
  result.Set("ioPriority", Napi::Number::New(env, -1));
  result.Set("pagePriority", Napi::Number::New(env, -1));

  DWORD pid = 0;
  if (!RequirePid(info, &pid)) {
    return result;
  }

  if (info.Length() < 2 || !info[1].IsObject()) {
    Napi::TypeError::New(env, "options object expected").ThrowAsJavaScriptException();
    return result;
  }

  Napi::Object options = info[1].As<Napi::Object>();
  EnsureKernel32Procs();

  EnsureDebugPrivilege();

  // 只请求最小必要权限。权限并集越大, 受保护进程越容易把整个请求拒成 ACCESS_DENIED,
  // 因此这里按用途拆成两个独立句柄, 而不是一次申请全部权限。
  HANDLE process =
      OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, FALSE, pid);
  const int openError = process ? 0 : (int)GetLastError();

  HANDLE cpuSetProcess = nullptr;
  int cpuSetOpenError = 0;
  if (options.Has("cpuSetIds") && options.Get("cpuSetIds").IsArray()) {
    cpuSetProcess = OpenProcess(PROCESS_SET_LIMITED_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION,
                                FALSE, pid);
    if (!cpuSetProcess) {
      cpuSetOpenError = (int)GetLastError();
    }
  }

  if (options.Has("priorityClass") && options.Get("priorityClass").IsNumber()) {
    DWORD want = options.Get("priorityClass").As<Napi::Number>().Uint32Value();
    int code = process ? (SetPriorityClass(process, want) ? 0 : (int)GetLastError()) : openError;
    result.Set("priorityClass", Napi::Number::New(env, code));
  }

  if (options.Has("cpuSetIds") && options.Get("cpuSetIds").IsArray()) {
    Napi::Array ids = options.Get("cpuSetIds").As<Napi::Array>();
    std::vector<ULONG> cpuSetIds;
    cpuSetIds.reserve(ids.Length());
    for (uint32_t i = 0; i < ids.Length(); i++) {
      Napi::Value value = ids.Get(i);
      if (value.IsNumber()) {
        cpuSetIds.push_back(value.As<Napi::Number>().Uint32Value());
      }
    }

    int code = 0;
    if (!cpuSetProcess) {
      code = cpuSetOpenError;
    } else if (!pSetProcessDefaultCpuSets) {
      code = (int)ERROR_PROC_NOT_FOUND;
    } else if (cpuSetIds.empty()) {
      code = (int)ERROR_INVALID_PARAMETER;
    } else if (!pSetProcessDefaultCpuSets(cpuSetProcess, cpuSetIds.data(),
                                          (ULONG)cpuSetIds.size())) {
      code = (int)GetLastError();
    }

    result.Set("cpuSets", Napi::Number::New(env, code));
  }

  if (options.Has("ecoQos") && options.Get("ecoQos").IsBoolean()) {
    bool enable = options.Get("ecoQos").As<Napi::Boolean>().Value();
    int code = 0;

    if (!process) {
      code = openError;
    } else if (!pSetProcessInformation) {
      code = (int)ERROR_PROC_NOT_FOUND;
    } else {
      PowerThrottlingState state = {};
      state.Version = 1;
      state.ControlMask =
          kPowerThrottlingExecutionSpeed | kPowerThrottlingIgnoreTimerResolution;
      state.StateMask = enable ? state.ControlMask : 0;

      if (!pSetProcessInformation(process, kProcessPowerThrottling, &state, sizeof(state))) {
        code = (int)GetLastError();

        // IGNORE_TIMER_RESOLUTION 仅 Win11 支持, 失败后去掉重试一次
        if (code == (int)ERROR_INVALID_PARAMETER) {
          state.ControlMask = kPowerThrottlingExecutionSpeed;
          state.StateMask = enable ? state.ControlMask : 0;
          if (pSetProcessInformation(process, kProcessPowerThrottling, &state, sizeof(state))) {
            code = 0;
          } else {
            code = (int)GetLastError();
          }
        }
      }
    }

    result.Set("ecoQos", Napi::Number::New(env, code));
  }

  if (options.Has("memoryPriority") && options.Get("memoryPriority").IsNumber()) {
    MemoryPriorityInfo payload = {};
    payload.MemoryPriority =
        options.Get("memoryPriority").As<Napi::Number>().Uint32Value();

    int code = 0;
    if (!process) {
      code = openError;
    } else if (!pSetProcessInformation) {
      code = (int)ERROR_PROC_NOT_FOUND;
    } else if (!pSetProcessInformation(process, kProcessMemoryPriority, &payload,
                                       sizeof(payload))) {
      code = (int)GetLastError();
    }

    result.Set("memoryPriority", Napi::Number::New(env, code));
  }

  if (options.Has("ioPriority") && options.Get("ioPriority").IsNumber()) {
    ULONG payload = options.Get("ioPriority").As<Napi::Number>().Uint32Value();
    int code = 0;

    if (!process) {
      code = openError;
    } else {
      NTSTATUS status =
          NtSetInformationProcess(process, (PROCESSINFOCLASS)kProcessIoPriorityClass, &payload,
                                  sizeof(payload));
      code = NT_SUCCESS(status) ? 0 : (int)status;
    }

    result.Set("ioPriority", Napi::Number::New(env, code));
  }

  if (options.Has("pagePriority") && options.Get("pagePriority").IsNumber()) {
    ULONG payload = options.Get("pagePriority").As<Napi::Number>().Uint32Value();
    int code = 0;

    if (!process) {
      code = openError;
    } else {
      NTSTATUS status =
          NtSetInformationProcess(process, (PROCESSINFOCLASS)kProcessPagePriorityClass, &payload,
                                  sizeof(payload));
      code = NT_SUCCESS(status) ? 0 : (int)status;
    }

    result.Set("pagePriority", Napi::Number::New(env, code));
  }

  if (cpuSetProcess) {
    CloseHandle(cpuSetProcess);
  }

  if (process) {
    CloseHandle(process);
  }

  return result;
}

Napi::Value IsProcessInJobNode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  DWORD pid = 0;
  if (!RequirePid(info, &pid)) {
    return env.Null();
  }

  EnsureDebugPrivilege();

  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) {
    return env.Null();
  }

  BOOL inJob = FALSE;
  bool ok = IsProcessInJob(process, nullptr, &inJob) != FALSE;
  CloseHandle(process);

  if (!ok) {
    return env.Null();
  }

  return Napi::Boolean::New(env, inJob != FALSE);
}

Napi::Value ConfigureJobObject(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "cpuRate expected").ThrowAsJavaScriptException();
    return Napi::Number::New(env, -1);
  }

  // 1..10000 对应 0.01%..100%
  DWORD cpuRate = info[0].As<Napi::Number>().Uint32Value();
  if (cpuRate < 1 || cpuRate > 10000) {
    cpuRate = 10000;
  }

  bool idlePriority = true;
  if (info.Length() >= 2 && info[1].IsBoolean()) {
    idlePriority = info[1].As<Napi::Boolean>().Value();
  }

  HANDLE job = EnsureJobObject();
  if (!job) {
    return Napi::Number::New(env, (int)GetLastError());
  }

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limitInfo = {};
  if (idlePriority) {
    limitInfo.BasicLimitInformation.LimitFlags = kJobObjectLimitPriority;
    limitInfo.BasicLimitInformation.PriorityClass = IDLE_PRIORITY_CLASS;
  }

  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limitInfo,
                               sizeof(limitInfo))) {
    return Napi::Number::New(env, (int)GetLastError());
  }

  JobCpuRateControlInformation rateControl = {};
  rateControl.ControlFlags = kJobObjectCpuRateControlEnable | kJobObjectCpuRateControlHardCap;
  rateControl.CpuRate = cpuRate;

  if (!SetInformationJobObject(job, (JOBOBJECTINFOCLASS)kJobObjectCpuRateControlInformation,
                               &rateControl, sizeof(rateControl))) {
    return Napi::Number::New(env, (int)GetLastError());
  }

  return Napi::Number::New(env, 0);
}

Napi::Value AssignProcessToJob(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  DWORD pid = 0;
  if (!RequirePid(info, &pid)) {
    return Napi::Number::New(env, -1);
  }

  EnsureDebugPrivilege();

  HANDLE job = EnsureJobObject();
  if (!job) {
    return Napi::Number::New(env, (int)GetLastError());
  }

  HANDLE process =
      OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                  pid);

  // 部分受保护进程拒绝 PROCESS_TERMINATE, 退回最小权限再试一次
  if (!process) {
    process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  }

  if (!process) {
    return Napi::Number::New(env, (int)GetLastError());
  }

  // 进程已属于其它 Job 时无法再 assign。先判定归属, 给出可解释的结果,
  // 而不是笼统地报 ACCESS_DENIED。
  BOOL inAnyJob = FALSE;
  if (IsProcessInJob(process, nullptr, &inAnyJob) && inAnyJob != FALSE) {
    BOOL inTargetJob = FALSE;
    if (IsProcessInJob(process, job, &inTargetJob) && inTargetJob != FALSE) {
      CloseHandle(process);
      return Napi::Number::New(env, 0);
    }

    CloseHandle(process);
    return Napi::Number::New(env, kErrorAlreadyInJob);
  }

  BOOL assigned = AssignProcessToJobObject(job, process);
  int code = assigned ? 0 : (int)GetLastError();
  CloseHandle(process);

  return Napi::Number::New(env, code);
}

Napi::Value SetIfeoPerfOptions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
    Napi::TypeError::New(env, "exeName and options expected").ThrowAsJavaScriptException();
    return Napi::Number::New(env, -1);
  }

  std::wstring exeName = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  if (exeName.empty()) {
    return Napi::Number::New(env, (int)ERROR_INVALID_PARAMETER);
  }

  Napi::Object options = info[1].As<Napi::Object>();
  std::wstring path = IfeoPerfOptionsPath(exeName);

  HKEY key = nullptr;
  LONG status = RegCreateKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0, nullptr, 0,
                                KEY_SET_VALUE | KEY_WOW64_64KEY, nullptr, &key, nullptr);
  if (status != ERROR_SUCCESS) {
    return Napi::Number::New(env, (int)status);
  }

  auto writeDword = [&](const wchar_t* name, Napi::Object& source, const char* prop) -> LONG {
    if (!source.Has(prop) || !source.Get(prop).IsNumber()) {
      return ERROR_SUCCESS;
    }

    DWORD value = source.Get(prop).As<Napi::Number>().Uint32Value();
    return RegSetValueExW(key, name, 0, REG_DWORD, reinterpret_cast<const BYTE*>(&value),
                          sizeof(value));
  };

  LONG result = ERROR_SUCCESS;
  result = writeDword(L"CpuPriorityClass", options, "cpu");
  if (result == ERROR_SUCCESS) {
    result = writeDword(L"IoPriority", options, "io");
  }
  if (result == ERROR_SUCCESS) {
    result = writeDword(L"PagePriority", options, "page");
  }

  RegCloseKey(key);
  return Napi::Number::New(env, (int)result);
}

Napi::Value GetIfeoPerfOptions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "exeName expected").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::wstring exeName = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  std::wstring path = IfeoPerfOptionsPath(exeName);

  HKEY key = nullptr;
  LONG status = RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0,
                              KEY_QUERY_VALUE | KEY_WOW64_64KEY, &key);
  if (status != ERROR_SUCCESS) {
    return env.Null();
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("cpu", env.Null());
  result.Set("io", env.Null());
  result.Set("page", env.Null());

  auto readDword = [&](const wchar_t* name, const char* prop) {
    DWORD value = 0;
    DWORD size = sizeof(value);
    DWORD type = 0;
    if (RegQueryValueExW(key, name, nullptr, &type, reinterpret_cast<LPBYTE>(&value), &size) ==
            ERROR_SUCCESS &&
        type == REG_DWORD) {
      result.Set(prop, Napi::Number::New(env, value));
    }
  };

  readDword(L"CpuPriorityClass", "cpu");
  readDword(L"IoPriority", "io");
  readDword(L"PagePriority", "page");

  RegCloseKey(key);
  return result;
}

Napi::Value RestoreIfeoPerfOptions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
    Napi::TypeError::New(env, "exeName and original values expected").ThrowAsJavaScriptException();
    return Napi::Number::New(env, -1);
  }

  std::wstring exeName = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
  Napi::Object original = info[1].As<Napi::Object>();
  std::wstring path = IfeoPerfOptionsPath(exeName);

  HKEY key = nullptr;
  LONG status = RegOpenKeyExW(HKEY_LOCAL_MACHINE, path.c_str(), 0,
                              KEY_SET_VALUE | KEY_WOW64_64KEY, &key);
  if (status != ERROR_SUCCESS) {
    return Napi::Number::New(env, 0);
  }

  // 只还原自己写过的值: 原值为 null 表示该值原本不存在, 需要删除
  auto restoreDword = [&](const wchar_t* name, Napi::Object& source, const char* prop) -> LONG {
    if (!source.Has(prop)) {
      return ERROR_SUCCESS;
    }

    Napi::Value value = source.Get(prop);
    if (value.IsNumber()) {
      DWORD data = value.As<Napi::Number>().Uint32Value();
      return RegSetValueExW(key, name, 0, REG_DWORD, reinterpret_cast<const BYTE*>(&data),
                            sizeof(data));
    }

    RegDeleteValueW(key, name);
    return ERROR_SUCCESS;
  };

  LONG result = restoreDword(L"CpuPriorityClass", original, "cpu");
  if (result == ERROR_SUCCESS) {
    result = restoreDword(L"IoPriority", original, "io");
  }
  if (result == ERROR_SUCCESS) {
    result = restoreDword(L"PagePriority", original, "page");
  }

  RegCloseKey(key);
  return Napi::Number::New(env, (int)result);
}

Napi::Value IsDebugPrivilegeEnabled(const Napi::CallbackInfo& info) {
  EnsureDebugPrivilege();
  return Napi::Boolean::New(info.Env(), g_debugPrivilegeEnabled);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("enumerateProcesses", Napi::Function::New(env, EnumerateProcesses));
  exports.Set("getSystemCpuSets", Napi::Function::New(env, GetSystemCpuSets));
  exports.Set("snapshotProcess", Napi::Function::New(env, SnapshotProcess));
  exports.Set("applyProcessRestrictions", Napi::Function::New(env, ApplyProcessRestrictions));
  exports.Set("isProcessInJob", Napi::Function::New(env, IsProcessInJobNode));
  exports.Set("configureJobObject", Napi::Function::New(env, ConfigureJobObject));
  exports.Set("assignProcessToJob", Napi::Function::New(env, AssignProcessToJob));
  exports.Set("setIfeoPerfOptions", Napi::Function::New(env, SetIfeoPerfOptions));
  exports.Set("getIfeoPerfOptions", Napi::Function::New(env, GetIfeoPerfOptions));
  exports.Set("restoreIfeoPerfOptions", Napi::Function::New(env, RestoreIfeoPerfOptions));
  exports.Set("isDebugPrivilegeEnabled", Napi::Function::New(env, IsDebugPrivilegeEnabled));
  return exports;
}

NODE_API_MODULE(akari_process, Init)
