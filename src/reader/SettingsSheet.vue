<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Minus, Plus, X } from 'lucide-vue-next'
import { settings, THEME_LABELS, type FontKey, type ThemeKey } from '../settings'
import { patchBook } from '../db'
import type { Book } from '../types'
import { READER_PALETTES } from './theme'
import {
  customFonts,
  fontCssOf,
  formatFontSize,
  importFont,
  listFonts,
  removeFont,
  type FontMeta,
} from './fonts'

const props = defineProps<{ book?: Book }>()
const emit = defineEmits<{ (e: 'book-font', key?: string): void }>()

const themes = Object.keys(THEME_LABELS) as ThemeKey[]
const lineSteps = [1.5, 1.65, 1.75, 1.9, 2.05]
const margins = [12, 20, 28, 36]
/* [shuge] 字重/字距/段距的可选档（readest 对齐项） */
const weightSteps = [
  { value: 300, label: '细' },
  { value: 400, label: '标准' },
  { value: 500, label: '中' },
  { value: 700, label: '粗' },
]
const spacingSteps = [0, 0.02, 0.05, 0.1]
const paraSteps = [0, 0.35, 0.7, 1.05]

const paraLabel = (v: number): string => {
  if (v === 0) return '紧凑'
  if (v === 0.35) return '标准'
  if (v === 0.7) return '宽'
  return '特宽'
}

const fontInput = ref<HTMLInputElement | null>(null)
const fontMsg = ref('')
const fontBusy = ref(false)

/**
 * 字体应用范围（参考 Readest 的 Global Settings 开关 / KOReader 的 per-book 作用域）：
 * - all  = 写全局设置，所有书跟着变
 * - book = 只写当前书的 readerFont，别的书不动
 * 当前书已有单独字体时默认停在 book，打开面板就能看到「这本跟别人不一样」。
 */
const bookFont = ref<string | undefined>(props.book?.readerFont)
const scope = ref<'all' | 'book'>(props.book?.readerFont ? 'book' : 'all')

/** 字体选择器当前高亮的那一项 */
const activeFont = computed<FontKey>(
  () => ((scope.value === 'book' ? (bookFont.value as FontKey | undefined) : undefined) ??
    settings.fontFamily) as FontKey,
)

const fontLabel = (key: string): string => {
  if (key === 'serif') return '宋体'
  if (key === 'sans') return '黑体'
  const id = key.startsWith('custom:') ? key.slice('custom:'.length) : ''
  return customFonts.value.find((f) => f.id === id)?.name ?? '自定义字体'
}

/** 选字体：按当前范围决定写全局还是写这一本 */
const pickFont = async (key: FontKey): Promise<void> => {
  if (scope.value === 'book' && props.book?.id != null) {
    bookFont.value = key
    await patchBook(props.book.id, { readerFont: key })
    emit('book-font', key)
    return
  }
  settings.fontFamily = key
  // 全局模式选了字体，就把这本书的单独覆盖撤掉，否则改了看不到变化
  if (bookFont.value && props.book?.id != null) {
    bookFont.value = undefined
    await patchBook(props.book.id, { readerFont: undefined })
    emit('book-font', undefined)
  }
}

const setScope = async (next: 'all' | 'book'): Promise<void> => {
  if (next === scope.value || props.book?.id == null) return
  scope.value = next
  if (next === 'book') {
    const key = settings.fontFamily
    bookFont.value = key
    await patchBook(props.book.id, { readerFont: key })
    emit('book-font', key)
  } else if (bookFont.value) {
    bookFont.value = undefined
    await patchBook(props.book.id, { readerFont: undefined })
    emit('book-font', undefined)
  }
}

/** 色块只负责展示配色，名字放到下方标签里 —— 文字压在半明半暗的色块上
 *  总要靠描边硬撑，五个色块风格也不统一。 */
const swatchStyle = (key: ThemeKey): Record<string, string> => {
  if (key === 'follow') {
    return { background: 'linear-gradient(180deg, #fbf9f4 0 50%, #16181a 50%)' }
  }
  return { background: READER_PALETTES[key].bg }
}

const step = (delta: number): void => {
  settings.fontSize = Math.min(30, Math.max(14, settings.fontSize + delta))
}

const pickLine = (v: number): void => {
  settings.lineHeight = v
}

const cycleMargin = (): void => {
  const i = margins.findIndex((m) => m >= settings.margin)
  const next = margins[(i + 1) % margins.length]
  settings.margin = next ?? margins[0]
}

const pickFontInput = (): void => fontInput.value?.click()

const onFontPicked = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  fontBusy.value = true
  fontMsg.value = '正在读取字体…'
  try {
    const meta = await importFont(file)
    await pickFont(`custom:${meta.id}`)
    fontMsg.value = `已导入「${meta.name}」（${formatFontSize(meta.size)}）`
  } catch (err) {
    fontMsg.value =
      err instanceof Error && err.message
        ? `这个文件不能当字体用：${err.message}`
        : '这个文件不能当字体用'
  } finally {
    fontBusy.value = false
    window.setTimeout(() => (fontMsg.value = ''), 6000)
  }
}

const dropFont = async (f: FontMeta): Promise<void> => {
  const key = `custom:${f.id}`
  if (settings.fontFamily === key) settings.fontFamily = 'serif'
  if (bookFont.value === key) {
    bookFont.value = 'serif'
    if (props.book?.id != null) await patchBook(props.book.id, { readerFont: 'serif' })
    emit('book-font', 'serif')
  }
  await removeFont(f.id)
  fontMsg.value = `已删除「${f.name}」`
  window.setTimeout(() => (fontMsg.value = ''), 3000)
}

onMounted(() => {
  void listFonts()
})
</script>

<template>
  <div class="sheet">
    <div class="sheet__handle" />
    <div class="sheet__head">阅读排版</div>
    <div class="sheet__body">
      <div class="row">
        <span class="row__label">主题</span>
        <div class="row__value themes">
          <button
            v-for="key in themes"
            :key="key"
            type="button"
            class="swatch"
            :class="{ 'is-active': settings.theme === key }"
            @click="settings.theme = key"
          >
            <span class="swatch__chip" :style="swatchStyle(key)" />
            <span class="swatch__name">{{ THEME_LABELS[key] }}</span>
          </button>
        </div>
      </div>

      <div class="divider" />

      <div class="row">
        <span class="row__label">字号</span>
        <div class="row__value">
          <button class="stepper" type="button" :disabled="settings.fontSize <= 14" @click="step(-1)">
            <Minus :size="16" :stroke-width="1.8" />
          </button>
          <span class="value">{{ settings.fontSize }}</span>
          <button class="stepper" type="button" :disabled="settings.fontSize >= 30" @click="step(1)">
            <Plus :size="16" :stroke-width="1.8" />
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">行距</span>
        <div class="row__value">
          <button
            v-for="v in lineSteps"
            :key="v"
            type="button"
            class="chip"
            :class="{ 'is-active': Math.abs(settings.lineHeight - v) < 0.02 }"
            @click="pickLine(v)"
          >
            {{ v.toFixed(2) }}
          </button>
        </div>
      </div>

      <!-- [shuge] 字重/字距/段距：readest 排版面板的对齐项 -->
      <div class="row">
        <span class="row__label">字重</span>
        <div class="row__value">
          <button
            v-for="w in weightSteps"
            :key="w.value"
            type="button"
            class="chip"
            :class="{ 'is-active': settings.fontWeight === w.value }"
            @click="settings.fontWeight = w.value"
          >
            {{ w.label }}
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">字距</span>
        <div class="row__value">
          <button
            v-for="v in spacingSteps"
            :key="v"
            type="button"
            class="chip"
            :class="{ 'is-active': Math.abs(settings.letterSpacing - v) < 0.005 }"
            @click="settings.letterSpacing = v"
          >
            {{ v === 0 ? '默认' : `${v}em` }}
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">段距</span>
        <div class="row__value">
          <button
            v-for="v in paraSteps"
            :key="v"
            type="button"
            class="chip"
            :class="{ 'is-active': Math.abs(settings.paragraphMargin - v) < 0.02 }"
            @click="settings.paragraphMargin = v"
          >
            {{ paraLabel(v) }}
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">边距</span>
        <div class="row__value">
          <button class="chip" type="button" @click="cycleMargin">
            {{ settings.margin }} px
          </button>
        </div>
      </div>

      <div class="row row--top">
        <span class="row__label">字体</span>
        <div class="row__value fonts">
          <button
            class="chip"
            :class="{ 'is-active': activeFont === 'serif' }"
            type="button"
            @click="pickFont('serif')"
          >
            宋体
          </button>
          <button
            class="chip"
            :class="{ 'is-active': activeFont === 'sans' }"
            type="button"
            @click="pickFont('sans')"
          >
            黑体
          </button>
          <span
            v-for="f in customFonts"
            :key="f.id"
            class="fontchip"
            :class="{ 'is-active': activeFont === `custom:${f.id}` }"
          >
            <button
              class="fontchip__pick"
              type="button"
              :style="{ fontFamily: fontCssOf(f) }"
              :title="`${f.name} · ${formatFontSize(f.size)}`"
              @click="pickFont(`custom:${f.id}`)"
            >
              {{ f.name }}
            </button>
            <button
              class="fontchip__del"
              type="button"
              :aria-label="`删除字体 ${f.name}`"
              @click="dropFont(f)"
            >
              <X :size="12" :stroke-width="2.4" />
            </button>
          </span>
          <button class="chip chip--ghost" type="button" :disabled="fontBusy" @click="pickFontInput">
            <Plus :size="13" :stroke-width="2.2" />
            导入字体
          </button>
        </div>
      </div>

      <!-- 应用范围：决定上面选的字体写全局还是只写这一本 -->
      <div class="row">
        <span class="row__label">应用范围</span>
        <div class="row__value">
          <button
            class="chip"
            :class="{ 'is-active': scope === 'all' }"
            type="button"
            @click="setScope('all')"
          >
            所有书籍
          </button>
          <button
            class="chip"
            :class="{ 'is-active': scope === 'book' }"
            type="button"
            :disabled="!book"
            @click="setScope('book')"
          >
            仅本书
          </button>
        </div>
      </div>
      <p v-if="scope === 'book'" class="fontmsg">
        本书单独用「{{ fontLabel(activeFont) }}」，其它书仍按全局设置。
      </p>

      <p v-if="fontMsg" class="fontmsg">{{ fontMsg }}</p>
      <p v-else class="fontmsg fontmsg--hint">
        支持 ttf / otf / woff / woff2，字体存在本机，随书库一起，不上传。
      </p>

      <input
        ref="fontInput"
        class="hidden"
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        @change="onFontPicked"
      />

      <div class="divider" />

      <div class="row">
        <span class="row__label">两端对齐</span>
        <div class="row__value">
          <button
            class="switch"
            :class="{ 'is-on': settings.justify }"
            type="button"
            role="switch"
            :aria-checked="settings.justify"
            @click="settings.justify = !settings.justify"
          >
            <i />
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">首行缩进</span>
        <div class="row__value">
          <button
            class="switch"
            :class="{ 'is-on': settings.indent }"
            type="button"
            role="switch"
            :aria-checked="settings.indent"
            @click="settings.indent = !settings.indent"
          >
            <i />
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">翻页</span>
        <div class="row__value">
          <button
            class="chip"
            :class="{ 'is-active': settings.flow === 'paginated' }"
            type="button"
            @click="settings.flow = 'paginated'"
          >
            左右翻页
          </button>
          <button
            class="chip"
            :class="{ 'is-active': settings.flow === 'scrolled' }"
            type="button"
            @click="settings.flow = 'scrolled'"
          >
            上下滚动
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.themes {
  gap: 8px;
}

.swatch {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 0;
  background: none;
}

.swatch__chip {
  display: block;
  width: 46px;
  height: 32px;
  border-radius: var(--radius);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow var(--dur) var(--ease), transform 140ms var(--ease);
}

.swatch__name {
  font-size: 11px;
  line-height: 1;
  color: var(--text-2);
  transition: color var(--dur) var(--ease);
}

.swatch.is-active .swatch__chip {
  box-shadow:
    inset 0 0 0 1px var(--line),
    0 0 0 2px var(--surface),
    0 0 0 4px var(--accent);
}

.swatch.is-active .swatch__name {
  color: var(--accent);
  font-weight: 600;
}

.swatch:active .swatch__chip {
  transform: scale(0.94);
}

.stepper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
}

.stepper:disabled {
  opacity: 0.35;
}

.value {
  min-width: 30px;
  text-align: center;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.chip {
  /* 触屏最小点击高度 36：原来 31 偏窄，选行距容易点空 */
  min-height: 40px;
  padding: 9px 11px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text-2);
  background: var(--surface-2);
  transition: all var(--dur) var(--ease);
}

.chip.is-active {
  color: var(--on-accent);
  background: var(--accent);
}

.chip--ghost {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--accent);
  background: transparent;
  outline: 1px dashed var(--line);
  outline-offset: -1px;
}

.chip--ghost:disabled {
  opacity: 0.5;
}

/* 字体行：chip 会换行折成两排，标签要和第一排对齐 */
.row--top {
  align-items: flex-start;
}

.row--top .row__label {
  padding-top: 11px;
}

.fonts {
  justify-content: flex-start;
  gap: 8px;
}

.fontchip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border-radius: 999px;
  background: var(--surface-2);
  outline: 1px solid transparent;
  outline-offset: -1px;
  overflow: hidden;
}

.fontchip.is-active {
  background: var(--accent);
  outline-color: var(--accent);
}

.fontchip__pick {
  min-height: 40px;
  max-width: 132px;
  padding: 9px 4px 9px 12px;
  font-size: 12.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fontchip.is-active .fontchip__pick {
  color: var(--on-accent);
}

.fontchip__del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 删除键也要满足 40px 触摸区，26 宽在手机上很容易点到旁边的字体 */
  width: 40px;
  height: 40px;
  color: var(--text-3);
}

.fontchip.is-active .fontchip__del {
  color: rgba(255, 255, 255, 0.82);
}

.fontmsg {
  margin: 2px 0 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
}

.fontmsg--hint {
  color: var(--text-3);
}

.hidden {
  display: none;
}

.switch {
  position: relative;
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: var(--surface-2);
  outline: 1px solid var(--line);
  outline-offset: -1px;
  transition: background-color var(--dur) var(--ease);
}

.switch::before {
  /* 开关视觉只有 26 高，用透明热区补到 44，避免点不中 */
  content: '';
  position: absolute;
  inset: -9px -6px;
}

.switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 200ms var(--ease);
}

.switch.is-on {
  background: var(--accent);
  outline-color: transparent;
}

.switch.is-on i {
  transform: translateX(18px);
}
</style>
