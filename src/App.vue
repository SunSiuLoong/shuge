<script setup lang="ts">
import { onMounted } from 'vue'
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

// UI 风格（莫奈取色 / 液态玻璃）的副作用挂在这里，只在 App 挂载一次
initUiStyle()

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

onMounted(() => {
  initPWA()
  void requestPersist()
  void reconcile()
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
</style>
