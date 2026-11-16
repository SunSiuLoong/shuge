<script setup lang="ts">
import { computed, ref } from 'vue'
import { dav, davConfigured, testConnection } from '../sync/webdav'
import { formatTime, syncNow } from '../sync'

const showAdvanced = ref(false)
const busy = ref(false)
const msg = ref('')
const failed = ref(false)

const ready = computed(() => davConfigured())

const run = async (fn: () => Promise<string>): Promise<void> => {
  if (busy.value) return
  busy.value = true
  failed.value = false
  msg.value = '处理中…'
  try {
    msg.value = await fn()
  } catch (e) {
    failed.value = true
    msg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

const onTest = (): Promise<void> =>
  run(async () => {
    const r = await testConnection()
    return r
  })

const onSync = (): Promise<void> =>
  run(async () => {
    const r = await syncNow()
    return `同步完成：进度 +${r.progressApplied}、书签 +${r.bookmarksApplied}${
      r.authorsFilled ? `、补作者 ${r.authorsFilled}` : ''
    }`
  })
</script>

<template>
  <section class="group">
    <p class="group__title">同步（WebDAV）</p>

    <label class="field">
      <span class="field__label">服务地址</span>
      <input
        v-model="dav.url"
        class="field__input"
        type="url"
        inputmode="url"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="https://dav.jianguoyun.com/dav/"
      />
    </label>

    <label class="field">
      <span class="field__label">账号</span>
      <input
        v-model="dav.username"
        class="field__input"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="邮箱"
      />
    </label>

    <label class="field">
      <span class="field__label">应用密码</span>
      <input
        v-model="dav.password"
        class="field__input"
        type="password"
        autocomplete="new-password"
        placeholder="不是登录密码"
      />
    </label>

    <label class="field">
      <span class="field__label">远端目录</span>
      <input
        v-model="dav.dir"
        class="field__input"
        autocapitalize="off"
        placeholder="书阁"
      />
    </label>

    <button class="more" type="button" @click="showAdvanced = !showAdvanced">
      {{ showAdvanced ? '收起高级设置' : '高级设置（浏览器里的中继地址）' }}
    </button>

    <label v-if="showAdvanced" class="field">
      <span class="field__label">中继地址</span>
      <input
        v-model="dav.relay"
        class="field__input"
        autocapitalize="off"
        placeholder="http://127.0.0.1:8787"
      />
    </label>

    <div class="actions">
      <button class="btn" type="button" :disabled="busy || !ready" @click="onTest">
        测试连接
      </button>
      <button
        class="btn btn--primary"
        type="button"
        :disabled="busy || !ready"
        @click="onSync"
      >
        立即同步
      </button>
    </div>

    <p v-if="msg" class="hint" :class="{ 'is-error': failed }">{{ msg }}</p>

    <label class="line line--switch">
      <span>打开 App 时自动同步</span>
      <input v-model="dav.auto" class="toggle" type="checkbox" />
    </label>

    <div class="line">
      <span>上次同步</span>
      <span class="line__value">
        {{ formatTime(dav.lastSyncAt) }}
        <template v-if="dav.lastResult">· {{ dav.lastResult }}</template>
      </span>
    </div>

    <p class="note">
      只同步「书目 + 进度 + 书签」，不上传书籍文件。密码以明文存在本机
      localStorage，坚果云请用「应用密码」而不是登录密码。在浏览器里打开时直连会被
      CORS 拦，需要填中继地址；装成 App 则走系统原生请求，不用中继。
    </p>
  </section>
</template>

<style scoped>
.group {
  padding: 18px 0 6px;
  border-bottom: 1px solid var(--line);
}

.group__title {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--text-3);
}

.field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
}

.field__label {
  flex: none;
  width: 72px;
  font-size: 13.5px;
  color: var(--text-2);
}

.field__input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
}

.field__input:focus {
  outline: 2px solid var(--accent-soft);
  border-color: var(--accent);
}

.more {
  display: block;
  padding: 10px 0;
  font-size: 12.5px;
  color: var(--accent);
  text-align: left;
  min-height: 40px;
}

.actions {
  display: flex;
  gap: 10px;
  padding: 6px 0 10px;
}

.btn {
  flex: 1;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 13.5px;
}

.btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.45;
}

.hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
}

.hint.is-error {
  color: var(--accent);
}

.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  font-size: 14px;
  color: var(--text);
}

.line__value {
  font-size: 12.5px;
  color: var(--text-2);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.toggle {
  flex: none;
  width: 22px;
  height: 22px;
  accent-color: var(--accent);
}

.note {
  margin: 12px 0 0;
  font-size: 11.5px;
  line-height: 1.75;
  color: var(--text-3);
}
</style>
