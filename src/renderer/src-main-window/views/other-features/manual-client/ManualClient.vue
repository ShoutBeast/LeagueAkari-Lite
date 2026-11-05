<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto flex max-w-200 flex-col gap-6 p-6">
        <SettingsSection :title="t('otherFeatures.manualClient.section')">
          <SettingsRow
            :label="t('otherFeatures.manualClient.path.label')"
            :label-description="t('otherFeatures.manualClient.path.description')"
            :label-width="400"
            control-full-line
            align="start"
          >
            <div class="flex w-full flex-col gap-2">
              <NInput
                v-model:value="pathInput"
                size="small"
                clearable
                :placeholder="t('otherFeatures.manualClient.path.placeholder')"
                @keyup.enter="applyPath"
              />

              <div class="flex flex-wrap items-center gap-2">
                <NButton size="small" @click="pickPath('directory')">
                  {{ t('otherFeatures.manualClient.pickDirectory') }}
                </NButton>
                <NButton size="small" @click="pickPath('executable')">
                  {{ t('otherFeatures.manualClient.pickExecutable') }}
                </NButton>
                <NButton size="small" type="primary" secondary @click="applyPath">
                  {{ t('otherFeatures.manualClient.apply') }}
                </NButton>
                <NButton
                  v-if="cis.settings.customTencentInstallationPath"
                  size="small"
                  quaternary
                  @click="clearPath"
                >
                  {{ t('otherFeatures.manualClient.clear') }}
                </NButton>
              </div>

              <div
                v-if="cis.customInstallationStatus === 'applied' && cis.tclsExecutablePath"
                class="min-w-0 text-xs text-green-600 dark:text-green-400"
              >
                {{ t('otherFeatures.manualClient.applied') }}
                <span class="font-mono break-all">{{ cis.tclsExecutablePath }}</span>
              </div>
              <div
                v-else-if="cis.customInstallationStatus === 'error'"
                class="text-xs text-red-600 dark:text-red-400"
              >
                {{ errorText }}
              </div>
            </div>
          </SettingsRow>
        </SettingsSection>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import SettingsRow from '@renderer-shared/components/SettingsRow.vue'
import SettingsSection from '@renderer-shared/components/SettingsSection.vue'
import { useInstance } from '@renderer-shared/shards'
import { ClientInstallationRenderer } from '@renderer-shared/shards/client-installation'
import { useClientInstallationStore } from '@renderer-shared/shards/client-installation/store'
import { useTranslation } from 'i18next-vue'
import { NButton, NInput, NScrollbar } from 'naive-ui'
import { computed, ref, watch } from 'vue'

const { t } = useTranslation()

const cis = useClientInstallationStore()
const ci = useInstance(ClientInstallationRenderer)

const pathInput = ref(cis.settings.customTencentInstallationPath)

watch(
  () => cis.settings.customTencentInstallationPath,
  (value) => {
    pathInput.value = value
  }
)

const errorText = computed(() => {
  const reason = cis.customInstallationMessage
  if (
    reason === 'input-not-exists' ||
    reason === 'not-client-exe' ||
    reason === 'client-exe-not-found'
  ) {
    return t(`otherFeatures.manualClient.error.${reason}`)
  }

  return `${t('otherFeatures.manualClient.invalid')} (${reason ?? ''})`
})

const pickPath = async (mode: 'directory' | 'executable') => {
  const picked = await ci.pickCustomInstallationPath(mode)

  if (picked) {
    pathInput.value = picked
    await applyPath()
  }
}

const applyPath = async () => {
  await ci.setCustomTencentInstallationPath(pathInput.value.trim())
}

const clearPath = () => {
  pathInput.value = ''
  void ci.setCustomTencentInstallationPath('')
}
</script>
