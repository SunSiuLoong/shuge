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
/** 连已有评分一起重查：v1.10 换了评分源，旧的分卷低分需要刷一遍 */
const overwrite = ref(false)
let cancelled = false

const totalCount = computed(() => books.value.length)
const taggedCount = computed(() => books.value.filter((b) => b.tags?.length).length)
const ratedCount = computed(() => books.value.filter((b) => b.rating != null).length)
/** 待处理数：缺分的一律算，开了覆盖重查再把非手动的已有分算进来 */
const pendingCount = computed(
  () =>
    books.value.filter(
      (b) => b.rating == null || (overwrite.value && b.metaSource !== 'manual'),
    ).length,
)

/** 评分来源分布：豆瓣分和微信读书分的量纲不同，用户有权知道这个数是哪来的 */
const bySource = computed(() => {
  const c = { douban: 0, weread: 0, manual: 0 }
  for (const b of books.value) {
    if (b.rating == null) continue
    if (b.metaSource === 'douban') c.douban += 1
    else if (b.metaSource === 'weread') c.weread += 1
    else if (b.metaSource === 'manual') c.manual += 1
  }
  return c
})

const sourceSummary = computed(() => {
  const { douban, weread, manual } = bySource.value
  const parts: string[] = []
  if (douban) parts.push(`豆瓣 ${douban}`)
  if (weread) parts.push(`微信读书 ${weread}`)
  if (manual) parts.push(`手动 ${manual}`)
  return parts.join(' · ') || '—'
})

/** 浏览器里没有中继就查不了豆瓣（没有 CORS 头），App 里走原生请求 */
const canLookup = computed(() => Capacitor.isNativePlatform() || Boolean(dav.relay.trim()))

const percent = computed(() =>
  total.value ? Math.round((done.value / total.value) * 100) : 0,
)

const run = async (): Promise<void> => {
  if (busy.value || !pendingCount.value) return
  busy.value = true
  failed.value = false
  cancelled = false
  done.value = 0
  total.value = pendingCount.value
  msg.value = ''
  try {
    const r = await enrichMany(books.value, {
      tags: false,
      rating: true,
      overwrite: overwrite.value,
      gap: 600,
      onProgress: (d, t, title) => {
        done.value = d
        total.value = t || total.value
        current.value = title
      },
      isCancelled: () => cancelled,
    })
    const parts = [`查到 ${r.ok} 本`]
    if (r.miss) parts.push(`${r.miss} 本两个源都没收录`)
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
    <div v-if="ratedCount" class="line line--sub">
      <span>评分来源</span>
      <span class="line__value">{{ sourceSummary }}</span>
    </div>

    <div class="actions">
      <button
        class="btn btn--primary"
        type="button"
        :disabled="busy || !canLookup || !pendingCount"
        @click="run"
      >
        {{ busy ? '查询中…' : `补全评分（${pendingCount} 本）` }}
      </button>
      <button v-if="busy" class="btn" type="button" @click="stop">停止</button>
    </div>

    <label class="line line--switch">
      <span>连已有评分一起重查</span>
      <input v-model="overwrite" class="toggle" type="checkbox" :disabled="busy" />
    </label>
    <p class="hint hint--tight">
      旧版本只查了豆瓣，很多网文拿到的是「分卷分」（整套《剑来》只有 7.0）。打开这个开关会把
      已有的豆瓣分按新规则重刷一遍，手动打的分不会被覆盖。
    </p>

    <div v-if="busy" class="progress">
      <div class="progress__bar"><i :style="{ width: `${percent}%` }" /></div>
      <p class="progress__text">
        {{ done }} / {{ total }} · {{ current }}
      </p>
    </div>

    <p v-if="msg" class="hint" :class="{ 'is-error': failed }">{{ msg }}</p>
    <p v-if="!canLookup" class="hint">
      在浏览器里查评分需要先在同步设置里填中继地址；装成 App 后走原生请求，不用中继。
    </p>

    <p class="note">
      标签在导入时从书名里提取（<code>[游戏异界]</code>、<code>【玄幻】</code>
      这类），也可以长按书籍手动加。评分先查豆瓣，查不到再查微信读书，都只取分数与人数，
      不抓短评、不抓评论正文。豆瓣只搜到分卷的（如整套《剑来》），会用微信读书的全书评分。
      两个源都没有的书，需要手动打分。
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

/* 来源分布是二级信息，压低一行高度，不然这个区块太长 */
.line--sub {
  min-height: 32px;
  font-size: 12.5px;
  color: var(--text-2);
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

.line--switch {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.toggle {
  flex: none;
  width: 22px;
  height: 22px;
  accent-color: var(--accent);
}

/* 开关下面那句说明要贴着，不然和上面的行距一样会看成另一块 */
.hint--tight {
  margin: 2px 0 10px;
  font-size: 11.5px;
  color: var(--text-3);
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
