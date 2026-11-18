<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import type { TocItem } from '../types'

const props = defineProps<{
  toc: TocItem[]
  currentHref: string
}>()

const emit = defineEmits<{
  (e: 'select', item: TocItem): void
  (e: 'close'): void
}>()

/**
 * 目录树：卷/分卷这类有下级的节点只负责展开收起，叶子节点才跳转。
 * 参考 readest 的做法——点标题就等于开合，箭头只是状态提示，不额外要求精确点中。
 */

interface Row {
  item: TocItem
  key: string
  depth: number
  hasChildren: boolean
  /** 当前阅读位置就在这个卷里（卷收起时也要看得出来） */
  inPath: boolean
}

/** 展开状态按节点路径存：key = 每级序号拼起来的 "0/2/1" */
const expanded = ref<Set<string>>(new Set())

const keyOf = (path: number[]): string => path.join('/')

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (items: TocItem[], depth: number, path: number[], ancestorHasCurrent: boolean): void => {
    items.forEach((item, i) => {
      const p = [...path, i]
      const key = keyOf(p)
      const hasChildren = !!item.children?.length
      const inPath = ancestorHasCurrent || (!!props.currentHref && item.href === props.currentHref)
      out.push({ item, key, depth, hasChildren, inPath })
      if (hasChildren && expanded.value.has(key)) walk(item.children!, depth + 1, p, inPath)
    })
  }
  walk(props.toc, 0, [], false)
  return out
})

/** 找当前章节的祖先路径，用来默认展开它所在的那个卷 */
const currentPath = computed<number[]>(() => {
  if (!props.currentHref) return []
  let found: number[] = []
  const walk = (items: TocItem[], path: number[]): boolean => {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (item.href === props.currentHref) {
        found = [...path, i]
        return true
      }
      if (item.children?.length && walk(item.children, [...path, i])) return true
    }
    return false
  }
  walk(props.toc, [])
  return found
})

/** 把某一级以上的节点都标记为展开（不含自身，自身是叶子） */
const expandAncestors = (path: number[]): void => {
  const next = new Set(expanded.value)
  for (let i = 1; i < path.length; i += 1) next.add(keyOf(path.slice(0, i)))
  expanded.value = next
}

// 换书 / 换章都保证当前所在的卷是打开的，否则「当前章在哪」看不见
watch(
  [() => props.toc, currentPath],
  () => {
    if (currentPath.value.length) expandAncestors(currentPath.value)
  },
  { immediate: true },
)

const toggle = (key: string): void => {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

const onRow = (row: Row): void => {
  if (row.hasChildren) {
    toggle(row.key)
    return
  }
  emit('select', row.item)
}

const hasTree = computed(() => props.toc.some((t) => t.children?.length))
</script>

<template>
  <div class="toc">
    <header class="toc__head">
      <span class="toc__title">目录</span>
      <button
        v-if="hasTree"
        class="toc__act"
        type="button"
        @click="expanded = new Set()"
      >
        全部收起
      </button>
      <button class="toc__close" type="button" @click="emit('close')">关闭</button>
    </header>
    <div class="toc__body scroll-y">
      <p v-if="!props.toc.length" class="toc__empty">这本书没有可用的目录</p>
      <button
        v-for="row in rows"
        :key="row.key + row.item.href"
        class="toc__row"
        :class="{
          'is-current': props.currentHref && row.item.href === props.currentHref,
          'is-branch': row.hasChildren,
          'is-open': expanded.has(row.key),
          'is-inpath': row.inPath && !(props.currentHref && row.item.href === props.currentHref),
        }"
        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
        type="button"
        @click="onRow(row)"
      >
        <ChevronRight
          v-if="row.hasChildren"
          class="toc__chev"
          :size="14"
          :stroke-width="2"
        />
        <span v-else class="toc__dot" />
        <span class="toc__label">{{ row.item.label || '（无标题）' }}</span>
        <span v-if="row.hasChildren" class="toc__count">{{ row.item.children?.length }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toc {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 圆角与搜索/排版/书评 sheet 对齐：右侧抽屉取其镜像（左侧两角） */
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  overflow: hidden;
  background: var(--bg);
}

.toc__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: calc(12px + var(--safe-top)) 12px 10px 16px;
  border-bottom: 1px solid var(--line);
}

.toc__title {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.toc__act {
  /* 文字按钮，热区补到 44 */
  min-height: 44px;
  padding: 0 6px;
  font-size: 12px;
  color: var(--text-2);
}

.toc__close {
  /* 文字 13px，但热区补到 44：原来只有 26×20，拇指点不中 */
  min-width: 44px;
  min-height: 44px;
  margin-right: -6px;
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
  min-height: 44px;
  padding: 10px 16px 10px 12px;
  text-align: left;
  font-size: 14px;
  color: var(--text);
}

.toc__row:active {
  background: var(--surface-2);
}

/* 卷/分卷：字重和字号提一档，跟章区分开；开合状态由箭头旋转表示 */
.toc__row.is-branch {
  font-size: 14.5px;
  font-weight: 600;
}

.toc__row.is-inpath {
  color: var(--accent);
}

.toc__row.is-current {
  color: var(--accent);
  font-weight: 700;
}

.toc__chev {
  flex: none;
  color: var(--text-3);
  transition: transform 160ms var(--ease);
}

.toc__row.is-open .toc__chev {
  transform: rotate(90deg);
}

.toc__row.is-inpath .toc__chev {
  color: var(--accent);
}

.toc__dot {
  flex: none;
  width: 3px;
  height: 3px;
  margin: 0 5px;
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

/* 卷后面的章数：小号数字，不抢标题 */
.toc__count {
  flex: none;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.toc__empty {
  padding: 60px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}
</style>
