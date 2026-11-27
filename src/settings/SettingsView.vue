<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Check, ChevronRight, Image, RotateCcw } from 'lucide-vue-next'
import { navigate, route } from '../router'
import {
  appDark,
  settings,
  MONET_SOURCE_LABELS,
  MONET_SOURCE_NOTES,
  SCHEME_LABELS,
  THEME_LABELS,
  UI_STYLE_LABELS,
  UI_STYLE_NOTES,
  resetSettings,
  type MonetSource,
  type SchemeKey,
  type ThemeKey,
  type UiStyleKey,
} from '../settings'
import { MONET_PRESETS, accentFromImage, currentAccentHex } from '../ui/monet'
import { isSystemColorAvailable } from '../ui/systemcolor'
import { READER_PALETTES } from '../reader/theme'
import { SORT_LABELS, setSort, sortKey, type SortKey } from '../shelf/store'
import SyncSection from './SyncSection.vue'
import MetaSection from './MetaSection.vue'
import AboutSection from './AboutSection.vue'
import CommunitySection from '../community/CommunitySection.vue'
import { useSwipe } from '../ui/swipe'
import { isNative } from '../native'
import { formatBytes } from '../storage/opfs'
import { changeWatchedFolder, importScanned, scanWatched } from '../storage/folderWatch'
import { buildImportReport, type ImportReport } from '../importer/report'
import InfoDialog from '../ui/InfoDialog.vue'
import type { ScannedFile } from '../storage/refs'

const imageInput = ref<HTMLInputElement | null>(null)
const appliedHex = ref(currentAccentHex() ?? settings.monetHex)

/* ---- 扫描文件夹：授权一个目录，列出里面的 EPUB 供勾选导入 ----
   去重靠书库里已登记的 refUri（见 storage/folderWatch.ts），不靠时间戳快照 */
const scanAll = ref(0)
const scanFresh = ref<ScannedFile[]>([])
const picked = ref<string[]>([])
const scanBusy = ref(false)
const scanMsg = ref('')
const importMsg = ref('')
/** 扫描导入的结果弹窗（与书架导入同一套文案） */
const importReport = ref<ImportReport | null>(null)

const fmtTime = (ts: number): string => {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** change=true 表示换文件夹：先忘掉旧授权，系统会重新弹目录选择器 */
const runScan = async (change = false): Promise<void> => {
  if (scanBusy.value) return
  scanBusy.value = true
  scanMsg.value = ''
  importMsg.value = ''
  try {
    const r = change ? await changeWatchedFolder() : await scanWatched()
    scanAll.value = r.all.length
    scanFresh.value = r.fresh
    picked.value = r.fresh.map((f) => f.uri) // 默认全选新书，用户可取消
    if (!r.folder) scanMsg.value = '没有选择文件夹'
    else if (!r.all.length)
      scanMsg.value = '这个文件夹里没找到 EPUB；如果确实有书，可能是授权失效，点「换文件夹」重选'
    else if (!r.fresh.length) scanMsg.value = '都导入过了，没有新书'
  } catch (e) {
    scanAll.value = 0
    scanFresh.value = []
    picked.value = []
    scanMsg.value = e instanceof Error ? e.message : '扫描失败'
  } finally {
    scanBusy.value = false
  }
}

const importPicked = async (): Promise<void> => {
  if (scanBusy.value || !picked.value.length) return
  scanBusy.value = true
  importMsg.value = ''
  try {
    const sel = scanFresh.value.filter((f) => picked.value.includes(f.uri))
    const r = await importScanned(sel)
    const parts = [`导入 ${r.added} 本`]
    if (r.duplicate) parts.push(`${r.duplicate} 本重复已跳过`)
    if (r.failed) parts.push(`${r.failed} 本失败`)
    importMsg.value = parts.join('，')
    importReport.value = buildImportReport(r.results)
    // 导完重扫一遍：列表里只剩真正没进库的
    const again = await scanWatched()
    scanAll.value = again.all.length
    scanFresh.value = again.fresh
    picked.value = again.fresh.map((f) => f.uri)
  } catch (e) {
    importMsg.value = e instanceof Error ? e.message : '导入失败'
  } finally {
    scanBusy.value = false
  }
}

/** 设置页二级分类。第一层只列这些名字，点进去才展开该类的参数 */
const SECTIONS = [
  { key: 'theme', no: '01', label: '主题' },
  { key: 'shelf', no: '02', label: '书架' },
  { key: 'sync', no: '03', label: '同步' },
  { key: 'meta', no: '04', label: '标签、评分与评论' },
  { key: 'community', no: '05', label: '社区' },
  { key: 'about', no: '06', label: '关于' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

/** 当前打开的分类；null 表示停在分类列表。分类放在路由里，
   这样标题栏返回键和系统返回都能一级一级退 */
const section = computed<SectionKey | null>(() => {
  if (route.value.name !== 'settings') return null
  const key = route.value.section
  return SECTIONS.some((s) => s.key === key) ? (key as SectionKey) : null
})

const sectionLabel = computed(
  () => SECTIONS.find((s) => s.key === section.value)?.label ?? '',
)

const open = (key: SectionKey): void => navigate(`/settings/${key}`)

const scrollEl = ref<HTMLElement | null>(null)

/** 转场方向：进分类从右滑入，退回列表从左滑入（共享轴模式） */
const navDir = ref<'fwd' | 'back'>('fwd')

watch(section, (to, from) => {
  navDir.value = !from || to ? 'fwd' : 'back'
})

/* out-in 模式下新页挂载完才回顶，watch 里拿到的还是旧节点 */
const resetScroll = (): void => scrollEl.value?.scrollTo({ top: 0 })

const themes = Object.keys(THEME_LABELS) as ThemeKey[]
const schemes = Object.keys(SCHEME_LABELS) as SchemeKey[]
/* [shuge] 外观只放出「原生」：极简（默认）与液态玻璃（开发中）在设置里收起，
   代码与主题层全部保留，随时可以重新开放 */
/* [houmo] 「极简」重做成厚墨/轻墨风后放出来，与「原生」并列可选 */
const styles: UiStyleKey[] = ['classic', 'monet']
const monetSources = Object.keys(MONET_SOURCE_LABELS) as MonetSource[]
const columns = [2, 3, 4]

/** 网页端没有动态色，这里如实说，不要让用户以为是 bug */
const systemNote = computed(() =>
  isSystemColorAvailable()
    ? '读手机壁纸的动态色（Android 12 以上）。换了壁纸回到 App 会自动变。'
    : '当前不是安卓 App（或系统低于 12），取不到壁纸色，会先用下面的兜底色。',
)

const reset = (): void => {
  resetSettings()
  syncApplied()
}

const themeSwatch = (key: ThemeKey): Record<string, string> => {
  if (key === 'follow') {
    return { background: 'linear-gradient(180deg, #fbf9f4 0 50%, #16181a 50%)' }
  }
  return { background: READER_PALETTES[key].bg }
}

const pickPreset = (hex: string): void => {
  settings.monetHex = hex
  settings.monetSource = 'manual'
  syncApplied()
}
const pickImage = (): void => imageInput.value?.click()

const onImage = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const hex = await accentFromImage(file)
  if (!hex) {
    appliedHex.value = '取色失败，换一张试试'
    return
  }
  settings.monetHex = hex
  settings.monetSource = 'image'
  syncApplied()
}

/** 取色是异步的（系统色要过桥），显示值得等一轮 */
const syncApplied = (): void => {
  void nextTick(() => {
    appliedHex.value = currentAccentHex() ?? settings.monetHex
  })
}

watch([() => settings.monetSource, () => settings.monetHex, appDark], syncApplied)

/**
 * 右滑返回：二级 → 一级分类，一级 → 书架。
 * 横向位移明显大于纵向才算；从滑条/开关/输入框起手时不算，否则拖透明度
 * 滑条会被当成返回。判定用 touch 事件（安卓上 pointerup 会被滚动手势取消）。
 */
const settingsEl = ref<HTMLElement | null>(null)
/** 滑动触发后的短时间窗口里吞掉补发的 click，防止手指落点所在的分类行被误点开 */
let clickGuardUntil = 0

const onSwipeClick = (e: MouseEvent): void => {
  if (Date.now() < clickGuardUntil) {
    e.stopPropagation()
    e.preventDefault()
  }
}

/** 返回键 / 右滑共用：二级只退到分类列表，一级才回书架 */
const back = (): void => {
  if (section.value) navigate('/settings')
  else navigate('/')
}

useSwipe(
  settingsEl,
  (dir) => {
    // 只认右滑（dir = -1）；左滑在设置页没有对应动作，别乱退
    if (dir !== -1) return
    clickGuardUntil = Date.now() + 450
    navigator.vibrate?.(4)
    back()
  },
  { distance: 64, dominance: 1.2, ignore: 'input, textarea, select, [data-noswipe]' },
)

onMounted(syncApplied)
</script>

<template>
  <div ref="settingsEl" class="settings" @click.capture="onSwipeClick">
    <header class="topbar">
      <button class="icon-btn" type="button" aria-label="返回" @click="back">
        <ArrowLeft :size="20" :stroke-width="1.7" />
      </button>
      <h1 class="topbar__title">{{ section ? sectionLabel : '设置' }}</h1>
    </header>

    <!-- 两级之间做交叉淡入：**不能**用 mode="out-in"，那会让旧页先退干净、
         中间留一帧空白，整块设置区看起来就是在闪。两个滚动层叠在 stage 里 -->
    <div class="settings__stage">
    <Transition :name="navDir === 'fwd' ? 'setfwd' : 'setback'" @after-enter="resetScroll">
      <!-- 第一层：只列分类名 -->
      <div v-if="!section" key="list" ref="scrollEl" class="settings__scroll scroll-y">
      <nav class="card cats">
        <button
          v-for="s in SECTIONS"
          :key="s.key"
          class="cat"
          type="button"
          @click="open(s.key)"
        >
          <span class="cat__no">{{ s.no }}</span>
          <span class="cat__name">{{ s.label }}</span>
          <ChevronRight class="cat__arrow" :size="18" :stroke-width="1.8" />
        </button>
      </nav>

      <p class="note">
        本地优先：书籍文件存在浏览器私有目录，不上传、不联网。换设备或清缓存会丢，重要藏书请自行留档。
      </p>
    </div>

      <!-- 第二层：某一类的参数 -->
      <div v-else :key="section" ref="scrollEl" class="settings__scroll scroll-y">
      <!-- 01 主题：外观 · 明暗 · 阅读主题 · 强调色 -->
      <template v-if="section === 'theme'">
        <p class="lead">整套界面的质感与明暗，外加阅读正文的纸色。先挑外观，再挑颜色。</p>

        <section class="card">
          <p class="sub sub--first">外观</p>
          <div class="styles">
            <button
              v-for="key in styles"
              :key="key"
              type="button"
              class="style"
              :class="{ 'is-active': settings.uiStyle === key }"
              @click="settings.uiStyle = key"
            >
              <span class="style__preview" :data-preview="key">
                <i /><i /><i />
                <Check
                  v-if="settings.uiStyle === key"
                  class="style__check"
                  :size="14"
                  :stroke-width="3"
                />
              </span>
              <span class="style__name">{{ UI_STYLE_LABELS[key] }}</span>
              <span class="style__note">{{ UI_STYLE_NOTES[key] }}</span>
            </button>
          </div>
          <p class="hint hint--tight">
            极简＝纯白纸面、细线分层；原生＝按系统壁纸取色（Material You）。液态玻璃暂时收起，代码还在。
          </p>

          <!-- 液态玻璃专属：通透度滑条（参考 Kyant0/AndroidLiquidGlass 的
               material 参数化思路——同一块玻璃给用户留一个 thickness/opacity 手柄） -->
          <template v-if="settings.uiStyle === 'glass'">
            <p class="sub">玻璃透明度</p>
            <div class="slider-row">
              <input
                v-model.number="settings.glassOpacity"
                class="slider"
                type="range"
                min="10"
                max="90"
                step="5"
              />
              <span class="slider__val">{{ settings.glassOpacity }}%</span>
            </div>
            <p class="hint hint--tight">
              数值越大越通透，玻璃底下的内容越明显；太透会看不清字，40% 左右最稳。书架浮块、
              阅读页顶底栏、目录抽屉、弹层都跟着这个值走。
            </p>
          </template>

          <p class="sub">明暗</p>
          <div class="seg">
            <button
              v-for="key in schemes"
              :key="key"
              type="button"
              class="seg__item"
              :class="{ 'is-active': settings.scheme === key }"
              @click="settings.scheme = key"
            >
              {{ SCHEME_LABELS[key] }}
            </button>
          </div>

          <p class="sub">阅读主题</p>
          <div class="themes">
            <button
              v-for="key in themes"
              :key="key"
              type="button"
              class="theme"
              :class="{ 'is-active': settings.theme === key }"
              @click="settings.theme = key"
            >
              <span class="theme__dot" :style="themeSwatch(key)" />
              <span class="theme__name">{{ THEME_LABELS[key] }}</span>
            </button>
          </div>
          <p class="hint hint--tight">
            「跟随 App」时，App 切深色阅读页就变夜读；也可以单独锁一套纸色。字号与行距在阅读界面的「Aa」里调。
          </p>

          <div class="divider" />

          <p class="sub sub--first">强调色</p>
          <p class="hint hint--tight">
            「原生」外观的取色来源。浅色与深色自动配套，强调色会按对比度收一档，不是原色照搬。
          </p>
          <div class="chips">
            <button
              v-for="key in monetSources"
              :key="key"
              type="button"
              class="chip"
              :class="{ 'is-active': settings.monetSource === key }"
              @click="settings.monetSource = key"
            >
              {{ MONET_SOURCE_LABELS[key] }}
            </button>
          </div>

          <p class="hint hint--tight">
            {{ settings.monetSource === 'system' ? systemNote : MONET_SOURCE_NOTES[settings.monetSource] }}
          </p>

          <div v-if="settings.monetSource === 'manual'" class="swatches">
            <button
              v-for="p in MONET_PRESETS"
              :key="p.key"
              type="button"
              class="swatch"
              :class="{ 'is-active': settings.monetHex.toLowerCase() === p.accent.toLowerCase() }"
              @click="pickPreset(p.accent)"
            >
              <span class="swatch__bars">
                <i v-for="s in p.swatches" :key="s" :style="{ background: s }" />
              </span>
              <span class="swatch__name">{{ p.name }}</span>
            </button>
          </div>

          <div v-if="settings.monetSource === 'image'" class="picker">
            <button class="picker__btn" type="button" @click="pickImage">
              <Image :size="16" :stroke-width="1.8" />
              选择一张图片
            </button>
            <span class="picker__note">只在本地读，不上传</span>
          </div>

          <div class="current">
            <span class="current__chip" :style="{ background: appliedHex.startsWith('#') ? appliedHex : settings.monetHex }" />
            <span class="current__label">当前主色</span>
            <span class="current__hex">{{ appliedHex }}</span>
          </div>

          <p v-if="settings.uiStyle !== 'monet'" class="hint hint--tight">
            现在用的是「{{ UI_STYLE_LABELS[settings.uiStyle] }}」，这里选的色要切到「原生」才生效。
          </p>
        </section>
      </template>

      <!-- 02 书架 -->
      <template v-else-if="section === 'shelf'">
        <p class="lead">书的排列与出版方式。标签页按题材分页，同名标签自动归到一起。</p>

        <section class="card">
          <div class="row">
            <span>显示方式</span>
            <div class="seg seg--inline">
              <button
                type="button"
                class="seg__item"
                :class="{ 'is-active': settings.shelfLayout === 'grid' }"
                @click="settings.shelfLayout = 'grid'"
              >
                网格
              </button>
              <button
                type="button"
                class="seg__item"
                :class="{ 'is-active': settings.shelfLayout === 'list' }"
                @click="settings.shelfLayout = 'list'"
              >
                列表
              </button>
            </div>
          </div>

          <div v-if="settings.shelfLayout === 'grid'" class="row">
            <span>每行本数</span>
            <div class="seg seg--inline">
              <button
                v-for="n in columns"
                :key="n"
                type="button"
                class="seg__item seg__item--num"
                :class="{ 'is-active': settings.shelfColumns === n }"
                @click="settings.shelfColumns = n"
              >
                {{ n }}
              </button>
            </div>
          </div>

          <label class="row row--switch">
            <span>显示阅读进度百分比</span>
            <input v-model="settings.showPercent" class="toggle" type="checkbox" />
          </label>

          <label class="row row--switch">
            <span>顶部标签页</span>
            <input v-model="settings.shelfTabs" class="toggle" type="checkbox" />
          </label>

          <label class="row row--switch">
            <span>书卡标签</span>
            <input v-model="settings.showCardTags" class="toggle" type="checkbox" />
          </label>

          <label class="row row--switch">
            <span>引用原文件（不复制）</span>
            <input v-model="settings.importByRef" class="toggle" type="checkbox" />
          </label>
          <p class="hint hint--tight">
            开着时点右下角加号直接登记原文件位置，书库不占第二份空间（安卓走系统文件选择器，
            桌面 Chrome/Edge 走文件句柄；不支持的浏览器会自动改回复制）。原文件被移动、删除或
            授权失效就打不开。关掉则导入时把书复制进书库，离线更稳。
          </p>

          <p class="sub">排序方式</p>
          <div class="chips">
            <button
              v-for="(label, key) in SORT_LABELS"
              :key="key"
              type="button"
              class="chip"
              :class="{ 'is-active': sortKey === key }"
              @click="setSort(key as SortKey)"
            >
              {{ label }}
            </button>
          </div>
        </section>

        <!-- 扫描文件夹：选一个目录，列出里面的 EPUB 勾选导入；可选新书自动导入 -->
        <section class="card">
          <p class="sub">扫描文件夹</p>

          <template v-if="isNative">
            <div class="row">
              <span>电子书文件夹</span>
              <span class="row__value fold__path">{{ settings.folderName || '未选择' }}</span>
            </div>

            <div class="fold__acts">
              <button
                class="fold__btn"
                type="button"
                :disabled="scanBusy"
                @click="runScan(false)"
              >
                {{ scanBusy ? '扫描中…' : settings.folderName ? '重新扫描' : '选择文件夹' }}
              </button>
              <button
                v-if="settings.folderName"
                class="fold__btn fold__btn--ghost"
                type="button"
                :disabled="scanBusy"
                @click="runScan(true)"
              >
                换文件夹
              </button>
            </div>

            <p class="hint hint--tight">
              第一次会调起系统目录选择器，之后记住授权。只认 EPUB，递归最多 6 层、800 本。
              导进来的书按「引用原文件」登记，文件本体留在手机里，不占第二份空间。
            </p>
            <p v-if="settings.folderScanAt" class="hint hint--tight">
              上次扫描：{{ fmtTime(settings.folderScanAt) }}
            </p>
            <p v-if="scanMsg" class="hint hint--tight">{{ scanMsg }}</p>
            <!-- 导入结果放在列表块外面：导完列表会清空，放里面提示会跟着消失 -->
            <p v-if="importMsg" class="hint hint--tight">{{ importMsg }}</p>

            <template v-if="scanFresh.length">
              <p class="sub">
                扫描到 {{ scanAll }} 本，其中 {{ scanFresh.length }} 本还没导入
              </p>
              <div class="fold__list">
                <label v-for="f in scanFresh" :key="f.uri" class="fold__item">
                  <input v-model="picked" type="checkbox" :value="f.uri" />
                  <span class="fold__name">{{ f.name }}</span>
                  <span class="fold__meta">
                    {{ f.dir ? `${f.dir} · ` : '' }}{{ formatBytes(f.size) }}
                  </span>
                </label>
              </div>
              <div class="fold__acts">
                <button
                  class="fold__btn fold__btn--primary"
                  type="button"
                  :disabled="scanBusy || !picked.length"
                  @click="importPicked"
                >
                  {{ scanBusy ? '处理中…' : `导入所选（${picked.length}）` }}
                </button>
                <button
                  class="fold__btn fold__btn--ghost"
                  type="button"
                  :disabled="scanBusy"
                  @click="picked = scanFresh.map((f) => f.uri)"
                >
                  全选
                </button>
              </div>
            </template>

            <label class="row row--switch">
              <span>文件夹有新书时自动导入</span>
              <input v-model="settings.folderAutoImport" class="toggle" type="checkbox" />
            </label>
            <p class="hint hint--tight">
              安卓没有后台文件监听，实际是「下次打开 App 或切回前台时补进来」，单次最多 10 本；
              多出来的留在上面列表里手动勾。
            </p>
            <p v-if="settings.folderLastAutoText" class="hint hint--tight">
              上次自动导入：{{ settings.folderLastAutoText }}（{{ fmtTime(settings.folderLastAutoAt) }}）
            </p>
          </template>

          <p v-else class="hint hint--tight">
            扫描文件夹只在安卓 App 里可用——浏览器拿不到目录长期授权。网页端请用右下角加号选文件，
            或从桌面把书拖进来。
          </p>
        </section>
      </template>

      <!-- 03 同步 -->
      <template v-else-if="section === 'sync'">
        <p class="lead">书目、进度与书签的云端备份。书文件本身不上传。</p>
        <section class="card">
          <SyncSection />
        </section>
      </template>

      <!-- 04 标签 · 评分 · 评论 -->
      <template v-else-if="section === 'meta'">
        <p class="lead">标签在导入时从书名提取；评分来自豆瓣与微信读书，只取分数与人数。</p>
        <section class="card">
          <MetaSection />

          <div class="divider" />

          <label class="row row--switch">
            <span>显示书评入口</span>
            <input v-model="settings.showReview" class="toggle" type="checkbox" />
          </label>
          <p class="hint hint--tight">
            阅读页底栏的「书评」和长按书籍的「去网文站看书评」都归这个开关。关掉后界面更干净，
            想看书评时再打开即可。
          </p>
        </section>
      </template>

      <!-- 05 社区 -->
      <template v-else-if="section === 'community'">
        <p class="lead">阡陌居的一键签到、领取威望与下载记录。登录态跟着手机浏览器的 Cookie 走。</p>
        <CommunitySection />
      </template>

      <!-- 06 关于 -->
      <template v-else>
        <p class="lead">存储占用、版本与更新，以及项目和打赏入口。</p>
        <section class="card">
          <AboutSection />

          <div class="divider" />

          <button class="row row--btn" type="button" @click="reset">
            <span>恢复默认设置</span>
            <span class="row__value">
              <RotateCcw :size="14" :stroke-width="1.8" />
              重置
            </span>
          </button>
        </section>
      </template>
      </div>
    </Transition>
    </div>

    <input ref="imageInput" class="hidden" type="file" accept="image/*" @change="onImage" />

    <!-- 扫描导入的结果：和书架加号导入用同一个弹窗，文案一致 -->
    <Transition name="fade">
      <InfoDialog
        v-if="importReport"
        :title="importReport.title"
        :lines="importReport.lines"
        :details="importReport.details"
        :note-title="importReport.noteTitle"
        :note="importReport.note"
        @close="importReport = null"
      />
    </Transition>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 横向手势给「右滑返回」，别被浏览器当成横滚/回弹 */
  touch-action: pan-y pinch-zoom;
}

.settings .topbar {
  /* 设置页顶栏常驻分隔线：正文滚到栏下时需要一个明确的边界 */
  border-bottom-color: var(--line);
}

/* 两级页面的叠放舞台：两个滚动层同时存在时互相覆盖，避免布局跳动 */
.settings__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.settings__scroll {
  position: absolute;
  inset: 0;
  padding: 10px 16px calc(40px + var(--safe-bottom));
}

.hidden {
  display: none;
}

/* 玻璃透明度滑条 */
.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0 2px;
}

.slider {
  flex: 1;
  height: 24px;
  appearance: none;
  background: transparent;
}

.slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: var(--line);
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -8px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.slider__val {
  min-width: 44px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

/* 紧跟卡片说明的第一个小标题不需要再空一大截 */
.sub--first {
  margin-top: 6px;
}

/* ---- 分节卡片 ---- */
.card {
  margin-bottom: 14px;
  padding: 16px 15px 14px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--line);
}

/*
 * 深色下卡片不填色，只留描边：强调色当文字压在 #202326 上只有 4.3，
 * 压页面底色 #16181a 才够 4.5。留白也更透气。
 */
[data-scheme='dark'] .card {
  background: transparent;
}

.card.is-muted {
  opacity: 0.72;
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 10px;
  letter-spacing: 0.16em;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.card__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text);
}

.card__note {
  margin: 6px 0 14px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-2);
}

/* ---- 第一层：分类列表 ----
   借 .card 的容器面（外观切换时自动跟玻璃/纸面），只去掉内边距让行贴边 */
.cats {
  padding: 0;
  overflow: hidden;
}

.cat {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 0 14px 0 16px;
  text-align: left;
  color: var(--text);
  transition: background-color var(--dur) var(--ease);
}

.cat + .cat {
  border-top: 1px solid var(--line);
}

.cat:active {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.cat__no {
  flex: none;
  width: 20px;
  font-size: 10px;
  letter-spacing: 0.14em;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.cat__name {
  flex: 1;
  font-family: var(--font-serif);
  font-size: 15.5px;
  letter-spacing: 0.02em;
}

.cat__arrow {
  flex: none;
  color: var(--text-3);
}

/* 第二层的引导说明：位置对应原来卡片里的 card__note */
.lead {
  margin: 2px 2px 12px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-2);
}

/* ---- 分段控件 ---- */
.seg {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
}

.seg--inline {
  flex: none;
  padding: 2px;
}

.seg__item {
  flex: 1;
  /* 触屏最小点击高度 40：34 的按钮在手机上容易点偏 */
  min-height: 40px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text-2);
  transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

/* 深色下 --text-2 压 surface-2 只有 4.14:1，未选中项要再亮一档 */
[data-scheme='dark'] .seg__item:not(.is-active) {
  color: #9d998f;
}

.seg__item--num {
  min-width: 42px;
  font-variant-numeric: tabular-nums;
}

.seg__item.is-active {
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 1px 4px -2px rgba(0, 0, 0, 0.3);
  font-weight: 600;
}

[data-scheme='dark'] .seg__item.is-active {
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--line);
}

/* ---- UI 风格三选一 ---- */
.styles {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: 14px;
}

.style {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  text-align: left;
}

.style__preview {
  position: relative;
  display: block;
  height: 62px;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
  outline: 1px solid var(--line);
  outline-offset: -1px;
  transition: outline-color var(--dur) var(--ease);
}

.style__preview i {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 9px;
  border-radius: 3px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.style__preview i:nth-child(1) {
  top: 10px;
}
.style__preview i:nth-child(2) {
  top: 24px;
  right: 26px;
}
.style__preview i:nth-child(3) {
  top: 38px;
  right: 40px;
}

/* 经典：实心块 + 细线 */
.style__preview[data-preview='classic'] i {
  background: var(--surface);
}

/* 莫奈：低饱和渐变底，块是半透明的 */
.style__preview[data-preview='monet'] {
  background:
    radial-gradient(120% 90% at 10% 0%, rgba(122, 168, 159, 0.55), transparent 65%),
    radial-gradient(120% 90% at 90% 100%, rgba(214, 160, 168, 0.55), transparent 62%),
    var(--surface-2);
}

.style__preview[data-preview='monet'] i {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(2px);
}

/* 玻璃：模糊 + 高光边 */
.style__preview[data-preview='glass'] {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5), rgba(180, 200, 220, 0.35));
  backdrop-filter: blur(4px);
}

[data-scheme='dark'] .style__preview[data-preview='glass'] {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(120, 150, 180, 0.1));
}

.style__preview[data-preview='glass'] i {
  background: rgba(255, 255, 255, 0.42);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

.style__check {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px;
  border-radius: 50%;
  color: var(--on-accent);
  background: var(--accent);
}

.style.is-active .style__preview {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.style__name {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text);
}

.style.is-active .style__name {
  color: var(--accent);
  font-weight: 600;
}

.style__note {
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--text-3);
}

/* ---- 色板 ---- */
.swatches {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 4px 0 12px;
}

.swatch {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 5px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--surface-2);
  text-align: left;
}

.swatch.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.swatch__bars {
  display: flex;
  height: 34px;
  border-radius: 5px;
  overflow: hidden;
}

.swatch__bars i {
  flex: 1;
}

.swatch__name {
  font-size: 11.5px;
  color: var(--text);
}

/* 选中靠色板外圈提示，文字不用强调色：色板底是 --surface-2，accent 压上去过不了 4.5 */
.swatch.is-active .swatch__name {
  color: var(--text);
  font-weight: 700;
}

.picker {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.picker__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--line);
}

.picker__note {
  font-size: 11px;
  color: var(--text-3);
}

.current {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--text-2);
}

.current__chip {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  outline: 1px solid var(--line);
  outline-offset: -1px;
}

.current__hex {
  margin-left: auto;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--text-3);
  text-transform: uppercase;
}

/* ---- 阅读主题色块 ---- */
.themes {
  display: flex;
  gap: 10px;
  padding-bottom: 6px;
}

.theme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.theme__dot {
  display: block;
  width: 100%;
  height: 52px;
  border-radius: var(--radius);
  outline: 1px solid var(--line);
  outline-offset: -1px;
  transition: outline-color var(--dur) var(--ease);
}

.theme.is-active .theme__dot {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.theme__name {
  font-size: 11.5px;
  color: var(--text-2);
}

.theme.is-active .theme__name {
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.hint--tight {
  margin: 8px 0 10px;
  font-size: 11.5px;
  color: var(--text-3);
}

/* ---- 通用行 ---- */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  font-size: 14px;
  text-align: left;
  color: var(--text);
}

.row--btn:active {
  opacity: 0.6;
}

.row--switch {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.row__value {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.meter {
  height: 3px;
  margin: 2px 0 12px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}

.meter i {
  display: block;
  height: 100%;
  background: var(--accent);
}

.link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  font-size: 12.5px;
  color: var(--accent);
  text-align: left;
}

.sub {
  margin: 14px 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 4px;
}

.chip {
  min-height: 40px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
  transition: background 140ms var(--ease), color 140ms var(--ease);
}

.chip.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
  font-weight: 600;
}

.toggle {
  flex: none;
  width: 22px;
  height: 22px;
  accent-color: var(--accent);
}

.note {
  margin: 18px 2px 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-3);
}
/* ============ 极简（厚墨/轻墨风）：设置页去卡片 ============
   厚墨的设置页没有卡片块，靠分节标题 + 一条细线分区。只改形态，
   行高、点击区、分组顺序全部不动。 */
[data-style='classic'] .card {
  margin-bottom: 0;
  padding: 16px 2px 14px;
  border: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
}

[data-style='classic'] .card:last-of-type {
  border-bottom: 0;
}

/* 分类列表自己带行间线，卡片不再留内边距，行贴同一条左边线 */
[data-style='classic'] .cats.card {
  padding: 0;
}

[data-style='classic'] .cat {
  padding-left: 2px;
  padding-right: 2px;
}

[data-style='classic'] .card__title,
[data-style='classic'] .cat__name {
  font-family: var(--font-ui);
  font-weight: 700;
  letter-spacing: 0.01em;
}

/* ============ 扫描文件夹 ============ */
/* 路径可能很长，挤在右列里要截断，别把行撑破 */
.fold__path {
  max-width: 58%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 6px;
}

.fold__btn {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
}

.fold__btn--ghost {
  color: var(--text-2);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--line);
}

.fold__btn--primary {
  color: var(--on-accent);
  background: var(--accent);
}

.fold__btn:disabled {
  opacity: 0.5;
}

/* 极简：按钮跟分段控件一样收成小方角（厚墨那边没有胶囊） */
[data-style='classic'] .fold__btn {
  border-radius: 8px;
}

.fold__list {
  margin: 8px 0 2px;
  border-top: 1px solid var(--line);
}

.fold__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}

.fold__item input {
  flex: none;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

.fold__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  color: var(--text);
}

.fold__meta {
  flex: none;
  max-width: 44%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}
</style>
