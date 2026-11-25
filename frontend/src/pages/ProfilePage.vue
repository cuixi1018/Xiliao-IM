<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import UiAvatar from '../components/ui/Avatar.vue';
import WechatNav from '../components/WechatNav.vue';

const route = useRoute();
const router = useRouter();
const session = computed(() => store.session);

const loading = ref(false);
const user = ref(null);
const error = ref('');
const info = ref('');
const note = ref('');
const submitting = ref(false);

const targetId = computed(() => Number(route.params.id));
const isSelf = computed(() => Boolean(user.value && session.value && Number(user.value.id) === Number(session.value.userId)));

function msg(text, type = 'info') {
  if (type === 'error') { error.value = text; info.value = ''; }
  else { info.value = text; error.value = ''; }
}

async function load() {
  if (!targetId.value) return;
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.getFriendDetail(targetId.value);
    user.value = payload.user || null;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.id, () => { load(); }, { immediate: true });

async function sendAdd() {
  if (!user.value) return;
  submitting.value = true;
  try {
    await api.addFriend({ userId: user.value.id, note: note.value.trim() });
    user.value.relationStatus = 'pending';
    user.value.relationDirection = 'outgoing';
    msg('好友申请已发送');
  } catch (e) {
    msg(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}

async function respond(accept) {
  if (!user.value?.relationRequestId) return;
  submitting.value = true;
  try {
    await api.respondFriend(user.value.relationRequestId, accept);
    msg(accept ? '已添加为好友' : '已拒绝申请');
    await load();
  } catch (e) {
    msg(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}

function copyChatId() {
  const id = user.value?.chatId;
  if (!id || typeof navigator === 'undefined' || !navigator.clipboard) return;
  navigator.clipboard.writeText(id).then(() => msg('已复制细聊号')).catch(() => msg('复制失败', 'error'));
}

async function chatWith() {
  if (!user.value) return;
  try {
    const dm = await api.openDm(user.value.id);
    sessionStorage.setItem('pendingDm', JSON.stringify(dm.dm));
    router.push('/');
  } catch (e) {
    msg(e.message, 'error');
  }
}

const genderLabel = computed(() => {
  const g = user.value?.gender;
  return g === 'male' ? '男' : g === 'female' ? '女' : '保密';
});
</script>

<template>
  <div class="profile-page">
    <header class="profile-header">
      <button type="button" class="back-btn" @click="router.back()" aria-label="返回">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <h1>个人主页</h1>
      <span class="header-placeholder"></span>
    </header>

    <div class="profile-body">
      <p v-if="error" class="profile-msg error">{{ error }}</p>
      <p v-if="info" class="profile-msg info">{{ info }}</p>

      <div v-if="loading" class="profile-loading">加载中…</div>

      <template v-else-if="user">
        <section class="profile-card">
          <div class="profile-avatar">
            <UiAvatar :src="user.avatarUrl" :fallback="(user.displayInGroup || user.displayName || '?')[0]" size="large" />
          </div>
          <div class="profile-name">{{ user.displayInGroup || user.displayName || user.username }}</div>
          <div class="profile-chatid">
            <span class="cid-label">细聊号</span>
            <span class="cid-value">{{ user.chatId || '未设置' }}</span>
            <button v-if="user.chatId" type="button" class="cid-copy" @click="copyChatId">复制</button>
          </div>
        </section>

        <section class="profile-section">
          <div class="profile-row"><span class="row-label">昵称</span><span class="row-value">{{ user.displayName || user.username }}</span></div>
          <div class="profile-row"><span class="row-label">性别</span><span class="row-value">{{ genderLabel }}</span></div>
          <div v-if="user.birthdate" class="profile-row"><span class="row-label">生日</span><span class="row-value">{{ user.birthdate }}</span></div>
          <div class="profile-row"><span class="row-label">个性签名</span><span class="row-value">{{ user.signature || '这个人很懒，什么都没留下' }}</span></div>
        </section>

        <section v-if="!isSelf" class="profile-actions">
          <template v-if="user.isFriend">
            <button type="button" class="btn-primary" @click="chatWith">发消息</button>
          </template>
          <template v-else-if="user.relationStatus === 'pending' && user.relationDirection === 'incoming'">
            <p class="action-hint">对方申请添加你为好友</p>
            <div class="btn-row">
              <button type="button" class="btn-secondary" :disabled="submitting" @click="respond(false)">拒绝</button>
              <button type="button" class="btn-primary" :disabled="submitting" @click="respond(true)">同意</button>
            </div>
          </template>
          <template v-else-if="user.relationStatus === 'pending' && user.relationDirection === 'outgoing'">
            <button type="button" class="btn-secondary" disabled>已发送申请，等待通过</button>
          </template>
          <template v-else-if="user.blockedByThem">
            <button type="button" class="btn-secondary" disabled>无法添加该用户</button>
          </template>
          <template v-else>
            <label class="note-field">
              <span>验证消息（可选）</span>
              <input v-model="note" type="text" maxlength="100" placeholder="我是…" />
            </label>
            <button type="button" class="btn-primary" :disabled="submitting" @click="sendAdd">
              {{ submitting ? '发送中' : '申请添加好友' }}
            </button>
          </template>
        </section>
      </template>
    </div>

    <WechatNav />
  </div>
</template>

<style scoped>
.profile-page { min-height: 100vh; padding-bottom: calc(64px + env(safe-area-inset-bottom)); background: #ededed; color: #191919; }
.profile-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 12px; background: #f7f7f7; border-bottom: 1px solid #e5e5e5; }
.profile-header h1 { margin: 0; font-size: 16px; font-weight: 600; }
.back-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: none; background: none; color: #191919; cursor: pointer; }
.header-placeholder { width: 36px; }
.profile-body { padding: 16px 14px; }
.profile-msg { margin: 0 0 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
.profile-msg.error { background: #ffecec; color: #c33; }
.profile-msg.info { background: #e7f8ee; color: #1a8f4b; }
.profile-loading { text-align: center; padding: 60px 0; color: #999; font-size: 14px; }
.profile-card { background: #fff; border-radius: 12px; padding: 24px 16px 20px; text-align: center; margin-bottom: 14px; }
.profile-avatar { display: flex; justify-content: center; margin-bottom: 14px; }
.profile-name { font-size: 19px; font-weight: 600; margin-bottom: 10px; }
.profile-chatid { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: #f5f5f5; border-radius: 16px; font-size: 12px; }
.cid-label { color: #999; }
.cid-value { color: #576b95; font-family: monospace; }
.cid-copy { border: none; background: #07c160; color: #fff; border-radius: 10px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.profile-section { background: #fff; border-radius: 12px; padding: 4px 16px; margin-bottom: 14px; }
.profile-row { display: flex; align-items: flex-start; gap: 12px; padding: 13px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
.profile-row:last-child { border-bottom: none; }
.row-label { flex: 0 0 72px; color: #999; }
.row-value { flex: 1; color: #191919; word-break: break-word; }
.profile-actions { background: #fff; border-radius: 12px; padding: 18px 16px; }
.note-field { display: block; margin-bottom: 14px; }
.note-field span { display: block; font-size: 12px; color: #999; margin-bottom: 6px; }
.note-field input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
.action-hint { text-align: center; color: #666; font-size: 13px; margin: 0 0 12px; }
.btn-row { display: flex; gap: 10px; }
.btn-primary, .btn-secondary { width: 100%; padding: 12px; border-radius: 8px; font-size: 15px; cursor: pointer; border: none; }
.btn-primary { background: #07c160; color: #fff; }
.btn-secondary { background: #f2f2f2; color: #555; }
.btn-primary:disabled, .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
@media (min-width: 768px) { .profile-page { max-width: 520px; margin: 0 auto; } }
</style>
