<template>
  <div class="h-full w-full">
    <NScrollbar class="relative h-full max-w-full">
      <div class="mx-auto flex max-w-200 flex-col gap-6 p-6">
        <NAlert v-if="!ags.available" type="warning" :bordered="false">
          {{ t('otherFeatures.aceGuard.unavailable') }}
        </NAlert>
        <NAlert v-else-if="!ags.elevated" type="warning" :bordered="false">
          {{ t('otherFeatures.aceGuard.requireElevation') }}
        </NAlert>

        <SettingsSection :title="t('otherFeatures.aceGuard.section')">
          <SettingsRow
            :label="t('otherFeatures.aceGuard.enabled.label')"
            :label-description="t('otherFeatures.aceGuard.enabled.description')"
            :label-width="400"
          >
            <NSwitch
              size="small"
              :value="ags.settings.enabled"
              :disabled="!canOperate"
              @update:value="(value) => ag.setEnabled(value)"
            />
          </SettingsRow>

          <SettingsRow
            :label="t('otherFeatures.aceGuard.profile.label')"
            :label-description="t('otherFeatures.aceGuard.profile.description')"
            :label-width="400"
          >
            <NRadioGroup
              size="small"
              :value="ags.settings.profile"
              :disabled="!canOperate"
              @update:value="setProfile"
            >
              <NRadioButton value="conservative">
                {{ t('otherFeatures.aceGuard.profile.options.conservative') }}
              </NRadioButton>
              <NRadioButton value="standard">
                {{ t('otherFeatures.aceGuard.profile.options.standard') }}
              </NRadioButton>
              <NRadioButton value="aggressive">
                {{ t('otherFeatures.aceGuard.profile.options.aggressive') }}
              </NRadioButton>
            </NRadioGroup>
          </SettingsRow>

          <SettingsRow
            :label="t('otherFeatures.aceGuard.writeIfeo.label')"
            :label-description="t('otherFeatures.aceGuard.writeIfeo.description')"
            :label-width="400"
          >
            <NSwitch
              size="small"
              :value="ags.settings.writeIfeo"
              :disabled="!canOperate"
              @update:value="(value) => ag.setWriteIfeo(value)"
            />
          </SettingsRow>

          <SettingsRow
            :label="t('otherFeatures.aceGuard.targets.label')"
            :label-description="t('otherFeatures.aceGuard.targets.description')"
            :label-width="400"
            control-full-line
          >
            <div class="flex flex-wrap gap-1">
              <NTag v-for="name of ags.settings.targets" :key="name" size="small">{{ name }}</NTag>
            </div>
          </SettingsRow>

          <SettingsRow
            :label="t('otherFeatures.aceGuard.cpuSets.label')"
            :label-description="cpuSetText"
            :label-width="400"
          >
            <NButton
              size="small"
              secondary
              :disabled="!canOperate"
              :loading="ags.scanning"
              @click="() => ag.scanNow()"
            >
              {{ t('otherFeatures.aceGuard.scanNow') }}
            </NButton>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection :title="t('otherFeatures.aceGuard.reports')">
          <div class="flex flex-col gap-2 p-3">
            <div
              v-for="item of ags.processes"
              :key="item.pid"
              class="rounded-lg bg-white/60 p-3 dark:bg-white/5"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold text-black/80 dark:text-white/90">{{
                  item.exeName
                }}</span>
                <span class="text-[11px] text-black/45 dark:text-white/45">PID {{ item.pid }}</span>
              </div>

              <div class="mt-2 flex flex-wrap gap-1">
                <NTag
                  v-for="limit of limitItems(item)"
                  :key="limit.key"
                  size="tiny"
                  :type="tagType(limit.state)"
                >
                  {{ limit.label }}: {{ t(`otherFeatures.aceGuard.state.${limit.state}`) }}
                </NTag>
              </div>

              <div
                v-if="item.detail"
                class="mt-1 font-mono text-[11px] text-black/40 dark:text-white/40"
              >
                {{ item.detail }}
              </div>
            </div>

            <div v-if="!ags.processes.length" class="text-xs text-black/50 dark:text-white/50">
              {{ t('otherFeatures.aceGuard.empty') }}
            </div>
          </div>
        </SettingsSection>

        <NAlert type="error" :bordered="false">{{ t('otherFeatures.aceGuard.risk') }}</NAlert>
      </div>
    </NScrollbar>
  </div>
</template>

<script setup lang="ts">
import SettingsRow from '@renderer-shared/components/SettingsRow.vue'
import SettingsSection from '@renderer-shared/components/SettingsSection.vue'
import { useInstance } from '@renderer-shared/shards'
import { AceGuardRenderer } from '@renderer-shared/shards/ace-guard'
import {
  useAceGuardStore,
  type AceGuardProfile,
  type AceLimitState,
  type AceProcessReport
} from '@renderer-shared/shards/ace-guard/store'
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NRadioButton, NRadioGroup, NScrollbar, NSwitch, NTag } from 'naive-ui'
import { computed } from 'vue'

const { t } = useTranslation()

const ags = useAceGuardStore()
const ag = useInstance(AceGuardRenderer)

const canOperate = computed(() => ags.available && ags.elevated)

const cpuSetText = computed(() => {
  const topology = ags.cpuSets
  if (!topology) {
    return ''
  }

  if (!topology.hybrid) {
    return t('otherFeatures.aceGuard.cpuSets.flat')
  }

  return t('otherFeatures.aceGuard.cpuSets.hybrid', {
    efficiency: topology.efficiencyCores.length,
    performance: topology.performanceCores.length
  })
})

const LIMIT_KEYS = [
  'priority',
  'cpuSets',
  'ecoQos',
  'memoryPriority',
  'ioPriority',
  'pagePriority',
  'job'
] as const

const limitItems = (report: AceProcessReport) => {
  return LIMIT_KEYS.map((key) => ({
    key,
    label: t(`otherFeatures.aceGuard.limits.${key}`),
    state: report.limits[key]
  }))
}

const tagType = (state: AceLimitState): 'default' | 'info' | 'success' | 'warning' | 'error' => {
  switch (state) {
    case 'applied':
      return 'success'
    case 'denied':
      return 'error'
    case 'reverted':
    case 'blocked':
      return 'warning'
    case 'pending':
      return 'info'
    default:
      return 'default'
  }
}

const setProfile = (value: string | number | boolean) => ag.setProfile(value as AceGuardProfile)
</script>
