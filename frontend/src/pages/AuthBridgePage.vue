<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import store from '../store.js';

const route = useRoute();
const router = useRouter();
const error = ref('');

onMounted(async () => {
  const token = String(route.query.token || '').trim();
  if (!token) {
    error.value = '缺少登录凭据';
    return;
  }
  try {
    store.setToken(token);
    await store.initialize();
    if (!store.session) {
      error.value = '登录已失效，请重新登录';
      return;
    }
    router.replace('/');
  } catch (e) {
    error.value = e.message || '登录失败';
  }
});
</script>

<template>
  <div class="auth-bridge">
    <div class="ab-card">
      <img class="ab-logo" :src="store.site.siteIconUrl || '/logo.svg'" alt="logo" />
      <div v-if="!error" class="ab-msg">正在登录细聊…</div>
      <div v-else class="ab-msg err">{{ error }}</div>
      <button v-if="error" type="button" class="ab-btn" @click="router.replace('/login')">去登录</button>
    </div>
  </div>
</template>

<style scoped>
.auth-bridge { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #ededed; padding: 24px; box-sizing: border-box; }
.ab-card { width: min(360px, 100%); background: #fff; border-radius: 16px; padding: 40px 28px; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,0.06); }
.ab-logo { width: 64px; height: 64px; border-radius: 14px; margin: 0 auto 20px; }
.ab-msg { font-size: 15px; color: #666; }
.ab-msg.err { color: #e64340; }
.ab-btn { margin-top: 20px; width: 100%; padding: 12px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 15px; cursor: pointer; }
</style>
