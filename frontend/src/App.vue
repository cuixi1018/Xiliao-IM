<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppDownloadPrompt from './components/AppDownloadPrompt.vue';
import OfflineBanner from './components/OfflineBanner.vue';
import { getPrefs } from './app-prefs.js';
import { isClientApp } from './platform.js';
import store from './store.js';
import {
  startGlobalInbox,
  stopGlobalInbox,
  subscribeInbox,
  isActiveRoom
} from './composables/useGlobalInbox.js';
import { showMessageNotification, requestNotifyPermission } from './notify-utils.js';

// 应用锁：APP 启动时若已设置 PIN 且本次会话未解锁，则显示锁屏
const LOCK_KEY = 'xiliao-unlocked-session';
const locked = ref(false);
const pinInput = ref('');
const pinErr = ref('');

let unsubscribeInbox = null;
function handleOnline() { startGlobalInbox(); }

function setupInbox() {
  if (!store.session) return;
  startGlobalInbox();
  // APP 端主动申请通知权限（Android 13+ 需要运行时授权）
  void requestNotifyPermission();
  if (!unsubscribeInbox) {
    unsubscribeInbox = subscribeInbox((payload) => {
      if (!payload || payload.type !== 'room_message' || !payload.room) return;
      // 正在查看的会话不弹通知（消息会直接显示在聊天页）
      if (isActiveRoom(payload.room)) return;
      showMessageNotification({
        room: payload.room,
        senderName: payload.senderName,
        preview: payload.preview
      });
    });
  }
}

function teardownInbox() {
  if (unsubscribeInbox) {
    unsubscribeInbox();
    unsubscribeInbox = null;
  }
  stopGlobalInbox();
}

onMounted(() => {
  // 网络恢复时主动重连收件箱，保证离线期间断开的消息连接尽快恢复
  window.addEventListener('online', handleOnline);

  // 登录态变化时启动/关闭全局收件箱（覆盖登录后进入、退出登录、会话恢复等场景）
  watch(
    () => store.session,
    (session) => {
      if (session) setupInbox();
      else teardownInbox();
    },
    { immediate: true }
  );

  if (!isClientApp()) return;
  const prefs = getPrefs();
  const unlocked = sessionStorage.getItem(LOCK_KEY) === '1';
  if (prefs.appLockEnabled && prefs.appLockPin && !unlocked) {
    locked.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline);
  teardownInbox();
});

function unlock() {
  const prefs = getPrefs();
  if (pinInput.value === prefs.appLockPin) {
    locked.value = false;
    pinInput.value = '';
    pinErr.value = '';
    sessionStorage.setItem(LOCK_KEY, '1');
  } else {
    pinErr.value = 'PIN 不正确，请重试';
    pinInput.value = '';
  }
}
</script>

<template>
  <router-view v-slot="{ Component, route }">
    <Transition :name="route.meta.transition || 'page'" mode="out-in">
      <component :is="Component" :key="route.path" />
    </Transition>
  </router-view>
  <OfflineBanner />
  <AppDownloadPrompt />

  <!-- 应用锁屏 -->
  <div v-if="locked" class="applock-mask">
    <div class="applock-box">
      <img class="applock-logo" src="/logo.svg" alt="细聊" />
      <h2>细聊已锁定</h2>
      <p>请输入 4 位应用锁 PIN 继续</p>
      <input
        v-model="pinInput"
        class="applock-input"
        type="tel"
        maxlength="4"
        inputmode="numeric"
        placeholder="••••"
        @keyup.enter="unlock"
      />
      <p v-if="pinErr" class="applock-err">{{ pinErr }}</p>
      <button type="button" class="applock-btn" @click="unlock">解锁</button>
    </div>
  </div>
</template>

<style>
/* 页面切换 — 丝滑淡入淡出 */
.page-enter-active,
.page-leave-active {
  transition: opacity 240ms cubic-bezier(0.37, 0, 0.63, 1),
              transform 240ms cubic-bezier(0.37, 0, 0.63, 1);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 应用锁屏 */
.applock-mask { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(160deg, #eef2f5, #dfe6e4); }
.applock-box { width: min(320px, 100%); text-align: center; background: #fff; border-radius: 22px; padding: 38px 28px 30px; box-shadow: 0 20px 60px rgba(26,35,50,0.16); }
.applock-logo { width: 60px; height: 60px; object-fit: contain; margin-bottom: 14px; }
.applock-box h2 { margin: 0 0 6px; font-size: 19px; color: #191919; }
.applock-box p { margin: 0 0 20px; font-size: 13px; color: #888; }
.applock-input { width: 100%; box-sizing: border-box; text-align: center; letter-spacing: 12px; font-size: 22px; padding: 12px; border: 1px solid #ddd; border-radius: 10px; outline: none; }
.applock-input:focus { border-color: #07c160; }
.applock-err { color: #e64340 !important; font-size: 12px !important; margin: 8px 0 0 !important; }
.applock-btn { width: 100%; margin-top: 18px; height: 44px; border: none; border-radius: 10px; background: #07c160; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
.applock-btn:hover { background: #06ad56; }
</style>
