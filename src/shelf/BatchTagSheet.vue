<script setup lang="ts">
import { computed, ref } from 'vue'
import { Pencil, Plus, X } from 'lucide-vue-next'
import type { Book } from '../types'
import { allTags } from './store'
import {
  MAX_TAGS,
  addTagTo,
  removeTagFrom,
  renameTagIn,
  tagsOf,
} from './tagOps'
import PromptDialog from '../ui/PromptDialog.vue'

/**
 * 批量标签：对选中的一批书做「加 / 删 / 改名」。
 * 三个动作都直接落库（这批书可能几十本，加个「保存」只会让人忘记点），
 * 每步给一行结果提示，面板不关，方便连着改几条。
 */
const props = defineProps<{ books: Book[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'done', message: string): void }>()

const draft = ref('')
const hint = ref('')
const busy = ref(false)

/** 改名弹窗：from 为待改的标签 */
const renaming = ref<string | null>(null)

const count = computed(() => props.books.length)
const present = computed(() => tagsOf(props.books))

/** 建议标签：库里出现过、但还没加到每本书上的 */
const suggestions = computed(() => {
  const all = new Set(props.books.flatMap((b) => b.tags ?? []))
  return allTags.value.map((t) => t.name).filter((n) => !all.has(n)).slice(0, 24)
})

const say = (msg: string): void => {
  hint.value = msg
  emit('done', msg)
}

const add = async (raw?: string): Promise<void> => {
  const name = (raw ?? draft.value).trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const { changed, skipped } = await addTagTo(props.books, name)
    draft.value = ''
    if (!changed) {
      say(skipped ? `选中书籍都满 ${MAX_TAGS} 个标签了` : `选中书籍都已有「${name}」`)
    } else {
      say(`已给 ${changed} 本加上「${name}」${skipped ? `，${skipped} 本标签已满` : ''}`)
    }
  } finally {
    busy.value = false
  }
}

const drop = async (name: string): Promise<void> => {
  if (busy.value) return
  busy.value = true
  try {
    const n = await removeTagFrom(props.books, name)
    say(n ? `已从 ${n} 本移除「${name}」` : `选中书籍没有「${name}」`)
  } finally {
    busy.value = false
  }
}

const submitRename = async (to: string): Promise<void> => {
  const from = renaming.value
  renaming.value = null
  if (!from || busy.value) return
  busy.value = true
  try {
    const { changed, conflict } = await renameTagIn(props.books, from, to)
    say(
      changed
        ? `已把 ${changed} 本的「${from}」改成「${to}」${conflict ? `，${conflict} 本原本就有「${to}」已合并` : ''}`
        : `选中书籍里没有「${from}」`,
    )
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="batch">
    <div class="batch__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
      <div class="sheet__handle" />
      <div class="sheet__head">
        <span class="batch__title">批量标签</span>
        <span class="batch__count">已选 {{ count }} 本</span>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <div class="sheet__body">
        <p class="sec">添加标签</p>
        <div class="adder">
          <input
            v-model="draft"
            class="adder__input"
            type="text"
            maxlength="12"
            placeholder="输入标签名，回车加到选中的书"
            @keydown.enter.prevent="add()"
          />
          <button class="adder__btn" type="button" :disabled="busy" @click="add()">
            <Plus :size="17" :stroke-width="2.2" />
          </button>
        </div>
        <div v-if="suggestions.length" class="chips">
          <button
            v-for="t in suggestions"
            :key="t"
            class="chip chip--dash"
            type="button"
            @click="add(t)"
          >+ {{ t }}</button>
        </div>

        <p class="sec">移除标签</p>
        <div v-if="present.length" class="chips">
          <button
            v-for="t in present"
            :key="t.name"
            class="chip"
            type="button"
            @click="drop(t.name)"
          >
            {{ t.name }}
            <span class="chip__n">{{ t.count }}</span>
            <X :size="12" :stroke-width="2.4" class="chip__x" />
          </button>
        </div>
        <p v-else class="sec__empty">选中的书还没有标签</p>

        <p class="sec">改成别的名字</p>
        <div v-if="present.length" class="chips">
          <button
            v-for="t in present"
            :key="`r-${t.name}`"
            class="chip chip--quiet"
            type="button"
            @click="renaming = t.name"
          >
            <Pencil :size="12" :stroke-width="2" />
            {{ t.name }}
          </button>
        </div>
        <p v-else class="sec__empty">先添加一条标签，再改它的名字</p>

        <p v-if="hint" class="hint">{{ hint }}</p>
        <p class="foot">
          改动只作用于选中的 {{ count }} 本书，其它书不受影响。一本书最多 {{ MAX_TAGS }} 个标签。
        </p>

        <button class="done" type="button" @click="emit('close')">完成</button>
      </div>
    </div>

    <PromptDialog
      v-if="renaming"
      :title="`重命名标签「${renaming}」`"
      label="新名字"
      :value="renaming"
      :maxlength="12"
      :note="`选中的 ${count} 本书里的这个标签会一起改名。`"
      @close="renaming = null"
      @submit="submitRename"
    />
  </div>
</template>

<style scoped>
.batch {
  position: fixed;
  inset: 0;
  z-index: 76;
  display: flex;
  align-items: flex-end;
}

.batch__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.batch .sheet {
  position: relative;
  max-height: 86vh;
}

.batch__title {
  flex: none;
  font-size: 15px;
  font-weight: 600;
}

.batch__count {
  flex: 1;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-3);
}

.sec {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 18px 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-2);
}

.sec:first-child {
  margin-top: 2px;
}

.sec__empty {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-3);
}

.adder {
  display: flex;
  align-items: center;
  gap: 8px;
}

.adder__input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border-radius: var(--radius);
  font-size: 13.5px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
}

.adder__input:focus {
  border-color: var(--accent);
  outline: none;
}

.adder__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius);
  color: var(--on-accent);
  background: var(--accent);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 38px;
  padding: 0 10px 0 12px;
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
}

.chip:active {
  transform: scale(0.97);
}

.chip--dash {
  padding: 0 12px;
  color: var(--text-2);
  background: transparent;
  border: 1px dashed var(--line);
}

.chip--quiet {
  padding: 0 12px;
  color: var(--text-2);
}

.chip__n {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.chip__x {
  margin-left: 1px;
  color: var(--text-3);
}

.hint {
  margin: 16px 0 0;
  padding: 9px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  background: var(--accent-soft);
}

.foot {
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}

.done {
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
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
