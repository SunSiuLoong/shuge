<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Tag as TagIcon, Trash2, X } from 'lucide-vue-next'
import { books, shelfTab, shelfTabs, setShelfTab } from './store'
import { removeTagFrom, renameTagEverywhere } from './tagOps'
import PromptDialog from '../ui/PromptDialog.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'

const emit = defineEmits<{ (e: 'close'): void; (e: 'toast', msg: string): void }>()

/**
 * 标签页名称管理：标签多了以后在标签条里一个个长按改名太费劲，
 * 这里一屏列全，改名 / 删除集中处理。
 * 「全部」「未分类」是虚拟页（背后没有真实标签），不进这个列表。
 */
const manageTabs = computed(() =>
  shelfTabs.value.filter((t) => t.key !== '__all__' && t.key !== '__untagged__'),
)

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
  if (!from) return
  const { changed, conflict } = await renameTagEverywhere(from, to)
  emit(
    'toast',
    changed
      ? `「${from}」已改成「${to}」，${changed} 本同步${conflict ? `（${conflict} 本合并）` : ''}`
      : `没有书用到「${from}」`,
  )
}

const doDelete = async (): Promise<void> => {
  const tag = deleting.value
  deleting.value = null
  if (!tag) return
  const changed = await removeTagFrom(books.value, tag)
  if (shelfTab.value === tag) setShelfTab('__all__')
  emit('toast', changed ? `已从 ${changed} 本书中移除「${tag}」` : `没有书用到「${tag}」`)
}
</script>

<template>
  <div class="tmgr">
    <div class="tmgr__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
      <div class="sheet__handle" />
      <div class="sheet__head">
        <span class="tmgr__title">管理标签页</span>
        <button class="close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <div class="sheet__body">
        <p v-if="!manageTabs.length" class="tmgr__empty">
          还没有标签页。给书加上标签（书籍长按 → 标签与评分）就会出现在这里。
        </p>

        <div v-for="t in manageTabs" :key="t.key" class="row">
          <span class="row__icon"><TagIcon :size="15" :stroke-width="1.8" /></span>
          <span class="row__name">{{ t.label }}</span>
          <span class="row__count">{{ t.count }} 本</span>
          <button
            class="row__btn"
            type="button"
            :aria-label="`重命名「${t.label}」`"
            @click="renaming = t.key"
          >
            <Pencil :size="16" :stroke-width="1.8" />
          </button>
          <button
            class="row__btn row__btn--danger"
            type="button"
            :aria-label="`删除标签「${t.label}」`"
            @click="deleting = t.key"
          >
            <Trash2 :size="16" :stroke-width="1.8" />
          </button>
        </div>

        <p class="tmgr__note">
          重命名会同步改到每本书身上的这个标签；删除标签只把标签从书上摘掉，书不受影响。
        </p>
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
  gap: 10px;
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

.sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 16px calc(20px + var(--safe-bottom));
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
  gap: 10px;
  min-height: 48px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
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
</style>
