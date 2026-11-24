<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import UiAvatar from '../components/ui/Avatar.vue';

const route = useRoute();
const router = useRouter();
const token = computed(() => String(route.params.token || ''));
const session = computed(() => store.session);

const loading = ref(true);
const error = ref('');
const info = ref(null);
const joining = ref(false);
const joined = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    info.value = await api.getChannelInviteCode(token.value);
  } catch (e) {
    error.value = e.message || '群二维码无效';
  } finally {
    loading.value = false;
  }
}

async function join() {
  joining.value = true;
  error.value = '';
  try {
    await api.joinChannelByInviteCode(token.value);
    joined.value = true;
  } catch (e) {
    error.value = e.message || '加入群聊失败';
  } finally {
    joining.value = false;
  }
}

function goChat() {
  router.push('/');
}

onMounted(load);
</script>

<template>
  <div class="join-page">
    <div class="join-card">
      <img class="brand-logo" :src="store.site.siteIconUrl || '/logo.svg'" alt="logo" />
      <div class="brand">{{ store.site.siteName || '细聊' }}</div>

      <div v-if="loading" class="state">正在加载群信息…</div>

      <template v-else-if="joined">
        <div class="result-icon">✅</div>
        <h2>加入成功</h2>
        <p class="sub">你已成为「{{ info?.channel?.name }}」的成员</p>
        <button type="button" class="primary-btn" @click="goChat">进入细聊</button>
      </template>

      <template v-else-if="info && !error">
        <div class="group-preview">
          <UiAvatar :src="info.channel.avatarUrl" :fallback="info.channel.name?.[0] || '群'" size="lg" />
          <h2>{{ info.channel.name }}</h2>
          <p v-if="info.channel.description" class="desc">{{ info.channel.description }}</p>
          <p class="kind">{{ info.channel.kind === 'public' ? '公开群聊' : '私密群聊' }}</p>
        </div>
        <p v-if="!session" class="tip">请先登录细聊账号后加入群聊</p>
        <button v-else type="button" class="primary-btn" :disabled="joining" @click="join">
          {{ joining ? '加入中…' : '加入群聊' }}
        </button>
        <p class="expire">二维码有效期至 {{ new Date(info.expiresAt).toLocaleDateString() }}</p>
      </template>

      <template v-else>
        <div class="result-icon">⚠️</div>
        <h2>无法加入群聊</h2>
        <p class="sub">{{ error }}</p>
        <button type="button" class="primary-btn" @click="goChat">返回细聊</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.join-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: #ededed;
}
.join-card {
  width: min(400px, 100%);
  background: #fff;
  border-radius: 14px;
  padding: 36px 30px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
  text-align: center;
}
.brand-logo { width: 60px; height: 60px; border-radius: 14px; object-fit: contain; display: block; margin: 0 auto 10px; }
.brand { font-size: 20px; font-weight: 600; color: #191919; margin-bottom: 24px; }
.state { padding: 40px 0; color: #9a9a9a; font-size: 14px; }
.result-icon { font-size: 46px; }
h2 { font-size: 19px; color: #191919; margin: 10px 0; }
.sub, .desc { color: #888; font-size: 13px; margin: 8px 0; line-height: 1.6; }
.group-preview { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 22px; }
.kind { color: #07c160; font-size: 12px; }
.tip { color: #fa5151; font-size: 13px; margin: 12px 0; }
.expire { color: #b2b2b2; font-size: 11px; margin-top: 16px; }
.primary-btn { width: 100%; padding: 13px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 16px; cursor: pointer; margin-top: 8px; }
.primary-btn:disabled { opacity: 0.6; }
</style>
