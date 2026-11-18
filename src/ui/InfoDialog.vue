<script setup lang="ts">
/**
 * 提示弹窗（Material 3 Dialog，单按钮）。
 *
 * 为什么不用底部 toast：toast 几秒就消失，条数一多、还带失败原因时根本读不完；
 * 导入结果是用户主动操作的回执，值得停一下让用户看清。
 * 只讲结果、不需要用户做选择，所以只有一个「知道了」。
 */
withDefaults(
  defineProps<{
    title: string
    /** 摘要行：一行一句，按顺序显示 */
    lines?: string[]
    /** 明细行：小字，用来列失败的书和原因 */
    details?: string[]
    /** 附带说明卡：标题 + 正文，解释概念用（例如「引用」是什么意思） */
    noteTitle?: string
    note?: string
    confirmText?: string
  }>(),
  {
    lines: () => [],
    details: () => [],
    noteTitle: '',
    note: '',
    confirmText: '知道了',
  },
)

const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div class="info" role="dialog" aria-modal="true" :aria-label="title">
    <div class="info__scrim" @click="emit('close')" />
    <div class="info__box">
      <h2 class="info__title">{{ title }}</h2>

      <p v-for="(line, i) in lines" :key="`l${i}`" class="info__line" :class="{ 'is-first': i === 0 }">
        {{ line }}
      </p>

      <ul v-if="details.length" class="info__details">
        <li v-for="(d, i) in details" :key="`d${i}`">{{ d }}</li>
      </ul>

      <div v-if="note" class="info__note">
        <p v-if="noteTitle" class="info__note-title">{{ noteTitle }}</p>
        <p class="info__note-body">{{ note }}</p>
      </div>

      <div class="info__actions">
        <button class="btn btn--primary" type="button" @click="emit('close')">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.info {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.info__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  animation: fade-in 160ms var(--ease);
}

.info__box {
  position: relative;
  width: 100%;
  max-width: 330px;
  max-height: calc(100% - 48px);
  overflow-y: auto;
  padding: 22px 20px 14px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.45);
  animation: pop-in 200ms var(--ease);
}

.info__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.01em;
  color: var(--text);
}

.info__line {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
}

/* 第一行是主结论（新增/没新增），给它正常文字色 */
.info__line.is-first {
  color: var(--text);
}

.info__details {
  margin: 10px 0 0;
  padding: 0 0 0 14px;
  list-style: disc;
}

.info__details li {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.info__note {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
}

.info__note-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.info__note-body {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-2);
}

.info__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.btn {
  min-height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--accent);
}

.btn:active {
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
