<script setup lang="ts">
import { ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import type { FoliateAdapter, SearchHit } from './adapter'

const props = defineProps<{ adapter: FoliateAdapter }>()
const emit = defineEmits<{
  (e: 'select', cfi: string): void
  (e: 'close'): void
}>()

const query = ref('')
const hits = ref<SearchHit[]>([])
const searching = ref(false)
const progress = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

let token = 0

const run = async (): Promise<void> => {
  const q = query.value.trim()
  if (q.length < 1) return
  const my = ++token
  props.adapter.cancelSearch()
  hits.value = []
  progress.value = 0
  searching.value = true
  try {
    await props.adapter.search(
      q,
      (hit) => {
        if (my !== token) return
        hits.value.push(hit)
      },
      (p) => {
        if (my === token) progress.value = p.processed
      },
    )
  } finally {
    if (my === token) searching.value = false
  }
}

const select = (hit: SearchHit): void => {
  emit('select', hit.cfi)
}

const close = (): void => {
  token++
  props.adapter.cancelSearch()
  emit('close')
}

defineExpose({ focus: () => inputEl.value?.focus() })
</script>

<template>
  <div class="sheet search">
    <div class="sheet__handle" />
    <div class="search__bar">
      <Search :size="17" :stroke-width="1.8" class="search__icon" />
      <input
        ref="inputEl"
        v-model="query"
        class="search__input"
        type="search"
        placeholder="在本书中搜索"
        enterkeyhint="search"
        @keyup.enter="run"
      />
      <button class="search__btn" type="button" @click="run">
        {{ searching ? '搜索中' : '搜索' }}
      </button>
      <button class="icon-btn" type="button" aria-label="关闭" @click="close">
        <X :size="18" :stroke-width="1.8" />
      </button>
    </div>

    <div v-if="searching" class="search__progress">
      <i :style="{ width: `${progress}%` }" />
    </div>

    <div class="sheet__body search__body">
      <p v-if="!searching && !hits.length && query" class="search__empty">
        没有找到包含「{{ query }}」的段落
      </p>
      <button
        v-for="(hit, i) in hits"
        :key="hit.cfi + i"
        class="hit"
        type="button"
        @click="select(hit)"
      >
        <span v-if="hit.label" class="hit__label">{{ hit.label }}</span>
        <span class="hit__text">
          {{ hit.pre }}<mark v-if="hit.match">{{ hit.match }}</mark>{{ hit.post }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.search {
  max-height: 78vh;
}

.search__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 6px 12px 10px;
  border-bottom: 1px solid var(--line);
}

.search__icon {
  flex: none;
  color: var(--text-3);
}

.search__input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 14px;
  outline: none;
}

.search__input::-webkit-search-cancel-button {
  display: none;
}

.search__btn {
  flex: none;
  /* 热区补足，避免和输入框抢点击时点空 */
  min-height: 44px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--accent);
}

.search__progress {
  flex: none;
  height: 2px;
  background: var(--line);
}

.search__progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 160ms linear;
}

.search__body {
  padding-top: 4px;
}

.search__empty {
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}

.hit {
  display: block;
  width: 100%;
  padding: 11px 2px;
  text-align: left;
  border-bottom: 1px solid var(--line);
}

.hit:last-child {
  border-bottom: 0;
}

.hit__label {
  display: block;
  margin-bottom: 3px;
  font-size: 11px;
  color: var(--text-3);
}

.hit__text {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text);
  font-family: var(--font-serif);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.hit__text mark {
  padding: 0 1px;
  border-radius: 2px;
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
}
</style>
