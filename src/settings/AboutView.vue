<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Github,
  Heart,
  Loader2,
  RefreshCw,
} from 'lucide-vue-next'
import { goBack } from '../router'
import { APP_VERSION } from '../version'
import {
  AFDIAN_URL,
  APP_NAME,
  DONATE_IMAGE,
  ISSUES_URL,
  LICENSE_NAME,
  REPO_URL,
  openExternal,
} from '../appinfo'
import { checkUpdate, type ReleaseInfo } from '../update'

type State = 'idle' | 'checking' | 'latest' | 'update' | 'error'

const state = ref<State>('idle')
const latest = ref<ReleaseInfo | null>(null)
const message = ref('')

const sizeText = computed(() => {
  const n = latest.value?.apkSize
  if (!n) return ''
  return `${(n / 1024 / 1024).toFixed(1)} MB`
})

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
  const url = latest.value?.apkUrl || latest.value?.pageUrl || ''
  openExternal(url)
}
</script>

<template>
  <div class="about">
    <header class="topbar">
      <button class="icon-btn" type="button" aria-label="返回" @click="goBack">
        <ArrowLeft :size="20" :stroke-width="1.7" />
      </button>
      <h1 class="topbar__title">关于</h1>
    </header>

    <div class="about__scroll scroll-y">
      <section class="brand">
        <div class="brand__mark" aria-hidden="true"><span /><span /><span /></div>
        <p class="brand__name">{{ APP_NAME }}</p>
        <p class="brand__ver">v{{ APP_VERSION }}</p>
        <p class="brand__desc">安卓本地 EPUB 阅读器，书只存在你自己的手机里</p>
      </section>

      <section class="group">
        <p class="group__title">版本</p>
        <div class="line">
          <span>当前版本</span>
          <span class="line__value">v{{ APP_VERSION }}</span>
        </div>

        <button
          class="line line--btn"
          type="button"
          :disabled="state === 'checking'"
          @click="runCheck"
        >
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
      </section>

      <section class="group">
        <p class="group__title">项目</p>
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
        <p class="note">
          用 MIT 协议开源，渲染引擎是 foliate-js（同为 {{ LICENSE_NAME }}）。遇到打不开的书，把书名和来源发到 issues 里，比截图有用。
        </p>
      </section>

      <section class="group">
        <p class="group__title">支持</p>
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
          <div v-else class="donate__empty">
            <span>打赏码待上传</span>
            <span class="donate__sub">放一张收款码到 public/donate.png 就会出现在这里</span>
          </div>
        </div>
      </section>

      <p class="foot">本地优先 · 不上传书籍 · 不收集账号</p>
    </div>
  </div>
</template>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.about .topbar {
  border-bottom-color: var(--line);
}

.about__scroll {
  flex: 1;
  min-height: 0;
  padding: 8px 18px calc(40px + var(--safe-bottom));
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 0 8px;
  text-align: center;
}

.brand__mark {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 42px;
  margin-bottom: 14px;
  opacity: 0.7;
}

.brand__mark span {
  width: 9px;
  border-radius: 1px;
  background: var(--text-3);
}

.brand__mark span:nth-child(1) {
  height: 30px;
}
.brand__mark span:nth-child(2) {
  height: 42px;
  background: var(--accent);
  opacity: 0.7;
}
.brand__mark span:nth-child(3) {
  height: 24px;
}

.brand__name {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 24px;
  letter-spacing: 0.14em;
}

.brand__ver {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.brand__desc {
  margin: 12px 0 0;
  max-width: 260px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.group {
  padding: 18px 0 6px;
  border-bottom: 1px solid var(--line);
}

.group:last-of-type {
  border-bottom: 0;
}

.group__title {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--text-3);
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

.update__btn:active {
  transform: translateY(1px);
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
  margin: 10px 0 8px;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-3);
}

.note a {
  color: var(--accent);
}

.donate {
  padding: 4px 0 12px;
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

.donate__sub {
  font-size: 11px;
  color: var(--text-3);
  opacity: 0.8;
}

.foot {
  margin: 26px 0 0;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-3);
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
