import { makeAutoObservable, observable } from 'mobx'

export class ClientInstallationSettings {
  /**
   * 手动指定的腾讯服安装目录或 TCLS Client.exe 路径, 留空则走自动检测
   */
  customTencentInstallationPath: string = ''

  setCustomTencentInstallationPath(path: string) {
    this.customTencentInstallationPath = path
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export type CustomInstallationStatus = 'unset' | 'applied' | 'error'

export class ClientInstallationState {
  /**
   * 检测到的已经安装的 LeagueClient
   */
  leagueClientExecutablePaths: string[] = []

  /**
   * 检测英雄联盟的安装位置, 腾讯服务器
   */
  tencentInstallationPath: string | null = null

  tclsExecutablePath: string | null = null

  weGameLauncherExecutablePath: string | null = null

  /**
   * 额外检测 WeGame 的安装情况
   */
  weGameExecutablePath: string | null = null

  /**
   * 获取默认的 RiotClient 的路径
   */
  officialRiotClientExecutablePath: string | null = null

  detectedLiveStreamingClients: string[] = []

  /**
   * 手动指定安装路径的应用结果
   */
  customInstallationStatus: CustomInstallationStatus = 'unset'

  /**
   * 应用失败时的技术性原因, 供渲染层映射为 i18n 文案
   */
  customInstallationMessage: string | null = null

  setLeagueClientExecutablePaths(clients: string[]) {
    this.leagueClientExecutablePaths = clients
  }

  setTencentInstallationPath(path: string | null) {
    this.tencentInstallationPath = path
  }

  setWeGameExecutablePath(path: string | null) {
    this.weGameExecutablePath = path
  }

  setOfficialRiotClientExecutablePath(path: string | null) {
    this.officialRiotClientExecutablePath = path
  }

  setTclsExecutablePath(path: string | null) {
    this.tclsExecutablePath = path
  }

  setWeGameLauncherExecutablePath(path: string | null) {
    this.weGameLauncherExecutablePath = path
  }

  setDetectedLiveStreamingClients(clients: string[]) {
    this.detectedLiveStreamingClients = clients
  }

  setCustomInstallationStatus(status: CustomInstallationStatus) {
    this.customInstallationStatus = status
  }

  setCustomInstallationMessage(message: string | null) {
    this.customInstallationMessage = message
  }

  constructor() {
    makeAutoObservable(this, {
      leagueClientExecutablePaths: observable.struct,
      detectedLiveStreamingClients: observable.struct
    })
  }
}
