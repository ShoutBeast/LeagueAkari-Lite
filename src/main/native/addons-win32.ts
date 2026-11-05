export type Win32Addons = typeof import('league-akari-native-win32')

export interface Win32AddonsInitializationResult {
  addons: Win32Addons
  isElevated: boolean
  inputInitializationError?: unknown
  processControlInitializationError?: unknown
}

type RegisterExitListener = (listener: () => void) => void

function loadWin32AddonsPackage(): Win32Addons {
  return require('league-akari-native-win32') as Win32Addons
}

function registerProcessExitListener(listener: () => void) {
  process.once('exit', listener)
}

export function initializeWin32Addons(
  addons: Win32Addons = loadWin32AddonsPackage(),
  registerExitListener: RegisterExitListener = registerProcessExitListener
): Win32AddonsInitializationResult {
  addons.tools.load()

  // 进程控制插件缺失时不应影响其余原生能力
  let processControlInitializationError: unknown
  try {
    addons.processControl.load()
  } catch (error) {
    processControlInitializationError = error
  }

  const isElevated = addons.tools.isElevated()
  if (!isElevated) {
    return { addons, isElevated, processControlInitializationError }
  }

  try {
    addons.input.load()
    addons.input.instance.install()

    registerExitListener(() => {
      if (addons.input.instance.isInstalled) {
        addons.input.instance.uninstall()
      }
    })

    return { addons, isElevated, processControlInitializationError }
  } catch (inputInitializationError) {
    return { addons, isElevated, inputInitializationError, processControlInitializationError }
  }
}
