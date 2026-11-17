<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowUpDown, ExternalLink, Plus, Settings, Tag, Trash2, X } from 'lucide-vue-next'
import type { Book } from '../types'
import { navigate } from '../router'
import { importFiles, importState, removeBook } from '../importer/importer'
import { formatBytes } from '../storage/opfs'
import {
  books,
  loading,
  percentOf,
  setShelfTab,
  setSort,
  shelfTab,
  shelfTabs,
  sortKey,
  startShelf,
  tabBooks,
  SORT_LABELS,
} from './store'
import type { SortKey } from './store'
import { settings } from '../settings'
import { maybeAutoSync } from '../sync'
import { backfillTags } from '../meta'
import BookCard from './BookCard.vue'
import BookMetaSheet from './BookMetaSheet.vue'
import LinkSheet from '../links/LinkSheet.vue'

const fileInput = ref<HTMLInputElement | null>(null)
const scrolled = ref(false)
const showSort = ref(false)
const actionBook = ref<Book | null>(null)
// 「去网文站」选中的书：先关掉操作弹层，再开站点选择
const linkTarget = ref<{ title: string; author?: string } | null>(null)
// 「标签与评分」编辑面板
const metaBook = ref<Book | null>(null)
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

const openLinkSheet = (): void => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  linkTarget.value = { title: book.title, author: book.author }
}

const openMetaSheet = (): void => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  metaBook.value = book
}

const chooseSort = (key: SortKey): void => setSort(key)

const chooseTab = (key: string): void => setShelfTab(key)

const hasTabs = computed(() => settings.shelfTabs && shelfTabs.value.length > 1)

onMounted(() => {
  void startShelf()
  void maybeAutoSync()
  // 老版本导入的书没有标签，用当时未清洗的书名回填一次
  void backfillTags()
})
</script>

<template>
  <div class="shelf">
    <header class="topbar" :class="{ scrolled }">
      <!-- [shuge] 文库式品牌题字：书徽 + 标题 + 英文小字。装饰元素，
           只有 classic 风格在 CSS 里露出，monet/glass 下隐藏；按钮位置不动 -->
      <h1 class="topbar__title title--brand">
        <span class="brand__mark" aria-hidden="true">书</span>
        <span class="brand__text">
          书阁
          <span class="brand__cap">SHUGE / READING ARCHIVE</span>
        </span>
      </h1>
      <button class="icon-btn" type="button" aria-label="排序" @click="showSort = true">
        <ArrowUpDown :size="19" :stroke-width="1.6" />
      </button>
      <button class="icon-btn" type="button" aria-label="设置" @click="navigate('/settings')">
        <Settings :size="19" :stroke-width="1.6" />
      </button>
    </header>

    <!-- 标签页：全部 / 未分类 / 各题材。贴在顶栏下面，滚动时不动 -->
    <nav v-if="hasTabs && !isEmpty" class="tabs" aria-label="按标签筛选">
      <button
        v-for="t in shelfTabs"
        :key="t.key"
        class="tab"
        :class="{ 'is-active': shelfTab === t.key }"
        type="button"
        @click="chooseTab(t.key)"
      >
        <span class="tab__label">{{ t.label }}</span>
        <span class="tab__count">{{ t.count }}</span>
      </button>
    </nav>

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
        <div
          class="grid"
          :class="{ 'is-list': settings.shelfLayout === 'list' }"
          :style="{ '--cols': settings.shelfColumns }"
        >
          <div
            v-for="book in tabBooks"
            :key="book.id"
            class="grid__item"
            @pointerdown="pressStart(book)"
            @pointerup="pressEnd"
            @pointerleave="pressEnd"
            @pointercancel="pressEnd"
            @contextmenu.prevent="actionBook = book"
          >
            <BookCard
              :book="book"
              :percent="percentOf(book.id)"
              :layout="settings.shelfLayout"
              :show-percent="settings.showPercent"
              @open="openBook"
            />
          </div>
        </div>

        <p v-if="!tabBooks.length" class="tabempty">
          这个标签下还没有书
        </p>

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

    <!-- 排序与筛选 -->
    <Transition name="fade">
      <div v-if="showSort" class="scrim" @click="showSort = false" />
    </Transition>
    <Transition name="slide-down">
      <div v-if="showSort" class="sheet sheet--panel">
        <div class="sheet__handle" />
        <div class="sheet__head">
          <span class="panel__head">排序与筛选</span>
          <button class="icon-btn" type="button" aria-label="关闭" @click="showSort = false">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>
        <div class="sheet__body">
          <p class="seg__label">排序方式</p>
          <div class="chips">
            <button
              v-for="(label, key) in SORT_LABELS"
              :key="key"
              class="chip"
              :class="{ 'is-active': sortKey === key }"
              type="button"
              @click="chooseSort(key as SortKey)"
            >{{ label }}</button>
          </div>

          <p class="seg__label">显示方式</p>
          <div class="chips">
            <button
              class="chip"
              :class="{ 'is-active': settings.shelfLayout === 'grid' }"
              type="button"
              @click="settings.shelfLayout = 'grid'"
            >网格封面</button>
            <button
              class="chip"
              :class="{ 'is-active': settings.shelfLayout === 'list' }"
              type="button"
              @click="settings.shelfLayout = 'list'"
            >列表</button>
          </div>

          <template v-if="settings.shelfLayout === 'grid'">
            <p class="seg__label">每行本数</p>
            <div class="chips">
              <button
                v-for="n in [2, 3, 4]"
                :key="n"
                class="chip"
                :class="{ 'is-active': settings.shelfColumns === n }"
                type="button"
                @click="settings.shelfColumns = n"
              >{{ n }} 本</button>
            </div>
          </template>

          <button class="switchrow" type="button" @click="settings.showPercent = !settings.showPercent">
            <span class="switchrow__text">
              显示阅读进度
              <span class="switchrow__note">在书名下显示全书百分比</span>
            </span>
            <span class="switch" :class="{ 'is-on': settings.showPercent }" />
          </button>

          <button class="switchrow" type="button" @click="settings.shelfTabs = !settings.shelfTabs">
            <span class="switchrow__text">
              标签页
              <span class="switchrow__note">书架顶部按题材分页，全部 / 未分类 / 各标签</span>
            </span>
            <span class="switch" :class="{ 'is-on': settings.shelfTabs }" />
          </button>

          <button class="done" type="button" @click="showSort = false">完成</button>
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
          <button class="option" type="button" @click="openMetaSheet">
            <Tag :size="17" :stroke-width="1.8" />
            标签与评分
          </button>
          <button class="option" type="button" @click="openLinkSheet">
            <ExternalLink :size="17" :stroke-width="1.8" />
            去网文站看书评
          </button>
          <button class="option option--danger" type="button" @click="confirmDelete">
            <Trash2 :size="17" :stroke-width="1.8" />
            删除这本书
          </button>
          <p class="action__note">同时删除本地文件与阅读进度，不可恢复。</p>
        </div>
      </div>
    </Transition>

    <!-- 网文站跳转 -->
    <Transition name="slide-down">
      <LinkSheet
        v-if="linkTarget"
        :title="linkTarget.title"
        :author="linkTarget.author"
        @close="linkTarget = null"
      />
    </Transition>

    <!-- 标签与评分 -->
    <Transition name="slide-down">
      <BookMetaSheet v-if="metaBook" :book="metaBook" @close="metaBook = null" />
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
  /* 列数由用户设置（--cols），默认 2；四列时缩小列间距，否则封面被挤成细条 */
  grid-template-columns: repeat(var(--cols, 2), 1fr);
  gap: 18px clamp(8px, 2vw, 16px);
  padding: 14px 18px 0;
}

/* 列表模式：一行一本，不再吃网格 */
.grid.is-list {
  display: block;
  max-width: 760px;
  margin: 0 auto;
  padding: 4px 18px 0;
}

@media (min-width: 760px) {
  .grid {
    max-width: 900px;
    margin: 0 auto;
  }
}

.grid__item {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

/* 选中标签后的筛选条，和顶栏同宽，滚动时不跟着走 */
.filterbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 18px 2px;
  padding: 0 6px 0 10px;
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--text-2);
  background: var(--surface-2);
}

.filterbar__name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filterbar__x {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 40px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--text-2);
}

.filterbar__x:active {
  background: var(--line);
}

/* ---- 标签页 ---- */
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  /* [shuge] 顶部加 6px：与 topbar 之间留出缓冲，胶囊不再顶进标题行 */
  padding: 6px 18px 10px;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  flex: none;
  display: inline-flex;
  /* [shuge] baseline 对齐会让单行内容停靠在交叉轴起点，文字顶在胶囊上沿；
     改中心线对齐，标签名在胶囊里垂直居中 */
  align-items: center;
  gap: 5px;
  min-height: 40px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--line);
  transition: background-color 140ms var(--ease), color 140ms var(--ease),
    border-color 140ms var(--ease);
}

.tab:active {
  transform: scale(0.97);
}

.tab.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
  font-weight: 600;
}

.tab__label {
  line-height: 1;
}

.tab__count {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  /* 计数比标题淡一档，但不能再浅：11px 的字对比度必须过 4.5 */
  color: var(--text-2);
}

/* 深色下 --text-2 压透明底只有 4.1，再亮一档 */
[data-scheme='dark'] .tab__count {
  color: #9d998f;
}

.tab.is-active .tab__count {
  color: inherit;
  opacity: 0.72;
}

.tabempty {
  margin: 40px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-3);
}

.group {
  margin-bottom: 4px;
}

.group__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 20px 18px 0;
}

.group:first-of-type .group__head {
  padding-top: 12px;
}

.group__name {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text);
}

.group__count {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* 有组标题时组内网格收紧上边距，免得标题和封面之间空一大块 */
.group__head + .grid {
  padding-top: 12px;
}

.shelf__foot {
  /* 悬浮在屏幕左下的小浮块：原先是文档流里排在所有书后面的统计行，
     书多了要滚很久才能看到；FAB 在右下，浮块放左下避让 */
  position: fixed;
  left: 16px;
  bottom: calc(16px + var(--safe-bottom));
  z-index: 20;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--text-2);
  letter-spacing: 0.04em;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-card);
  transition: opacity 180ms var(--ease), background-color var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
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
  color: var(--on-accent);
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
  color: var(--on-accent);
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

[data-scheme='dark'] .toast {
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

/* ---- 排序与筛选面板 ---- */
.panel__head {
  flex: 1;
  min-width: 0;
}

.sheet--panel .sheet__body {
  max-height: 64vh;
}

.seg__label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 20px 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-2);
}

.seg__label:first-child {
  margin-top: 2px;
}

.seg__note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 标签可能几十个，横向滚动比换十几行省地方 */
.chips--scroll {
  flex-wrap: nowrap;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  margin: 0 -16px;
  padding: 0 16px 6px;
  scrollbar-width: none;
}

.chips--scroll::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
  transition: background 140ms var(--ease), color 140ms var(--ease);
}

.chip:active {
  transform: scale(0.97);
}

.chip.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
  font-weight: 600;
}

.switchrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 8px 0;
  text-align: left;
}

.switchrow__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  color: var(--text);
}

.switchrow__note {
  font-size: 11.5px;
  color: var(--text-3);
}

.switch {
  position: relative;
  flex: none;
  width: 42px;
  height: 25px;
  border-radius: 999px;
  background: var(--line);
  transition: background 160ms var(--ease);
}

.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
  transition: transform 160ms var(--ease);
}

.switch.is-on {
  background: var(--accent);
}

.switch.is-on::after {
  transform: translateX(17px);
}

.done {
  width: 100%;
  min-height: 48px;
  margin-top: 20px;
  border-radius: var(--radius);
  font-size: 14.5px;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
}

.done:active {
  transform: translateY(1px);
}
</style>
