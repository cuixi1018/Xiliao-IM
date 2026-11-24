<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const validating = ref(true);
const error = ref('');
const invite = ref(null);
const form = reactive({ username: '', displayName: '', password: '', confirmPassword: '' });
const token = computed(() => String(route.params.token || '').trim());

async function loadInvite() {
  validating.value = true;
  try {
    const payload = await api.getRegisterInvite(token.value);
    invite.value = payload.invite;
    if (payload.site) store.setSite(payload.site);
  } catch (e) {
    error.value = e.message;
  } finally {
    validating.value = false;
  }
}

async function submit() {
  if (form.password !== form.confirmPassword) { error.value = '两次输入的密码不一致'; return; }
  if (form.password.length < 6) { error.value = '密码至少 6 位'; return; }
  loading.value = true;
  error.value = '';
  try {
    await api.registerWithInvite(token.value, form);
    router.push({ name: 'login', query: { registered: '1' } });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadInvite);
</script>

<template>
  <div class="wx-login">
    <div class="wx-login__card">
      <div class="wx-login__brand">
        <div class="wx-login__logo">💬</div>
        <h1>{{ store.site.siteName }}</h1>
        <p>邀请注册</p>
      </div>
      <p v-if="validating" class="hint">正在验证注册链接…</p>
      <p v-else-if="invite?.note" class="hint">{{ invite.note }}</p>
      <p v-if="error" class="hint err">{{ error }}</p>
      <form v-if="invite && !error" class="wx-login__form" @submit.prevent="submit">
        <div class="field"><input v-model.trim="form.username" placeholder="用户名" autocomplete="username" /></div>
        <div class="field"><input v-model.trim="form.displayName" placeholder="显示名称" /></div>
        <div class="field"><input v-model="form.password" type="password" placeholder="密码（至少6位）" /></div>
        <div class="field"><input v-model="form.confirmPassword" type="password" placeholder="确认密码" /></div>
        <button class="primary" :disabled="loading" type="submit">{{ loading ? '注册中…' : '完成注册' }}</button>
      </form>
      <div class="wx-login__links"><button type="button" @click="router.push('/login')">返回登录</button></div>
    </div>
  </div>
</template>

<style scoped>
.wx-login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(160deg, #eef2f5 0%, #dfe6e4 100%); box-sizing: border-box; }
.wx-login__card { width: min(400px, 100%); background: #fff; border-radius: 16px; padding: 40px 34px 32px; box-shadow: 0 12px 40px rgba(0,0,0,0.06); }
.wx-login__brand { text-align: center; margin-bottom: 28px; }
.wx-login__logo { width: 60px; height: 60px; margin: 0 auto 14px; border-radius: 14px; background: #07c160; display: flex; align-items: center; justify-content: center; font-size: 32px; }
.wx-login__brand h1 { margin: 0; font-size: 22px; font-weight: 600; color: #191919; }
.wx-login__brand p { margin: 6px 0 0; font-size: 13px; color: #9a9a9a; }
.hint { margin: 0 0 14px; padding: 9px 12px; border-radius: 8px; font-size: 13px; text-align: center; background: #f5f8f6; color: #5a7a68; }
.hint.err { background: #fdeaea; color: #c0392b; }
.wx-login__form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; align-items: center; height: 48px; padding: 0 14px; border: 1px solid #e3e3e3; border-radius: 8px; transition: border-color 150ms; }
.field:focus-within { border-color: #07c160; }
.field input { flex: 1; border: none; outline: none; font-size: 15px; color: #191919; }
.primary { margin-top: 8px; height: 46px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
.primary:disabled { opacity: 0.6; }
.wx-login__links { display: flex; justify-content: center; margin-top: 16px; }
.wx-login__links button { border: none; background: transparent; color: #576b95; font-size: 13px; cursor: pointer; }
</style>
