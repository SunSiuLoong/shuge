<script setup lang="ts">
import { ref } from 'vue'

/**
 * 二次确认弹窗（Material 3 Dialog）。
 * 删书这类不可恢复操作统一走这里，不再用「点一下直接没了」的菜单项。
 * option 是可选勾选项（例如「同时删除本地文件」），默认不勾。
 */
const props = withDefaults(
  defineProps<{
    title: string
    message?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    /** 可选勾选项；不给就不渲染这一行 */
    option?: { label: string; note?: string }
    optionDefault?: boolean
  }>(),
  {
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    option: undefined,
    optionDefault: false,
  },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', option: boolean): void
}>()

const checked = ref(props.optionDefault)
</script>

<template>
  <div class="dlg" role="dialog" aria-modal="true" :aria-label="title">
    <div class="dlg__scrim" @click="emit('close')" />
    <div class="dlg__box">
      <h2 class="dlg__title">{{ title }}</h2>
      <p v-if="message" class="dlg__msg">{{ message }}</p>

      <button
        v-if="option"
        class="opt"
        type="button"
        role="checkbox"
        :aria-checked="checked"
        @click="checked = !checked"
      >
        <span class="opt__box" :class="{ 'is-on': checked }">
          <svg v-if="checked" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M20 6 9 17l-5-5"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="opt__text">
          {{ option.label }}
          <span v-if="option.note" class="opt__note">{{ option.note }}</span>
        </span>
      </button>

      <div class="dlg__actions">
        <button class="btn" type="button" @click="emit('close')">{{ cancelText }}</button>
        <button
          class="btn btn--primary"
          :class="{ 'btn--danger': danger }"
          type="button"
          @click="emit('confirm', checked)"
        >{{ confirmText }}</button>
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
  letter-spacing: 0.01em;
  color: var(--text);
}

.dlg__msg {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-2);
}

.opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin-top: 16px;
  padding: 10px 10px 10px 8px;
  text-align: left;
  border-radius: var(--radius);
  background: var(--surface-2);
}

.opt:active {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.opt__box {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 3px;
  border: 1.5px solid var(--text-3);
  color: var(--on-accent);
  transition: background-color 140ms var(--ease), border-color 140ms var(--ease);
}

.opt__box.is-on {
  background: var(--accent);
  border-color: var(--accent);
}

.opt__box svg {
  width: 13px;
  height: 13px;
}

.opt__text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
}

.opt__note {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-3);
}

.dlg__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 18px;
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

.btn--primary:active {
  background: var(--accent-soft);
}

.btn--danger {
  color: #fff;
  background: var(--accent);
}

.btn--danger:active {
  background: color-mix(in srgb, var(--accent) 82%, #000);
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
