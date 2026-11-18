<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, Download, ExternalLink, Gift, Trash2 } from 'lucide-vue-next'
import { openInApp } from '../links/inapp'
import {
  QM_BASE,
  QM_NAME,
  claimPrestigeTasks,
  doSign,
  getSignState,
} from './qm'
import { clearDownloadRecords, downloadState, startDownload } from './downloads'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const signBusy = ref(false)
const signMsg = ref('')
const signNeedLogin = ref(false)
const taskBusy = ref(false)
const taskMsg = ref('')
const taskNeedLogin = ref(false)

const SIGN_KEY = 'shuge.community.lastSign.v1'
const lastSign = ref<string | null>(localStorage.getItem(SIGN_KEY))
/** 必须是本地日期：toISOString 是 UTC，东八区 0–8 点会被算成前一天，签到标记就错位 */
const today = (): string => {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const signedToday = computed(() => lastSign.value === today())

const openCommunity = (path = ''): void => {
  void openInApp(QM_BASE + path, QM_NAME, false)
}

const openLogin = (): void => {
  void openInApp(QM_BASE + '/member.php?mod=logging&action=login', `${QM_NAME} 登录`, false)
}

const onSign = async (): Promise<void> => {
  signBusy.value = true
  signMsg.value = ''
  try {
    const r = await doSign()
    signMsg.value = r.message
    signNeedLogin.value = !r.ok && /登录/.test(r.message)
    if (r.ok && !/已经签/.test(r.message)) {
      localStorage.setItem(SIGN_KEY, today())
      lastSign.value = today()
    }
  } catch (e) {
    signMsg.value = e instanceof Error ? e.message : '签到失败'
    signNeedLogin.value = false
  } finally {
    signBusy.value = false
  }
}

/** 进社区前先探一下登录态，避免把「未登录」误报成「无任务」 */
const onClaim = async (): Promise<void> => {
  taskBusy.value = true
  taskMsg.value = ''
  try {
    const st = await getSignState()
    if (!st.loggedIn) {
      taskMsg.value = '还没登录，先去社区登录一次'
      taskNeedLogin.value = true
      return
    }
    const r = await claimPrestigeTasks()
    taskMsg.value = r.message
    taskNeedLogin.value = false
  } catch (e) {
    taskMsg.value = e instanceof Error ? e.message : '领取失败'
    taskNeedLogin.value = false
  } finally {
    taskBusy.value = false
  }
}

const showDownloads = ref(false)
const askClearDownloads = ref(false)
const dlMsg = ref('')

const onDownload = async (url: string, name: string): Promise<void> => {
  const r = await startDownload(url, name)
  dlMsg.value = r.message
}

const timeOf = (t: number): string => {
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const doClearDownloads = (): void => {
  clearDownloadRecords()
  askClearDownloads.value = false
  dlMsg.value = '下载记录已清空'
}
</script>

<template>
  <section class="card">
    <!-- 打开社区 -->
    <button class="row row--btn" type="button" @click="openCommunity()">
      <span>打开{{ QM_NAME }}（社区）</span>
      <span class="row__value">
        打开
        <ChevronRight :size="14" :stroke-width="1.8" />
      </span>
    </button>
    <p class="hint hint--tight">
      登录态跟着手机浏览器的 Cookie 走：在内置浏览器里登录一次，
      之后签到、领威望、搜索都会自动带上。没有账号就先去注册一个。
    </p>

    <div class="divider" />

    <!-- 一键签到 -->
    <div class="row">
      <span>
        每日签到
        <span class="row__tag" :class="{ 'is-on': signedToday }">
          {{ signedToday ? '今日已签' : '未签' }}
        </span>
      </span>
      <button
        class="action"
        :class="{ 'is-done': signedToday }"
        type="button"
        :disabled="signBusy"
        @click="signNeedLogin ? openLogin() : onSign()"
      >
        {{ signNeedLogin ? '去登录' : signBusy ? '签到中…' : signedToday ? '再签一次' : '一键签到' }}
      </button>
    </div>
    <p class="hint hint--tight">
      自动挑一个随机表情、配一句随机古诗词当签到语。
      {{ lastSign ? `上次签到：${lastSign}。` : '' }}
    </p>
    <p v-if="signMsg" class="result" :class="{ 'is-ok': !signNeedLogin }">{{ signMsg }}</p>

    <div class="divider" />

    <!-- 领取威望 -->
    <div class="row">
      <span>
        领取威望
        <span class="row__icon"><Gift :size="14" :stroke-width="1.8" /></span>
      </span>
      <button class="action" type="button" :disabled="taskBusy" @click="taskNeedLogin ? openLogin() : onClaim()">
        {{ taskNeedLogin ? '去登录' : taskBusy ? '领取中…' : '自动领取' }}
      </button>
    </div>
    <p class="hint hint--tight">
      相当于替你把社区任务页里的「申请任务 / 领取奖励」各点一遍。
      有的任务有条件（发帖数、在线时长），满足不了会跳过。
    </p>
    <p v-if="taskMsg" class="result">{{ taskMsg }}</p>

    <div class="divider" />

    <!-- 下载记录 -->
    <button class="row row--btn" type="button" @click="showDownloads = !showDownloads">
      <span>
        <span class="row__icon"><Download :size="14" :stroke-width="1.8" /></span>
        下载记录
      </span>
      <span class="row__value">
        {{ downloadState.records.length }} 条
        <ChevronRight class="chev" :class="{ open: showDownloads }" :size="14" :stroke-width="1.8" />
      </span>
    </button>
    <p v-if="showDownloads" class="hint hint--tight">
      在社区附件上点下载后走系统下载器（登录 Cookie 自动带上），
      完成后可在系统通知栏查看。
    </p>
    <ul v-if="showDownloads && downloadState.records.length" class="downloads">
      <li v-for="r in downloadState.records" :key="r.id" class="downloads__item">
        <button class="downloads__main" type="button" @click="onDownload(r.url, r.name)">
          <span class="downloads__name">{{ r.name }}</span>
          <span class="downloads__time">{{ timeOf(r.time) }}</span>
        </button>
        <button class="icon-btn icon-btn--sm" type="button" aria-label="重新下载" @click="onDownload(r.url, r.name)">
          <ExternalLink :size="14" :stroke-width="1.8" />
        </button>
      </li>
    </ul>
    <button
      v-if="showDownloads && downloadState.records.length"
      class="action action--ghost"
      type="button"
      @click="askClearDownloads = true"
    >
      <Trash2 :size="14" :stroke-width="1.8" />
      清空记录
    </button>
    <p v-if="dlMsg" class="result">{{ dlMsg }}</p>
  </section>

  <ConfirmDialog
    v-if="askClearDownloads"
    title="清空下载记录？"
    message="只清掉这份列表，已下载到手机的文件不受影响。"
    confirm-text="清空"
    @close="askClearDownloads = false"
    @confirm="doClearDownloads"
  />
</template>

<style scoped>
.row__tag {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--text-2);
  background: var(--surface-2);
  vertical-align: 1px;
}

.row__tag.is-on {
  color: var(--on-accent);
  background: var(--accent);
}

.row__icon {
  display: inline-flex;
  margin-right: 5px;
  color: var(--text-3);
  vertical-align: -2px;
}

.action {
  flex: none;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
}

.action:disabled {
  opacity: 0.55;
}

.action.is-done {
  color: var(--text-2);
  background: var(--surface-2);
}

.action--ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-2);
  background: var(--surface-2);
}

.result {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: var(--radius, 8px);
  padding: 8px 10px;
}

.result.is-ok {
  color: var(--accent);
}

.chev {
  transition: transform 160ms var(--ease);
}

.chev.open {
  transform: rotate(90deg);
}

.downloads {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius, 8px);
  overflow: hidden;
}

.downloads__item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.downloads__item + .downloads__item {
  border-top: 1px solid var(--line);
}

.downloads__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 12px;
  text-align: left;
}

.downloads__name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.downloads__time {
  flex: none;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.icon-btn--sm {
  width: 34px;
  height: 34px;
  color: var(--text-3);
}
</style>
