<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { Book } from '../types'
import { patchBook } from '../db'

/** 长按「修改书名和作者」。只改库里这两栏，不动 EPUB 文件本身。 */
const props = defineProps<{ book: Book }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', book: Book): void }>()

const title = ref(props.book.title)
const author = ref(props.book.author)
const busy = ref(false)
const error = ref('')

const titleOk = computed(() => title.value.trim().length > 0)
const changed = computed(
  () => title.value.trim() !== props.book.title || author.value.trim() !== props.book.author,
)

const save = async (): Promise<void> => {
  if (!titleOk.value || busy.value || props.book.id == null) return
  if (!changed.value) {
    emit('close')
    return
  }
  busy.value = true
  error.value = ''
  const nextTitle = title.value.trim()
  const nextAuthor = author.value.trim() || '佚名'
  try {
    await patchBook(props.book.id, { title: nextTitle, author: nextAuthor })
    emit('saved', { ...props.book, title: nextTitle, author: nextAuthor })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="edit">
    <div class="edit__scrim" @click="emit('close')" />
    <div class="sheet edit__sheet">
      <div class="sheet__handle" />
      <div class="sheet__head">
        <span class="edit__head">修改书目信息</span>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>
      <div class="sheet__body">
        <label class="field">
          <span class="field__label">书名</span>
          <input
            v-model="title"
            class="field__input"
            type="text"
            maxlength="80"
            placeholder="书名"
            @keydown.enter.prevent="save"
          />
        </label>
        <label class="field">
          <span class="field__label">作者</span>
          <input
            v-model="author"
            class="field__input"
            type="text"
            maxlength="40"
            placeholder="留空显示「佚名」"
            @keydown.enter.prevent="save"
          />
        </label>
        <p v-if="error" class="field__error">{{ error }}</p>
        <p class="edit__note">
          只改书库里的显示信息，EPUB 文件原样不动。标签、评分、进度都不受影响。
        </p>
        <button class="save" type="button" :disabled="!titleOk || busy" @click="save">
          {{ busy ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 单根节点：多根套 <Transition> 动画会失效 */
.edit {
  position: fixed;
  inset: 0;
  z-index: 75;
  display: flex;
  align-items: flex-end;
}

.edit__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.edit__sheet {
  position: relative;
}

.edit__head {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.field {
  display: block;
  margin-top: 12px;
}

.field__label {
  display: block;
  margin: 0 0 6px;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

.field__input {
  width: 100%;
  height: 46px;
  padding: 0 12px;
  border-radius: var(--radius);
  font-size: 14.5px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
}

.field__input:focus {
  border-color: var(--accent);
  outline: none;
}

.field__error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--accent);
}

.edit__note {
  margin: 16px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}

.save {
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
  border-radius: var(--radius);
  font-size: 14.5px;
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
}

.save:disabled {
  opacity: 0.5;
}

.save:active {
  transform: translateY(1px);
}
</style>
