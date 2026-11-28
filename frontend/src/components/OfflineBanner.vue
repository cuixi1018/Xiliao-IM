<script setup>
// 全局离线提示：所有用户端（网页 / PWA / APP / 桌面端）离线时显示，
// 告知界面仍可浏览，但无法接收新消息与获取最新数据；恢复联网后自动隐藏。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { isDesktopApp } from '../platform.js';

const offline = ref(false);
const desktop = isDesktopApp();

function isOfflineNow() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (desktop && typeof window !== 'undefined' && window.__XILIAO_OFFLINE__ === true) return true;
  return false;
}

function refresh() {
  offline.value = isOfflineNow();
}

onMounted(() => {
  refresh();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  // 桌面端主进程判定离线后派发该事件
  window.addEventListener('xiliao-offline', () => { offline.value = true; });
});

onBeforeUnmount(() => {
  window.removeEventListener('online', refresh);
  window.removeEventListener('offline', refresh);
  window.removeEventListener('xiliao-offline', refresh);
});
</script>

<template>
  <Transition name="offline-fade">
    <div v-if="offline" class="offline-banner" :class="{ 'is-desktop': desktop }">
      <span class="offline-banner__dot"></span>
      <span class="offline-banner__text">当前处于离线状态，界面可浏览，但无法接收新消息或获取最新数据</span>
      <span class="offline-banner__hint">联网后自动恢复</span>
    </div>
  </Transition>
</template>

<style scoped>
.offline-banner {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 8000;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 24px);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(38, 42, 48, 0.92);
  color: #fff;
  font-size: 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(8px);
  white-space: nowrap;
}
.offline-banner.is-desktop { top: 52px; }
.offline-banner__dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #ff9f0a; flex: none;
  box-shadow: 0 0 0 3px rgba(255, 159, 10, 0.2);
}
.offline-banner__text { overflow: hidden; text-overflow: ellipsis; }
.offline-banner__hint { opacity: 0.6; font-size: 11px; }
.offline-fade-enter-active, .offline-fade-leave-active { transition: opacity 220ms ease, transform 220ms ease; }
.offline-fade-enter-from, .offline-fade-leave-to { opacity: 0; transform: translate(-50%, -8px); }
@media (max-width: 480px) {
  .offline-banner { white-space: normal; border-radius: 12px; font-size: 11px; }
  .offline-banner__hint { display: none; }
}
</style>
