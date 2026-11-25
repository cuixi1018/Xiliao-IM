<script setup>
import { useRouter } from 'vue-router';
import UiAvatar from './ui/Avatar.vue';
import store from '../store.js';

defineProps({
  active: { type: String, default: 'chat' }
});

const router = useRouter();
const session = store.session;

const items = [
  { key: 'chat', label: '聊天', icon: 'chat' },
  { key: 'contacts', label: '通讯录', icon: 'contacts' },
  { key: 'moments', label: '朋友圈', icon: 'moments' }
];

function go(key) {
  const routes = { chat: '/', contacts: '/contacts', moments: '/moments' };
  router.push(routes[key] || '/');
}
function logout() {
  store.logout();
  router.push('/login');
}
</script>

<template>
  <aside class="wx-nav">
    <div class="wx-nav__top">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="wx-nav__btn"
        :class="{ 'wx-nav__btn--active': active === item.key }"
        :title="item.label"
        @click="go(item.key)"
      >
        <svg v-if="item.icon === 'chat'" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20l1.4-4.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>
        </svg>
        <svg v-else-if="item.icon === 'contacts'" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
        </svg>
        <span class="wx-nav__label">{{ item.label }}</span>
      </button>
    </div>

    <div class="wx-nav__bottom">
      <button type="button" class="wx-nav__btn" title="设置" @click="router.push('/settings')">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span class="wx-nav__label">设置</span>
      </button>
      <button type="button" class="wx-nav__btn wx-nav__btn--me" title="我的资料" @click="router.push('/settings')">
        <UiAvatar :src="session?.avatarUrl" :fallback="session?.displayName?.[0] || '我'" size="sm" />
      </button>
      <button type="button" class="wx-nav__btn wx-nav__btn--logout" title="退出登录" @click="logout">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.wx-nav {
  flex-shrink: 0;
  width: 68px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 18px 0;
  background: #2e2e2e;
  box-sizing: border-box;
  z-index: 20;
}
.wx-nav__top,
.wx-nav__bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.wx-nav__bottom { gap: 10px; }
.wx-nav__btn {
  position: relative;
  width: 56px;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: #8e8e8e;
  cursor: pointer;
  border-radius: 8px;
  transition: color 150ms, background 150ms;
}
.wx-nav__btn:hover { color: #d6d6d6; background: rgba(255,255,255,0.05); }
.wx-nav__btn--active { color: #07c160; }
.wx-nav__label { font-size: 10px; line-height: 1; }
.wx-nav__btn--me :deep(.ui-avatar) { border-radius: 6px; }
.wx-nav__btn--logout { color: #7a7a7a; }
@media (max-width: 768px) {
  /* 移动端：微信式底部导航栏 */
  .wx-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 58px;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    padding: 0;
    background: #ffffff;
    border-top: 1px solid #e5e5e5;
    z-index: 100;
  }
  .wx-nav__top,
  .wx-nav__bottom {
    flex-direction: row;
    gap: 0;
    width: auto;
    height: 100%;
  }
  .wx-nav__top { flex: 3; }
  .wx-nav__bottom { flex: 1; justify-content: center; }
  .wx-nav__btn {
    width: auto;
    flex: 1;
    height: 100%;
    padding: 6px 0;
    color: #7a7a7a;
    border-radius: 0;
  }
  .wx-nav__btn svg { width: 22px; height: 22px; }
  .wx-nav__btn--active { color: #07c160; }
  /* 移动端隐藏「我的头像/退出登录」，这两个入口放在设置页 */
  .wx-nav__btn--me,
  .wx-nav__btn--logout { display: none; }
}
</style>
