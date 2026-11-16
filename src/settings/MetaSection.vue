<script setup lang="ts">
import { computed, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { books } from '../shelf/store'
import { enrichMany } from '../meta'
import { dav } from '../sync/webdav'

/**
 * 元数据区块：标签与评分从哪来、怎么批量补。
 * 标签不联网（导入时已经从书名提取），这里只管评分。
 */
const busy = ref(false)
const done = ref(0)
const total = ref(0)
const current = ref('')
const msg = ref('')
const failed = ref(false)
let cancelled = false

const totalCount = computed(() => books.value.length)
const taggedCount = computed(() => books.value.filter((b) => b.tags?.length).length)
const ratedCount = computed(() => books.value.filter((b) => b.rating != null).length)
const missingRated = computed(() => totalCount.value - ratedCount.value)

/** 浏览器里没有中继就查不了豆瓣（没有 CORS 头），App 里走原生请求 */
const canLookup = computed(() => Capacitor.isNativePlatform() || Boolean(dav.relay.trim()))

const percent = computed(() =>
  total.value ? Math.round((done.value / total.value) * 100) : 0,
)

const run = async (): Promise<void> => {
  if (busy.value || !missingRated.value) return
  busy.value = true
  failed.value = false
  cancelled = false
  done.value = 0
  total.value = missingRated.value
  msg.value = ''
  try {
    const r = await enrichMany(books.value, {
      tags: false,
      rating: true,
      gap: 600,
      onProgress: (d, t, title) => {
        done.value = d
        total.value = t || total.value
        current.value = title
      },
      isCancelled: () => cancelled,
    })
    const parts = [`查到 ${r.ok} 本`]
    if (r.miss) parts.push(`${r.miss} 本豆瓣没收录`)
    if (r.failed) parts.push(`${r.failed} 本请求失败`)
    msg.value = `${cancelled ? '已停止，' : '完成，'}${parts.join('，')}`
  } catch (e) {
    failed.value = true
    msg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    current.value = ''
  }
}

const stop = (): void => {
  cancelled = true
}
</script>

<template>
  <section class="group">
    <p class="group__title">标签与评分</p>

    <div class="line">
      <span>已打标签</span>
      <span class="line__value">{{ taggedCount }} / {{ totalCount }}</span>
    </div>
    <div class="line">
      <span>已有评分</span>
      <span class="line__value">{{ ratedCount }} / {{ totalCount }}</span>
    </div>

    <div class="actions">
      <button
        class="btn btn--primary"
        type="button"
        :disabled="busy || !canLookup || !missingRated"
        @click="run"
      >
        {{ busy ? '查询中…' : `补全评分（${missingRated} 本）` }}
      </button>
      <button v-if="busy" class="btn" type="button" @click="stop">停止</button>
    </div>

    <div v-if="busy" class="progress">
      <div class="progress__bar"><i :style="{ width: `${percent}%` }" /></div>
      <p class="progress__text">
        {{ done }} / {{ total }} · {{ current }}
      </p>
    </div>

    <p v-if="msg" class="hint" :class="{ 'is-error': failed }">{{ msg }}</p>
    <p v-if="!canLookup" class="hint">
      在浏览器里查豆瓣需要先在同步设置里填中继地址；装成 App 后走原生请求，不用中继。
    </p>

    <p class="note">
      标签在导入时从书名里提取（<code>[游戏异界]</code>、<code>【玄幻】</code>
      这类），也可以长按书籍手动加。评分来自豆瓣，只取分数与评价人数，不抓短评、不抓标签。
      豆瓣没收录的书（多数连载网文）查不到就是查不到，需要手动打分。
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
  font-variant-numeric: tabular-nums;
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

.btn--primary:disabled {
  background: var(--surface-2);
  color: var(--text-2);
}

.btn:disabled {
  /* 半透明会把白字压成粉红底白字，对比度掉到 2:1 以下；改成实心灰态 */
  border-color: var(--line);
  background: var(--surface-2);
  color: var(--text-2);
}

.progress {
  padding: 0 0 10px;
}

.progress__bar {
  height: 2px;
  border-radius: 1px;
  background: var(--line);
  overflow: hidden;
}

.progress__bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 220ms var(--ease);
}

.progress__text {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.note {
  margin: 12px 0 0;
  font-size: 11.5px;
  line-height: 1.75;
  color: var(--text-3);
}

.note code {
  padding: 0 3px;
  border-radius: 3px;
  /* --text-3 压 surface-2 只有 4.43:1，小字不够，这里用二级文字色 */
  color: var(--text-2);
  background: var(--surface-2);
  font-size: 11px;
}
</style>
