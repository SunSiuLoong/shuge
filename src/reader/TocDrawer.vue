<script setup lang="ts">
import type { TocItem } from '../types'

const props = defineProps<{
  toc: TocItem[]
  currentHref: string
}>()

const emit = defineEmits<{
  (e: 'select', item: TocItem): void
  (e: 'close'): void
}>()
</script>

<template>
  <div class="toc">
    <header class="toc__head">
      <span class="toc__title">目录</span>
      <button class="toc__close" type="button" @click="emit('close')">关闭</button>
    </header>
    <div class="toc__body scroll-y">
      <p v-if="!props.toc.length" class="toc__empty">这本书没有可用的目录</p>
      <button
        v-for="(item, i) in props.toc"
        :key="item.href + i"
        class="toc__row"
        :class="{ 'is-current': currentHref && item.href === currentHref }"
        :style="{ paddingLeft: `${16 + item.depth * 14}px` }"
        type="button"
        @click="emit('select', item)"
      >
        <span v-if="item.depth > 0" class="toc__dot" />
        <span class="toc__label">{{ item.label || '（无标题）' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toc {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.toc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: calc(12px + var(--safe-top)) 16px 10px;
  border-bottom: 1px solid var(--line);
}

.toc__title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.toc__close {
  /* 文字 13px，但热区补到 44：原来只有 26×20，拇指点不中 */
  min-width: 44px;
  min-height: 44px;
  margin-right: -10px;
  font-size: 13px;
  color: var(--text-2);
}

.toc__body {
  flex: 1;
  min-height: 0;
  padding-bottom: calc(24px + var(--safe-bottom));
}

.toc__row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  font-size: 14px;
  color: var(--text);
}

.toc__row:active {
  background: var(--surface-2);
}

.toc__row.is-current {
  color: var(--accent);
  font-weight: 600;
}

.toc__dot {
  flex: none;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-3);
}

.toc__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc__empty {
  padding: 60px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}
</style>
