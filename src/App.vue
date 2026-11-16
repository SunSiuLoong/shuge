<script setup lang="ts">
import { onMounted } from 'vue'
import { route } from './router'
import ShelfView from './shelf/ShelfView.vue'
import ReaderView from './reader/ReaderView.vue'
import SettingsView from './settings/SettingsView.vue'
import { requestPersist, listBookFiles, deleteBookFile } from './storage/opfs'
import { db, patchBook } from './db'
import { applyUpdate, initPWA, needRefresh, offlineReady } from './pwa'

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
  <ShelfView v-if="route.name === 'shelf'" />
  <ReaderView v-else-if="route.name === 'reader'" :key="route.id" :book-id="route.id" />
  <SettingsView v-else-if="route.name === 'settings'" />

  <Transition name="fade">
    <button v-if="needRefresh" class="sw-toast" type="button" @click="applyUpdate">
      有新版本，点此更新
    </button>
  </Transition>

  <Transition name="fade">
    <div v-if="offlineReady" class="sw-toast sw-toast--plain">已可离线阅读</div>
  </Transition>
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
  color: #fff;
  background: var(--accent);
  box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.5);
}

.sw-toast--plain {
  color: var(--bg);
  background: rgba(35, 33, 30, 0.9);
}

[data-theme='night'] .sw-toast--plain {
  color: #16181a;
  background: rgba(230, 227, 220, 0.92);
}
</style>
