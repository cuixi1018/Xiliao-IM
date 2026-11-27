<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const ready = ref(false);
const submitting = ref(false);
const error = ref('');
const success = ref(false);
const userInfo = ref(null);
const tempToken = ref('');
const expectSub = ref(''); // 唯一用户标识，用于核验防串号
const form = reactive({ username: '', password: '', displayName: '' });

function showError(text) {
  error.value = text;
  loading.value = false;
}

onMounted(async () => {
  try {
    // 先确认注册开关是否开放
    await store.loadSite();
    if (!store.site.allowRegistration) {
      showError('注册功能暂未开放');
      return;
    }

    const code = String(route.query.code || '').trim();
    if (!code) {
      // 未授权：拉取配置并跳转到熙熙授权
      const config = await api.getRegConfig();
      if (!config.authEndpoint || !config.clientId) {
        showError('注册服务尚未配置完成，请联系管理员');
        return;
      }
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('regOauthState', state);
      const url = `${config.authEndpoint}?response_type=code&client_id=${encodeURIComponent(config.clientId)}&redirect_uri=${encodeURIComponent(config.redirectUri)}&scope=profile&state=${encodeURIComponent(state)}`;
      window.location.href = url;
      return;
    }

    // 已回调：校验 state 防 CSRF
    const returnedState = String(route.query.state || '');
    const savedState = sessionStorage.getItem('regOauthState') || '';
    if (!returnedState || !savedState || returnedState !== savedState) {
      sessionStorage.removeItem('regOauthState');
      showError('state 校验失败，请重新发起授权');
      return;
    }
    sessionStorage.removeItem('regOauthState');

    // 换取用户信息
    const data = await api.regExchange(code);
    tempToken.value = data.tempToken;
    userInfo.value = data.userinfo;
    expectSub.value = String(data.userinfo?.sub || '');
    if (!expectSub.value) {
      showError('授权信息缺少唯一标识，请重新授权');
      return;
    }
    form.username = data.userinfo?.username || '';
    form.displayName = data.userinfo?.username || '';
    loading.value = false;
    ready.value = true;
  } catch (e) {
    showError(e.message || '加载失败');
  }
});

async function submit() {
  if (!form.username.trim()) { showError('用户名不能为空'); return; }
  if (form.password.length < 6) { showError('密码至少 6 位'); return; }
  submitting.value = true;
  error.value = '';
  try {
    const result = await api.regRegister({
      tempToken: tempToken.value,
      username: form.username.trim(),
      password: form.password,
      displayName: form.displayName.trim() || form.username.trim()
    });
    // 唯一标识核验：返回的 sub 必须与本次授权拿到的 sub 一致，防串号
    if (result && result.xiSub && expectSub.value && result.xiSub !== expectSub.value) {
      showError('账号身份核验失败（唯一标识不一致），请重新授权');
      return;
    }
    // 主站已按唯一标识(sub)签发会话，直接用 token 登录，不依赖可变账号名+密码
    if (result && result.token) {
      store.setToken(result.token);
      await store.initialize();
      router.push('/');
      return;
    }
    // 兼容兜底：老接口未返回 token 时用账号名+密码登录
    try {
      const sessionPayload = await api.login({ username: form.username.trim(), password: form.password });
      store.login(sessionPayload);
      router.push('/');
      return;
    } catch {
      // 自动登录失败则展示成功页，让用户手动登录
    }
    success.value = true;
    error.value = '';
  } catch (e) {
    showError(e.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="reg-page">
    <div class="reg-card">
      <img class="brand-logo" :src="store.site.siteIconUrl || '/logo.svg'" alt="logo" />
      <div class="brand">{{ store.site.siteName }}</div>
      <p class="subtitle">使用熙熙安全账号注册</p>

      <div v-if="loading" class="state">正在连接熙熙账号…</div>

      <template v-else-if="ready && !success">
        <div class="info-box">
          <strong>✅ 熙熙账号已验证</strong>
          <span v-if="expectSub">唯一标识：{{ expectSub.slice(0, 8) }}… · 改名或改邮箱不影响登录</span>
        </div>
        <label>细聊用户名<input v-model="form.username" placeholder="登录用的用户名" /></label>
        <label>设置密码（至少6位）<input v-model="form.password" type="password" placeholder="输入密码" /></label>
        <label>显示名称（选填）<input v-model="form.displayName" placeholder="在细聊中显示" /></label>
        <button class="primary-btn" :disabled="submitting" @click="submit">{{ submitting ? '注册中...' : '完成注册' }}</button>
      </template>

      <div v-else-if="success" class="success-box">
        <div class="success-icon">🎉</div>
        <strong>注册成功！</strong>
        <p>你的细聊号已自动生成，现在可以登录了。</p>
        <button class="primary-btn" @click="router.push('/login')">去登录</button>
      </div>

      <p v-if="error" class="error-box">{{ error }}</p>
      <button v-if="error && !ready" class="text-btn" @click="router.push('/login')">返回登录</button>
    </div>
  </div>
</template>

<style scoped>
.reg-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: linear-gradient(145deg, #eef7f1 0%, #e3ede8 100%); box-sizing: border-box; }
.reg-card { width: min(420px, 100%); background: #fff; border-radius: 20px; padding: 36px 32px; box-shadow: 0 16px 48px rgba(7,193,96,0.12); text-align: center; }
.brand-logo { width: 64px; height: 64px; border-radius: 14px; object-fit: contain; display: block; margin: 0 auto 12px; }
.brand { font-size: 24px; font-weight: 700; color: #191919; }
.subtitle { color: #888; font-size: 14px; margin: 8px 0 24px; }
.state { padding: 40px 0; color: #888; }
.info-box { background: #f4faf6; border-left: 3px solid #07c160; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px; text-align: left; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #333; }
.info-box span { color: #888; font-size: 12px; }
label { display: block; text-align: left; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 14px; }
label input { display: block; width: 100%; margin-top: 6px; padding: 11px 13px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; box-sizing: border-box; outline: none; }
label input:focus { border-color: #07c160; box-shadow: 0 0 0 3px rgba(7,193,96,0.1); }
.primary-btn { width: 100%; padding: 13px; border: none; border-radius: 24px; background: #07c160; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 6px; }
.primary-btn:disabled { opacity: 0.6; }
.success-box { padding: 16px 0; }
.success-icon { font-size: 48px; }
.success-box strong { display: block; font-size: 18px; margin: 8px 0; }
.success-box p { color: #888; font-size: 13px; margin-bottom: 20px; }
.error-box { background: #fdeaea; color: #c0392b; border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-top: 16px; }
.text-btn { margin-top: 14px; border: none; background: transparent; color: #576b95; font-size: 13px; cursor: pointer; }
</style>
