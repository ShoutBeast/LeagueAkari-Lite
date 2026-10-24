import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  type InstallationFsLike,
  resolveCustomTencentInstallation
} from './custom-installation-resolver'

function createMemoryFs(files: string[], dirs: string[]): InstallationFsLike {
  const fileSet = new Set(files)
  const dirSet = new Set(dirs)

  return {
    async access(p) {
      if (!fileSet.has(p) && !dirSet.has(p)) {
        throw new Error('not found')
      }
    },
    async readdir(p) {
      if (!dirSet.has(p)) {
        throw new Error('not found')
      }

      const children = [...fileSet, ...dirSet].filter((child) => path.dirname(child) === p)
      return children.map((child) => ({
        name: path.basename(child),
        isDirectory: () => dirSet.has(child)
      }))
    },
    async stat(p) {
      if (fileSet.has(p)) {
        return { isFile: () => true, isDirectory: () => false }
      }
      if (dirSet.has(p)) {
        return { isFile: () => false, isDirectory: () => true }
      }
      throw new Error('not found')
    }
  }
}

describe('resolveCustomTencentInstallation', () => {
  const root = path.join('C:', '英雄联盟')
  const standardLayout = createMemoryFs(
    [path.join(root, 'Launcher', 'Client.exe'), path.join(root, 'WeGameLauncher', 'launcher.exe')],
    [root, path.join(root, 'Launcher'), path.join(root, 'WeGameLauncher')]
  )

  it('目录输入: 命中标准布局 Launcher/Client.exe, 并还原安装目录与 WeGame 启动器', async () => {
    const result = await resolveCustomTencentInstallation(root, standardLayout)

    expect(result).toEqual({
      ok: true,
      installationPath: root,
      tclsExecutablePath: path.join(root, 'Launcher', 'Client.exe'),
      weGameLauncherExecutablePath: path.join(root, 'WeGameLauncher', 'launcher.exe')
    })
  })

  it('exe 输入: 从 Launcher 目录还原安装目录', async () => {
    const result = await resolveCustomTencentInstallation(
      path.join(root, 'Launcher', 'Client.exe'),
      standardLayout
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.installationPath).toBe(root)
      expect(result.tclsExecutablePath).toBe(path.join(root, 'Launcher', 'Client.exe'))
    }
  })

  it('exe 输入: 兼容复制文件地址带来的引号包裹', async () => {
    const result = await resolveCustomTencentInstallation(
      `"${path.join(root, 'Launcher', 'Client.exe')}"`,
      standardLayout
    )

    expect(result.ok).toBe(true)
  })

  it('exe 输入: 非 Client.exe 返回 not-client-exe', async () => {
    const result = await resolveCustomTencentInstallation(
      path.join(root, 'WeGameLauncher', 'launcher.exe'),
      standardLayout
    )

    expect(result).toEqual({ ok: false, reason: 'not-client-exe' })
  })

  it('目录输入: 非标准布局时通过有界扫描找到 Client.exe', async () => {
    const root2 = path.join('D:', '游戏', 'lol')
    const fsLike = createMemoryFs(
      [path.join(root2, 'a', 'Client.exe')],
      [root2, path.join(root2, 'a')]
    )

    const result = await resolveCustomTencentInstallation(root2, fsLike)

    expect(result).toEqual({
      ok: true,
      installationPath: root2,
      tclsExecutablePath: path.join(root2, 'a', 'Client.exe'),
      weGameLauncherExecutablePath: null
    })
  })

  it('目录输入: 找不到 Client.exe 返回 client-exe-not-found', async () => {
    const root3 = path.join('D:', 'empty')
    const fsLike = createMemoryFs([path.join(root3, 'readme.txt')], [root3])

    const result = await resolveCustomTencentInstallation(root3, fsLike)

    expect(result).toEqual({ ok: false, reason: 'client-exe-not-found' })
  })

  it('输入不存在返回 input-not-exists', async () => {
    const result = await resolveCustomTencentInstallation(
      path.join('C:', 'not-exists'),
      standardLayout
    )

    expect(result).toEqual({ ok: false, reason: 'input-not-exists' })
  })
})
