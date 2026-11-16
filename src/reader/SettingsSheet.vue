<script setup lang="ts">
import { Minus, Plus } from 'lucide-vue-next'
import { settings, THEME_LABELS, type ThemeKey } from '../settings'
import { READER_PALETTES } from './theme'

const themes = Object.keys(THEME_LABELS) as ThemeKey[]
const lineSteps = [1.5, 1.65, 1.75, 1.9, 2.05]
const margins = [12, 20, 28, 36]

/** auto 档没有单一色板，用纸白/夜读对半拼色 */
/** 色块只负责展示配色，名字放到下方标签里 —— 文字压在半明半暗的色块上
 *  总要靠描边硬撑，五个色块风格也不统一。 */
const swatchStyle = (key: ThemeKey): Record<string, string> => {
  if (key === 'auto') {
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

      <div class="row">
        <span class="row__label">边距</span>
        <div class="row__value">
          <button class="chip" type="button" @click="cycleMargin">
            {{ settings.margin }} px
          </button>
        </div>
      </div>

      <div class="row">
        <span class="row__label">字体</span>
        <div class="row__value">
          <button
            class="chip"
            :class="{ 'is-active': settings.fontFamily === 'serif' }"
            type="button"
            @click="settings.fontFamily = 'serif'"
          >
            宋体
          </button>
          <button
            class="chip"
            :class="{ 'is-active': settings.fontFamily === 'sans' }"
            type="button"
            @click="settings.fontFamily = 'sans'"
          >
            黑体
          </button>
        </div>
      </div>

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
  color: #fff;
  background: var(--accent);
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
