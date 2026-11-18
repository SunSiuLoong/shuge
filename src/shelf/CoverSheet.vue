<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import type { Book } from '../types'
import { coverUrlOf } from './useCoverUrl'

/** 长按「查看封面」：全屏看图，不做缩放交互——书架上的缩略图太小，
 *  这里要的是把封面看清楚（标题、丛书名、腰封文字）。 */
const props = defineProps<{ book: Book }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const cover = computed(() => coverUrlOf(props.book))
const initial = computed(() => props.book.title.trim().charAt(0) || '书')
const tone = computed(() => {
  let h = 0
  for (const ch of props.book.title) h = (h * 31 + ch.codePointAt(0)!) % 360
  return { background: `hsl(${h} 16% 24%)`, color: `hsl(${h} 26% 88%)` }
})
</script>

<template>
  <div class="cover" @click="emit('close')">
    <button class="cover__x" type="button" aria-label="关闭" @click.stop="emit('close')">
      <X :size="20" :stroke-width="1.8" />
    </button>
    <div class="cover__frame" @click.stop>
      <img v-if="cover" class="cover__img" :src="cover" :alt="book.title" />
      <div v-else class="cover__ph" :style="tone">{{ initial }}</div>
    </div>
    <p class="cover__title">{{ book.title }}</p>
    <p class="cover__author">{{ book.author || '作者未知' }}</p>
  </div>
</template>

<style scoped>
.cover {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: calc(52px + var(--safe-top)) 26px calc(30px + var(--safe-bottom));
  background: rgba(10, 10, 11, 0.94);
  backdrop-filter: blur(14px);
  animation: cover-in 200ms var(--ease);
}

.cover__x {
  position: absolute;
  top: calc(8px + var(--safe-top));
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.86);
}

.cover__x:active {
  background: rgba(255, 255, 255, 0.12);
}

.cover__frame {
  max-width: 100%;
  max-height: 100%;
  min-height: 0;
  display: flex;
  justify-content: center;
}

.cover__img {
  max-width: min(78vw, 420px);
  max-height: 68vh;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.9);
  animation: cover-pop 260ms var(--ease);
}

.cover__ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(72vw, 320px);
  aspect-ratio: 3 / 4;
  border-radius: 6px;
  font-family: var(--font-serif);
  font-size: 64px;
  font-weight: 600;
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.9);
}

.cover__title {
  max-width: 88%;
  margin: 22px 0 0;
  font-family: var(--font-serif);
  font-size: 15px;
  line-height: 1.5;
  text-align: center;
  color: rgba(255, 255, 255, 0.92);
}

.cover__author {
  margin: 5px 0 0;
  max-width: 88%;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes cover-in {
  from {
    opacity: 0;
  }
}

@keyframes cover-pop {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
}
</style>
