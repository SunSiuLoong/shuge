<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { route } from './router'
import ShelfView from './shelf/ShelfView.vue'
import ReaderView from './reader/ReaderView.vue'
import SettingsView from './settings/SettingsView.vue'
import AboutView from './settings/AboutView.vue'
import { requestPersist, listBookFiles, deleteBookFile } from './storage/opfs'
import { db, patchBook } from './db'
import { applyUpdate, initPWA, needRefresh, offlineReady } from './pwa'
import { initUiStyle } from './ui/style'
import InAppBrowser from './links/InAppBrowser.vue'
import { autoImportFromFolder } from './storage/folderWatch'
import { noticeText, notify } from './ui/notice'
import { loading } from './shelf/store'
import { dismissBoot } from './ui/boot'

// UI 风格（莫奈取色 / 液态玻璃）的副作用挂在这里，只在 App 挂载一次
initUiStyle()

/*
 * 启动画面收尾：书架数据一到就撤掉 #boot（见 index.html）。
 * 直接深链进阅读页时书架不会加载，兜底 2.5 秒后强制撤掉，不能把用户关在外面。
 */
watch(loading, (v) => {
  if (!v) dismissBoot()
}, { immediate: true })
window.setTimeout(dismissBoot, 2500)

/** 启动对账：删掉没有记录指向的孤儿文件，标记文件丢失的书 */
const reconcile = async (): Promise<void> => {
  try {
    const [files, books] = await Promise.all([listBookFiles(), db.books.toArray()])
    const referenced = new Set(books.map((b) => b.opfsPath))
    for (const name of files) {
      if (!referenced.has(name)) await deleteBookFile(name)
    }
    const present = new Set(files)
    for (const book of books) {
      const missing = !present.has(book.opfsPath)
      if (!!book.missing !== missing && book.id != null) {
        await patchBook(book.id, { missing })
      }
    }
  } catch (e) {
    console.warn('对账失败', e)
  }
}

/**
 * 跑一次文件夹自动导入，成功后给个顶部浮条回执。
 * 只在书架 / 设置页提示：阅读页正在沉浸看书，底部或顶部突然冒一条很扫兴，
 * 而这两页正好是用户能立刻看到新书的地方（设置页还有扫描文件夹卡片）。
 */
const runAutoImport = async (): Promise<void> => {
  const r = await autoImportFromFolder()
  if (!r || (!r.added && !r.failed)) return
  const page = route.value.name
  if (page !== 'shelf' && page !== 'settings') return
  // 全失败也要说一声：多半是原文件坏了 / 授权失效，用户得知道去重扫
  const msg = r.added
    ? r.failed
      ? `已自动导入 ${r.added} 本，${r.failed} 本失败`
      : `已自动导入 ${r.added} 本新书`
    : `${r.failed} 本自动导入失败，可到设置里重扫`
  notify(msg)
}

onMounted(() => {
  initPWA()
  void requestPersist()
  void reconcile()
  /* [shuge] 文件夹自动导入：安卓没有后台文件监听，只能在启动后补扫一次
     （延后 4 秒，让首屏和索引先跑完），另外切回前台时再补一次。
     内部有 5 分钟节流与开关判断，没开就不会动。 */
  window.setTimeout(() => void runAutoImport(), 4000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runAutoImport()
  })
})
</script>

<template>
  <!-- 书架 ⇄ 阅读页的转场：出去快（淡出），进来带一点缩放上浮，
       参考 Lumi_Books 打开书时的容器过渡的简化版——不做封面形变，
       但要有「进入另一层」的纵深而不是硬切 -->
  <Transition name="page" mode="out-in">
    <ShelfView v-if="route.name === 'shelf'" key="shelf" />
    <ReaderView v-else-if="route.name === 'reader'" :key="`reader-${route.id}`" :book-id="route.id" />
    <SettingsView v-else-if="route.name === 'settings'" key="settings" />
    <AboutView v-else key="about" />
  </Transition>

  <Transition name="fade">
    <button v-if="needRefresh" class="sw-toast" type="button" @click="applyUpdate">
      有新版本，点此更新
    </button>
  </Transition>

  <Transition name="fade">
    <div v-if="offlineReady" class="sw-toast sw-toast--plain">已可离线阅读</div>
  </Transition>

  <!-- 后台自动导入的回执：顶部浮条，几秒后自消，不拦操作 -->
  <Transition name="drop">
    <div v-if="noticeText" class="notice" role="status">{{ noticeText }}</div>
  </Transition>

  <!-- 网页端的内置浏览器（安卓走 Custom Tabs，不需要这一层） -->
  <InAppBrowser />
</template>

<style scoped>
.sw-toast {
  position: fixed;
  left: 50%;
  bottom: calc(20px + var(--safe-bottom));
  z-index: 90;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--on-accent);
  background: var(--accent);
  box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.5);
}

.sw-toast--plain {
  color: var(--bg);
  background: rgba(35, 33, 30, 0.9);
}

[data-scheme='dark'] .sw-toast--plain {
  color: #16181a;
  background: rgba(230, 227, 220, 0.92);
}

/* 自动导入回执：走顶部，和书架的底部 toast 错开；配色用 text/bg 反转，
   浅色下是深底浅字、深色下是浅底深字，两套外观都跟得上 */
.notice {
  position: fixed;
  top: calc(10px + var(--safe-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 95;
  max-width: calc(100% - 28px);
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 12.5px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--bg);
  background: var(--text);
  box-shadow: 0 10px 28px -12px rgba(0, 0, 0, 0.45);
}

.drop-enter-active,
.drop-leave-active {
  transition: opacity 180ms var(--ease), transform 220ms var(--ease);
}

.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

</style>
