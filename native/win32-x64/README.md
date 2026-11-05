# League Akari Native Win32 x64

Internal Windows-only native bindings for League Akari.

## Addons

| Target                | Source                   | Purpose                                   |
| --------------------- | ------------------------ | ----------------------------------------- |
| `akari-input-win64`   | `src/input/input.cc`     | keyboard/mouse input simulation           |
| `akari-tools-win64`   | `src/tools/tools.cc`     | window and process utilities              |
| `akari-process-win64` | `src/process/process.cc` | process scheduling controls (local extra) |

`akari-process-win64` is a locally added addon exposing `enumerateProcesses`, `getSystemCpuSets`,
`snapshotProcess`, `applyProcessRestrictions`, `configureJobObject`, `assignProcessToJob` and the
IFEO helpers. It only adjusts scheduling resources (priority class, CPU sets, EcoQoS,
memory/IO/page priority, Job quota, IFEO `PerfOptions`). It never terminates, suspends, injects
into, or otherwise interferes with the target processes.

## Build

```powershell
node scripts/build.js
```

### Visual Studio 2026 (v145 toolset only)

`node-gyp` always generates projects with `PlatformToolset=v143`. On a machine that only has the
VS 2026 Build Tools (toolset `v145`) the build fails with `MSB8020`. Workaround:

```powershell
# inside a VS developer prompt, from the repository root
set VSCMD_VER=17.14.0
node node_modules/node-gyp/bin/node-gyp.js configure --directory native/win32-x64
# then rewrite every generated *.vcxproj, replacing v143 with v145
node node_modules/node-gyp/bin/node-gyp.js build --directory native/win32-x64
```

`VSCMD_VER` is only used by node-gyp for version detection; the actual toolset comes from the
rewritten project files.

Do not compile this addon with a bare `cl.exe` invocation. node-gyp/MSBuild supplies required
runtime flags such as `/DNDEBUG` and `_ITERATOR_DEBUG_LEVEL=0`; omitting them makes the module
crash with `ACCESS_VIOLATION` when loaded under Electron.
