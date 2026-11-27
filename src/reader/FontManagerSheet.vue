<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Plus, Trash2, X } from 'lucide-vue-next'
import { settings, type FontKey } from '../settings'
import { patchBook } from '../db'
import type { Book } from '../types'
import {
  customFonts,
  fontCssOf,
  formatFontSize,
  importFont,
  FontImportError,
  listFonts,
  removeFont,
  type FontMeta,
} from './fonts'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const props = defineProps<{ book?: Book }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'book-font', key?: string): void }>()

/**
 * 字体管理二级面板：从「阅读排版 → 字体 → 管理字体」进。
 * 选字体 / 应用范围 / 导入 / 删除都收在这里，排版面板只留当前字体和入口，
 * 排版项一多字体区就折成两三行，太挤。
 * 选字体逻辑（含全局 / 仅本书范围）与原排版面板一致。
 */

const bookFont = ref<string | undefined>(props.book?.readerFont)
const scope = ref<'all' | 'book'>(props.book?.readerFont ? 'book' : 'all')

const activeFont = computed<FontKey>(
  () => ((scope.value === 'book' ? (bookFont.value as FontKey | undefined) : undefined) ??
    settings.fontFamily) as FontKey,
)

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

/* ---------------- 导入 ---------------- */

const fontInput = ref<HTMLInputElement | null>(null)
const fontMsg = ref('')
const fontBusy = ref(false)

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
    fontMsg.value = `已导入「${meta.name}」（${formatFontSize(meta.size)}）并选用`
  } catch (err) {
    fontMsg.value =
      err instanceof FontImportError
        ? err.message
        : `这个文件不能当字体用（${
            err instanceof Error ? `${err.name}: ${err.message}` : String(err)
          }）`
  } finally {
    fontBusy.value = false
    window.setTimeout(() => (fontMsg.value = ''), 6000)
  }
}

/* ---------------- 删除 ---------------- */

const deleting = ref<FontMeta | null>(null)

const dropFont = async (): Promise<void> => {
  const f = deleting.value
  deleting.value = null
  if (!f) return
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

const previewText = '永和九年岁在癸丑 Aa Bb 123'
const builtinCss = (key: 'serif' | 'sans'): string => (key === 'serif' ? 'serif' : 'sans-serif')
const customCss = (f: FontMeta): string => fontCssOf(f)

const isBuiltin = (key: 'serif' | 'sans'): boolean => activeFont.value === key
const isCustom = (f: FontMeta): boolean => activeFont.value === `custom:${f.id}`

onMounted(() => {
  void listFonts()
})
</script>

<template>
  <div class="fms">
    <div class="fms__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
      <div class="sheet__handle" />
      <div class="sheet__head">
        <span class="fms__title">字体管理</span>
        <button class="close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <div class="sheet__body">
        <!-- 应用范围：决定选字体写全局还是只写这一本 -->
        <div class="scoperow">
          <span class="scoperow__label">应用到</span>
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
          <span v-if="scope === 'book'" class="scoperow__note">本书单独生效</span>
        </div>

        <!-- 内置字体 -->
        <button class="frow" type="button" :class="{ 'is-active': isBuiltin('serif') }" @click="pickFont('serif')">
          <span class="frow__preview" :style="{ fontFamily: builtinCss('serif') }">{{ previewText }}</span>
          <span class="frow__meta">
            <span class="frow__name">宋体</span>
            <span class="frow__size">内置 · 衬线</span>
          </span>
          <span class="frow__check"><Check v-if="isBuiltin('serif')" :size="15" :stroke-width="2.6" /></span>
        </button>
        <button class="frow" type="button" :class="{ 'is-active': isBuiltin('sans') }" @click="pickFont('sans')">
          <span class="frow__preview" :style="{ fontFamily: builtinCss('sans') }">{{ previewText }}</span>
          <span class="frow__meta">
            <span class="frow__name">黑体</span>
            <span class="frow__size">内置 · 无衬线</span>
          </span>
          <span class="frow__check"><Check v-if="isBuiltin('sans')" :size="15" :stroke-width="2.6" /></span>
        </button>

        <!-- 自定义字体 -->
        <button
          v-for="f in customFonts"
          :key="f.id"
          class="frow"
          type="button"
          :class="{ 'is-active': isCustom(f) }"
          @click="pickFont(`custom:${f.id}`)"
        >
          <span class="frow__preview" :style="{ fontFamily: customCss(f) }">{{ previewText }}</span>
          <span class="frow__meta">
            <span class="frow__name">{{ f.name }}</span>
            <span class="frow__size">{{ formatFontSize(f.size) }} · 导入</span>
          </span>
          <span class="frow__check"><Check v-if="isCustom(f)" :size="15" :stroke-width="2.6" /></span>
          <button
            class="frow__del"
            type="button"
            :aria-label="`删除字体 ${f.name}`"
            @click.stop="deleting = f"
          >
            <Trash2 :size="16" :stroke-width="1.8" />
          </button>
        </button>

        <!-- 导入 -->
        <button class="importbtn" type="button" :disabled="fontBusy" @click="pickFontInput">
          <Plus :size="15" :stroke-width="2.2" />
          导入字体文件
        </button>

        <p v-if="fontMsg" class="fms__msg">{{ fontMsg }}</p>
        <p v-else class="fms__msg fms__msg--hint">
          支持 ttf / otf / ttc / woff / woff2；导入失败会先尝试自动修复；字体只存本机，不上传。
        </p>
      </div>

      <input
        ref="fontInput"
        class="hidden"
        type="file"
        accept=".ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        @change="onFontPicked"
      />
    </div>

    <Transition name="fade">
      <ConfirmDialog
        v-if="deleting"
        :title="`删除字体「${deleting.name}」？`"
        message="字体文件会从本机移除；正在使用它的书籍回到宋体显示。"
        confirm-text="删除字体"
        danger
        @close="deleting = null"
        @confirm="dropFont"
      />
    </Transition>
  </div>
</template>

<style scoped>
.fms {
  position: fixed;
  inset: 0;
  z-index: 70;
}

.fms__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.fms__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--text-2);
}

.scoperow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0 10px;
}

.scoperow__label {
  font-size: 12.5px;
  color: var(--text-2);
}

.scoperow__note {
  font-size: 11px;
  color: var(--text-3);
}

.chip {
  min-height: 36px;
  padding: 7px 12px;
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

.chip:disabled {
  opacity: 0.35;
}

/* 字体行：预览 + 名称，整行可点切换 */
.frow {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  transition: background var(--dur) var(--ease);
}

.frow.is-active {
  background: var(--accent-soft, var(--surface-2));
  border-radius: var(--radius-sm);
  border-bottom-color: transparent;
}

.frow__preview {
  flex: none;
  width: 118px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
}

.frow__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.frow__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frow__size {
  font-size: 11px;
  color: var(--text-3);
}

.frow__check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--accent);
}

.frow__del {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--text-3);
}

.frow__del:active {
  color: var(--accent);
}

.importbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 46px;
  margin-top: 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: transparent;
  outline: 1px dashed var(--line);
  outline-offset: -1px;
}

.importbtn:disabled {
  opacity: 0.5;
}

.fms__msg {
  margin: 10px 0 4px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
}

.fms__msg--hint {
  color: var(--text-3);
}

.hidden {
  display: none;
}
</style>
