<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { goBack } from '../router'
import { APP_VERSION } from '../version'
import { APP_NAME } from '../appinfo'
import AboutSection from './AboutSection.vue'

/**
 * 独立「关于」页：设置页的 05 组已经内嵌了同一份内容，
 * 这里只保留品牌头，方便从旧链接 / 桌面快捷方式进来时仍有完整信息。
 */
</script>

<template>
  <div class="about">
    <header class="topbar">
      <button class="icon-btn" type="button" aria-label="返回" @click="goBack">
        <ArrowLeft :size="20" :stroke-width="1.7" />
      </button>
      <h1 class="topbar__title">关于</h1>
    </header>

    <div class="about__scroll scroll-y">
      <section class="brand">
        <div class="brand__mark" aria-hidden="true"><span /><span /><span /></div>
        <p class="brand__name">{{ APP_NAME }}</p>
        <p class="brand__ver">v{{ APP_VERSION }}</p>
        <p class="brand__desc">安卓本地 EPUB 阅读器，书只存在你自己的手机里</p>
      </section>

      <AboutSection />

      <p class="foot">本地优先 · 不上传书籍 · 不收集账号</p>
    </div>
  </div>
</template>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.about .topbar {
  border-bottom-color: var(--line);
}

.about__scroll {
  flex: 1;
  min-height: 0;
  padding: 8px 18px calc(40px + var(--safe-bottom));
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 0 8px;
  text-align: center;
}

.brand__mark {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 42px;
  margin-bottom: 14px;
  opacity: 0.7;
}

.brand__mark span {
  width: 9px;
  border-radius: 1px;
  background: var(--text-3);
}

.brand__mark span:nth-child(1) {
  height: 30px;
}
.brand__mark span:nth-child(2) {
  height: 42px;
  background: var(--accent);
  opacity: 0.7;
}
.brand__mark span:nth-child(3) {
  height: 24px;
}

.brand__name {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 24px;
  letter-spacing: 0.14em;
}

.brand__ver {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.brand__desc {
  margin: 12px 0 0;
  max-width: 260px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
}

.foot {
  margin: 26px 0 0;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-3);
}
</style>
