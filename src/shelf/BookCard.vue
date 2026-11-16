<script setup lang="ts">
import { computed } from 'vue'
import type { Book } from '../types'
import { coverUrlOf } from './useCoverUrl'

const props = defineProps<{
  book: Book
  percent: number
}>()

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
</script>

<template>
  <button class="card" type="button" @click="emit('open', book)">
    <div class="card__cover">
      <img v-if="cover" :src="cover" :alt="book.title" loading="lazy" decoding="async" />
      <span v-else class="card__ph" :style="placeholderTone">{{ initial }}</span>
      <span v-if="finished" class="card__done">已读完</span>
    </div>
    <div class="card__meta">
      <p class="card__title">{{ book.title }}</p>
      <p class="card__author">{{ book.author }}</p>
    </div>
    <div class="card__progress" :class="{ 'is-empty': pct === 0 }">
      <i :style="{ width: `${pct}%` }" />
    </div>
  </button>
</template>

<style scoped>
.card {
  display: block;
  width: 100%;
  padding: 0;
  text-align: left;
  color: inherit;
  background: none;
}

.card:active .card__cover {
  transform: scale(0.985);
}

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

.card__done {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: #fff;
  background: rgba(35, 33, 30, 0.55);
  backdrop-filter: blur(4px);
}

.card__meta {
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

.card__author {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__progress {
  height: 2px;
  margin-top: 7px;
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
