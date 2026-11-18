<script setup lang="ts">
import { computed } from 'vue'
import type { Book } from '../types'
import { coverUrlOf } from './useCoverUrl'

const props = withDefaults(
  defineProps<{
    book: Book
    percent: number
    /** grid = 封面卡片；list = 一行一本 */
    layout?: 'grid' | 'list'
    /** 是否在作者行右侧显示全书百分比 */
    showPercent?: boolean
    /** 批量管理：显示勾选圈 */
    selectMode?: boolean
    /** 当前是否被勾选 */
    selected?: boolean
  }>(),
  { layout: 'grid', showPercent: false, selectMode: false, selected: false },
)

const emit = defineEmits<{ (e: 'open', book: Book): void }>()

const cover = computed(() => coverUrlOf(props.book))
const pct = computed(() => Math.min(100, Math.max(0, Math.round(props.percent * 100))))
// [shuge] 百分比文案：>0 但不足 1% 时四舍五入会变成 0，必须显式给「<1%」，
// 否则刚读几页的书会显示「未开始」
const pctLabel = computed(() => {
  if (pct.value > 0 && pct.value < 1) return '<1%'
  return `${pct.value}%`
})
const finished = computed(() => pct.value >= 99)

/** 无封面时用书名首字占位，底色由书名哈希决定 */
const placeholderTone = computed(() => {
  let h = 0
  for (const ch of props.book.title) h = (h * 31 + ch.codePointAt(0)!) % 360
  return { background: `hsl(${h} 18% 88%)`, color: `hsl(${h} 26% 32%)` }
})

const initial = computed(() => props.book.title.trim().charAt(0) || '书')

const rating = computed(() => {
  const r = props.book.rating
  return r != null && r > 0 ? r.toFixed(1) : ''
})

const visibleTags = computed(() => (props.book.tags ?? []).slice(0, 2))
const moreTags = computed(() => Math.max(0, (props.book.tags?.length ?? 0) - 2))
</script>

<template>
  <button
    class="card"
    :class="[`card--${layout}`, { 'is-selected': selected, 'is-selecting': selectMode }]"
    type="button"
    :aria-pressed="selectMode ? selected : undefined"
    @click="emit('open', book)"
  >
    <div class="card__cover">
      <img v-if="cover" :src="cover" :alt="book.title" loading="lazy" decoding="async" />
      <span v-else class="card__ph" :style="placeholderTone">{{ initial }}</span>
      <span
        v-if="rating"
        class="card__rating"
        :title="book.ratingCount ? `${book.ratingCount} 人评价` : '评分'"
      >{{ rating }}</span>
      <span v-if="finished" class="card__done">已读完</span>
      <!-- 引用模式：书在原位没复制进书库，给个低调的角标提醒用户别随意删原文件 -->
      <span v-if="book.source === 'ref'" class="card__ref">引用</span>
      <!-- 批量管理的勾选圈：压在封面右上角，不改变卡片布局 -->
      <span v-if="selectMode" class="card__check" :class="{ 'is-on': selected }" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path
            d="M20 6 9 17l-5-5"
            fill="none"
            stroke="currentColor"
            stroke-width="3.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </div>

    <div class="card__body">
      <p class="card__title">{{ book.title }}</p>
      <p class="card__author-row">
        <span class="card__author">{{ book.author }}</span>
        <!-- [shuge] 开关打开就常显：未开过的书显示「未开始」，保证有可见反馈 -->
        <span v-if="showPercent" class="card__pct">{{ pct > 0 ? pctLabel : '未开始' }}</span>
      </p>
      <!-- 固定高度占位：标签有无都不能让同一排的进度条错位 -->
      <p class="card__tags" :class="{ 'is-empty': !visibleTags.length }">
        <span v-for="t in visibleTags" :key="t" class="card__tag">{{ t }}</span>
        <span v-if="moreTags" class="card__tag card__tag--more">+{{ moreTags }}</span>
      </p>
      <div class="card__progress" :class="{ 'is-empty': pct === 0 }">
        <i :style="{ width: `${pct}%` }" />
      </div>
    </div>
  </button>
</template>

<style scoped>
.card {
  width: 100%;
  padding: 0;
  text-align: left;
  color: inherit;
  background: none;
}

.card:active .card__cover {
  transform: scale(0.985);
}

.card--grid {
  display: block;
}

/* ---- 列表模式 ---- */
.card--list {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}

.card--list:last-child {
  border-bottom: 0;
}

.card--list:active {
  opacity: 0.66;
}

.card--list .card__cover {
  flex: none;
  width: 52px;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius-sm);
}

.card--list .card__body {
  flex: 1;
  min-width: 0;
  padding: 0;
}

.card--list .card__title {
  height: auto;
  font-size: 14.5px;
  -webkit-line-clamp: 1;
}

.card--list .card__author-row {
  margin-top: 4px;
}

/* ---- 封面 ---- */
.card__cover {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: var(--shadow-card);
  outline: 1px solid var(--line);
  outline-offset: -1px;
  transition: transform 180ms var(--ease);
}

.card__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card__ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-family: var(--font-serif);
  font-size: 34px;
  font-weight: 600;
}

.card--list .card__ph {
  font-size: 20px;
}

.card__done {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: #fff;
  /* 不透明：半透明底在后层是浅色封面时对比度不可控，审计也会判成 1.1:1 */
  background: #3d3832;
}

.card--list .card__done {
  right: 3px;
  bottom: 3px;
  padding: 0 3px;
  font-size: 8.5px;
}

/* 评分压在封面左上角：白字压在书封上，任何底色都能看清 */
.card__ref {
  position: absolute;
  left: 0;
  bottom: 0;
  padding: 2px 7px;
  border-radius: 0 8px 0 10px;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--text-2);
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  border: 1px solid var(--line);
  backdrop-filter: blur(6px);
}

.card--list .card__ref {
  border-radius: 999px 0 0 999px;
  left: 0;
}

.card__rating {
  position: absolute;
  left: 6px;
  top: 6px;
  min-width: 22px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-align: center;
  color: #fff;
  background: #3d3832;
}

/* ---- 批量管理勾选 ---- */
.card__check {
  position: absolute;
  right: 6px;
  top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: transparent;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(4px);
  transition: background-color 140ms var(--ease), color 140ms var(--ease);
}

.card__check svg {
  width: 13px;
  height: 13px;
}

.card__check.is-on {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

.card.is-selected .card__cover {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* 选择态下卡片不再做按压缩放：手指动作是在勾选，不是在打开书 */
.card.is-selecting:active .card__cover {
  transform: none;
}

.card.is-selecting .card__cover {
  opacity: 0.92;
}

.card.is-selecting.is-selected .card__cover {
  opacity: 1;
}

.card--list .card__rating {
  left: 3px;
  top: 3px;
  min-width: 18px;
  padding: 0 3px;
  font-size: 9px;
}

/* ---- 文字区 ---- */
.card__body {
  padding: 8px 2px 0;
}

.card__title {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 500;
  /* [shuge] 取消固定两行高（height:2.8em）：单行书名会空出一整行，
     造成作者名与标签「离得远」的观感。改为自适应高度，超过两行
     仍用 line-clamp 截断。代价是同一排卡片进度条不再绝对齐平 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card__author-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin: 3px 0 0;
}

.card__author {
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__pct {
  flex: none;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

/* 标签行：有标签时 16px 高；无标签时由 .is-empty 整行塌陷 */
.card__tags {
  display: flex;
  gap: 4px;
  height: 16px;
  margin: 5px 0 0;
  overflow: hidden;
}

/* [shuge] 无标签时整行塌陷（原 visibility:hidden 恒占 16px，
   在作者名与进度条之间拉出一条空带） */
.card__tags.is-empty {
  display: none;
}

.card__tag {
  flex: none;
  max-width: 100%;
  padding: 0 4px;
  font-size: 10px;
  line-height: 16px;
  border-radius: 3px;
  color: var(--text-2);
  background: var(--surface-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__tag--more {
  padding: 0 1px;
  color: var(--text-3);
  background: transparent;
}

/* 夜读下 --text-2 压 surface-2 只有 4.14:1，10px 小字不够，提亮到正文色 */
[data-scheme='dark'] .card__tag {
  color: var(--text);
}

.card__progress {
  height: 2px;
  margin-top: 6px;
  border-radius: 1px;
  background: var(--line);
  overflow: hidden;
}

.card__progress.is-empty {
  /* [shuge] 未开过的书保留淡轨道：进度恒可见，而不是整条消失 */
  background: color-mix(in srgb, var(--text) 10%, transparent);
}

.card__progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 1px;
  transition: width 240ms var(--ease);
}
</style>
