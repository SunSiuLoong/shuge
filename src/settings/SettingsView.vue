<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, ChevronRight } from 'lucide-vue-next'
import { goBack } from '../router'
import { settings, THEME_LABELS, type ThemeKey, resetSettings } from '../settings'
import { READER_PALETTES } from '../reader/theme'
import { formatBytes, getStorageInfo, requestPersist, type StorageInfo } from '../storage/opfs'
import { APP_VERSION } from '../version'
import SyncSection from './SyncSection.vue'
import MetaSection from './MetaSection.vue'

const info = ref<StorageInfo | null>(null)
const themes = Object.keys(THEME_LABELS) as ThemeKey[]

const usageText = computed(() => {
  if (!info.value) return '读取中…'
  return `${formatBytes(info.value.usage)} / ${formatBytes(info.value.quota)}`
})

const usagePercent = computed(() => {
  if (!info.value?.quota) return 0
  return Math.min(100, (info.value.usage / info.value.quota) * 100)
})

const persistText = computed(() =>
  info.value?.persisted ? '已持久化' : '未持久化（系统可能清理）',
)

const refresh = async (): Promise<void> => {
  info.value = await getStorageInfo()
}

const askPersist = async (): Promise<void> => {
  await requestPersist()
  await refresh()
}

const reset = (): void => {
  resetSettings()
}

onMounted(refresh)
</script>

<template>
  <div class="settings">
    <header class="topbar">
      <button class="icon-btn" type="button" aria-label="返回" @click="goBack">
        <ArrowLeft :size="20" :stroke-width="1.7" />
      </button>
      <h1 class="topbar__title">设置</h1>
    </header>

    <div class="settings__scroll scroll-y">
      <section class="group">
        <p class="group__title">阅读主题</p>
        <div class="themes">
          <button
            v-for="key in themes"
            :key="key"
            type="button"
            class="theme"
            :class="{ 'is-active': settings.theme === key }"
            @click="settings.theme = key"
          >
            <span
              class="theme__dot"
              :style="{
                background:
                  key === 'auto'
                    ? 'linear-gradient(135deg, #fbf9f4 50%, #16181a 50%)'
                    : READER_PALETTES[key].bg,
                color: key === 'auto' ? '#23211e' : READER_PALETTES[key].text,
              }"
            >文</span>
            <span class="theme__name">{{ THEME_LABELS[key] }}</span>
          </button>
        </div>
      </section>

      <section class="group">
        <p class="group__title">存储</p>
        <div class="line">
          <span>占用</span>
          <span class="line__value">{{ usageText }}</span>
        </div>
        <div class="meter"><i :style="{ width: `${usagePercent}%` }" /></div>
        <div class="line">
          <span>持久化</span>
          <span class="line__value">{{ persistText }}</span>
        </div>
        <button v-if="!info?.persisted" class="link" type="button" @click="askPersist">
          申请持久化存储，避免书库被系统清理
          <ChevronRight :size="15" :stroke-width="2" />
        </button>
      </section>

      <SyncSection />

      <MetaSection />

      <section class="group">
        <p class="group__title">其他</p>
        <button class="line line--btn" type="button" @click="reset">
          <span>恢复默认排版</span>
          <ChevronRight :size="15" :stroke-width="2" />
        </button>
        <div class="line">
          <span>版本</span>
          <span class="line__value">v{{ APP_VERSION }}</span>
        </div>
      </section>

      <p class="note">
        本地优先：书籍文件存在浏览器私有目录，不上传、不联网。换设备或清缓存会丢，重要藏书请自行留档。
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.settings .topbar {
  /* 设置页顶栏常驻分隔线：正文滚到栏下时需要一个明确的边界 */
  border-bottom-color: var(--line);
}

.settings__scroll {
  flex: 1;
  min-height: 0;
  padding: 8px 18px calc(40px + var(--safe-bottom));
}

.group {
  padding: 18px 0 6px;
  border-bottom: 1px solid var(--line);
}

.group:last-of-type {
  border-bottom: 0;
}

.group__title {
  margin: 0 0 12px;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--text-3);
}

.themes {
  display: flex;
  gap: 10px;
  padding-bottom: 12px;
}

.theme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.theme__dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 52px;
  border-radius: var(--radius);
  font-family: var(--font-serif);
  font-size: 18px;
  outline: 1px solid var(--line);
  outline-offset: -1px;
  transition: outline-color var(--dur) var(--ease);
}

.theme.is-active .theme__dot {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.theme__name {
  font-size: 11.5px;
  color: var(--text-2);
}

.theme.is-active .theme__name {
  color: var(--accent);
  font-weight: 600;
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  font-size: 14px;
  text-align: left;
  color: var(--text);
}

.line--btn:active {
  opacity: 0.6;
}

.line__value {
  font-size: 13px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.meter {
  height: 3px;
  margin: 2px 0 12px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}

.meter i {
  display: block;
  height: 100%;
  background: var(--accent);
}

.link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  font-size: 12.5px;
  color: var(--accent);
  text-align: left;
}

.note {
  margin: 22px 0 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
