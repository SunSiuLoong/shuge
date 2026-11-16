<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { SITES, cleanTitle, searchUrl } from './sites'
import { openExternal } from './open'

const props = defineProps<{ title: string; author?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const pick = (key: string): void => {
  openExternal(searchUrl(key, props.title, props.author))
  emit('close')
}
</script>

<template>
  <div class="link">
    <div class="link__scrim" @click="emit('close')" />
    <div class="sheet" @click.stop>
    <div class="sheet__handle" />
    <div class="sheet__head">
      <span class="link__head">去网文站看这本书</span>
      <button class="close" type="button" aria-label="关闭" @click="emit('close')">
        <X :size="18" :stroke-width="1.8" />
      </button>
    </div>
    <div class="sheet__body">
      <p class="link__sub">搜「{{ cleanTitle(title) }}」，在浏览器里打开</p>
      <button
        v-for="site in SITES"
        :key="site.key"
        class="opt"
        type="button"
        @click="pick(site.key)"
      >
        <span class="opt__name">{{ site.name }}</span>
        <span class="opt__note">{{ site.note }}</span>
      </button>
      <p class="link__foot">只做跳转。书评、评分归站点所有，本应用不抓取也不展示。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 单一根节点：多根组件放进 <Transition> 时动画会失效，遮罩也可能不渲染 */
.link {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
}

.link__scrim {
  position: absolute;
  inset: 0;
  background: var(--scrim);
}

.sheet {
  position: relative;
  width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: var(--safe-bottom);
  box-shadow: 0 -8px 32px -12px rgba(0, 0, 0, 0.28);
}

.sheet__handle {
  flex: none;
  width: 36px;
  height: 4px;
  margin: 8px auto 4px;
  border-radius: 2px;
  background: var(--line);
}

.sheet__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 10px 16px;
  color: var(--text);
}

.link__head {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
}

.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--text-2);
}

.close:active {
  background: var(--surface-2);
}

.sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 16px 18px;
}

.link__sub {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-2);
  word-break: break-all;
}

.opt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-height: 56px;
  padding: 12px 4px;
  text-align: left;
  border-bottom: 1px solid var(--line);
}

.opt:last-of-type {
  border-bottom: 0;
}

.opt:active {
  background: var(--surface-2);
}

.opt__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.opt__note {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-2);
}

.link__foot {
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-2);
}
</style>
