<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, RefreshCw, Star, X } from 'lucide-vue-next'
import type { Book } from '../types'
import { patchBook } from '../db'
import { lookupDouban, lastMetaError } from '../meta/douban'
import { tagsFromName } from '../meta/tags'

const props = defineProps<{ book: Book }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/**
 * 面板里所有改动即改即存，没有「保存」按钮。
 * 原因是这个面板经常边看边调，多一步确认只会让人忘记点。
 */
const tags = ref<string[]>([...(props.book.tags ?? [])])
const rating = ref<number | null>(props.book.rating ?? null)
const ratingCount = ref<number | undefined>(props.book.ratingCount)
const metaSource = ref<Book['metaSource']>(props.book.metaSource)
const draft = ref('')
const looking = ref(false)
const hint = ref<string | null>(null)

/** 最多 6 个标签，再多书架上的筛选条就没法看了 */
const MAX_TAGS = 6

const STAR_PX = 26

/**
 * 第 i 颗星要填多少像素。按图标宽度（26px）算而不是按钮宽度（40px），
 * 否则半星的橙色会被按钮的左右留白吃掉，看上去像没填。
 */
const starFillPx = (i: number): string => {
  const r = rating.value ?? 0
  const ratio = Math.max(0, Math.min(1, (r - (i - 1) * 2) / 2))
  return `${(ratio * STAR_PX).toFixed(1)}px`
}

const ratingText = computed(() => (rating.value != null && rating.value > 0 ? rating.value.toFixed(1) : '未评分'))

const candidates = computed(() => {
  const have = new Set(tags.value)
  return tagsFromName(props.book.title, props.book.author)
    .map((t) => t.name)
    .filter((t) => !have.has(t))
})

const persist = async (patch: Partial<Book>): Promise<void> => {
  if (props.book.id == null) return
  await patchBook(props.book.id, patch)
}

const setRating = async (value: number | null): Promise<void> => {
  rating.value = value
  metaSource.value = value == null ? undefined : 'manual'
  await persist({ rating: value ?? undefined, metaSource: metaSource.value })
}

/** 点星星：左半是 x.5，右半是整分（豆瓣是 10 分制，一颗星 = 2 分） */
const hitStar = async (index: number, e: MouseEvent): Promise<void> => {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const left = e.clientX - rect.left < rect.width / 2
  const value = index * 2 - (left ? 1 : 0)
  await setRating(value)
}

const addTag = async (raw?: string): Promise<void> => {
  const name = (raw ?? draft.value).trim().replace(/^#/, '')
  if (!name || tags.value.includes(name)) {
    draft.value = ''
    return
  }
  if (tags.value.length >= MAX_TAGS) {
    hint.value = `最多 ${MAX_TAGS} 个标签`
    return
  }
  tags.value = [...tags.value, name]
  draft.value = ''
  hint.value = null
  await persist({ tags: tags.value })
}

const removeTag = async (name: string): Promise<void> => {
  tags.value = tags.value.filter((t) => t !== name)
  await persist({ tags: tags.value.length ? tags.value : undefined })
}

const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Enter') {
    e.preventDefault()
    void addTag()
  }
}

const askDouban = async (): Promise<void> => {
  if (looking.value) return
  looking.value = true
  hint.value = null
  const hit = await lookupDouban(props.book.title, props.book.author)
  looking.value = false
  if (!hit) {
    hint.value = lastMetaError.value || '豆瓣没查到这本，网文没出实体书时查不到'
    return
  }
  rating.value = hit.rating
  ratingCount.value = hit.count
  metaSource.value = 'douban'
  await persist({
    rating: hit.rating,
    ratingCount: hit.count,
    metaSource: 'douban',
    metaUpdatedAt: Date.now(),
  })
  hint.value = `豆瓣「${hit.matchedTitle}」${hit.rating.toFixed(1)} 分`
}

const countLabel = computed(() => {
  if (!ratingCount.value) return ''
  return ratingCount.value >= 10000
    ? `${(ratingCount.value / 10000).toFixed(1)} 万人评价`
    : `${ratingCount.value} 人评价`
})
</script>

<template>
  <div class="meta">
    <div class="meta__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
      <div class="sheet__handle" />
      <div class="sheet__head">
        <span class="meta__title">{{ book.title }}</span>
        <button class="close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <div class="sheet__body">
        <p class="meta__author">{{ book.author }}</p>

        <!-- 评分 -->
        <div class="field">
          <div class="field__head">
            <span class="field__label">评分</span>
            <span class="field__value">{{ ratingText }}</span>
          </div>
          <div class="stars">
            <button
              v-for="i in 5"
              :key="i"
              class="star"
              type="button"
              :aria-label="`打 ${i * 2} 分`"
              @click="hitStar(i, $event)"
            >
              <Star class="star__bg" :size="26" :stroke-width="1.6" />
              <span class="star__fill" :style="{ width: starFillPx(i) }">
                <Star :size="STAR_PX" :stroke-width="1.6" fill="currentColor" />
              </span>
            </button>
          </div>
          <div class="field__foot">
            <button class="mini" type="button" :disabled="looking" @click="askDouban">
              <RefreshCw :size="13" :stroke-width="2" :class="{ 'is-spin': looking }" />
              {{ looking ? '查询中' : '查豆瓣评分' }}
            </button>
            <span v-if="metaSource === 'douban' && countLabel" class="field__note">
              豆瓣 · {{ countLabel }}
            </span>
            <button
              v-if="rating != null"
              class="mini mini--quiet"
              type="button"
              @click="setRating(null)"
            >清除</button>
          </div>
          <p v-if="hint" class="field__hint">{{ hint }}</p>
        </div>

        <!-- 标签 -->
        <div class="field">
          <div class="field__head">
            <span class="field__label">标签</span>
            <span class="field__value">{{ tags.length }} / {{ MAX_TAGS }}</span>
          </div>
          <div class="tags">
            <span v-for="t in tags" :key="t" class="tag">
              {{ t }}
              <button class="tag__x" type="button" :aria-label="`删除标签 ${t}`" @click="removeTag(t)">
                <X :size="11" :stroke-width="2.4" />
              </button>
            </span>
            <span v-if="!tags.length" class="tags__empty">还没有标签，下面可以添加</span>
          </div>
          <div class="adder">
            <input
              v-model="draft"
              class="adder__input"
              type="text"
              maxlength="12"
              placeholder="输入标签，回车添加"
              @keydown="onKey"
            />
            <button class="adder__btn" type="button" aria-label="添加标签" @click="addTag()">
              <Plus :size="16" :stroke-width="2" />
            </button>
          </div>
          <div v-if="candidates.length" class="cands">
            <span class="cands__label">从书名里找到：</span>
            <button
              v-for="c in candidates"
              :key="c"
              class="cand"
              type="button"
              @click="addTag(c)"
            >+ {{ c }}</button>
          </div>
        </div>

        <p class="foot">
          <Star :size="12" :stroke-width="2" />
          评分存 10 分制，点星星左半是 0.5 星。标签只存在本机，会随同步一起走。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 单根节点：多根组件套 <Transition> 动画会失效 */
.meta {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
}

.meta__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.sheet {
  position: relative;
  width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: var(--safe-bottom);
  box-shadow: 0 -8px 32px -12px rgba(0, 0, 0, 0.28);
}

.sheet__handle {
  flex: none;
  width: 36px;
  height: 4px;
  margin: 8px auto 4px;
  border-radius: 2px;
  background: var(--line);
}

.sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 10px 16px;
  color: var(--text);
}

.meta__title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--text-2);
}

.close:active {
  background: var(--surface-2);
}

.sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 16px 20px;
}

.meta__author {
  margin: 0 0 14px;
  font-size: 12.5px;
  color: var(--text-2);
}

.field {
  padding: 14px 0;
  border-top: 1px solid var(--line);
}

.field__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.field__label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.field__value {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

/* 五颗星各占 40px，图标 26px 居中：热区边界和星星边界严格对齐，
   否则点第 2 颗会落到第 1 颗的判定里 */
.stars {
  display: flex;
  margin-left: -7px;
}

.star {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 44px;
  color: rgba(0, 0, 0, 0.16);
}

[data-theme='night'] .star {
  color: rgba(255, 255, 255, 0.2);
}

.star__bg {
  display: block;
}

.star__fill {
  pointer-events: none;
}

/* 前景星叠在背景星上，从图标左边缘起按像素裁切 */
.star__fill {
  position: absolute;
  top: 0;
  left: 7px;
  display: flex;
  align-items: center;
  height: 100%;
  overflow: hidden;
  color: var(--accent);
}

.star__fill > svg {
  flex: none;
}

.field__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 40px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--accent);
  background: var(--accent-soft);
}

.mini:disabled {
  opacity: 0.6;
}

.mini--quiet {
  color: var(--text-2);
  background: var(--surface-2);
}

.is-spin {
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.field__note {
  font-size: 11.5px;
  color: var(--text-2);
}

.field__hint {
  margin: 8px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-2);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px 3px 9px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--surface-2);
}

.tag__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 视觉 24px，热区撑到 40：负 margin 把多出来的部分收回去 */
  width: 40px;
  height: 40px;
  margin: -8px -12px -8px 0;
  border-radius: 50%;
  color: var(--text-2);
}

.tag__x:active {
  background: var(--line);
}

.tags__empty {
  font-size: 12px;
  color: var(--text-3);
}

.adder {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.adder__input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius);
  font-size: 13.5px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
}

.adder__input:focus {
  border-color: var(--accent);
  outline: none;
}

.adder__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius);
  color: #fff;
  background: var(--accent);
}

.cands {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.cands__label {
  font-size: 11.5px;
  color: var(--text-3);
}

.cand {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-2);
  border: 1px dashed var(--line);
}

.cand:active {
  background: var(--surface-2);
}

.foot {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 16px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-3);
}
</style>
