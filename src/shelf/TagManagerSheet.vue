<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Check, GripVertical, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-vue-next'
import { books, shelfTab, shelfTabs, setShelfTab, setTagOrder } from './store'
import { removeTagsFrom, renameTagEverywhere } from './tagOps'
import { indexAt, moveItem, shiftFor } from './tagOrder'
import PromptDialog from '../ui/PromptDialog.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import { logEvent, logError } from '../log'

const emit = defineEmits<{ (e: 'close'): void; (e: 'toast', msg: string): void }>()

/**
 * 标签页名称管理：改名 / 删除 / 拖拽排序 / 长按多选批量删除。
 * 「全部」「未分类」是虚拟页（背后没有真实标签），不进这个列表。
 */
const manageTabs = computed(() =>
  shelfTabs.value.filter((t) => t.key !== '__all__' && t.key !== '__untagged__'),
)

const busy = ref(false)
const renaming = ref<string | null>(null)
const deleting = ref<string | null>(null)

const deleteCount = computed(() => {
  const tag = deleting.value
  if (!tag) return 0
  return books.value.filter((b) => (b.tags ?? []).includes(tag)).length
})

const submitRename = async (to: string): Promise<void> => {
  const from = renaming.value
  renaming.value = null
  if (!from || busy.value) return
  busy.value = true
  try {
    const { changed, conflict } = await renameTagEverywhere(from, to)
    emit(
      'toast',
      changed
        ? `「${from}」已改成「${to}」，${changed} 本同步${conflict ? `（${conflict} 本合并）` : ''}`
        : `没有书用到「${from}」`,
    )
  } catch {
    emit('toast', '改名失败，详情已记到运行日志')
  } finally {
    busy.value = false
  }
}

/* ---------------- 多选 ---------------- */

const selectMode = ref(false)
const selectedKeys = ref<string[]>([])

const isSelected = (key: string): boolean => selectedKeys.value.includes(key)

const enterSelect = (key: string): void => {
  selectMode.value = true
  selectedKeys.value = isSelected(key) ? [...selectedKeys.value] : [...selectedKeys.value, key]
}

const exitSelect = (): void => {
  selectMode.value = false
  selectedKeys.value = []
}

const toggleSelect = (key: string): void => {
  if (isSelected(key)) {
    const next = selectedKeys.value.filter((k) => k !== key)
    selectedKeys.value = next
    if (!next.length) selectMode.value = false
  } else {
    selectedKeys.value = [...selectedKeys.value, key]
  }
}

const allSelected = computed(
  () => manageTabs.value.length > 0 && selectedKeys.value.length === manageTabs.value.length,
)

const toggleAll = (): void => {
  if (allSelected.value) {
    selectedKeys.value = []
    return
  }
  selectedKeys.value = manageTabs.value.map((t) => t.key)
}

/** 选中标签波及的书本数（去重：一本书上两个选中的标签只算一本） */
const batchBooks = computed(() => {
  const drop = new Set(selectedKeys.value)
  return books.value.filter((b) => (b.tags ?? []).some((t) => drop.has(t))).length
})

const askBatch = ref(false)

const doBatchDelete = async (): Promise<void> => {
  const tags = [...selectedKeys.value]
  askBatch.value = false
  if (!tags.length || busy.value) return
  busy.value = true
  try {
    logEvent('tag', `批量删除标签页 ${tags.length} 个：${tags.join('/')}`)
    // 先退回「全部」再删：否则删的过程中当前页会先空掉，看着像书没了
    if (tags.includes(shelfTab.value)) setShelfTab('__all__')
    const changed = await removeTagsFrom(books.value, tags)
    emit('toast', `已删除 ${tags.length} 个标签页，${changed} 本书上的标签已摘掉`)
    exitSelect()
  } catch (e) {
    logError('tag', `批量删标签失败：${e instanceof Error ? e.message : String(e)}`)
    emit('toast', '删除失败，详情已记到运行日志')
  } finally {
    busy.value = false
  }
}

const doDelete = async (): Promise<void> => {
  const tag = deleting.value
  deleting.value = null
  if (!tag || busy.value) return
  busy.value = true
  try {
    if (shelfTab.value === tag) setShelfTab('__all__')
    const changed = await removeTagsFrom(books.value, [tag])
    emit('toast', changed ? `已从 ${changed} 本书中移除「${tag}」` : `没有书用到「${tag}」`)
  } catch (e) {
    logError('tag', `删标签失败：${e instanceof Error ? e.message : String(e)}`)
    emit('toast', '删除失败，详情已记到运行日志')
  } finally {
    busy.value = false
  }
}

/* ---------------- 拖拽排序 ---------------- */

/**
 * 用「按住左侧把手拖动」而不是整行拖：整行既要长按多选、又要纵向滚动，
 * 三种手势叠在一起必然互相打架。把手单独 touch-action: none，判定干净。
 *
 * 行高统一（min-height + 固定内边距），所以位移换算成索引只要 round(dy/行高)，
 * 不做 FLIP，够用且不会抖。松手才落盘，拖动过程中只做视觉位移。
 */
const dragKey = ref<string | null>(null)
const dragFrom = ref(-1)
const dragTo = ref(-1)
const dragDy = ref(0)
const rowH = ref(52)
const listEl = ref<HTMLElement | null>(null)
let grabY = 0

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const onDragMove = (e: PointerEvent): void => {
  if (dragKey.value == null) return
  const n = manageTabs.value.length
  if (!n) return
  const from = dragFrom.value
  // 位移夹在首尾之间：拖出列表也不会飞天
  const dy = clamp(e.clientY - grabY, -from * rowH.value, (n - 1 - from) * rowH.value)
  dragDy.value = dy
  dragTo.value = indexAt(from, dy, rowH.value, n)
  // 拖到边缘时让列表自己滚，方便挪到屏幕外的位置
  const box = listEl.value
  if (box) {
    const r = box.getBoundingClientRect()
    if (e.clientY < r.top + 28) box.scrollTop -= 8
    else if (e.clientY > r.bottom - 28) box.scrollTop += 8
  }
}

const endDrag = (commitIt: boolean): void => {
  const key = dragKey.value
  const from = dragFrom.value
  const to = dragTo.value
  dragKey.value = null
  dragFrom.value = -1
  dragTo.value = -1
  dragDy.value = 0
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
  if (!commitIt || !key || from < 0 || to < 0 || from === to) return
  const keys = moveItem(
    manageTabs.value.map((t) => t.key),
    from,
    to,
  )
  setTagOrder(keys)
  navigator.vibrate?.(6)
  logEvent('tag', `标签顺序调整：「${key}」${from} → ${to}`)
  emit('toast', '标签顺序已保存')
}

const onUp = (): void => endDrag(true)
const onCancel = (): void => endDrag(false)

const onGripDown = (key: string, index: number, e: PointerEvent): void => {
  if (selectMode.value || busy.value) return
  e.preventDefault()
  const row = (e.currentTarget as HTMLElement).closest('.row') as HTMLElement | null
  rowH.value = row?.offsetHeight || 52
  dragKey.value = key
  dragFrom.value = index
  dragTo.value = index
  dragDy.value = 0
  grabY = e.clientY
  navigator.vibrate?.(8)
  window.addEventListener('pointermove', onDragMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
}

/** 被让位的那几行整体上/下挪一格；被拖的那行自己跟手 */
const rowStyle = (key: string): Record<string, string> => {
  if (dragKey.value === key) {
    return { transform: `translateY(${dragDy.value}px)`, zIndex: '3' }
  }
  if (dragKey.value == null) return {}
  const i = manageTabs.value.findIndex((t) => t.key === key)
  const dy = shiftFor(dragFrom.value, dragTo.value, i, rowH.value)
  return dy ? { transform: `translateY(${dy}px)` } : {}
}

/* ---------------- 长按多选 ---------------- */

let pressTimer = 0
let pressKey: string | null = null
let pressAt = { x: 0, y: 0 }
/** 长按进多选后，紧跟的这次 click 要吞掉，否则会立刻把刚选中的取消 */
let swallowClick = false

const onRowDown = (key: string, e: PointerEvent): void => {
  if (selectMode.value || dragKey.value || busy.value) return
  if ((e.target as HTMLElement).closest('.row__btn, .grip')) return
  pressKey = key
  pressAt = { x: e.clientX, y: e.clientY }
  clearTimeout(pressTimer)
  pressTimer = window.setTimeout(() => {
    pressKey = null
    swallowClick = true
    navigator.vibrate?.(12)
    enterSelect(key)
    logEvent('tag', `进入多选：${key}`)
    window.setTimeout(() => (swallowClick = false), 500)
  }, 460)
}

const onRowMove = (e: PointerEvent): void => {
  if (!pressKey) return
  if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) {
    clearTimeout(pressTimer)
    pressKey = null
  }
}

const onRowUp = (): void => {
  clearTimeout(pressTimer)
  pressKey = null
}

const onRowClick = (key: string): void => {
  if (swallowClick) return
  if (selectMode.value) toggleSelect(key)
}

onBeforeUnmount(() => {
  clearTimeout(pressTimer)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
})
</script>

<template>
  <div class="tmgr">
    <div class="tmgr__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
      <div class="sheet__handle" />
      <div class="sheet__head">
        <template v-if="selectMode">
          <span class="tmgr__title">已选 {{ selectedKeys.length }} 个标签页</span>
          <button class="headbtn" type="button" @click="toggleAll">
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <button class="headbtn" type="button" @click="exitSelect">取消</button>
        </template>
        <template v-else>
          <span class="tmgr__title">管理标签页</span>
          <button class="close" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </template>
      </div>

      <div ref="listEl" class="sheet__body">
        <p v-if="!manageTabs.length" class="tmgr__empty">
          还没有标签页。给书加上标签（书籍长按 → 标签与评分）就会出现在这里。
        </p>

        <div
          v-for="(t, i) in manageTabs"
          :key="t.key"
          class="row"
          :class="{ 'is-dragging': dragKey === t.key, 'is-selected': isSelected(t.key) }"
          :style="rowStyle(t.key)"
          @pointerdown="onRowDown(t.key, $event)"
          @pointermove="onRowMove"
          @pointerup="onRowUp"
          @pointercancel="onRowUp"
          @pointerleave="onRowUp"
          @contextmenu.prevent
          @click="onRowClick(t.key)"
        >
          <span
            v-if="!selectMode"
            class="grip"
            role="button"
            :aria-label="`拖动排序「${t.label}」`"
            @pointerdown.stop="onGripDown(t.key, i, $event)"
            @click.stop
          >
            <GripVertical :size="16" :stroke-width="1.8" />
          </span>
          <span v-else class="check" :class="{ 'is-on': isSelected(t.key) }">
            <Check v-if="isSelected(t.key)" :size="13" :stroke-width="3" />
          </span>

          <span class="row__icon"><TagIcon :size="15" :stroke-width="1.8" /></span>
          <span class="row__name">{{ t.label }}</span>
          <span class="row__count">{{ t.count }} 本</span>

          <template v-if="!selectMode">
            <button
              class="row__btn"
              type="button"
              :aria-label="`重命名「${t.label}」`"
              @pointerdown.stop
              @click.stop="renaming = t.key"
            >
              <Pencil :size="16" :stroke-width="1.8" />
            </button>
            <button
              class="row__btn row__btn--danger"
              type="button"
              :aria-label="`删除标签「${t.label}」`"
              @pointerdown.stop
              @click.stop="deleting = t.key"
            >
              <Trash2 :size="16" :stroke-width="1.8" />
            </button>
          </template>
        </div>

        <p v-if="!selectMode && manageTabs.length" class="tmgr__note">
          按住左侧把手上下拖可调整标签页顺序；长按某一项进入多选，可批量删除。
          重命名会同步改到每本书身上的这个标签；删除只把标签从书上摘掉，书不受影响。
        </p>
      </div>

      <div v-if="selectMode" class="batchbar">
        <button
          class="batchbtn batchbtn--danger"
          type="button"
          :disabled="!selectedKeys.length || busy"
          @click="askBatch = true"
        >
          <Trash2 :size="15" :stroke-width="1.8" />
          删除 {{ selectedKeys.length }} 个标签页
        </button>
      </div>
    </div>

    <Transition name="fade">
      <PromptDialog
        v-if="renaming"
        :title="`重命名标签「${renaming}」`"
        label="新名字"
        :value="renaming"
        :maxlength="12"
        note="标签页上所有书籍的这个标签会一起改名（全库同步）。"
        @close="renaming = null"
        @submit="submitRename"
      />
    </Transition>

    <Transition name="fade">
      <ConfirmDialog
        v-if="deleting"
        :title="`删除标签「${deleting}」？`"
        :message="`${deleteCount} 本书身上的「${deleting}」会被摘掉，标签页随之消失，书本身不受影响。`"
        confirm-text="删除标签"
        danger
        @close="deleting = null"
        @confirm="doDelete"
      />
    </Transition>

    <Transition name="fade">
      <ConfirmDialog
        v-if="askBatch"
        :title="`删除这 ${selectedKeys.length} 个标签页？`"
        :message="`这些标签会从 ${batchBooks} 本书上摘掉，标签页随之消失，书本身不受影响。`"
        confirm-text="删除标签页"
        danger
        @close="askBatch = false"
        @confirm="doBatchDelete"
      />
    </Transition>
  </div>
</template>

<style scoped>
.tmgr {
  position: fixed;
  inset: 0;
  z-index: 60;
}

.tmgr__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--surface);
  box-shadow: 0 -12px 40px -18px rgba(0, 0, 0, 0.4);
}

.sheet__handle {
  flex: none;
  width: 36px;
  height: 4px;
  margin: 10px auto 2px;
  border-radius: 2px;
  background: var(--line);
}

.sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 6px;
}

.tmgr__title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
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

.headbtn {
  flex: none;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--surface-2);
}

.sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 16px calc(20px + var(--safe-bottom));
  /* 行位移靠 transform，不用 layout，拖动才不抖 */
  position: relative;
}

.tmgr__empty {
  margin: 24px 0 8px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--text-3);
  text-align: center;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  transition: transform 150ms var(--ease), background 150ms var(--ease);
  touch-action: pan-y;
  /* 长按是多选手势，不能被系统的文字选择/长按菜单截走 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.row.is-dragging {
  transition: none;
  border-radius: var(--radius, 8px);
  box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.35);
}

.row.is-selected {
  background: var(--accent-soft, var(--surface-2));
}

.grip {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 34px;
  margin-left: -6px;
  color: var(--text-3);
  border-radius: 6px;
  /* 把手独占手势：不参与滚动，拖它才不会被浏览器当成滚页 */
  touch-action: none;
}

.check {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  margin-left: -2px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  color: var(--on-accent);
}

.check.is-on {
  border-color: var(--accent);
  background: var(--accent);
}

.row__icon {
  flex: none;
  display: flex;
  color: var(--text-3);
}

.row__name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.row__count {
  flex: none;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.row__btn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--text-2);
}

.row__btn:active {
  background: var(--line);
}

.row__btn--danger {
  color: var(--accent);
}

.tmgr__note {
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-3);
}

.batchbar {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 16px calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--line);
  background: var(--surface);
}

.batchbtn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
}

.batchbtn:disabled {
  opacity: 0.5;
}
</style>
