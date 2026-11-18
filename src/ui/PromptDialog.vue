<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

/**
 * 单行文本输入弹窗。用于标签重命名、书名的就地改名这类
 * 「只有一个字段」的轻量编辑，没必要开一整张 sheet。
 */
const props = withDefaults(
  defineProps<{
    title: string
    label?: string
    value?: string
    placeholder?: string
    maxlength?: number
    confirmText?: string
    note?: string
  }>(),
  {
    label: '',
    value: '',
    placeholder: '',
    maxlength: 40,
    confirmText: '保存',
    note: '',
  },
)

const emit = defineEmits<{ (e: 'close'): void; (e: 'submit', value: string): void }>()

const text = ref(props.value)
const input = ref<HTMLInputElement | null>(null)

const submit = (): void => {
  const v = text.value.trim()
  if (!v) {
    input.value?.focus()
    return
  }
  emit('submit', v)
}

onMounted(() => {
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
})
</script>

<template>
  <div class="dlg" role="dialog" aria-modal="true" :aria-label="title">
    <div class="dlg__scrim" @click="emit('close')" />
    <div class="dlg__box">
      <h2 class="dlg__title">{{ title }}</h2>
      <label v-if="label" class="dlg__label" for="prompt-input">{{ label }}</label>
      <input
        id="prompt-input"
        ref="input"
        v-model="text"
        class="dlg__input"
        type="text"
        :maxlength="maxlength"
        :placeholder="placeholder"
        @keydown.enter.prevent="submit"
      />
      <p v-if="note" class="dlg__note">{{ note }}</p>
      <div class="dlg__actions">
        <button class="btn" type="button" @click="emit('close')">取消</button>
        <button class="btn btn--primary" type="button" :disabled="!text.trim()" @click="submit">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dlg {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dlg__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  animation: fade-in 160ms var(--ease);
}

.dlg__box {
  position: relative;
  width: 100%;
  max-width: 330px;
  padding: 22px 20px 14px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.45);
  animation: pop-in 200ms var(--ease);
}

.dlg__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text);
}

.dlg__label {
  display: block;
  margin: 16px 0 6px;
  font-size: 11.5px;
  color: var(--text-3);
}

.dlg__input {
  width: 100%;
  height: 44px;
  margin-top: 14px;
  padding: 0 12px;
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent;
}

.dlg__label + .dlg__input {
  margin-top: 0;
}

.dlg__input:focus {
  border-color: var(--accent);
  outline: none;
}

.dlg__note {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}

.dlg__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 16px;
}

.btn {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-2);
}

.btn:active {
  background: var(--surface-2);
}

.btn--primary {
  color: var(--accent);
  font-weight: 600;
}

.btn--primary:disabled {
  opacity: 0.45;
}

.btn--primary:active {
  background: var(--accent-soft);
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(6px);
  }
}
</style>
