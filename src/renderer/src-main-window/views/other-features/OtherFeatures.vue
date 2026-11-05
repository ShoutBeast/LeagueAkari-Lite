<!--
  本地扩展页面: "其他功能"

  该目录下的代码不属于上游, 用于承载自行添加的功能, 便于与上游代码同步。
  Sidebar 与 routes 中各只有一处极小的挂载点, 新增功能只需要在下面追加 tab。
-->
<template>
  <TabbedPage
    :icon="ToolsIcon"
    :title="t('otherFeatures.title')"
    :tabs="tabs"
    route-name="other-features"
    default-tab="ace-guard"
  />
</template>

<script setup lang="ts">
import { Tools as ToolsIcon } from '@vicons/carbon'
import { Settings24Filled, Shield24Filled } from '@vicons/fluent'
import { useTranslation } from 'i18next-vue'
import { computed } from 'vue'

import TabbedPage, { TabConfig } from '@main-window/components/TabbedPage.vue'

import AceGuard from './ace-guard/AceGuard.vue'
import ManualClient from './manual-client/ManualClient.vue'

const { t } = useTranslation()

const tabs = computed<TabConfig[]>(() => [
  {
    key: 'ace-guard',
    name: t('otherFeatures.aceGuard.tab'),
    icon: Shield24Filled,
    component: AceGuard
  },
  {
    key: 'manual-client',
    name: t('otherFeatures.manualClient.tab'),
    icon: Settings24Filled,
    component: ManualClient
  }
])
</script>
