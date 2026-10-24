import { defineStore } from 'pinia'
import { reactive, ref, shallowRef } from 'vue'

export type ClientInstallationCustomStatus = 'unset' | 'applied' | 'error'

export const useClientInstallationStore = defineStore('shard:client-installation-renderer', () => {
  const leagueClientExecutablePaths = shallowRef<string[]>([])
  const tencentInstallationPath = ref<string | null>(null)
  const weGameExecutablePath = ref<string | null>(null)
  const officialRiotClientExecutablePath = ref<string | null>(null)
  const detectedLiveStreamingClients = shallowRef<string[]>([])

  const tclsExecutablePath = ref<string | null>(null)
  const weGameLauncherExecutablePath = ref<string | null>(null)

  const customInstallationStatus = ref<ClientInstallationCustomStatus>('unset')
  const customInstallationMessage = ref<string | null>(null)

  const settings = reactive({
    customTencentInstallationPath: ''
  })

  return {
    leagueClientExecutablePaths,
    tencentInstallationPath,
    weGameExecutablePath,
    officialRiotClientExecutablePath,
    tclsExecutablePath,
    weGameLauncherExecutablePath,
    detectedLiveStreamingClients,
    customInstallationStatus,
    customInstallationMessage,
    settings
  }
})
