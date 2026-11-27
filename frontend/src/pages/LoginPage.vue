<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import store from '../store.js';
import api from '../api.js';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const error = ref('');
const form = reactive({ username: '', password: '' });
const registered = computed(() => route.query.registered === '1');

const REGISTER_SITE_URL = import.meta.env.VITE_REGISTER_SITE_URL || 'https://reg.xl.cuixi.qzz.io/';
function goRegister() {
  window.location.href = REGISTER_SITE_URL;
}

async function submit() {
  if (!form.username.trim() || !form.password) {
    error.value = '请输入账号和密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await store.login(form);
    router.push('/');
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="wx-login">
    <div class="wx-login__card">
      <div class="wx-login__brand">
        <img class="wx-login__logo" :src="store.site.siteIconUrl || '/logo.svg'" alt="logo" />
        <h1>{{ store.site.siteName }}</h1>
        <p>连接你我，随时畅聊</p>
      </div>

      <p v-if="registered" class="hint ok">注册成功，现在可以登录了。</p>
      <p v-if="error" class="hint err">{{ error }}</p>

      <form class="wx-login__form" @submit.prevent="submit">
        <div class="field">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <input v-model.trim="form.username" placeholder="用户名 / 细聊号" autocomplete="username" />
        </div>
        <div class="field">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <input v-model="form.password" type="password" placeholder="密码" autocomplete="current-password" />
        </div>
        <button class="primary" :disabled="loading" type="submit">{{ loading ? '登录中…' : '登录' }}</button>
      </form>

      <div class="wx-login__links">
        <button
          v-if="store.site.allowRegistration"
          type="button"
          @click="goRegister"
        >熙熙账号登录 / 注册</button>
      </div>

      <p class="wx-login__tip">细聊号格式如 <code>hello#8F3A</code>，可在「设置」中查看自己的细聊号</p>
    </div>
  </div>
</template>

<style scoped>
.wx-login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(160deg, #eef2f5 0%, #dfe6e4 100%); box-sizing: border-box; }
.wx-login__card { width: min(400px, 100%); background: #fff; border-radius: 16px; padding: 40px 34px 32px; box-shadow: 0 12px 40px rgba(0,0,0,0.06); }
.wx-login__brand { text-align: center; margin-bottom: 28px; }
.wx-login__logo { width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 14px; object-fit: contain; display: block; }
.wx-login__brand h1 { margin: 0; font-size: 22px; font-weight: 600; color: #191919; }
.wx-login__brand p { margin: 6px 0 0; font-size: 13px; color: #9a9a9a; }
.hint { margin: 0 0 14px; padding: 9px 12px; border-radius: 8px; font-size: 13px; text-align: center; }
.hint.ok { background: #eaf8ef; color: #1a7f43; }
.hint.err { background: #fdeaea; color: #c0392b; }
.wx-login__form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border: 1px solid #e3e3e3; border-radius: 8px; color: #b0b0b0; transition: border-color 150ms; }
.field:focus-within { border-color: #07c160; }
.field input { flex: 1; border: none; outline: none; font-size: 15px; color: #191919; background: transparent; }
.primary { margin-top: 8px; height: 46px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; transition: background 150ms; }
.primary:hover:not(:disabled) { background: #06ad56; }
.primary:disabled { opacity: 0.6; cursor: not-allowed; }
.wx-login__links { display: flex; justify-content: center; margin-top: 16px; }
.wx-login__links button { border: none; background: transparent; color: #576b95; font-size: 13px; cursor: pointer; }
.wx-login__tip { margin: 20px 0 0; font-size: 11px; color: #b0b0b0; text-align: center; line-height: 1.6; }
.wx-login__tip code { background: #f5f5f5; padding: 1px 5px; border-radius: 4px; color: #888; }
</style>
