<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowUpDown, Plus, Settings, Trash2, X } from 'lucide-vue-next'
import type { Book } from '../types'
import { navigate } from '../router'
import { importFiles, importState, removeBook } from '../importer/importer'
import { formatBytes } from '../storage/opfs'
import {
  books,
  loading,
  percentOf,
  setSort,
  sortKey,
  sortedBooks,
  startShelf,
  SORT_LABELS,
} from './store'
import BookCard from './BookCard.vue'

const fileInput = ref<HTMLInputElement | null>(null)
const scrolled = ref(false)
const showSort = ref(false)
const actionBook = ref<Book | null>(null)
const summary = ref<string | null>(null)

const isEmpty = computed(() => !loading.value && books.value.length === 0)
const totalSize = computed(() =>
  books.value.reduce((sum, b) => sum + (b.fileSize || 0), 0),
)
const totalLabel = computed(() => formatBytes(totalSize.value))

const onScroll = (e: Event): void => {
  scrolled.value = (e.target as HTMLElement).scrollTop > 4
}

const pickFile = (): void => fileInput.value?.click()

const onPicked = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  const results = await importFiles(files)
  const added = results.filter((r) => r.status === 'added').length
  const dup = results.filter((r) => r.status === 'duplicate').length
  const failed = results.filter((r) => r.status === 'failed').length
  const parts = [`导入 ${added} 本`]
  if (dup) parts.push(`${dup} 本重复已跳过`)
  if (failed) {
    const first = results.find((r) => r.status === 'failed')
    parts.push(`${failed} 本失败${first?.reason ? `：${first.reason}` : ''}`)
  }
  summary.value = parts.join('，')
  // 失败原因要留得住，别 4 秒就没了
  setTimeout(() => (summary.value = null), failed ? 9000 : 4000)
}

const openBook = (book: Book): void => {
  if (book.id == null) return
  navigate(`/read/${book.id}`)
}

// 长按 / 右键呼出操作
let timer: number | undefined
const pressStart = (book: Book): void => {
  clearTimeout(timer)
  timer = window.setTimeout(() => {
    actionBook.value = book
    navigator.vibrate?.(10)
  }, 480)
}
const pressEnd = (): void => clearTimeout(timer)

const confirmDelete = async (): Promise<void> => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  await removeBook(book)
  summary.value = `已删除《${book.title}》`
  setTimeout(() => (summary.value = null), 3000)
}

const setSortAndClose = (key: typeof sortKey.value): void => {
  setSort(key)
  showSort.value = false
}

onMounted(startShelf)
</script>

<template>
  <div class="shelf">
    <header class="topbar" :class="{ scrolled }">
      <h1 class="topbar__title">书阁</h1>
      <button class="icon-btn" type="button" aria-label="排序" @click="showSort = true">
        <ArrowUpDown :size="19" :stroke-width="1.6" />
      </button>
      <button class="icon-btn" type="button" aria-label="设置" @click="navigate('/settings')">
        <Settings :size="19" :stroke-width="1.6" />
      </button>
    </header>

    <main class="shelf__scroll scroll-y" @scroll="onScroll">
      <div v-if="isEmpty" class="empty">
        <div class="empty__mark">
          <span /><span /><span />
        </div>
        <p class="empty__title">书架还空着</p>
        <p class="empty__hint">把 EPUB 放进来看第一本</p>
        <button class="empty__btn" type="button" @click="pickFile">
          <Plus :size="16" :stroke-width="2" />
          导入电子书
        </button>
        <p class="empty__sub">支持批量选择，可一次导入多本</p>
      </div>

      <template v-else>
        <div class="grid">
          <div
            v-for="book in sortedBooks"
            :key="book.id"
            class="grid__item"
            @pointerdown="pressStart(book)"
            @pointerup="pressEnd"
            @pointerleave="pressEnd"
            @pointercancel="pressEnd"
            @contextmenu.prevent="actionBook = book"
          >
            <BookCard :book="book" :percent="percentOf(book.id)" @open="openBook" />
          </div>
        </div>

        <footer class="shelf__foot" :class="{ 'is-faded': summary }">
          <span>{{ books.length }} 本 · {{ totalLabel }}</span>
        </footer>
      </template>
    </main>

    <button v-if="!isEmpty && !importState.running" class="fab" type="button" @click="pickFile">
      <Plus :size="22" :stroke-width="1.8" />
    </button>

    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      multiple
      accept=".epub,application/epub+zip"
      @change="onPicked"
    />

    <!-- 导入进度 -->
    <Transition name="slide-up">
      <div v-if="importState.running" class="importing">
        <div class="importing__row">
          <span class="importing__label">
            正在导入 {{ importState.done + 1 }} / {{ importState.total }}
          </span>
          <span class="importing__name">{{ importState.currentName }}</span>
        </div>
        <div class="importing__bar">
          <i :style="{ width: `${(importState.done / Math.max(1, importState.total)) * 100}%` }" />
        </div>
      </div>
    </Transition>

    <!-- 结果提示 -->
    <Transition name="fade">
      <div v-if="summary" class="toast">{{ summary }}</div>
    </Transition>

    <!-- 排序 -->
    <Transition name="fade">
      <div v-if="showSort" class="scrim" @click="showSort = false" />
    </Transition>
    <Transition name="slide-down">
      <div v-if="showSort" class="sheet">
        <div class="sheet__handle" />
        <div class="sheet__head">排序方式</div>
        <div class="sheet__body">
          <button
            v-for="(label, key) in SORT_LABELS"
            :key="key"
            class="option"
            :class="{ 'is-active': sortKey === key }"
            type="button"
            @click="setSortAndClose(key as typeof sortKey)"
          >
            {{ label }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 书籍操作 -->
    <Transition name="fade">
      <div v-if="actionBook" class="scrim" @click="actionBook = null" />
    </Transition>
    <Transition name="slide-down">
      <div v-if="actionBook" class="sheet">
        <div class="sheet__handle" />
        <div class="sheet__head">
          <span class="action__title">{{ actionBook.title }}</span>
          <button class="icon-btn" type="button" @click="actionBook = null">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>
        <div class="sheet__body">
          <button class="option option--danger" type="button" @click="confirmDelete">
            <Trash2 :size="17" :stroke-width="1.8" />
            删除这本书
          </button>
          <p class="action__note">同时删除本地文件与阅读进度，不可恢复。</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.shelf {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.shelf__scroll {
  flex: 1;
  min-height: 0;
  /* 底部留 140px：滚到底时统计行要能露在「导入结果」提示条上方 */
  padding: 4px 0 calc(140px + var(--safe-bottom));
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px 16px;
  padding: 14px 18px 0;
}

@media (min-width: 520px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 760px) {
  .grid {
    grid-template-columns: repeat(4, 1fr);
    max-width: 900px;
    margin: 0 auto;
  }
}

.grid__item {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.shelf__foot {
  padding: 28px 0 12px;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-2);
  letter-spacing: 0.04em;
  transition: opacity 180ms var(--ease);
}

/* 导入结果提示条浮在底部时会正好压在统计行上，先把统计淡出 */
.shelf__foot.is-faded {
  opacity: 0;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 62vh;
  padding: 0 32px;
  text-align: center;
}

.empty__mark {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 42px;
  margin-bottom: 22px;
  opacity: 0.5;
}

.empty__mark span {
  width: 9px;
  border-radius: 1px;
  background: var(--text-3);
}

.empty__mark span:nth-child(1) {
  height: 30px;
}
.empty__mark span:nth-child(2) {
  height: 42px;
  background: var(--accent);
  opacity: 0.55;
}
.empty__mark span:nth-child(3) {
  height: 24px;
}

.empty__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 19px;
  letter-spacing: 0.06em;
}

.empty__hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-2);
}

.empty__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 26px;
  padding: 10px 20px;
  border-radius: 999px;
  font-size: 14px;
  color: #fff;
  background: var(--accent);
  box-shadow: 0 6px 18px -8px var(--accent);
}

.empty__btn:active {
  transform: translateY(1px);
}

.empty__sub {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: var(--text-2);
}

.fab {
  position: absolute;
  right: 18px;
  bottom: calc(20px + var(--safe-bottom));
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  color: #fff;
  background: var(--accent);
  box-shadow: 0 8px 24px -8px rgba(180, 71, 47, 0.72);
}

.fab:active {
  transform: scale(0.95);
}

.hidden-input {
  display: none;
}

.importing {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(20px + var(--safe-bottom));
  padding: 12px 14px 13px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: 0 10px 34px -12px rgba(0, 0, 0, 0.32);
  border: 1px solid var(--line);
}

.importing__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 9px;
}

.importing__label {
  flex: none;
  font-size: 13px;
  font-weight: 500;
}

.importing__name {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.importing__bar {
  height: 2px;
  border-radius: 1px;
  background: var(--line);
  overflow: hidden;
}

.importing__bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 220ms var(--ease);
}

.toast {
  position: absolute;
  left: 50%;
  bottom: calc(84px + var(--safe-bottom));
  transform: translateX(-50%);
  max-width: 80%;
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--bg);
  background: rgba(35, 33, 30, 0.9);
  backdrop-filter: blur(8px);
}

[data-theme='night'] .toast {
  color: #16181a;
  background: rgba(230, 227, 220, 0.92);
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--scrim);
}

.option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 4px;
  font-size: 15px;
  text-align: left;
  color: var(--text);
  border-bottom: 1px solid var(--line);
}

.option:last-child {
  border-bottom: 0;
}

.option.is-active {
  color: var(--accent);
  font-weight: 600;
}

.option--danger {
  color: var(--accent);
}

.action__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action__note {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
