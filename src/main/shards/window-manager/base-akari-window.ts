import { is } from '@electron-toolkit/utils'
import { i18next } from '@main/i18n'
import { LEAGUE_AKARI_GITHUB } from '@shared/constants/common'
import { Paths } from '@shared/utils/types'
import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Event,
  IgnoreMouseEventsOptions,
  app,
  dialog,
  screen,
  shell
} from 'electron'
import { comparer, runInAction } from 'mobx'
import EventEmitter from 'node:events'
import path from 'node:path'
import { z } from 'zod'

import type { WindowManagerMain } from '.'
import { AkariProtocolMain } from '../akari-protocol'
import { AppCommonMain } from '../app-common'
import { GameClientMain } from '../game-client'
import { AkariIpcMain } from '../ipc'
import { KeyboardShortcutsMain } from '../keyboard-shortcuts'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingSchema } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { WindowManagerMainContext } from './context'
import {
  TRACKED_BOUNDS_SETTLE_MS,
  createTrackedBounds,
  getMaxDisplayDimension,
  repositionWindowIfInvisible,
  rescueWindowIfUnreachable,
  resolveTrackedBounds,
  sanitizeRestoredContentBounds
} from './window-position-service'
import type { TrackedWindowBounds } from './window-position-service'

/**
 * 具备的一些基础属性
 */
export interface BaseAkariWindowBasicState {
  status: 'normal' | 'maximized' | 'minimized'

  focus: 'focused' | 'blurred'

  ready: boolean

  show: boolean

  trackedBounds: TrackedWindowBounds | null
}

export interface AkariBaseWindowConfig<TSettings extends BaseAkariWindowBasicSetting> {
  baseWidth: number
  baseHeight: number
  minWidth: number
  minHeight: number

  /**
   * 设置项的额外 schema
   */
  settingSchema?: SettingSchema<TSettings>

  /**
   * HTML 入口文件, 对应 renderer 目录下对应文件
   */
  htmlEntry: string | { path: string; hash: string }

  /**
   * 重新定位窗口, 当窗口不可见时, default: false
   */
  repositionWindowIfInvisible?: boolean

  /**
   * 将记忆上一次的窗口位置, default: false
   */
  rememberPosition?: boolean

  /**
   * 将记忆上一次的窗口大小, default: false
   */
  rememberSize?: boolean

  /**
   * BrowserWindow 选项
   */
  browserWindowOptions?: BrowserWindowConstructorOptions
}

export interface BaseAkariWindowBasicSetting {
  pinned: boolean

  // 一些情况下, 在设置非 1 的不透明度后将完全不可见
  // 该问题位于 https://github.com/electron/electron/issues/45730
  opacity: number
}

/**
 * 预制菜, 封装了窗口的常见状态
 */
export abstract class BaseAkariWindow<
  TState extends BaseAkariWindowBasicState,
  TSettings extends BaseAkariWindowBasicSetting
> extends EventEmitter {
  protected _window: BrowserWindow | null = null
  protected _namespace: string
  protected _partition: string
  protected _logger: AkariLogger

  protected _forceReadyTimerId: NodeJS.Timeout | null = null
  protected _trueClose = false

  /** 窗口停稳后延迟记录尺寸的定时器 */
  protected _boundsSettleTimerId: NodeJS.Timeout | null = null

  /** 创建时希望恢复的内容区域, 用于窗口真正显示后校正 Chromium 应用失真的尺寸 */
  protected _pendingRestoreBounds: Electron.Rectangle | null = null

  protected readonly _settingService: SetterSettingService<TSettings>

  protected readonly _appCommon: AppCommonMain

  /** an alias for this._context.ipc */
  protected readonly _ipc: AkariIpcMain

  /** an alias for this._context.mobxUtils */
  protected readonly _mobxUtils: MobxUtilsMain

  /** an alias for this._context.leagueClient */
  protected readonly _leagueClient: LeagueClientMain

  /** an alias for this._context.gameClient */
  protected readonly _gameClient: GameClientMain

  /** an alias for this._context.windowManager */
  protected readonly _windowManager: WindowManagerMain

  /** an alias for this._context.loggerFactory */
  protected readonly _loggerFactory: LoggerFactoryMain

  /** an alias for this._context.protocol */
  protected readonly _protocol: AkariProtocolMain

  protected readonly _keyboardShortcuts: KeyboardShortcutsMain

  constructor(
    /**
     * 由窗口管理器提供的上下文信息
     */
    protected _context: WindowManagerMainContext,

    /**
     * 命名空间后缀, {windowManagerId}/{suffix}
     */
    protected _namespaceSuffix: string,

    /**
     * 窗口封装状态
     */
    public state: TState,

    /**
     * 窗口设置项状态
     */
    public settings: TSettings,

    protected _config: AkariBaseWindowConfig<TSettings>
  ) {
    super()

    this._namespace = `${_context.namespace}/${_namespaceSuffix}`
    this._partition = `persist:${_namespaceSuffix}`
    this._logger = _context.loggerFactory.create(this._namespace)
    this._appCommon = _context.appCommon
    this._ipc = _context.ipc
    this._mobxUtils = _context.mobxUtils
    this._leagueClient = _context.leagueClient
    this._gameClient = _context.gameClient
    this._windowManager = _context.windowManager
    this._loggerFactory = _context.loggerFactory
    this._protocol = _context.protocol
    this._keyboardShortcuts = _context.keyboardShortcuts
    this._settingService = _context.settingFactory.register(
      this._namespace,
      {
        // @ts-ignore
        pinned: { default: this.settings.pinned, schema: z.boolean() },
        opacity: { default: this.settings.opacity, schema: z.number() },
        ...this._config.settingSchema
      },
      this.settings
    )
  }

  get window() {
    return this._window
  }

  protected _baseWindowIpcCall() {
    this._context.ipc.onCall(this._namespace, 'setSize', async (_, width, height, animate) => {
      this._window?.setSize(width, height, animate)
    })

    this._context.ipc.onCall(this._namespace, 'getSize', async () => {
      return this._window?.getSize()
    })

    this._context.ipc.onCall(this._namespace, 'setPosition', async (_, x, y, animate) => {
      this._window?.setPosition(x, y, animate)
    })

    this._context.ipc.onCall(this._namespace, 'getPosition', async () => {
      return this._window?.getPosition()
    })

    this._context.ipc.onCall(this._namespace, 'minimize', async () => {
      this._window?.minimize()
    })

    this._context.ipc.onCall(this._namespace, 'maximize', async () => {
      this._window?.maximize()
    })

    this._context.ipc.onCall(this._namespace, 'unmaximize', async () => {
      this._window?.unmaximize()
    })

    this._context.ipc.onCall(this._namespace, 'restore', async () => {
      this._window?.restore()
    })

    this._context.ipc.onCall(this._namespace, 'close', async () => {
      this._window?.close()
    })

    this._context.ipc.onCall(this._namespace, 'toggleDevtools', async () => {
      this._window?.webContents.toggleDevTools()
    })

    this._context.ipc.onCall(this._namespace, 'setTitle', (_, title) => {
      this._window?.setTitle(title)
    })

    this._context.ipc.onCall(this._namespace, 'hide', () => {
      this.hide()
    })

    this._context.ipc.onCall(this._namespace, 'show', (_, inactive: boolean = false) => {
      this.showOrRestore(inactive)
    })

    this._context.ipc.onCall(this._namespace, 'resetPosition', () => {
      this.resetPosition()
    })

    this._context.ipc.onCall(this._namespace, 'repositionWindowIfInvisible', () => {
      this.repositionWindowIfInvisible()
    })

    this._context.ipc.onCall(this._namespace, 'downloadUrl', (event, url: string) => {
      const sender = event.sender
      sender.downloadURL(url)
    })

    this._context.ipc.onCall(
      this._namespace,
      'setIgnoreMouseEvents',
      (_, ignore, options: IgnoreMouseEventsOptions) => {
        this._window?.setIgnoreMouseEvents(ignore, options)
      }
    )
  }

  protected _baseWindowObservations() {
    this._context.mobxUtils.reaction(
      () => this.settings.opacity,
      (o) => {
        this._window?.setOpacity(o)
      },
      { fireImmediately: true }
    )

    this._context.mobxUtils.reaction(
      () => this.settings.pinned,
      (pinned) => {
        this._window?.setAlwaysOnTop(pinned, 'screen-saver')
      },
      { fireImmediately: true }
    )

    this._context.mobxUtils.reaction(
      () => this.state.trackedBounds,
      (bounds) => {
        if (bounds) {
          this._settingService._saveToStorage('trackedBounds', bounds, { delay: 1000 })
        }
      },
      { equals: comparer.shallow }
    )

    this._context.mobxUtils.reaction(
      () => this._windowManager.settings.contentProtection,
      (enabled) => {
        this._window?.setContentProtection(enabled)
      },
      { fireImmediately: true }
    )
  }

  protected _createWindow() {
    const { webPreferences, ...rest } = this._config.browserWindowOptions || {}

    this._window = new BrowserWindow({
      width: this._config.baseWidth,
      height: this._config.baseHeight,
      minWidth: this._config.minWidth,
      minHeight: this._config.minHeight,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        spellcheck: false,
        partition: this._partition,
        backgroundThrottling: false,
        additionalArguments: [`--akari-window-type=${this._namespaceSuffix}`],
        ...webPreferences
      },
      ...rest
    })

    this._window.once('ready-to-show', () => {
      this._logger.info(`BrowserWindow ready-to-show (${this._namespace})`)

      if (this._forceReadyTimerId) {
        clearTimeout(this._forceReadyTimerId)
        this._forceReadyTimerId = null
      }
      runInAction(() => (this.state.ready = true))

      this._applyPendingRestoreBounds()

      if (this._window && this._config.repositionWindowIfInvisible) {
        // 仅抢救完全无法触及的窗口, 不干扰用户调整过的窗口位置与大小
        rescueWindowIfUnreachable(this._window)
      }
    })

    runInAction(() => {
      this.state.show = this._config.browserWindowOptions?.show ?? true

      // type guard
      if (!this._window) {
        return
      }

      if (this._window.isMinimized()) {
        this.state.status = 'minimized'
      } else {
        this.state.status = 'normal'
      }
    })

    this._window.webContents.on('before-input-event', (event, input) => {
      if (
        (input.control && input.key.toLowerCase() === 'w') ||
        (input.control && input.key.toLowerCase() === 'r') ||
        (input.meta && input.key.toLowerCase() === 'r')
      ) {
        event.preventDefault()
      }
    })

    this._window.setContentProtection(this._windowManager.settings.contentProtection)
    this._window.setOpacity(this.settings.opacity)
    this._window.setAlwaysOnTop(this.settings.pinned, 'screen-saver')

    runInAction(() => (this.state.focus = this._window!.isFocused() ? 'focused' : 'blurred'))

    const restoreTarget = this.state.trackedBounds
    const targetDisplay = restoreTarget
      ? screen.getDisplayMatching(restoreTarget)
      : screen.getPrimaryDisplay()

    const restoredBounds = sanitizeRestoredContentBounds(
      restoreTarget,
      this._config.minWidth,
      this._config.minHeight,
      getMaxDisplayDimension(),
      { workArea: targetDisplay.workArea }
    )

    if (restoredBounds) {
      if (this._config.rememberPosition && this._config.rememberSize) {
        this._window.setContentBounds(restoredBounds)
        this._pendingRestoreBounds = restoredBounds
      } else if (this._config.rememberPosition) {
        this._window.setPosition(restoredBounds.x, restoredBounds.y)
      } else if (this._config.rememberSize) {
        this._window.setContentSize(restoredBounds.width, restoredBounds.height)
        this._window.center()
      }
    } else {
      // 没有可用记忆值时, 仍要用 DIP 显式设置一次默认尺寸。
      // BrowserWindow 的构造参数在非 100% 缩放的显示器上会被当成物理像素放大,
      // 只有 setContentBounds 能保证按 DIP 生效。
      const current = this._window.getContentBounds()
      this._window.setContentBounds({
        x: current.x,
        y: current.y,
        width: this._config.baseWidth,
        height: this._config.baseHeight
      })
    }

    this._window.webContents.on('dom-ready', () => {
      this._logger.info(`WebContents dom-ready (${this._namespace})`)
    })

    this._window.webContents.on('did-finish-load', () => {
      this._window?.webContents.setZoomFactor(1.0)

      this._logger.info(`WebContents did-finish-load (${this._namespace})`)

      if (this._forceReadyTimerId) {
        clearTimeout(this._forceReadyTimerId)
        this._forceReadyTimerId = null
      }

      if (this.state.ready) {
        return
      }

      this._forceReadyTimerId = setTimeout(() => {
        this._logger.warn(`WebContents force-ready (${this._namespace})`)
        runInAction(() => (this.state.ready = true))
      }, 5000)
    })

    this._window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        this._logger.error(`WebContents did-fail-load (${this._namespace})`, {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame
        })
      }
    )

    this._window.webContents.on('render-process-gone', (_event, details) => {
      this._logger.warn(`WebContents render-process-gone (${this._namespace})`, details)
    })

    this._window.on('unresponsive', () => {
      this._logger.warn(`BrowserWindow unresponsive (${this._namespace})`)
    })

    this._window.on('responsive', () => {
      this._logger.info(`BrowserWindow responsive (${this._namespace})`)
    })

    this._window.webContents.setWindowOpenHandler((details) => {
      dialog
        .showMessageBox(this._window!, {
          type: 'question',
          buttons: [i18next.t('yes', { ns: 'common' }), i18next.t('no', { ns: 'common' })],
          defaultId: 0,
          title: i18next.t('confirm', { ns: 'common' }),
          message: details.url.startsWith(LEAGUE_AKARI_GITHUB)
            ? i18next.t('windowOpenHandler.toAkari')
            : i18next.t('windowOpenHandler.toExternalLink', {
                target: new URL(details.url).origin
              }),
          detail: details.url
        })
        .then((r) => {
          if (r.response === 0) {
            shell.openExternal(details.url)
          }
        })

      return { action: 'deny' }
    })

    this._window.on('unmaximize', () => {
      runInAction(() => (this.state.status = 'normal'))
    })

    this._window.on('maximize', () => {
      runInAction(() => (this.state.status = 'maximized'))
    })

    this._window.on('minimize', () => {
      runInAction(() => (this.state.status = 'minimized'))
    })

    this._window.on('restore', () => {
      runInAction(() => (this.state.status = 'normal'))
    })

    this._window.on('focus', () => {
      runInAction(() => (this.state.focus = 'focused'))
    })

    this._window.on('blur', () => {
      runInAction(() => (this.state.focus = 'blurred'))
    })

    this._window.on('show', () => {
      this._logger.info(`BrowserWindow show (${this._namespace})`)
      runInAction(() => (this.state.show = true))
    })

    this._window.on('hide', () => {
      this._logger.info(`BrowserWindow hide (${this._namespace})`)
      runInAction(() => (this.state.show = false))
    })

    this._window.on('closed', () => {
      this._logger.info(`BrowserWindow closed (${this._namespace})`)

      if (this._boundsSettleTimerId) {
        clearTimeout(this._boundsSettleTimerId)
        this._boundsSettleTimerId = null
      }

      this._pendingRestoreBounds = null

      runInAction(() => (this.state.ready = false))
      this._window = null
    })

    const captureBounds = () => {
      const win = this._window
      if (!win || win.isDestroyed()) {
        return
      }

      if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) {
        return
      }

      // 取整存储, 避免小数坐标在反复记忆与恢复间累积漂移
      const contentBounds = win.getContentBounds()
      const measured = createTrackedBounds(contentBounds, screen.getDisplayMatching(contentBounds))

      // 跨 DPI 显示器时 Chromium 会按缩放系数放大或缩小报告尺寸,
      // 由 resolveTrackedBounds 识别这类误报并沿用上一次的尺寸。
      const trackedBounds = resolveTrackedBounds(measured, this.state.trackedBounds)

      runInAction(() => (this.state.trackedBounds = trackedBounds))
    }

    // 窗口停稳之后才记录。跨 DPI 显示器切换抛出的中间尺寸只持续几毫秒,
    // 立即记录会把被缩放系数放大过的值写进存档。
    const scheduleBoundsCapture = () => {
      if (this._boundsSettleTimerId) {
        clearTimeout(this._boundsSettleTimerId)
      }

      this._boundsSettleTimerId = setTimeout(() => {
        this._boundsSettleTimerId = null
        captureBounds()
      }, TRACKED_BOUNDS_SETTLE_MS)
    }

    this._window.on('move', () => {
      scheduleBoundsCapture()
    })

    this._window.on('resize', () => {
      scheduleBoundsCapture()
    })

    this._window.on('page-title-updated', (e) => e.preventDefault())

    this._window.on('close', (e) => {
      this.handleClose(e)
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      if (typeof this._config.htmlEntry !== 'string') {
        this._window.loadURL(
          `${process.env['ELECTRON_RENDERER_URL']}/${this._config.htmlEntry.path}#${this._config.htmlEntry.hash}`
        )
      } else {
        this._window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${this._config.htmlEntry}`)
      }
    } else {
      if (typeof this._config.htmlEntry !== 'string') {
        this._window.loadFile(path.join(__dirname, `../renderer/${this._config.htmlEntry.path}`), {
          hash: this._config.htmlEntry.hash
        })
      } else {
        this._window.loadFile(path.join(__dirname, `../renderer/${this._config.htmlEntry}`))
      }
    }

    this._window.webContents.session.on('will-download', (_event, item) => {
      const filename = item.getFilename()
      const url = item.getURL()
      const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

      item.setSaveDialogOptions({
        title: i18next.t('window-manager-main.download.dialogTitle'),
        defaultPath: path.join(app.getPath('downloads'), filename),
        buttonLabel: i18next.t('window-manager-main.download.dialogButtonLabel')
      })

      runInAction(() => {
        this._windowManager.state.addDownloadTask({
          id: taskId,
          filename,
          url,
          savePath: '',
          receivedBytes: 0,
          totalBytes: item.getTotalBytes(),
          state: 'progressing',
          startTime: Date.now()
        })
      })

      item.on('updated', (_e, state) => {
        if (state === 'progressing') {
          const received = item.getReceivedBytes()
          const total = item.getTotalBytes()

          runInAction(() => {
            this._windowManager.state.updateDownloadTask(taskId, {
              receivedBytes: received,
              totalBytes: total,
              state: 'progressing'
            })
          })
        }
      })

      item.once('done', (_e, state) => {
        const endTime = Date.now()
        const savePath = item.getSavePath()

        if (state === 'completed') {
          this._logger.info(`Download completed: ${savePath}`)
        } else {
          this._logger.info(`Download ended with state: ${state}`)
        }

        runInAction(() => {
          this._windowManager.state.updateDownloadTask(taskId, {
            state: state as 'completed' | 'interrupted' | 'cancelled',
            savePath,
            endTime,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes()
          })
        })
      })
    })

    this._logger.info(`Create ${this._namespace}`)
  }

  /**
   * Chromium 在跨 DPI 显示器上未必会精确应用 setContentBounds 的目标值,
   * 窗口真正显示出来后校验一次, 尺寸明显偏移时纠正回去。
   */
  protected _applyPendingRestoreBounds() {
    const target = this._pendingRestoreBounds
    this._pendingRestoreBounds = null

    const win = this._window
    if (!target || !win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) {
      return
    }

    const current = win.getContentBounds()
    if (
      Math.abs(current.width - target.width) <= 2 &&
      Math.abs(current.height - target.height) <= 2
    ) {
      return
    }

    this._logger.warn(`Content bounds drifted from restore target, reapplying`, {
      target,
      current
    })
    win.setContentBounds(target)
  }

  setOpacity(opacity: number) {
    runInAction(() => {
      this.settings.opacity = opacity
    })
  }

  setPinned(pinned: boolean) {
    runInAction(() => {
      this.settings.pinned = pinned
    })
  }

  createWindow() {
    if (!this._window || this._window.isDestroyed()) {
      this._createWindow()
    }
  }

  showOrRestore(inactive = false) {
    if (this._window) {
      if (!this.state.show) {
        if (inactive) {
          this._window.showInactive()
        } else {
          this._window.show()
        }

        return
      }

      if (this._window.isMinimized()) {
        this._window.restore()
      }

      if (!inactive) {
        this._window.focus()
      }
    }
  }

  show(inactive = false) {
    if (this._window && !this.state.show) {
      if (inactive) {
        this._window.showInactive()
      } else {
        this._window.show()
      }
    }
  }

  hide() {
    if (this._window && this.state.show) {
      this._window.hide()
    }
  }

  /**
   * 隐藏窗口或真正关闭窗口
   *
   * @param trueClose 否则为 hide
   */
  close(trueClose = false) {
    if (this._window) {
      this._trueClose = trueClose
      this._window.close()
      this._trueClose = false
    }
  }

  resetPosition() {
    if (this._window) {
      this._window.center()
    }

    this._logger.info(`Reset ${this._namespace} position to main display center`)
  }

  repositionWindowIfInvisible() {
    if (this._window) {
      repositionWindowIfInvisible(this._window)
    }

    this._logger.info(`Reposition ${this._namespace} window if invisible`)
  }

  toggleDevtools() {
    this._window?.webContents.toggleDevTools()
  }

  toggleMinimizedAndFocused() {
    if (this._window) {
      if (!this.state.show) {
        this._window.show()
        this._window.focus()
        return
      }

      if (this._window.isMinimized()) {
        this._window.restore()
        this._window.focus()
      } else {
        this._window.minimize()
      }
    }
  }

  protected getStatePropKeys(): readonly Paths<TState>[] {
    return []
  }

  protected getSettingPropKeys(): readonly Paths<TSettings>[] {
    return []
  }

  /**
   * 默认的关闭行为是隐藏窗口
   */
  protected handleClose(e: Event) {
    if (this._trueClose || this._context.shared.global.isReadyToQuit) {
      return
    }

    e.preventDefault()
    this.hide()
  }

  async onInit() {
    await this._settingService.applyToState()

    this._protocol.registerPartition(this._partition)

    // @ts-ignore
    this._context.mobxUtils.propSync(this._namespace, 'state', this.state, [
      'focus',
      'ready',
      'status',
      'show',
      'trackedBounds',
      ...this.getStatePropKeys()
    ])

    // @ts-ignore
    this._context.mobxUtils.propSync(this._namespace, 'settings', this.settings, [
      'opacity',
      'pinned',
      ...this.getSettingPropKeys()
    ])

    const bounds = await this._settingService._getFromStorage('trackedBounds')
    if (bounds) {
      runInAction(() => (this.state.trackedBounds = bounds))
    }

    this._baseWindowIpcCall()
    this._baseWindowObservations()
  }

  async onDispose() {
    if (this._forceReadyTimerId) {
      clearTimeout(this._forceReadyTimerId)
      this._forceReadyTimerId = null
    }

    if (this._boundsSettleTimerId) {
      clearTimeout(this._boundsSettleTimerId)
      this._boundsSettleTimerId = null
    }
  }

  async onFinish() {}
}
