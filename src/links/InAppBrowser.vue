<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ExternalLink, RotateCw, X } from 'lucide-vue-next'
import { closeInAppBrowser, inAppBrowser } from '../links/inapp'

/**
 * 网页端的内置浏览器：整屏 iframe + 一条工具栏。
 * 安卓 App 不用它——那边走 Custom Tabs（见 links/inapp.ts）。
 */
const loading = ref(true)
const frameKey = ref(0)

const url = computed(() => inAppBrowser.url)

const reload = (): void => {
  loading.value = true
  frameKey.value += 1
}

const openOutside = (): void => {
  window.open(url.value, '_blank', 'noopener,noreferrer')
}

watch(url, () => {
  loading.value = true
  frameKey.value += 1
})
</script>

<template>
  <Transition name="browser-up">
    <div v-if="inAppBrowser.open" class="ib">
      <header class="ib__bar">
        <button class="ib__btn" type="button" aria-label="关闭" @click="closeInAppBrowser">
          <X :size="20" :stroke-width="1.8" />
        </button>
        <span class="ib__title">{{ inAppBrowser.title || '书评' }}</span>
        <button class="ib__btn" type="button" aria-label="刷新" @click="reload">
          <RotateCw :size="18" :stroke-width="1.8" />
        </button>
        <button class="ib__btn" type="button" aria-label="在浏览器中打开" @click="openOutside">
          <ExternalLink :size="18" :stroke-width="1.8" />
        </button>
      </header>

      <div class="ib__progress" :class="{ 'is-done': !loading }"><i /></div>

      <iframe
        :key="frameKey"
        class="ib__frame"
        :src="url"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        @load="loading = false"
      />

      <p class="ib__hint">
        加载不出来（白屏）说明该站点不允许被嵌入，点右上角在浏览器中打开。
      </p>
    </div>
  </Transition>
</template>

<style scoped>
.ib {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
}

.ib__bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: calc(48px + var(--safe-top));
  padding: var(--safe-top) 6px 0;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}

.ib__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--text);
}

.ib__btn:active {
  background: var(--surface-2);
}

.ib__title {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 进度条：加载时来回跑，加载完淡出。比转圈更不挡内容 */
.ib__progress {
  position: relative;
  flex: none;
  height: 2px;
  overflow: hidden;
  background: var(--line);
  transition: opacity 240ms var(--ease);
}

.ib__progress i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 34%;
  background: var(--accent);
  animation: ib-slide 1.1s var(--ease) infinite;
}

.ib__progress.is-done {
  opacity: 0;
}

@keyframes ib-slide {
  from {
    left: -34%;
  }
  to {
    left: 100%;
  }
}

.ib__frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: var(--bg);
}

.ib__hint {
  flex: none;
  margin: 0;
  padding: 8px 16px calc(8px + var(--safe-bottom));
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
  color: var(--text-3);
  border-top: 1px solid var(--line);
}

.browser-up-enter-active,
.browser-up-leave-active {
  transition: transform 240ms var(--ease), opacity 240ms var(--ease);
}

.browser-up-enter-from,
.browser-up-leave-to {
  transform: translateY(2%);
  opacity: 0;
}
</style>
