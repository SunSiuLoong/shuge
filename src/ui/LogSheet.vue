<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Check, Copy, Trash2, X } from 'lucide-vue-next'
import { clearLogs, exportLogs, getLogs, type LogEntry } from '../log'
import ConfirmDialog from './ConfirmDialog.vue'

/**
 * 运行日志面板：给用户看的，不是给开发者看的调试器。
 * 只做三件事——看得见、能复制走、能清空。
 */
const emit = defineEmits<{ (e: 'close'): void }>()

const entries = ref<LogEntry[]>(getLogs())
const bodyEl = ref<HTMLElement | null>(null)
const copied = ref(false)
const askClear = ref(false)

const abnormal = computed(() =>
  entries.value.some((e) => e.tag === 'boot' && /没有正常收尾/.test(e.msg)),
)

const pad2 = (n: number): string => String(n).padStart(2, '0')
const timeText = (t: number): string => {
  const d = new Date(t)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const scrollToEnd = (): void => {
  void nextTick(() => {
    const el = bodyEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

const copyAll = async (): Promise<void> => {
  const text = exportLogs()
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 老 WebView 没有 clipboard API，退到 textarea + execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* 复制不了就只让用户看 */
    }
    document.body.removeChild(ta)
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1600)
}

const doClear = (): void => {
  clearLogs()
  entries.value = []
  askClear.value = false
}

onMounted(scrollToEnd)
</script>

<template>
  <div class="logs">
    <div class="logs__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
      <div class="sheet__handle" />
      <div class="sheet__head">
        <span class="logs__title">
          运行日志
          <span class="logs__count">{{ entries.length }} 条</span>
        </span>
        <button class="close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <p v-if="!entries.length" class="logs__empty">
        还没有日志。用一会儿再回来看。
      </p>

      <template v-else>
        <p v-if="abnormal" class="logs__warn">
          上次没有正常收尾——可能是闪退，也可能是被系统清理或强制停止。看最后几条记录能知道当时在做什么。
        </p>
        <div ref="bodyEl" class="logs__body">
          <div
            v-for="(e, i) in entries"
            :key="i"
            class="logs__row"
            :class="`is-${e.lvl}`"
          >
            <span class="logs__t">{{ timeText(e.t) }}</span>
            <span class="logs__tag">{{ e.tag }}</span>
            <span class="logs__msg">{{ e.msg }}</span>
          </div>
        </div>
      </template>

      <div class="logs__actions">
        <button class="btn btn--ghost" type="button" :disabled="!entries.length" @click="copyAll">
          <Check v-if="copied" :size="15" :stroke-width="2" />
          <Copy v-else :size="15" :stroke-width="1.8" />
          {{ copied ? '已复制' : '复制全部' }}
        </button>
        <button class="btn btn--ghost" type="button" :disabled="!entries.length" @click="askClear = true">
          <Trash2 :size="15" :stroke-width="1.8" />
          清空
        </button>
      </div>
      <p class="logs__note">
        日志只存在这台手机上，不上传任何地方。遇到闪退、白屏，请点「复制全部」把内容发给我。
      </p>
    </div>

    <ConfirmDialog
      v-if="askClear"
      title="清空运行日志？"
      message="清空后就查不到之前发生了什么，书库数据不受影响。"
      confirm-text="清空"
      danger
      @close="askClear = false"
      @confirm="doClear"
    />
  </div>
</template>

<style scoped>
.logs {
  position: fixed;
  inset: 0;
  z-index: 70;
}

.logs__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--surface);
  box-shadow: 0 -12px 40px -18px rgba(0, 0, 0, 0.4);
}

.sheet__handle {
  flex: none;
  width: 36px;
  height: 4px;
  margin: 10px auto 2px;
  border-radius: 2px;
  background: var(--line);
}

.sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 6px;
}

.logs__title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.logs__count {
  margin-left: 6px;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-3);
}

.close {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--text-2);
}

.logs__warn {
  flex: none;
  margin: 4px 16px 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--accent);
  background: var(--accent-soft, var(--surface-2));
}

.logs__body {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  margin: 8px 16px 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--surface-2);
  -webkit-overflow-scrolling: touch;
}

.logs__row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 2px 0;
  font-size: 11px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text-2);
  word-break: break-all;
}

.logs__row.is-warn {
  color: #9a6b00;
}

.logs__row.is-error {
  color: var(--accent);
}

.logs__t {
  flex: none;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.logs__tag {
  flex: none;
  color: var(--text-3);
}

.logs__msg {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
}

.logs__empty {
  margin: 20px 16px;
  font-size: 12.5px;
  color: var(--text-3);
  text-align: center;
}

.logs__actions {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 16px 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-2);
}

.btn:disabled {
  opacity: 0.5;
}

.btn--ghost:active {
  background: var(--line);
}

.logs__note {
  flex: none;
  margin: 8px 16px calc(16px + var(--safe-bottom));
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
