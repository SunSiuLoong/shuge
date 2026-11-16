<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  List,
  MessageSquare,
  Search,
  Type,
} from 'lucide-vue-next'
import { getBook, getProgress, saveProgress, addBookmark, listBookmarks, patchBook, removeBookmark } from '../db'
import type { Book, Bookmark as BookmarkRow, TocItem } from '../types'
import { getBookFile } from '../storage/opfs'
import { navigate } from '../router'
import { settings, applyTheme, resolveTheme, systemDark } from '../settings'
import { FoliateAdapter, type RelocateInfo } from './adapter'
import { buildReaderCSS, READER_PALETTES } from './theme'
import TocDrawer from './TocDrawer.vue'
import SettingsSheet from './SettingsSheet.vue'
import SearchSheet from './SearchSheet.vue'
import LinkSheet from '../links/LinkSheet.vue'

const props = defineProps<{ bookId: number }>()

const host = ref<HTMLElement | null>(null)
const book = ref<Book | undefined>()
const adapter = shallowRef<FoliateAdapter | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const chrome = ref(false)
const showToc = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const showLinks = ref(false)
const searchRef = ref<InstanceType<typeof SearchSheet> | null>(null)

const fraction = ref(0)
const chapterLabel = ref('')
const toc = shallowRef<TocItem[]>([])

const bookmarks = ref<BookmarkRow[]>([])
const dragging = ref(false)
const slideValue = ref(0)

const palette = computed(() => READER_PALETTES[resolveTheme(settings.theme)])
const percentText = computed(() => `${(fraction.value * 100).toFixed(1)}%`)
const isBookmarked = computed(() =>
  bookmarks.value.some((b) => b.chapterIndex === chapterIndex.value),
)
const chapterIndex = ref(0)

let hideTimer: number | undefined
let saveTimer: number | undefined

const bumpChrome = (): void => {
  chrome.value = true
  clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (!showToc.value && !showSettings.value && !showSearch.value && !showLinks.value) {
      chrome.value = false
    }
  }, 5000)
}

const toggleChrome = (): void => {
  if (chrome.value) {
    chrome.value = false
    clearTimeout(hideTimer)
  } else {
    bumpChrome()
  }
}

const persist = (info: RelocateInfo): void => {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(async () => {
    if (book.value?.id == null) return
    try {
      await saveProgress({
        bookId: book.value.id,
        cfi: info.cfi || undefined,
        fraction: info.fraction,
        chapterIndex: info.chapterIndex,
        percent: info.fraction,
        chapterLabel: info.chapterLabel || undefined,
        updatedAt: Date.now(),
      })
    } catch (e) {
      console.error(e)
    }
  }, 600)
}

const applySettings = (): void => {
  const a = adapter.value
  if (!a) return
  const rect = host.value?.getBoundingClientRect()
  if (rect) a.setViewport(rect.width, rect.height)
  a.setFlow(settings.flow)
  a.setMargin(settings.margin)
  a.setGap(4)
  a.setStyles(buildReaderCSS(settings))
}

/** 屏幕旋转 / 地址栏收放都会改尺寸，需要重算分页宽度 */
const onResize = (): void => {
  applySettings()
  bindContents()
}

const onRelocate = (info: RelocateInfo): void => {
  fraction.value = info.fraction
  chapterIndex.value = info.chapterIndex
  chapterLabel.value = info.chapterLabel
  if (!dragging.value) slideValue.value = Math.round(info.fraction * 1000)
  bindContents()
  // 翻页后布局才最终确定，再收一次溢出的负边距（cost 极低：无溢出的书一次判断即返回）
  requestAnimationFrame(() => clampAll())
  persist(info)
}

/** 当前章节对应的目录项：按标题匹配，比 href 归一化更稳 */
const currentHref = computed(() => {
  if (!chapterLabel.value) return ''
  return toc.value.find((t) => t.label === chapterLabel.value)?.href ?? ''
})

/** 正文渲染在 iframe 里，点击不会冒泡到外层，需要对每个内容文档单独绑定 */
const boundDocs = new WeakSet<Document>()

/** 插图全屏查看 */
const lightboxSrc = ref<string | null>(null)

const onContentClick = (e: MouseEvent): void => {
  if (e.defaultPrevented) return
  // 点到插图 → 全屏查看，不再触发翻页/浮层
  const target = e.target as Element | null
  const img = target?.closest?.('img, svg, image') as
    | (Element & { currentSrc?: string })
    | null
  if (img) {
    const src =
      (img as HTMLImageElement).currentSrc ||
      (img as HTMLImageElement).src ||
      img.getAttribute('xlink:href') ||
      img.getAttribute('href')
    if (src) {
      e.preventDefault()
      lightboxSrc.value = src
      return
    }
  }
  const doc = (e.currentTarget as Document | null) ?? null
  if (settings.flow === 'paginated') {
    // iframe 内的 e.clientX 是 iframe 坐标系，换算回屏幕坐标再按屏幕宽度取三分布
    const frame = doc?.defaultView?.frameElement as HTMLElement | null
    const rect = frame?.getBoundingClientRect()
    const screenX = rect ? rect.left + e.clientX : e.clientX
    const width = window.innerWidth || 1
    const ratio = screenX / width
    if (ratio < 0.3) {
      void adapter.value?.prev()
      return
    }
    if (ratio > 0.7) {
      void adapter.value?.next()
      return
    }
  }
  toggleChrome()
}

/**
 * 书里常用负外边距把块状元素撑出正文栏（多看模板的卷首页横幅就是
 * `margin: 55% -50px 0 -50px`），窄屏上会溢出边界把字裁掉。
 * 只处理确实出界的块，按 body 边界收回；已处理过的打标跳过。
 * 注意要等样式表生效后再跑（contentLoad 时 blob 链接的 CSS 可能还没应用，
 * 那时元素宽度还没撑开），所以 contentLoad 和 relocate 都调一次。
 */
const clampOverflow = (doc: Document): void => {
  const body = doc.body
  if (!body) return
  if (body.scrollWidth <= body.clientWidth + 1) return
  const br = body.getBoundingClientRect()
  if (br.width < 40) return
  const win = doc.defaultView
  if (!win) return
  const els = body.querySelectorAll<HTMLElement>(
    'h1,h2,h3,h4,h5,h6,div,p,section,article,figure,blockquote,table,pre',
  )
  for (const el of Array.from(els)) {
    if (el.dataset.shugeClamp) continue
    const r = el.getBoundingClientRect()
    if (r.width < 40) continue
    const ov = Math.max(0, br.left - r.left, r.right - br.right)
    if (ov < 2) continue
    const cs = win.getComputedStyle(el)
    const ml = parseFloat(cs.marginLeft) || 0
    const mr = parseFloat(cs.marginRight) || 0
    if (ml >= 0 && mr >= 0) continue
    if (ml < 0) el.style.setProperty('margin-left', `${Math.min(0, ml + ov)}px`, 'important')
    if (mr < 0) el.style.setProperty('margin-right', `${Math.min(0, mr + ov)}px`, 'important')
    el.dataset.shugeClamp = '1'
  }
}

/** 对当前已渲染的内容文档做一次溢出回收 */
const clampAll = (): void => {
  const contents = adapter.value?.el.renderer?.getContents?.() ?? []
  for (const item of contents) {
    const doc = item?.doc as Document | undefined
    if (!doc) continue
    try {
      clampOverflow(doc)
    } catch (e) {
      console.warn('[shuge] clampOverflow', e)
    }
  }
}

const bindContents = (): void => {
  const contents = adapter.value?.el.renderer?.getContents?.() ?? []
  for (const item of contents) {
    const doc = item?.doc as Document | undefined
    if (!doc || boundDocs.has(doc)) continue
    boundDocs.add(doc)
    doc.addEventListener('click', onContentClick)
  }
  clampAll()
}

const onContentLoad = (): void => {
  bindContents()
}

const onTap = (e: MouseEvent): void => {
  const a = adapter.value
  if (!a) return
  if (a.linkJustClicked) return
  const el = host.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  const ratio = x / rect.width
  if (settings.flow === 'paginated') {
    if (ratio < 0.28) {
      void a.prev()
      return
    }
    if (ratio > 0.72) {
      void a.next()
      return
    }
  }
  toggleChrome()
}

const onSlide = (e: Event): void => {
  dragging.value = true
  slideValue.value = Number((e.target as HTMLInputElement).value)
}

const commitSlide = async (): Promise<void> => {
  const a = adapter.value
  if (!a) return
  await a.goToFraction(slideValue.value / 1000)
  dragging.value = false
}

const jumpToc = (item: TocItem): void => {
  showToc.value = false
  bumpChrome()
  void adapter.value?.goTo(item.href)
}

const goBack = (): void => {
  navigate('/')
}

const toggleBookmark = async (): Promise<void> => {
  const a = adapter.value
  if (!a || book.value?.id == null) return
  const existing = bookmarks.value.find((b) => b.chapterIndex === chapterIndex.value)
  if (existing?.id) {
    await removeBookmark(existing.id)
    bookmarks.value = bookmarks.value.filter((b) => b.id !== existing.id)
    return
  }
  const cfi = a.el.lastLocation?.cfi
  if (!cfi) return
  const row: BookmarkRow = {
    bookId: book.value.id,
    cfi,
    excerpt: a.excerptAround() || chapterLabel.value || '书签',
    chapterIndex: chapterIndex.value,
    percent: fraction.value,
    createdAt: Date.now(),
  }
  const id = await addBookmark(row)
  bookmarks.value = [{ ...row, id: id as number }, ...bookmarks.value]
}

const openSearch = (): void => {
  showSearch.value = true
  bumpChrome()
  nextTick(() => searchRef.value?.focus())
}

const jumpSearch = (cfi: string): void => {
  showSearch.value = false
  void adapter.value?.goTo(cfi)
}

watch(
  settings,
  () => {
    applySettings()
  },
  { deep: true },
)

watch(
  () => settings.theme,
  () => {
    applyTheme(settings.theme)
  },
)

/** 系统暗色切换时 settings.theme 仍是 'auto'，上面的 watch 不会触发，
 *  这里单独监听系统态，重建 iframe 内的配色与文字样式。 */
watch(systemDark, () => {
  applyTheme(settings.theme)
  applySettings()
})

/** 原生返回键：按层关闭浮层，全部关掉后交给路由 */
const onSystemBack = (e: Event): void => {
  if (lightboxSrc.value) {
    lightboxSrc.value = null
    e.preventDefault()
    return
  }
  if (showSettings.value) {
    showSettings.value = false
    e.preventDefault()
    return
  }
  if (showSearch.value) {
    showSearch.value = false
    e.preventDefault()
    return
  }
  if (showToc.value) {
    showToc.value = false
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('shuge:back', onSystemBack)
})

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try {
    book.value = await getBook(props.bookId)
    if (!book.value) {
      error.value = '书库里找不到这本书'
      return
    }
    const file = await getBookFile(book.value.opfsPath)
    if (!file) {
      error.value = '本地文件已丢失，请重新导入'
      await patchBook(props.bookId, { missing: true })
      return
    }

    const a = new FoliateAdapter(host.value!)
    adapter.value = a
    a.onRelocate = onRelocate
    a.onContentLoad = onContentLoad

    const saved = await getProgress(props.bookId)
    const lastLocation = saved?.cfi || (saved?.fraction != null ? { fraction: saved.fraction } : undefined)

    await a.open(file, lastLocation)
    toc.value = a.getToc()
    bookmarks.value = await listBookmarks(props.bookId)
    applySettings()
    bindContents()
    loading.value = false
    await patchBook(props.bookId, { lastOpenedAt: Date.now() })

    bumpChrome()
  } catch (e) {
    console.error(e)
    error.value = e instanceof Error ? e.message : '打开失败'
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('shuge:back', onSystemBack)
  clearTimeout(hideTimer)
  clearTimeout(saveTimer)
  adapter.value?.destroy()
})
</script>

<template>
  <div
    class="reader"
    :class="{ 'is-scrolled': settings.flow === 'scrolled' }"
    :style="{ background: palette.bg, color: palette.text }"
  >
    <div ref="host" class="reader__host" @click="onTap" />

    <div v-if="loading && !error" class="reader__state">正在打开…</div>
    <div v-if="error" class="reader__state reader__state--error">
      <p>{{ error }}</p>
      <button type="button" class="reader__back" @click="goBack">返回书架</button>
    </div>

    <!-- 顶栏 -->
    <Transition name="fade">
      <header v-if="chrome" class="rbar rbar--top">
        <button class="rbtn" type="button" aria-label="返回" @click="goBack">
          <ArrowLeft :size="20" :stroke-width="1.7" />
        </button>
        <span class="rbar__title">{{ book?.title }}</span>
        <button class="rbtn" type="button" aria-label="书签" @click="toggleBookmark">
          <BookmarkCheck v-if="isBookmarked" :size="19" :stroke-width="1.7" />
          <Bookmark v-else :size="19" :stroke-width="1.7" />
        </button>
      </header>
    </Transition>

    <!-- 底栏 -->
    <Transition name="fade">
      <footer v-if="chrome" class="rbar rbar--bottom">
        <div class="rbar__progress">
          <input
            class="slider"
            type="range"
            min="0"
            max="1000"
            :value="slideValue"
            @input="onSlide"
            @change="commitSlide"
          />
        </div>
        <div class="rbar__meta">
          <span class="rbar__chapter">{{ chapterLabel || `第 ${chapterIndex + 1} 节` }}</span>
          <span class="rbar__percent">{{ percentText }}</span>
        </div>
        <div class="rbar__tools">
          <button class="rtool" type="button" @click="showToc = true; bumpChrome()">
            <List :size="19" :stroke-width="1.7" />
            <span>目录</span>
          </button>
          <button class="rtool" type="button" @click="openSearch">
            <Search :size="19" :stroke-width="1.7" />
            <span>搜索</span>
          </button>
          <button class="rtool" type="button" @click="showSettings = true; bumpChrome()">
            <Type :size="19" :stroke-width="1.7" />
            <span>排版</span>
          </button>
          <button class="rtool" type="button" @click="showLinks = true; bumpChrome()">
            <MessageSquare :size="19" :stroke-width="1.7" />
            <span>书评</span>
          </button>
        </div>
      </footer>
    </Transition>

    <!-- 目录 -->
    <Transition name="slide-right">
      <div v-if="showToc" class="drawer">
        <TocDrawer :toc="toc" :current-href="currentHref" @select="jumpToc" @close="showToc = false" />
      </div>
    </Transition>

    <!-- 遮罩与浮层 -->
    <Transition name="fade">
      <div v-if="showSettings || showSearch" class="scrim" @click="showSettings = false; showSearch = false" />
    </Transition>

    <Transition name="slide-down">
      <SettingsSheet v-if="showSettings" @click.stop />
    </Transition>

    <Transition name="slide-down">
      <SearchSheet
        v-if="showSearch"
        ref="searchRef"
        :adapter="adapter!"
        @select="jumpSearch"
        @close="showSearch = false"
      />
    </Transition>

    <!-- 网文站跳转 -->
    <Transition name="slide-down">
      <LinkSheet
        v-if="showLinks && book"
        :title="book.title"
        :author="book.author"
        @close="showLinks = false"
      />
    </Transition>

    <!-- 插图全屏查看 -->
    <Transition name="fade">
      <div v-if="lightboxSrc" class="lightbox" @click="lightboxSrc = null">
        <img class="lightbox__img" :src="lightboxSrc" alt="" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.reader {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.reader__host {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.reader__state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 13px;
  color: var(--text-3);
}

.reader__state--error p {
  margin: 0;
  font-size: 14px;
  color: var(--text-2);
}

.reader__back {
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 13px;
  color: #fff;
  background: var(--accent);
}

/* 顶/底栏 */
.rbar {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  /* 之前是 88% 半透明 + 模糊，正文会从栏底透出半截字，看着像脏污；
     浮层要的是「干净地盖住」，不是「朦胧地透出」 */
  background: var(--bg);
}

.rbar--top {
  top: 0;
  gap: 6px;
  height: calc(44px + var(--safe-top));
  padding: var(--safe-top) 8px 0;
  border-bottom: 1px solid var(--line);
  box-shadow: 0 1px 12px -6px rgba(0, 0, 0, 0.28);
}

.rbar--bottom {
  bottom: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 10px 16px calc(10px + var(--safe-bottom));
  border-top: 1px solid var(--line);
  box-shadow: 0 -1px 12px -6px rgba(0, 0, 0, 0.24);
}

/* 滚动模式正文是连续的，工具栏浮上来必定把某一行拦腰截断，
   在栏底叠一层同色渐变让文字淡出。翻页模式不加：一页内容位置固定，
   渐变反而会擦掉页首标题的上沿；那种模式下被挡的是书里的卷首装饰条，能忍 */
.is-scrolled .rbar--top::after,
.is-scrolled .rbar--bottom::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 28px;
  pointer-events: none;
}

.is-scrolled .rbar--top::after {
  top: 100%;
  background: linear-gradient(var(--bg) 0%, var(--bg) 42%, transparent 100%);
}

.is-scrolled .rbar--bottom::before {
  bottom: 100%;
  background: linear-gradient(transparent 0%, var(--bg) 58%, var(--bg) 100%);
}

.rbar__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
}

.rbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--text);
}

.rbtn:active {
  background: var(--surface-2);
}

.rbar__progress {
  /* 给滑块 44px 的触摸高度，但不占布局高度：上下各负 11px 溢出 */
  display: flex;
  align-items: center;
  height: 22px;
}

.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  /* 视觉轨道只有 2px，但要给手指留够拖动区 */
  height: 44px;
  margin: -11px 0;
  background: transparent;
}

.slider::-webkit-slider-runnable-track {
  height: 2px;
  border-radius: 1px;
  background: var(--line);
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
}

.rbar__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px 6px;
  font-size: 11.5px;
  color: var(--text-2);
}

.rbar__chapter {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rbar__percent {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.rbar__tools {
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.rtool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 56px;
  padding: 6px 0 2px;
  font-size: 10.5px;
  color: var(--text-2);
}

.rtool:active {
  color: var(--accent);
}

/* 目录抽屉 */
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 55;
  width: 86%;
  max-width: 420px;
  box-shadow: -12px 0 40px -18px rgba(0, 0, 0, 0.4);
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--scrim);
}

/* 插图全屏查看 */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.96);
  cursor: zoom-out;
}

.lightbox__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 260ms var(--ease);
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
