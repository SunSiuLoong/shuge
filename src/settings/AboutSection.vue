<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Github,
  Heart,
  Loader2,
  RefreshCw,
} from 'lucide-vue-next'
import { APP_VERSION } from '../version'
import {
  AFDIAN_URL,
  DONATE_IMAGE,
  ISSUES_URL,
  LICENSE_NAME,
  REPO_URL,
  openExternal,
} from '../appinfo'
import { checkUpdate, type ReleaseInfo } from '../update'
import {
  formatBytes,
  getStorageInfo,
  requestPersist,
  listTrashFiles,
  clearTrash,
  type StorageInfo,
} from '../storage/opfs'
import { isNative } from '../native'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

/**
 * 「关于」这一组：存储、版本、检查更新、仓库、建议、爱发电、打赏码。
 * 设置页第 5 组和 /about 页共用这一份，避免两处各写一遍文案。
 */
type State = 'idle' | 'checking' | 'latest' | 'update' | 'error'

const state = ref<State>('idle')
const latest = ref<ReleaseInfo | null>(null)
const message = ref('')

const info = ref<StorageInfo | null>(null)

/** 回收站：删书时选「保留本地文件」的副本落在这里 */
const trash = ref<{ name: string; size: number }[]>([])
const askClear = ref(false)
const clearing = ref(false)

const trashSizeText = computed(() =>
  formatBytes(trash.value.reduce((s, f) => s + f.size, 0)),
)

const trashText = computed(() => {
  if (!trash.value.length) return '空'
  return `${trash.value.length} 个 · ${trashSizeText.value}`
})

const refreshTrash = async (): Promise<void> => {
  trash.value = await listTrashFiles()
}

const doClearTrash = async (): Promise<void> => {
  if (clearing.value) return
  clearing.value = true
  try {
    await clearTrash()
    await refreshTrash()
    await refreshStorage()
  } finally {
    clearing.value = false
    askClear.value = false
  }
}

const usageText = computed(() => {
  if (!info.value) return '读取中…'
  return `${formatBytes(info.value.usage)} / ${formatBytes(info.value.quota)}`
})

const usagePercent = computed(() => {
  if (!info.value?.quota) return 0
  return Math.min(100, (info.value.usage / info.value.quota) * 100)
})

const sizeText = computed(() => {
  const n = latest.value?.apkSize
  if (!n) return ''
  return `${(n / 1024 / 1024).toFixed(1)} MB`
})

const refreshStorage = async (): Promise<void> => {
  info.value = await getStorageInfo()
}

const askPersist = async (): Promise<void> => {
  await requestPersist()
  await refreshStorage()
}

const runCheck = async (): Promise<void> => {
  if (state.value === 'checking') return
  state.value = 'checking'
  message.value = ''
  latest.value = null
  try {
    const r = await checkUpdate()
    latest.value = r.latest
    if (r.hasUpdate) {
      state.value = 'update'
    } else {
      state.value = 'latest'
      message.value = '已经是最新版本'
    }
  } catch (e) {
    state.value = 'error'
    message.value = e instanceof Error ? e.message : String(e)
  }
}

const download = (): void => {
  openExternal(latest.value?.apkUrl || latest.value?.pageUrl || '')
}

onMounted(() => {
  void refreshStorage()
  void refreshTrash()
})
</script>

<template>
  <div class="about-section">
    <div class="line">
      <span>占用</span>
      <span class="line__value">{{ usageText }}</span>
    </div>
    <div class="meter"><i :style="{ width: `${usagePercent}%` }" /></div>

    <div class="line">
      <span>回收站</span>
      <span class="line__value">{{ trashText }}</span>
    </div>
    <button v-if="trash.length" class="more" type="button" :disabled="clearing" @click="askClear = true">
      清空回收站，彻底删掉这些文件
      <ChevronRight :size="15" :stroke-width="2" />
    </button>

    <!-- 持久化只在网页端有意义：APK 的存储不受浏览器配额清理策略影响，
         App 启动时也已自动申请过，这一行在手机上只会让人困惑，直接不显示 -->
    <template v-if="!isNative">
      <div class="line">
        <span>持久化</span>
        <span class="line__value">
          {{ info?.persisted ? '已持久化' : '未持久化（系统可能清理）' }}
        </span>
      </div>
      <button v-if="!info?.persisted" class="more" type="button" @click="askPersist">
        申请持久化存储，避免书库被系统清理
        <ChevronRight :size="15" :stroke-width="2" />
      </button>
    </template>

    <div class="line">
      <span>当前版本</span>
      <span class="line__value">v{{ APP_VERSION }}</span>
    </div>

    <button class="line line--btn" type="button" :disabled="state === 'checking'" @click="runCheck">
      <span>检查更新</span>
      <span class="line__value line__value--action">
        <Loader2 v-if="state === 'checking'" class="spin" :size="15" :stroke-width="2" />
        <template v-else-if="state === 'latest'">
          <CheckCircle2 :size="15" :stroke-width="2" />
          已是最新
        </template>
        <template v-else-if="state === 'update'">v{{ latest?.version }}</template>
        <template v-else>
          检查
          <ChevronRight :size="15" :stroke-width="2" />
        </template>
      </span>
    </button>

    <div v-if="state === 'update' && latest" class="update">
      <p class="update__head">发现新版本 v{{ latest.version }}</p>
      <p v-if="latest.notes" class="update__notes">{{ latest.notes }}</p>
      <button class="update__btn" type="button" @click="download">
        <Download :size="16" :stroke-width="2" />
        下载安装包{{ sizeText ? `（${sizeText}）` : '' }}
      </button>
      <button class="update__link" type="button" @click="openExternal(latest.pageUrl)">
        在 GitHub 上看这个版本
        <ExternalLink :size="13" :stroke-width="2" />
      </button>
    </div>

    <p v-if="state === 'error'" class="hint is-error">{{ message }}</p>

    <button class="line line--btn" type="button" @click="openExternal(REPO_URL)">
      <span class="line__with-icon">
        <Github :size="16" :stroke-width="1.8" />
        开源仓库
      </span>
      <span class="line__value line__value--mono">
        {{ REPO_URL.replace('https://', '') }}
        <ExternalLink :size="13" :stroke-width="2" />
      </span>
    </button>

    <button class="line line--btn" type="button" @click="openExternal(ISSUES_URL)">
      <span class="line__with-icon">
        <RefreshCw :size="16" :stroke-width="1.8" />
        问题与建议
      </span>
      <ChevronRight :size="15" :stroke-width="2" />
    </button>

    <button
      class="line line--btn"
      type="button"
      :disabled="!AFDIAN_URL"
      @click="AFDIAN_URL && openExternal(AFDIAN_URL)"
    >
      <span class="line__with-icon">
        <Heart :size="16" :stroke-width="1.8" />
        爱发电
      </span>
      <span class="line__value">
        {{ AFDIAN_URL ? '去主页' : '暂未开放' }}
        <ChevronRight v-if="AFDIAN_URL" :size="15" :stroke-width="2" />
      </span>
    </button>

    <div class="donate">
      <p class="donate__label">打赏码</p>
      <div v-if="DONATE_IMAGE" class="donate__qr">
        <img :src="DONATE_IMAGE" alt="打赏码" />
      </div>
      <div v-else class="donate__empty"><span>打赏码待上传</span></div>
    </div>

    <p class="note">
      用 MIT 协议开源，渲染引擎是 foliate-js（同为 {{ LICENSE_NAME }}）。遇到打不开的书，把书名和来源发到 issues 里，比截图有用。
    </p>

    <Transition name="fade">
      <ConfirmDialog
        v-if="askClear"
        title="清空回收站？"
        :message="`回收站里的 ${trash.length} 个文件（${trashSizeText}）会被永久删除，不可恢复。`"
        confirm-text="清空"
        danger
        @close="askClear = false"
        @confirm="doClearTrash"
      />
    </Transition>
  </div>
</template>

<style scoped>
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

.line--btn:disabled {
  opacity: 0.5;
}

.line__with-icon {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.line__value {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.line__value--action {
  color: var(--accent);
}

.line__value--mono {
  max-width: 58%;
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.more {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 0 12px;
  font-size: 12.5px;
  color: var(--accent);
  text-align: left;
}

.update {
  margin: 6px 0 12px;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  border: 1px solid var(--line);
}

.update__head {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.update__notes {
  margin: 8px 0 0;
  max-height: 140px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-2);
  white-space: pre-wrap;
}

.update__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 42px;
  margin-top: 12px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
}

.update__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--accent);
}

.hint {
  margin: 8px 0 10px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
}

.hint.is-error {
  color: var(--accent);
}

.note {
  margin: 10px 0 4px;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-3);
}

.donate {
  padding: 10px 0 8px;
}

.donate__label {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-2);
}

.donate__qr {
  display: flex;
  justify-content: center;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--surface-2);
}

.donate__qr img {
  width: 168px;
  height: 168px;
  object-fit: contain;
  border-radius: var(--radius);
}

.donate__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 14px;
  border-radius: var(--radius-lg);
  border: 1px dashed var(--line);
  font-size: 12.5px;
  color: var(--text-3);
  text-align: center;
}

.spin {
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
