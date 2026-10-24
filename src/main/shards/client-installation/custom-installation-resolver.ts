import path from 'node:path'

/**
 * 解析所需文件系统操作的最小接口, 便于测试注入内存实现
 */
export interface InstallationFsLike {
  access(path: string): Promise<void>
  readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<{ name: string; isDirectory(): boolean }[]>
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>
}

export type CustomInstallationResolution =
  | {
      ok: true
      installationPath: string
      tclsExecutablePath: string
      weGameLauncherExecutablePath: string | null
    }
  | {
      ok: false
      reason: 'input-not-exists' | 'not-client-exe' | 'client-exe-not-found'
    }

const CLIENT_EXE_BASENAME = 'client.exe'
const WEGAME_LAUNCHER_RELATIVE = path.join('WeGameLauncher', 'launcher.exe')
const SCAN_MAX_DEPTH = 3
const SCAN_MAX_ENTRIES = 4000

/**
 * 解析用户手动指定的腾讯服安装位置: 输入可以是安装目录 (在目录下寻找 Client.exe),
 * 也可以直接是 TCLS Client.exe 的路径
 */
export async function resolveCustomTencentInstallation(
  rawInput: string,
  fsLike: InstallationFsLike
): Promise<CustomInstallationResolution> {
  // 兼容资源管理器 "复制文件地址" 产生的引号包裹
  const input = rawInput.trim().replace(/^"(.*)"$/, '$1')

  if (!input) {
    return { ok: false, reason: 'input-not-exists' }
  }

  let inputStat
  try {
    inputStat = await fsLike.stat(input)
  } catch {
    return { ok: false, reason: 'input-not-exists' }
  }

  if (inputStat.isFile()) {
    return resolveFromExecutable(input, fsLike)
  }

  return resolveFromDirectory(input, fsLike)
}

async function resolveFromExecutable(
  exePath: string,
  fsLike: InstallationFsLike
): Promise<CustomInstallationResolution> {
  if (path.basename(exePath).toLowerCase() !== CLIENT_EXE_BASENAME) {
    return { ok: false, reason: 'not-client-exe' }
  }

  const dir = path.dirname(exePath)

  // 标准布局为 <安装目录>/Launcher/Client.exe, 从中还原安装目录
  const installationPath = path.basename(dir).toLowerCase() === 'launcher' ? path.dirname(dir) : dir

  return finalize(installationPath, exePath, fsLike)
}

async function resolveFromDirectory(
  dir: string,
  fsLike: InstallationFsLike
): Promise<CustomInstallationResolution> {
  const candidates = [path.join(dir, 'Launcher', 'Client.exe'), path.join(dir, 'Client.exe')]

  let tcls: string | null = null
  for (const candidate of candidates) {
    try {
      await fsLike.access(candidate)
      tcls = candidate
      break
    } catch {}
  }

  if (!tcls) {
    tcls = await scanForClientExecutable(dir, fsLike)
  }

  if (!tcls) {
    return { ok: false, reason: 'client-exe-not-found' }
  }

  return finalize(dir, tcls, fsLike)
}

async function finalize(
  installationPath: string,
  tclsExecutablePath: string,
  fsLike: InstallationFsLike
): Promise<CustomInstallationResolution> {
  const weGameLauncher = path.join(installationPath, WEGAME_LAUNCHER_RELATIVE)

  let weGameLauncherExecutablePath: string | null = null
  try {
    await fsLike.access(weGameLauncher)
    weGameLauncherExecutablePath = path.normalize(weGameLauncher)
  } catch {}

  return {
    ok: true,
    installationPath: path.normalize(installationPath),
    tclsExecutablePath: path.normalize(tclsExecutablePath),
    weGameLauncherExecutablePath
  }
}

/**
 * 有界深度优先扫描, 在非标准布局的安装目录树中寻找 Client.exe
 */
async function scanForClientExecutable(
  dir: string,
  fsLike: InstallationFsLike
): Promise<string | null> {
  let visited = 0

  const walk = async (current: string, depth: number): Promise<string | null> => {
    if (depth > SCAN_MAX_DEPTH || visited >= SCAN_MAX_ENTRIES) {
      return null
    }

    let entries
    try {
      entries = await fsLike.readdir(current, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      if (visited >= SCAN_MAX_ENTRIES) {
        return null
      }
      visited++

      const fullPath = path.join(current, entry.name)

      if (!entry.isDirectory() && entry.name.toLowerCase() === CLIENT_EXE_BASENAME) {
        return fullPath
      }

      if (entry.isDirectory()) {
        const found = await walk(fullPath, depth + 1)
        if (found) {
          return found
        }
      }
    }

    return null
  }

  return walk(dir, 0)
}
