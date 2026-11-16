<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, Check, ChevronRight } from 'lucide-vue-next'
import { goBack, navigate } from '../router'
import {
  settings,
  SCHEME_LABELS,
  THEME_LABELS,
  UI_STYLE_LABELS,
  UI_STYLE_NOTES,
  resetSettings,
  type SchemeKey,
  type ThemeKey,
  type UiStyleKey,
} from '../settings'
import { READER_PALETTES } from '../reader/theme'
import { formatBytes, getStorageInfo, requestPersist, type StorageInfo } from '../storage/opfs'
import { APP_VERSION } from '../version'
import {
  SORT_LABELS,
  groupMode,
  setGroupMode,
  setSort,
  sortKey,
  type SortKey,
} from '../shelf/store'
import SyncSection from './SyncSection.vue'
import MetaSection from './MetaSection.vue'

const info = ref<StorageInfo | null>(null)
const themes = Object.keys(THEME_LABELS) as ThemeKey[]
const schemes = Object.keys(SCHEME_LABELS) as SchemeKey[]
const styles = Object.keys(UI_STYLE_LABELS) as UiStyleKey[]
const columns = [2, 3, 4]

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

const toggleGroup = (): void => {
  setGroupMode(groupMode.value === 'tag' ? 'none' : 'tag')
}

const themeSwatch = (key: ThemeKey): Record<string, string> => {
  if (key === 'follow') {
    return { background: 'linear-gradient(180deg, #fbf9f4 0 50%, #16181a 50%)' }
  }
  return { background: READER_PALETTES[key].bg }
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
        <p class="group__title">界面风格</p>
        <div class="seg">
          <button
            v-for="key in schemes"
            :key="key"
            type="button"
            class="seg__item"
            :class="{ 'is-active': settings.scheme === key }"
            @click="settings.scheme = key"
          >
            {{ SCHEME_LABELS[key] }}
          </button>
        </div>

        <div class="styles">
          <button
            v-for="key in styles"
            :key="key"
            type="button"
            class="style"
            :class="{ 'is-active': settings.uiStyle === key }"
            @click="settings.uiStyle = key"
          >
            <span class="style__preview" :data-preview="key">
              <i /><i /><i />
              <Check
                v-if="settings.uiStyle === key"
                class="style__check"
                :size="14"
                :stroke-width="3"
              />
            </span>
            <span class="style__name">{{ UI_STYLE_LABELS[key] }}</span>
            <span class="style__note">{{ UI_STYLE_NOTES[key] }}</span>
          </button>
        </div>
      </section>

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
            <span class="theme__dot" :style="themeSwatch(key)" />
            <span class="theme__name">{{ THEME_LABELS[key] }}</span>
          </button>
        </div>
        <p class="hint hint--tight">
          「跟随 App」时，App 切到深色阅读界面就变夜读；也可以单独锁一套纸色，不受 App 明暗影响。
        </p>
      </section>

      <section class="group">
        <p class="group__title">书架</p>

        <div class="line line--stack">
          <span>显示方式</span>
          <div class="seg seg--inline">
            <button
              type="button"
              class="seg__item"
              :class="{ 'is-active': settings.shelfLayout === 'grid' }"
              @click="settings.shelfLayout = 'grid'"
            >
              网格
            </button>
            <button
              type="button"
              class="seg__item"
              :class="{ 'is-active': settings.shelfLayout === 'list' }"
              @click="settings.shelfLayout = 'list'"
            >
              列表
            </button>
          </div>
        </div>

        <div v-if="settings.shelfLayout === 'grid'" class="line line--stack">
          <span>每行本数</span>
          <div class="seg seg--inline">
            <button
              v-for="n in columns"
              :key="n"
              type="button"
              class="seg__item seg__item--num"
              :class="{ 'is-active': settings.shelfColumns === n }"
              @click="settings.shelfColumns = n"
            >
              {{ n }}
            </button>
          </div>
        </div>

        <label class="line line--switch">
          <span>显示阅读进度百分比</span>
          <input v-model="settings.showPercent" class="toggle" type="checkbox" />
        </label>

        <p class="seg__label">排序方式</p>
        <div class="chips">
          <button
            v-for="(label, key) in SORT_LABELS"
            :key="key"
            type="button"
            class="chip"
            :class="{ 'is-active': sortKey === key }"
            @click="setSort(key as SortKey)"
          >
            {{ label }}
          </button>
        </div>

        <label class="line line--switch">
          <span>按标签分组</span>
          <input
            class="toggle"
            type="checkbox"
            :checked="groupMode === 'tag'"
            @change="toggleGroup"
          />
        </label>
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
        <button class="line line--btn" type="button" @click="navigate('/about')">
          <span>关于</span>
          <span class="line__value">
            v{{ APP_VERSION }}
            <ChevronRight :size="15" :stroke-width="2" />
          </span>
        </button>
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

/* ---- 分段控件 ---- */
.seg {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
}

.seg--inline {
  flex: none;
  padding: 2px;
}

.seg__item {
  flex: 1;
  /* 触屏最小点击高度 40：34 的按钮在手机上容易点偏 */
  min-height: 40px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text-2);
  transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

/* 深色下 --text-2 压 surface-2 只有 4.14:1，未选中项要再亮一档 */
[data-scheme='dark'] .seg__item:not(.is-active) {
  color: #9d998f;
}

.seg__item--num {
  min-width: 42px;
  font-variant-numeric: tabular-nums;
}

.seg__item.is-active {
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 1px 4px -2px rgba(0, 0, 0, 0.3);
  font-weight: 600;
}

[data-scheme='dark'] .seg__item.is-active {
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--line);
}

/* ---- UI 风格三选一 ---- */
.styles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
}

.style {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  text-align: left;
}

.style__preview {
  position: relative;
  display: block;
  height: 62px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
  outline: 1px solid var(--line);
  outline-offset: -1px;
  transition: outline-color var(--dur) var(--ease);
}

.style__preview i {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 9px;
  border-radius: 3px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.style__preview i:nth-child(1) {
  top: 10px;
}
.style__preview i:nth-child(2) {
  top: 24px;
  right: 26px;
}
.style__preview i:nth-child(3) {
  top: 38px;
  right: 40px;
}

/* 经典：实心块 + 细线 */
.style__preview[data-preview='classic'] i {
  background: var(--surface);
}

/* 莫奈：低饱和渐变底，块是半透明的 */
.style__preview[data-preview='monet'] {
  background:
    radial-gradient(120% 90% at 10% 0%, rgba(122, 168, 159, 0.55), transparent 65%),
    radial-gradient(120% 90% at 90% 100%, rgba(214, 160, 168, 0.55), transparent 62%),
    var(--surface-2);
}

.style__preview[data-preview='monet'] i {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(2px);
}

/* 玻璃：模糊 + 高光边 */
.style__preview[data-preview='glass'] {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5), rgba(180, 200, 220, 0.35));
  backdrop-filter: blur(4px);
}

[data-scheme='dark'] .style__preview[data-preview='glass'] {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(120, 150, 180, 0.1));
}

.style__preview[data-preview='glass'] i {
  background: rgba(255, 255, 255, 0.42);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

.style__check {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px;
  border-radius: 50%;
  color: var(--on-accent);
  background: var(--accent);
}

.style.is-active .style__preview {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.style__name {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text);
}

.style.is-active .style__name {
  color: var(--accent);
  font-weight: 600;
}

.style__note {
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--text-3);
}

/* ---- 阅读主题色块 ---- */
.themes {
  display: flex;
  gap: 10px;
  padding-bottom: 6px;
}

.theme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.theme__dot {
  display: block;
  width: 100%;
  height: 52px;
  border-radius: var(--radius);
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

.hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.hint--tight {
  margin: 2px 0 8px;
  font-size: 11.5px;
  color: var(--text-3);
}

/* ---- 通用行 ---- */
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

.line--switch {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.line--stack {
  padding: 4px 0;
}

.line__value {
  display: inline-flex;
  align-items: center;
  gap: 2px;
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

.seg__label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 14px 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 6px;
}

.chip {
  min-height: 40px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
  transition: background 140ms var(--ease), color 140ms var(--ease);
}

.chip.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
  font-weight: 600;
}

.toggle {
  flex: none;
  width: 22px;
  height: 22px;
  accent-color: var(--accent);
}

.note {
  margin: 22px 0 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
