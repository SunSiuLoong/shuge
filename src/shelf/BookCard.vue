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
  }>(),
  { layout: 'grid', showPercent: false },
)

const emit = defineEmits<{ (e: 'open', book: Book): void }>()

const cover = computed(() => coverUrlOf(props.book))
const pct = computed(() => Math.min(100, Math.max(0, Math.round(props.percent * 100))))
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
  <button class="card" :class="`card--${layout}`" type="button" @click="emit('open', book)">
    <div class="card__cover">
      <img v-if="cover" :src="cover" :alt="book.title" loading="lazy" decoding="async" />
      <span v-else class="card__ph" :style="placeholderTone">{{ initial }}</span>
      <span
        v-if="rating"
        class="card__rating"
        :title="book.ratingCount ? `${book.ratingCount} 人评价` : '评分'"
      >{{ rating }}</span>
      <span v-if="finished" class="card__done">已读完</span>
    </div>

    <div class="card__body">
      <p class="card__title">{{ book.title }}</p>
      <p class="card__author-row">
        <span class="card__author">{{ book.author }}</span>
        <span v-if="showPercent && pct > 0" class="card__pct">{{ pct }}%</span>
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

.card--list .card__tags {
  display: none;
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
  /* 固定两行高：书名长短不一时，同一排的作者名与进度条才不会错位。
     -webkit-box 会吃掉 min-height，所以这里必须用 height */
  height: 2.8em;
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

/* 标签行固定 16px 高：没有标签时用 visibility 留位，保证同一排进度条齐平 */
.card__tags {
  display: flex;
  gap: 4px;
  height: 16px;
  margin: 5px 0 0;
  overflow: hidden;
}

.card__tags.is-empty {
  visibility: hidden;
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
  background: transparent;
}

.card__progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 1px;
  transition: width 240ms var(--ease);
}
</style>
