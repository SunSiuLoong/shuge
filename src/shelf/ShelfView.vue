<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  CheckCheck,
  ExternalLink,
  Image as ImageIcon,
  Pencil,
  Plus,
  Search,
  Settings2,
  Tag,
  Tags,
  Trash2,
  X,
} from 'lucide-vue-next'
import type { Book } from '../types'
import { navigate } from '../router'
import { importItems, importState, removeBook } from '../importer/importer'
import type { ImportItem } from '../importer/importer'
import { formatBytes } from '../storage/opfs'
import { isNative as isNativeApp } from '../native'
import {
  forgetNativeFolder,
  pickRefFilesDesktop,
  pickRefFilesNative,
  readRefFileNative,
  scanNativeFolder,
  supportsRefImport,
} from '../storage/refs'
import type { ScannedFile } from '../storage/refs'
import {
  books,
  loading,
  percentOf,
  setShelfTab,
  shelfTab,
  shelfTabs,
  startShelf,
  tabBooks,
} from './store'
import type { ShelfTab } from './store'
import { settings } from '../settings'
import { maybeAutoSync } from '../sync'
import { backfillTags } from '../meta'
import { renameTagEverywhere } from './tagOps'
import BookCard from './BookCard.vue'
import BookMetaSheet from './BookMetaSheet.vue'
import BookEditSheet from './BookEditSheet.vue'
import CoverSheet from './CoverSheet.vue'
import BatchTagSheet from './BatchTagSheet.vue'
import LinkSheet from '../links/LinkSheet.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import { useSwipe } from '../ui/swipe'
import PromptDialog from '../ui/PromptDialog.vue'
import { openInApp } from '../links/inapp'
import { QM_BASE, searchForum, type QmSearchItem } from '../community/qm'

const fileInput = ref<HTMLInputElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const scrolled = ref(false)
const actionBook = ref<Book | null>(null)
// 「去网文站」选中的书：先关掉操作弹层，再开站点选择
const linkTarget = ref<{ title: string; author?: string } | null>(null)
// 「标签与评分」编辑面板
const metaBook = ref<Book | null>(null)
// 查看封面 / 修改书名作者
const coverBook = ref<Book | null>(null)
const editBook = ref<Book | null>(null)
const summary = ref<string | null>(null)

/** 批量管理：进去以后点卡片是勾选，不是开书 */
const selecting = ref(false)
const selected = ref<Book[]>([])
const batchOpen = ref(false)

/** 待确认的删除（单本或批量都走这一张弹窗） */
const pendingDelete = ref<Book[] | null>(null)
/** 标签页长按重命名：存旧名字 */
const tagRenaming = ref<string | null>(null)

const isEmpty = computed(() => !loading.value && books.value.length === 0)
const totalSize = computed(() =>
  books.value.reduce((sum, b) => sum + (b.fileSize || 0), 0),
)
const totalLabel = computed(() => formatBytes(totalSize.value))
const allSelected = computed(
  () => tabBooks.value.length > 0 && selected.value.length === tabBooks.value.length,
)

const onScroll = (e: Event): void => {
  scrolled.value = (e.target as HTMLElement).scrollTop > 4
}

/**
 * 导入入口分派：
 * - 平台支持且开关开着 → 系统选择器 + 引用原文件（不复制；安卓 SAF，桌面 FS Access）
 * - 否则回退 <input type=file>，走复制入库
 */
const pickFile = (): void => {
  if (settings.importByRef && supportsRefImport) {
    void pickByRef()
    return
  }
  fileInput.value?.click()
}

const pickByRef = async (): Promise<void> => {
  try {
    if (isNativeApp) {
      const files = await pickRefFilesNative()
      if (!files.length) return
      const items: ImportItem[] = []
      for (const f of files) {
        // SAF 只给 content:// uri：去重、解析、目录提取都要真实字节，
        // 先按块读进内存（不落盘），再交给 importer
        const file = await readRefFileNative(f.uri, f.name)
        items.push({ file, ref: { refUri: f.uri } })
      }
      await finishImport(items)
    } else {
      const picked = await pickRefFilesDesktop()
      if (!picked.length) return
      await finishImport(
        picked.map((r) => ({ file: r.file, ref: { refKey: r.key } })),
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '选择文件失败'
    toast(msg, 9000)
  }
}

const finishImport = async (
  items: { file: File; ref?: { refKey?: string; refUri?: string } }[],
): Promise<void> => {
  const results = await importItems(items)
  const added = results.filter((r) => r.status === 'added').length
  const dup = results.filter((r) => r.status === 'duplicate').length
  const failed = results.filter((r) => r.status === 'failed').length
  const parts = [`导入 ${added} 本`]
  if (dup) parts.push(`${dup} 本重复已跳过`)
  if (failed) {
    const first = results.find((r) => r.status === 'failed')
    parts.push(`${failed} 本失败${first?.reason ? `：${first.reason}` : ''}`)
  }
  // 失败原因要留得住，别 4 秒就没了
  toast(parts.join('，'), failed ? 9000 : 4000)
}

const onPicked = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  await finishImport(files.map((file) => ({ file })))
}

let summaryTimer = 0
const toast = (msg: string, ms = 3000): void => {
  summary.value = msg
  clearTimeout(summaryTimer)
  summaryTimer = window.setTimeout(() => (summary.value = null), ms)
}

/**
 * 长按/滑动统一在滚动容器上判定，避免每张卡片各挂一套定时器：
 * - 480ms 不动 → 长按菜单（批量管理里改成长按勾选）
 * - 横向位移 > 64 且明显大于纵向 → 切换标签页
 * 长按或滑动之后浏览器还会补一个 click，用 clickGuard 吃掉它。
 */
let clickGuard = 0
let clickGuardUntil = 0
const guardClick = (): void => {
  clickGuard = Date.now()
}

/** 遮罩点击守卫：长按弹菜单的瞬间，补发 click 不应把菜单关掉 */
const actionScrimClick = (): void => {
  if (Date.now() < clickGuardUntil) return
  actionBook.value = null
}

interface Gesture {
  x: number
  y: number
  book: Book | null
  moved: boolean
  longFired: boolean
  timer: number
  active: boolean
}

let g: Gesture = { x: 0, y: 0, book: null, moved: false, longFired: false, timer: 0, active: false }

const cancelPress = (): void => {
  if (g.timer) {
    clearTimeout(g.timer)
    g.timer = 0
  }
}

const onDown = (e: PointerEvent): void => {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const el = (e.target as HTMLElement).closest('[data-book-id]') as HTMLElement | null
  const id = el?.dataset.bookId ? Number(el.dataset.bookId) : NaN
  const book = Number.isFinite(id) ? tabBooks.value.find((b) => b.id === id) ?? null : null
  cancelPress()
  g = {
    x: e.clientX,
    y: e.clientY,
    book,
    moved: false,
    longFired: false,
    timer: 0,
    active: true,
  }
  if (!book) return
  g.timer = window.setTimeout(() => {
    if (!g.active || g.moved) return
    g.longFired = true
    navigator.vibrate?.(10)
    if (selecting.value) toggleSelect(book)
    else actionBook.value = book
    // 长按抬手时浏览器会补发一个 click，别让它把刚弹出的菜单（或遮罩）点掉
    clickGuardUntil = Date.now() + 450
  }, 480)
}

const onMove = (e: PointerEvent): void => {
  if (!g.active) return
  const dx = e.clientX - g.x
  const dy = e.clientY - g.y
  if (!g.moved && Math.hypot(dx, dy) > 8) {
    g.moved = true
    cancelPress()
  }
}

/** 这里只管长按收尾；左右滑动交给 useSwipe（pointerup 在真机上会被取消） */
const onUp = (): void => {
  cancelPress()
  if (!g.active) return
  g.active = false
  if (g.longFired) guardClick()
}

const onCancel = (): void => {
  cancelPress()
  g.active = false
  g.moved = true
}

const openBook = (book: Book): void => {
  // 长按/滑动后浏览器补的 click：不当成「打开这本」
  if (Date.now() - clickGuard < 400) return
  if (selecting.value) {
    toggleSelect(book)
    return
  }
  if (book.id == null) return
  navigate(`/read/${book.id}`)
}

const isSelected = (book: Book): boolean =>
  book.id != null && selected.value.some((b) => b.id === book.id)

const toggleSelect = (book: Book): void => {
  if (book.id == null) return
  if (isSelected(book)) selected.value = selected.value.filter((b) => b.id !== book.id)
  else selected.value = [...selected.value, book]
  if (!selected.value.length) selecting.value = false
}

const startSelect = (book: Book): void => {
  selecting.value = true
  selected.value = isSelected(book) ? selected.value : [...selected.value, book]
}

const exitSelect = (): void => {
  selecting.value = false
  selected.value = []
  batchOpen.value = false
}

const toggleSelectAll = (): void => {
  if (allSelected.value) {
    selected.value = []
    selecting.value = false
    return
  }
  selected.value = [...tabBooks.value]
}

const askDelete = (list: Book[]): void => {
  if (!list.length) return
  pendingDelete.value = [...list]
}

/** option = 弹窗里「同时删除本地文件」是否勾选 */
const doDelete = async (deleteFile: boolean): Promise<void> => {
  const list = pendingDelete.value ?? []
  pendingDelete.value = null
  if (!list.length) return
  let failed = 0
  for (const book of list) {
    try {
      await removeBook(book, { keepFile: !deleteFile })
    } catch (e) {
      console.warn('[shuge] 删除失败', e)
      failed++
    }
  }
  exitSelect()
  const ok = list.length - failed
  const tail = deleteFile ? '本地文件已删除' : '本地文件已移入回收站'
  toast(failed ? `已删除 ${ok} 本，${failed} 本失败` : `已删除 ${ok} 本，${tail}`, failed ? 8000 : 3600)
}

const deleteMessage = computed(() => {
  const list = pendingDelete.value ?? []
  if (list.length === 1) {
    return `《${list[0].title}》会从书架移除，阅读进度和书签一并删除，不可恢复。`
  }
  return `这 ${list.length} 本书会从书架移除，阅读进度和书签一并删除，不可恢复。`
})

const hasRefBook = computed(() => (pendingDelete.value ?? []).some((b) => b.source === 'ref'))

/** 标签页长按：停在此页上改名，全库同名标签一起改 */
const submitTagRename = async (to: string): Promise<void> => {
  const from = tagRenaming.value
  tagRenaming.value = null
  if (!from) return
  const { changed, conflict } = await renameTagEverywhere(from, to)
  toast(
    changed
      ? `「${from}」已改成「${to}」，${changed} 本同步${conflict ? `（${conflict} 本合并）` : ''}`
      : `没有书用到「${from}」`,
    4000,
  )
}

const confirmDelete = async (): Promise<void> => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  askDelete([book])
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

const openCover = (): void => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  coverBook.value = book
}

const openEdit = (): void => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  editBook.value = book
}

const enterBatch = (): void => {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  startSelect(book)
}

const onEditSaved = (book: Book): void => {
  editBook.value = null
  toast(`已改为《${book.title}》`)
}

/* ---- 书架搜索：默认搜书架（当前标签页），可切本地（全库）与社区（阡陌居） ---- */
const showSearch = ref(false)
const query = ref('')
type SearchScope = 'shelf' | 'local' | 'community'
const searchScope = ref<SearchScope>('shelf')
const communityItems = ref<QmSearchItem[]>([])
const communitySearching = ref(false)
const communityMsg = ref('')
let communityTimer = 0
/** 请求序号：慢请求回来时如果已经不是最新一次，结果直接丢掉，防旧结果覆盖新结果 */
let communitySeq = 0

const kw = computed(() => query.value.trim().toLowerCase())

/**
 * 书架范围：按书名、作者、标签过滤当前标签页。
 * 「本地」不再查已入库的书——那是书架自己的事；本地=手机存储文件夹，
 * 结果来自原生扫描（见下面的 localFiles）。
 */
const searchHits = computed(() => {
  if (!kw.value || searchScope.value !== 'shelf') return []
  return tabBooks.value.filter(
    (b) =>
      b.title.toLowerCase().includes(kw.value) ||
      (b.author ?? '').toLowerCase().includes(kw.value) ||
      (b.tags ?? []).some((t) => t.toLowerCase().includes(kw.value)),
  )
})

/* ---- 本地（手机存储）：SAF 目录授权 + 递归扫描 ---- */
const localFiles = ref<ScannedFile[]>([])
const localFolder = ref('')
const localBusy = ref(false)
const localMsg = ref('')
const importingUri = ref('')

/** 手机存储搜索只在 App 里成立；浏览器里这一档直接不出现 */
const scopes = computed<SearchScope[]>(() =>
  isNativeApp ? ['shelf', 'local', 'community'] : ['shelf', 'community'],
)

const scopeName = (s: SearchScope): string =>
  s === 'shelf' ? '书架' : s === 'local' ? '本地' : '社区'

const localHits = computed(() =>
  localFiles.value.filter((f) => !kw.value || f.name.toLowerCase().includes(kw.value)),
)

const scanFolder = async (): Promise<void> => {
  if (!isNativeApp) return
  localBusy.value = true
  localMsg.value = ''
  try {
    const r = await scanNativeFolder()
    localFolder.value = r.folder
    localFiles.value = r.files
    if (!r.files.length) localMsg.value = '这个文件夹里没找到电子书'
  } catch (e) {
    localFiles.value = []
    localMsg.value = e instanceof Error ? e.message : '扫描失败'
  } finally {
    localBusy.value = false
  }
}

/** 换文件夹：清掉授权记录再扫一次，系统会重新弹目录选择器 */
const changeLocalFolder = async (): Promise<void> => {
  await forgetNativeFolder().catch(() => undefined)
  localFiles.value = []
  await scanFolder()
}

/** 点扫描结果：按引用模式导入（原文件留在手机里，不复制） */
const importScanned = async (f: ScannedFile): Promise<void> => {
  if (importingUri.value) return
  // 扫描会带出 pdf / mobi / txt，导入链路只吃 EPUB；提前拦下，别让它走到「失败」再报
  if (!/\.epub$/i.test(f.name)) {
    toast('目前只能导入 EPUB，这个文件导不了', 6000)
    return
  }
  importingUri.value = f.uri
  try {
    const file = await readRefFileNative(f.uri, f.name)
    await finishImport([{ file, ref: { refUri: f.uri } }])
  } catch (e) {
    toast(e instanceof Error ? e.message : '导入失败', 9000)
  } finally {
    importingUri.value = ''
  }
}

const searchingCommunity = computed(
  () => searchScope.value === 'community' && communitySearching.value,
)

const runCommunitySearch = async (): Promise<void> => {
  const q = query.value.trim()
  const seq = ++communitySeq
  communityItems.value = []
  communityMsg.value = ''
  if (!q) return
  communitySearching.value = true
  try {
    const r = await searchForum(q)
    if (seq !== communitySeq) return
    communityItems.value = r.items
    communityMsg.value = r.message
  } catch (e) {
    if (seq !== communitySeq) return
    communityItems.value = []
    communityMsg.value = e instanceof Error ? e.message : '社区搜索失败'
  } finally {
    if (seq === communitySeq) communitySearching.value = false
  }
}

watch(searchScope, (s) => {
  if (s === 'local' && !localFiles.value.length && !localBusy.value) void scanFolder()
})

watch([query, searchScope], () => {
  if (searchScope.value !== 'community') {
    clearTimeout(communityTimer)
    communitySeq++
    communitySearching.value = false
    return
  }
  clearTimeout(communityTimer)
  communityTimer = window.setTimeout(() => void runCommunitySearch(), 500)
})

const toggleSearch = (): void => {
  showSearch.value = !showSearch.value
  if (!showSearch.value) {
    clearTimeout(communityTimer)
    communitySeq++
    query.value = ''
    communityItems.value = []
    communityMsg.value = ''
    communitySearching.value = false
    searchScope.value = 'shelf'
  }
}

const openThread = (url: string, title: string): void => {
  void openInApp(url, title, false)
}

/** 社区关键词交给内置浏览器看完整结果（应用内只列前 30 条） */
const openCommunitySearchPage = (): void => {
  const q = query.value.trim()
  if (!q) return
  void openInApp(
    `${QM_BASE}/search.php?mod=forum&srchtxt=${encodeURIComponent(q)}&searchsubmit=yes`,
    '社区搜索',
    false,
  )
}

const scopeLabel = computed(() => scopeName(searchScope.value))

const hasTabs = computed(() => settings.shelfTabs && shelfTabs.value.length > 1)/** 标签条横向滚动容器：切页后把当前标签滚到中间，标签多的时候不至于看不见 */
const tabsEl = ref<HTMLElement | null>(null)

const revealTab = (): void => {
  void nextTick(() => {
    const nav = tabsEl.value
    const btn = nav?.querySelector<HTMLElement>('.tab.is-active')
    if (!nav || !btn) return
    const nr = nav.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    const delta = br.left - nr.left - (nav.clientWidth - btn.clientWidth) / 2
    nav.scrollTo({ left: Math.max(0, nav.scrollLeft + delta), behavior: 'smooth' })
  })
}

const chooseTab = (key: string): void => {
  if (tabLongFired) {
    tabLongFired = false
    return
  }
  setShelfTab(key)
  revealTab()
}

/** 上一页 / 下一页（不要首尾相接，滑到头就该停住） */
const stepTab = (dir: number): void => {
  const list = shelfTabs.value
  if (list.length < 1) return
  const i = list.findIndex((t) => t.key === shelfTab.value)
  const next = list[Math.min(list.length - 1, Math.max(0, i + dir))]
  if (next && next.key !== shelfTab.value) {
    setShelfTab(next.key)
    revealTab()
    navigator.vibrate?.(4)
  }
}

/* ---- 左右滑动切标签页：整个书架都能滑（顶栏、网格、空白处） ---- */
const shelfEl = ref<HTMLElement | null>(null)

useSwipe(
  shelfEl,
  (dir) => {
    if (!hasTabs.value || selecting.value || isEmpty.value) return
    guardClick()
    stepTab(dir)
  },
  { distance: 52, dominance: 1.2 },
)

/* ---- 标签页长按重命名 ---- */
let tabTimer = 0
let tabLongFired = false
let tabX = 0
let tabY = 0

const tabDown = (t: ShelfTab, e: PointerEvent): void => {
  tabLongFired = false
  if (t.key === '__all__' || t.key === '__untagged__') return
  tabX = e.clientX
  tabY = e.clientY
  clearTimeout(tabTimer)
  tabTimer = window.setTimeout(() => {
    tabLongFired = true
    navigator.vibrate?.(10)
    tagRenaming.value = t.key
  }, 480)
}

const tabMove = (e: PointerEvent): void => {
  if (Math.hypot(e.clientX - tabX, e.clientY - tabY) > 8) clearTimeout(tabTimer)
}

const tabUp = (): void => clearTimeout(tabTimer)

/* ---- 顶栏双击（不是按钮的地方）回顶 ---- */
let lastTopTap = 0
const onTopTap = (e: PointerEvent): void => {
  if (selecting.value) return
  if ((e.target as HTMLElement).closest('button')) return
  const now = Date.now()
  if (now - lastTopTap < 320) {
    lastTopTap = 0
    navigator.vibrate?.(6)
    scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    lastTopTap = now
  }
}

onMounted(() => {
  void startShelf()
  void maybeAutoSync()
  // 老版本导入的书没有标签，用当时未清洗的书名回填一次
  void backfillTags()
})
</script>

<template>
  <div ref="shelfEl" class="shelf">
    <header class="topbar" :class="{ scrolled: scrolled || selecting }" @pointerup="onTopTap">
      <!-- 批量管理：顶栏换成「取消 / 已选 n 本 / 全选」，跟系统相册一致 -->
      <template v-if="selecting">
        <button class="icon-btn" type="button" aria-label="退出批量管理" @click="exitSelect">
          <X :size="20" :stroke-width="1.8" />
        </button>
        <h1 class="topbar__title">已选 {{ selected.length }} 本</h1>
        <div class="topbar__tools">
          <button
            class="icon-btn"
            type="button"
            :aria-label="allSelected ? '取消全选' : '全选'"
            @click="toggleSelectAll"
          >
            <CheckCheck :size="19" :stroke-width="1.7" />
          </button>
        </div>
      </template>

      <template v-else>
        <!-- [shuge] 文库式品牌题字：书徽 + 标题 + 英文小字。装饰元素，
             只有极简风格在 CSS 里露出。
             注意：这块**不能**做成按钮——顶栏任意空白处双击才是「回到书架顶部」，
             设置入口改放右侧齿轮，否则单击标题会抢掉双击手势 -->
        <h1 class="topbar__title title--brand">
          <span class="brand__mark" aria-hidden="true">书</span>
          <span class="brand__text">
            书阁
            <span class="brand__cap">SHUGE / READING ARCHIVE</span>
          </span>
        </h1>
        <!-- 工具区：搜索 + 设置（排序在设置的书架分组里） -->
        <div class="topbar__tools">
          <button
            class="icon-btn"
            :class="{ 'is-active': showSearch }"
            type="button"
            :aria-label="showSearch ? '关闭搜索' : '搜索'"
            @click="toggleSearch"
          >
            <Search v-if="!showSearch" :size="19" :stroke-width="1.6" />
            <X v-else :size="19" :stroke-width="1.6" />
          </button>
          <button
            class="icon-btn"
            type="button"
            aria-label="设置"
            @click="navigate('/settings')"
          >
            <Settings2 :size="19" :stroke-width="1.6" />
          </button>
        </div>
      </template>
    </header>

    <!-- 搜索条：M3 search bar（胶囊、高面），范围 书架 / 本地 / 社区 -->
    <div v-if="showSearch" class="searchbar">
      <Search class="searchbar__icon" :size="17" :stroke-width="1.8" />
      <input
        v-model="query"
        class="searchbar__input"
        type="search"
        :placeholder="
          searchScope === 'community'
            ? '在阡陌居搜索帖子'
            : searchScope === 'local'
              ? '搜手机里的电子书'
              : '搜书名、作者、标签'
        "
        enterkeyhint="search"
      />
      <button
        v-if="query"
        class="searchbar__clear"
        type="button"
        aria-label="清空"
        @click="query = ''"
      >
        <X :size="15" :stroke-width="1.8" />
      </button>
      <div class="searchbar__scopes">
        <button
          v-for="s in scopes"
          :key="s"
          type="button"
          class="searchbar__scope"
          :class="{ 'is-active': searchScope === s }"
          @click="searchScope = s"
        >
          {{ scopeName(s) }}
        </button>
      </div>
    </div>

    <!-- 标签页：全部 / 未分类 / 各题材。贴在顶栏下面，滚动时不动。
         长按可重命名（「全部」「未分类」是虚拟页，不给改） -->
    <nav
      v-if="hasTabs && !isEmpty"
      ref="tabsEl"
      class="tabs"
      aria-label="按标签筛选"
    >
      <button
        v-for="t in shelfTabs"
        :key="t.key"
        class="tab"
        :class="{ 'is-active': shelfTab === t.key }"
        type="button"
        @pointerdown="tabDown(t, $event)"
        @pointermove="tabMove"
        @pointerup="tabUp"
        @pointercancel="tabUp"
        @pointerleave="tabUp"
        @click="chooseTab(t.key)"
      >
        <span class="tab__label">{{ t.label }}</span>
        <span class="tab__count">{{ t.count }}</span>
      </button>
    </nav>

    <main
      ref="scrollEl"
      class="shelf__scroll scroll-y"
      :class="{ 'is-selecting': selecting }"
      @scroll="onScroll"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
    >
      <!-- 搜索态：书架出书卡、本地出手机文件夹扫描结果、社区出帖子列表 -->
      <template v-if="showSearch && (query.trim() || searchScope === 'local')">
        <template v-if="searchScope === 'community'">
          <p v-if="searchingCommunity" class="tabempty">正在搜索社区…</p>
          <p v-else-if="communityMsg || !communityItems.length" class="tabempty">
            {{ communityMsg || '输入关键词搜索阡陌居的帖子' }}
          </p>
          <div v-else class="threads">
            <button
              v-for="(it, i) in communityItems"
              :key="i"
              class="thread"
              type="button"
              @click="openThread(it.url, it.title)"
            >
              <span class="thread__title">{{ it.title }}</span>
              <span class="thread__host">阡陌居</span>
            </button>
            <button class="thread thread--more" type="button" @click="openCommunitySearchPage">
              在内置浏览器里看完整结果
            </button>
          </div>
        </template>
        <template v-else-if="searchScope === 'local'">
          <!-- 手机存储：选文件夹授权后列出里面的电子书，点一条按引用模式导入 -->
          <div class="localfold">
            <span class="localfold__path">{{ localFolder || '手机存储' }}</span>
            <span class="localfold__count">{{ localFiles.length }} 本</span>
            <button
              class="localfold__btn"
              type="button"
              :disabled="localBusy"
              @click="changeLocalFolder"
            >
              换文件夹
            </button>
          </div>
          <p v-if="localBusy" class="tabempty">正在扫描文件夹…</p>
          <p v-else-if="localMsg" class="tabempty">{{ localMsg }}</p>
          <p v-else-if="!localHits.length" class="tabempty">
            没有名字含「{{ query.trim() }}」的文件
          </p>
          <div v-else class="localfiles">
            <button
              v-for="f in localHits"
              :key="f.uri"
              class="localrow"
              type="button"
              :disabled="importingUri === f.uri"
              @click="importScanned(f)"
            >
              <span class="localrow__name">{{ f.name }}</span>
              <span class="localrow__meta">
                {{ f.dir ? `${f.dir} · ` : '' }}{{ formatBytes(f.size) }}
              </span>
              <span class="localrow__act">{{ importingUri === f.uri ? '导入中…' : '导入' }}</span>
            </button>
          </div>
        </template>
        <template v-else>
          <p class="searchhint">
            {{ scopeLabel }}内找到 {{ searchHits.length }} 本「{{ query.trim() }}」
          </p>
          <div v-if="searchHits.length" class="grid" :style="{ '--cols': settings.shelfColumns }">
            <div v-for="book in searchHits" :key="book.id" class="grid__item" :data-book-id="book.id">
              <BookCard
                :book="book"
                :percent="percentOf(book.id)"
                :layout="settings.shelfLayout"
                :show-percent="settings.showPercent"
                :select-mode="false"
                :selected="false"
                @open="openBook"
              />
            </div>
          </div>
          <p v-else class="tabempty">没有找到，换个词试试</p>
        </template>
      </template>

      <div v-else-if="isEmpty" class="empty">
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
          :key="shelfTab"
          class="grid"
          :class="{ 'is-list': settings.shelfLayout === 'list' }"
          :style="{ '--cols': settings.shelfColumns }"
        >
          <div
            v-for="book in tabBooks"
            :key="book.id"
            class="grid__item"
            :data-book-id="book.id"
            @contextmenu.prevent="selecting ? toggleSelect(book) : (actionBook = book)"
          >
            <BookCard
              :book="book"
              :percent="percentOf(book.id)"
              :layout="settings.shelfLayout"
              :show-percent="settings.showPercent"
              :select-mode="selecting"
              :selected="isSelected(book)"
              @open="openBook"
            />
          </div>
        </div>

        <p v-if="!tabBooks.length" class="tabempty">
          这个标签下还没有书
        </p>

        <footer v-if="!selecting" class="shelf__foot" :class="{ 'is-faded': summary }">
          <span>{{ books.length }} 本 · {{ totalLabel }}</span>
        </footer>
      </template>
    </main>

    <button
      v-if="!isEmpty && !importState.running && !selecting"
      class="fab"
      type="button"
      @click="pickFile"
    >
      <Plus :size="22" :stroke-width="1.8" />
    </button>

    <!-- 批量操作条：勾了书才浮出来，跟 FAB 同一条底线上 -->
    <Transition name="slide-up">
      <div v-if="selecting" class="batchbar">
        <button class="batchbar__btn" type="button" :disabled="!selected.length" @click="batchOpen = true">
          <Tags :size="18" :stroke-width="1.8" />
          标签
        </button>
        <button
          class="batchbar__btn batchbar__btn--danger"
          type="button"
          :disabled="!selected.length"
          @click="askDelete(selected)"
        >
          <Trash2 :size="18" :stroke-width="1.8" />
          删除
        </button>
      </div>
    </Transition>

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

    <!-- 书籍操作 -->
    <Transition name="fade">
      <div v-if="actionBook" class="scrim" @click="actionScrimClick" />
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
          <button class="option" type="button" @click="openCover">
            <ImageIcon :size="17" :stroke-width="1.8" />
            查看封面
          </button>
          <button class="option" type="button" @click="openEdit">
            <Pencil :size="17" :stroke-width="1.8" />
            修改书名和作者
          </button>
          <button class="option" type="button" @click="openMetaSheet">
            <Tag :size="17" :stroke-width="1.8" />
            标签与评分
          </button>
          <button class="option" type="button" @click="enterBatch">
            <Tags :size="17" :stroke-width="1.8" />
            批量管理
          </button>
          <button v-if="settings.showReview" class="option" type="button" @click="openLinkSheet">
            <ExternalLink :size="17" :stroke-width="1.8" />
            去网文站看书评
          </button>
          <button class="option option--danger" type="button" @click="confirmDelete">
            <Trash2 :size="17" :stroke-width="1.8" />
            删除这本书
          </button>
          <p class="action__note">删除前会再确认一次，可选是否连同本地文件一起删。</p>
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

    <!-- 修改书名与作者 -->
    <Transition name="slide-down">
      <BookEditSheet
        v-if="editBook"
        :book="editBook"
        @close="editBook = null"
        @saved="onEditSaved"
      />
    </Transition>

    <!-- 查看封面 -->
    <Transition name="fade">
      <CoverSheet v-if="coverBook" :book="coverBook" @close="coverBook = null" />
    </Transition>

    <!-- 批量标签 -->
    <Transition name="fade">
      <BatchTagSheet
        v-if="batchOpen && selected.length"
        :books="selected"
        @close="batchOpen = false"
        @done="toast"
      />
    </Transition>

    <!-- 删除确认：二次确认 + 「同时删除本地文件」默认不勾 -->
    <Transition name="fade">
      <ConfirmDialog
        v-if="pendingDelete"
        :title="pendingDelete.length > 1 ? `删除这 ${pendingDelete.length} 本书？` : '删除这本书？'"
        :message="deleteMessage"
        confirm-text="删除"
        danger
        :option="{
          label: '同时删除本地文件',
          note: hasRefBook
            ? '引用模式的书只删书记录，原文件在你自己的目录里，不会被删。不勾选时已复制入库的文件移入回收站。'
            : '不勾选时文件移入回收站，可在「设置 → 关于」里清空；勾选后文件立即删除，不可恢复。',
        }"
        @close="pendingDelete = null"
        @confirm="doDelete"
      />
    </Transition>

    <!-- 标签页重命名 -->
    <Transition name="fade">
      <PromptDialog
        v-if="tagRenaming"
        :title="`重命名标签「${tagRenaming}」`"
        label="新名字"
        :value="tagRenaming"
        :maxlength="12"
        note="标签页上所有书籍的这个标签会一起改名（全库同步）。"
        @close="tagRenaming = null"
        @submit="submitTagRename"
      />
    </Transition>
  </div>
</template>

<style scoped>
.shelf {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  /* 横向手势留给 JS（切标签页）：不交给浏览器，避免被滚动手势抢走 or 触发
     横向 overscroll；纵向滚动和双指缩放照旧 */
  touch-action: pan-y pinch-zoom;
}

.shelf__scroll {
  flex: 1;
  min-height: 0;
  /* 底部留 140px：滚到底时统计行要能露在「导入结果」提示条上方 */
  padding: 4px 0 calc(140px + var(--safe-bottom));
}

/* 批量操作条要压在最下面一排书上，多留一截才滚得出来 */
.shelf__scroll.is-selecting {
  padding-bottom: calc(210px + var(--safe-bottom));
}

.grid {
  display: grid;
  /* 列数由用户设置（--cols），默认 2；四列时缩小列间距，否则封面被挤成细条 */
  grid-template-columns: repeat(var(--cols, 2), 1fr);
  gap: 18px clamp(8px, 2vw, 16px);
  padding: 14px 18px 0;
  /* 切标签页时整片轻轻淡入上浮一下（:key 换 tab 会重建这块，动画随之重放） */
  animation: grid-swap 220ms var(--ease) both;
}

@keyframes grid-swap {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 系统开了「减少动态效果」就不动 */
@media (prefers-reduced-motion: reduce) {
  .grid {
    animation: none;
  }
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

/* ---- 顶栏工具浮块：面由 base.css 的 --tools-* 按外观给 ---- */
.topbar__tools {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 40px;
  padding: 0 2px;
  border-radius: 999px;
  background: var(--tools-bg, transparent);
  border: 1px solid var(--tools-line, transparent);
  box-shadow: var(--tools-shadow, none);
  backdrop-filter: var(--tools-blur, none);
}

/* 设置入口已移到顶栏右侧齿轮；标题只做展示，双击顶栏仍是「回到顶部」 */

/* ---- 搜索条（M3 search bar：胶囊 + 高面） ---- */
.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 18px 4px;
  padding: 0 8px 0 14px;
  min-height: 48px;
  border-radius: 999px;
  background: var(--surface-2);
  flex: none;
}

.searchbar__icon {
  flex: none;
  color: var(--text-3);
}

.searchbar__input {
  flex: 1;
  min-width: 0;
  height: 46px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}

.searchbar__input:focus {
  outline: none;
}

.searchbar__input::placeholder {
  color: var(--text-3);
}

/* type=search 的原生清除按钮去掉，用自绘的 */
.searchbar__input::-webkit-search-cancel-button {
  display: none;
}

.searchbar__clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--text-3);
}

.searchbar__scopes {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--line) 55%, transparent);
}

.searchbar__scope {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-2);
}

.searchbar__scope.is-active {
  color: var(--text);
  background: var(--surface);
  font-weight: 600;
}

/* 搜索结果 */
.searchhint {
  margin: 10px 20px 0;
  font-size: 12px;
  color: var(--text-2);
}

/* ---- 本地（手机存储）结果 ---- */
.localfold {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 20px 6px;
  font-size: 12px;
  color: var(--text-2);
}

.localfold__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 600;
}

.localfold__count {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.localfold__btn {
  flex: none;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
}

.localfold__btn:disabled {
  opacity: 0.5;
}

.localfiles {
  max-width: 760px;
  margin: 0 auto;
  padding: 4px 18px 0;
}

.localrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 4px;
  text-align: left;
  border-bottom: 1px solid var(--line);
}

.localrow:disabled {
  opacity: 0.6;
}

.localrow__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--text);
}

.localrow__meta {
  flex: none;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}

.localrow__act {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}

.threads {
  max-width: 760px;
  margin: 0 auto;
  padding: 10px 18px 0;
  display: flex;
  flex-direction: column;
}

.thread {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 4px;
  text-align: left;
  border-bottom: 1px solid var(--line);
}

.thread__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread__host {
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-2);
}

.thread--more {
  justify-content: center;
  border-bottom: 0;
  color: var(--accent);
  font-size: 13px;
}

/* ---- 标签页 ---- */
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  /* 标签条自己可以横向滚（标签多的时候），滚到头继续滑才是切页；
     指针事件被滚动手势取消也正好，不会一次手势干两件事 */
  touch-action: pan-x pan-y;
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
  /* 长按改名：别让系统把标签文字当可选中文本处理（安卓会弹选择/复制） */
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
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
  /* 与右下角 FAB 同一套外观令牌（base.css 按三套外观定义） */
  color: var(--fab-fg, var(--on-accent));
  background: var(--fab-bg, var(--accent));
  border: 1px solid var(--fab-line, transparent);
  backdrop-filter: var(--fab-blur, none);
  box-shadow: var(--fab-shadow, 0 8px 22px -10px color-mix(in srgb, var(--accent) 58%, transparent));
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
  /* 面随外观走：令牌由 base.css 按经典/莫奈/玻璃三套外观定义，这里只管布局 */
  color: var(--fab-fg, var(--on-accent));
  background: var(--fab-bg, var(--accent));
  border: 1px solid var(--fab-line, transparent);
  backdrop-filter: var(--fab-blur, none);
  box-shadow: var(--fab-shadow, 0 8px 22px -10px color-mix(in srgb, var(--accent) 58%, transparent));
  transition:
    transform 140ms var(--ease),
    background-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
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

/* ---- 批量操作条 ---- */
.batchbar {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(16px + var(--safe-bottom));
  z-index: 24;
  display: flex;
  gap: 8px;
  padding: 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: 0 12px 34px -18px rgba(0, 0, 0, 0.5);
  transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

[data-style='glass'] .batchbar {
  background: var(--glass-bg);
  border-color: var(--glass-line);
  backdrop-filter: blur(var(--glass-blur-bar)) saturate(var(--glass-saturate));
  box-shadow: var(--glass-shadow);
}

.batchbar__btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 44px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  background: var(--surface-2);
}

.batchbar__btn:active {
  transform: scale(0.98);
}

.batchbar__btn:disabled {
  opacity: 0.45;
}

.batchbar__btn--danger {
  color: var(--on-accent);
  background: var(--accent);
}
</style>
