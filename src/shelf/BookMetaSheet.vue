<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Link2, Plus, Star, X } from 'lucide-vue-next'
import type { Book, BookLink } from '../types'
import { patchBook } from '../db'
import { lastSourceError, searchSources } from '../meta'
import type { SourceCandidate } from '../meta'
import { toBookLink } from '../meta/types'
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
const link = ref<BookLink | undefined>(props.book.link)
const draft = ref('')
const hint = ref<string | null>(null)

/** 关联面板：打开时现查，不缓存——评分人数是一直在涨的 */
const pickerOpen = ref(false)
const picking = ref(false)
const pickError = ref<string | null>(null)
const candidates = ref<SourceCandidate[]>([])

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

const ratingText = computed(() =>
  rating.value != null && rating.value > 0 ? rating.value.toFixed(1) : '未评分',
)

const tagCandidates = computed(() => {
  const have = new Set(tags.value)
  return tagsFromName(props.book.title, props.book.author)
    .map((t) => t.name)
    .filter((t) => !have.has(t))
})

const persist = async (patch: Partial<Book>): Promise<void> => {
  if (props.book.id == null) return
  await patchBook(props.book.id, patch)
}

const countText = (n?: number): string => {
  if (!n) return ''
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万人评` : `${n} 人评`
}

/** 类型：站点的分类字段（目前两个源都没有），拿不到就用本地标签兜底 */
const typeText = computed(() => {
  const fromSite = link.value?.categories ?? []
  const list = fromSite.length ? fromSite : tags.value
  return list.slice(0, 3).join(' · ')
})

const setRating = async (value: number | null): Promise<void> => {
  rating.value = value
  metaSource.value = value == null ? undefined : 'manual'
  // 手动打分等于否认站点那条记录，关联要跟着断，否则界面会显示「微信读书 8.6」但星星是 4 分
  if (value != null && link.value) link.value = undefined
  await persist({ rating: value ?? undefined, metaSource: metaSource.value, link: link.value })
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

/**
 * 打开关联面板：把各评分站的候选按评分人数列出来，用户自己挑。
 * 不自动选第一条，是因为同名分卷/同名不同书必须让人眼看一眼。
 */
const openPicker = async (): Promise<void> => {
  pickerOpen.value = true
  picking.value = true
  pickError.value = null
  const list = await searchSources(props.book.title, props.book.author)
  candidates.value = list
  picking.value = false
  if (!list.length) pickError.value = lastSourceError.value || '各评分站都没收录这本'
}

const closePicker = (): void => {
  pickerOpen.value = false
}

const isLinked = (c: SourceCandidate): boolean =>
  Boolean(
    link.value &&
      link.value.site === c.site &&
      (link.value.bookId ?? link.value.title) === (c.bookId ?? c.title),
  )

const choose = async (c: SourceCandidate): Promise<void> => {
  link.value = toBookLink(c, false)
  rating.value = c.rating
  ratingCount.value = c.ratingCount
  metaSource.value = c.site
  await persist({
    rating: c.rating,
    ratingCount: c.ratingCount,
    metaSource: c.site,
    metaUpdatedAt: Date.now(),
    link: link.value,
  })
  pickerOpen.value = false
  const pct = c.percent != null ? `（推荐值 ${c.percent}%）` : ''
  hint.value = `已关联 ${c.siteName}「${c.title}」${c.rating.toFixed(1)} 分${pct}`
}

/** 取消关联：分数留着（可能还要按它排序），只是不再声称它来自某个站 */
const clearLink = async (): Promise<void> => {
  link.value = undefined
  metaSource.value = 'manual'
  hint.value = '已取消关联，评分改为手动'
  await persist({ link: undefined, metaSource: 'manual', metaUpdatedAt: Date.now() })
}

/** 封面挂了（防盗链、站点改 CDN）就藏起来，别留个碎图标 */
const hideCover = (e: Event): void => {
  const img = e.target as HTMLImageElement
  img.style.visibility = 'hidden'
}

const sourceLabel = computed(() => {
  if (link.value) return link.value.siteName
  if (metaSource.value === 'douban') return '豆瓣'
  if (metaSource.value === 'weread') return '微信读书'
  return ''
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

        <!-- 评分与关联 -->
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
            <button class="mini" type="button" @click="openPicker">
              <Link2 :size="14" :stroke-width="2" />
              {{ link ? '重新关联' : '关联' }}
            </button>
            <span v-if="sourceLabel && countText(ratingCount)" class="field__note">
              {{ sourceLabel }} · {{ countText(ratingCount) }}
            </span>
            <button v-if="link" class="mini mini--quiet" type="button" @click="clearLink">
              取消关联
            </button>
          </div>

          <!-- 关联到的那条记录：书名、作者、封面、类型、评分原样展示 -->
          <div v-if="link" class="linked">
            <span class="thumb thumb--lg">
              <span class="thumb__ph" aria-hidden="true">{{ link.title.charAt(0) || '书' }}</span>
              <img
                v-if="link.coverUrl"
                class="thumb__img"
                :src="link.coverUrl"
                :alt="link.title"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="hideCover"
              />
            </span>
            <div class="linked__main">
              <p class="linked__title">{{ link.title }}</p>
              <p class="linked__meta">
                {{ link.author || '作者未知' }}<template v-if="typeText"> · {{ typeText }}</template>
              </p>
              <p class="linked__score">
                {{ link.rating.toFixed(1) }}
                <span v-if="link.ratingCount">{{ countText(link.ratingCount) }}</span>
                <span class="linked__site">{{ link.siteName }}</span>
              </p>
            </div>
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
          <div v-if="tagCandidates.length" class="cands">
            <span class="cands__label">从书名里找到：</span>
            <button
              v-for="t in tagCandidates"
              :key="t"
              class="cand"
              type="button"
              @click="addTag(t)"
            >+ {{ t }}</button>
          </div>
        </div>

        <p class="foot">
          <Star :size="12" :stroke-width="2" />
          评分存 10 分制，点星星左半是 0.5 星。标签只存在本机，会随同步一起走。
        </p>
      </div>
    </div>

    <!-- 关联面板：盖在编辑面板之上，选完即关 -->
    <div v-if="pickerOpen" class="picker">
      <div class="picker__scrim" @click="closePicker" />
      <div class="picker__sheet">
        <div class="sheet__handle" />
        <div class="picker__head">
          <span class="picker__title">选择关联的评分站</span>
          <button class="close" type="button" aria-label="关闭" @click="closePicker">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>
        <div class="picker__body">
          <p v-if="picking" class="picker__state">正在查询豆瓣、微信读书…</p>
          <p v-else-if="!candidates.length" class="picker__state">
            {{ pickError || '各评分站都没收录这本' }}
          </p>
          <template v-else>
            <button
              v-for="c in candidates"
              :key="`${c.site}-${c.bookId ?? c.title}`"
              class="candrow"
              :class="{ 'is-active': isLinked(c) }"
              type="button"
              @click="choose(c)"
            >
              <span class="thumb">
                <span class="thumb__ph" aria-hidden="true">{{ c.title.charAt(0) || '书' }}</span>
                <img
                  v-if="c.coverUrl"
                  class="thumb__img"
                  :src="c.coverUrl"
                  :alt="c.title"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="hideCover"
                />
              </span>
              <span class="candrow__main">
                <span class="candrow__top">
                  <span class="candrow__site">{{ c.siteName }}</span>
                  <span class="candrow__title">{{ c.title }}</span>
                </span>
                <span class="candrow__author">{{ c.author || '作者未知' }}</span>
                <span class="candrow__foot">
                  <span class="candrow__type">{{ typeText }}</span>
                  <span class="candrow__score">{{ c.rating.toFixed(1) }}</span>
                  <span class="candrow__count">{{ countText(c.ratingCount) }}</span>
                  <span v-if="c.partial" class="candrow__warn">分卷</span>
                </span>
              </span>
              <Check v-if="isLinked(c)" class="candrow__check" :size="18" :stroke-width="2.2" />
            </button>
            <p class="picker__note">
              按评分人数从多到少排。人数越多样本越大，分数越接近大众判断；标「分卷」的只是其中一册。
            </p>
          </template>
        </div>
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

[data-scheme='dark'] .star {
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
  color: var(--on-accent);
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
/* ---------- 关联记录 ---------- */
.linked {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding: 10px;
  border-radius: var(--radius);
  background: var(--surface-2);
}

/* 封面兜底：占位字垫在下面，图片加载成功后盖上去；
   豆瓣图要靠中继带 Referer 才给，App 没配中继时至少还能看到首字 */
.thumb {
  position: relative;
  flex: none;
  width: 40px;
  height: 54px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--line);
}

.thumb--lg {
  width: 44px;
  height: 60px;
}

.thumb__ph {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-serif);
  font-size: 17px;
  color: var(--text-2);
}

.thumb__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.linked__main {
  flex: 1;
  min-width: 0;
}

.linked__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linked__meta {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linked__score {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.linked__score > span {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-2);
}

.linked__site {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--text-2);
  background: var(--surface);
}

/* ---------- 关联面板 ---------- */
.picker {
  position: absolute;
  inset: 0;
  /* 编辑面板本身用的是全局 .sheet（fixed + z-index 60），
     这里必须压过它，否则候选列表被挡在下面点不到 */
  z-index: 80;
  display: flex;
  align-items: flex-end;
}

.picker__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.picker__sheet {
  position: relative;
  width: 100%;
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: var(--safe-bottom);
  box-shadow: 0 -8px 32px -12px rgba(0, 0, 0, 0.3);
}

.picker__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 6px 16px;
}

.picker__title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.picker__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 12px 16px;
}

.picker__state {
  padding: 24px 6px;
  font-size: 13px;
  text-align: center;
  color: var(--text-2);
}

.candrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 8px;
  text-align: left;
  border-radius: var(--radius);
  color: var(--text);
}

.candrow:active {
  background: var(--surface-2);
}

.candrow.is-active {
  background: var(--accent-soft);
}

.candrow__main {
  flex: 1;
  min-width: 0;
}

.candrow__top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.candrow__site {
  flex: none;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10.5px;
  color: var(--text-2);
  background: var(--surface-2);
}

.candrow.is-active .candrow__site {
  background: var(--surface);
}

.candrow__title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candrow__author {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candrow__foot {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-2);
}

.candrow__type {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candrow__score {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.candrow__count {
  flex: none;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.candrow__warn {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  color: var(--text-2);
  border: 1px solid var(--line);
}

.candrow__check {
  flex: none;
  color: var(--accent);
}

.picker__note {
  margin: 10px 4px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}
</style>
