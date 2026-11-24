<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import UiAvatar from '../components/ui/Avatar.vue';
import UiButton from '../components/ui/Button.vue';
import WechatNav from '../components/WechatNav.vue';

const router = useRouter();
const loading = ref(false);
const friends = ref([]);
const incoming = ref([]);
const outgoing = ref([]);
const blacklist = ref([]);
const error = ref('');
const info = ref('');

const tab = ref('friends'); // friends | adds | blacklist
const searchOpen = ref(false);
const keyword = ref('');
const searchResults = ref([]);
const searching = ref(false);
const addForm = reactive({ targetUserId: null, note: '' });

const friendCount = computed(() => friends.value.length);
const addCount = computed(() => incoming.value.length);

function msg(text, type = 'info') {
  if (type === 'error') { error.value = text; info.value = ''; }
  else { info.value = text; error.value = ''; }
  setTimeout(() => { info.value = ''; error.value = ''; }, 3000);
}

async function load() {
  loading.value = true;
  try {
    const [f, b] = await Promise.all([api.getFriends(), api.getBlacklist()]);
    friends.value = f.friends || [];
    incoming.value = f.incoming || [];
    outgoing.value = f.outgoing || [];
    blacklist.value = b.users || [];
  } catch (e) {
    msg(e.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function doSearch() {
  const kw = keyword.value.trim();
  if (!kw) { searchResults.value = []; return; }
  searching.value = true;
  try {
    const payload = await api.searchUsers(kw);
    searchResults.value = payload.users || [];
  } catch (e) {
    msg(e.message, 'error');
  } finally {
    searching.value = false;
  }
}

async function sendAdd(user) {
  try {
    await api.addFriend({ userId: user.id, note: addForm.note });
    user.relationStatus = 'pending';
    user.relationDirection = 'outgoing';
    msg('好友申请已发送');
    await load();
  } catch (e) {
    msg(e.message, 'error');
  }
}

async function respond(req, accept) {
  try {
    await api.respondFriend(req.requestId, accept);
    msg(accept ? '已添加为好友' : '已忽略申请');
    await load();
  } catch (e) {
    msg(e.message, 'error');
  }
}

async function removeFriend(user) {
  if (!window.confirm(`确定删除好友「${user.displayName}」吗？`)) return;
  try {
    await api.removeFriend(user.id);
    msg('已删除好友');
    await load();
  } catch (e) { msg(e.message, 'error'); }
}

async function block(user) {
  if (!window.confirm(`确定拉黑「${user.displayName}」吗？`)) return;
  try {
    await api.blockUser(user.id);
    msg('已加入黑名单');
    await load();
  } catch (e) { msg(e.message, 'error'); }
}

async function unblock(user) {
  try {
    await api.unblockUser(user.id);
    msg('已解除拉黑');
    await load();
  } catch (e) { msg(e.message, 'error'); }
}

async function chatWith(user) {
  try {
    const dm = await api.openDm(user.id);
    sessionStorage.setItem('pendingDm', JSON.stringify(dm.dm));
    router.push('/');
  } catch (e) { msg(e.message, 'error'); }
}

onMounted(load);
</script>

<template>
  <div class="contacts-layout">
    <WechatNav active="contacts" />

    <aside class="contacts-panel">
      <div class="panel-head">
        <h1>通讯录</h1>
        <button type="button" class="add-btn" title="添加朋友" @click="searchOpen = !searchOpen">＋</button>
      </div>

      <div v-if="searchOpen" class="search-box">
        <input v-model="keyword" placeholder="输入细聊号 / 用户名搜索" @keyup.enter="doSearch" />
        <button type="button" @click="doSearch">{{ searching ? '搜索中' : '搜索' }}</button>
        <input v-model="addForm.note" class="note-input" placeholder="验证消息（选填）" />
        <div v-if="searchResults.length" class="search-results">
          <div v-for="u in searchResults" :key="u.id" class="search-row">
            <UiAvatar :src="u.avatarUrl" :fallback="u.displayName?.[0] || '?'" size="sm" />
            <div class="row-main">
              <strong>{{ u.displayName }}</strong>
              <small>细聊号：{{ u.chatId }}</small>
            </div>
            <button
              v-if="!u.isFriend && u.relationStatus !== 'pending'"
              type="button" class="mini-btn" @click="sendAdd(u)"
            >添加</button>
            <span v-else-if="u.isFriend" class="tag">已是好友</span>
            <span v-else-if="u.relationStatus === 'pending'" class="tag">已发送</span>
          </div>
        </div>
        <p v-else-if="keyword && !searching" class="hint">没有找到匹配的用户</p>
      </div>

      <div class="tabs">
        <button :class="{ active: tab === 'friends' }" @click="tab = 'friends'">好友 ({{ friendCount }})</button>
        <button :class="{ active: tab === 'adds' }" @click="tab = 'adds'">新的朋友 <span v-if="addCount" class="dot">{{ addCount }}</span></button>
        <button :class="{ active: tab === 'blacklist' }" @click="tab = 'blacklist'">黑名单</button>
      </div>

      <p v-if="info" class="banner ok">{{ info }}</p>
      <p v-if="error" class="banner err">{{ error }}</p>

      <div class="list">
        <div v-if="loading" class="hint">加载中...</div>

        <template v-if="tab === 'friends'">
          <div v-if="!friends.length && !loading" class="hint">还没有好友，点右上角 ＋ 按细聊号添加吧</div>
          <div v-for="f in friends" :key="f.id" class="person-row" @click="chatWith(f)">
            <UiAvatar :src="f.avatarUrl" :fallback="f.displayName?.[0] || '?'" size="sm" />
            <div class="row-main">
              <strong>{{ f.displayName }}</strong>
              <small>细聊号：{{ f.chatId }}</small>
            </div>
            <button type="button" class="row-action" title="删除好友" @click.stop="removeFriend(f)">删除</button>
            <button type="button" class="row-action danger" title="拉黑" @click.stop="block(f)">拉黑</button>
          </div>
        </template>

        <template v-else-if="tab === 'adds'">
          <div class="section-title">待处理申请</div>
          <div v-if="!incoming.length" class="hint">暂无新的好友申请</div>
          <div v-for="r in incoming" :key="r.requestId" class="person-row">
            <UiAvatar :src="r.avatarUrl" :fallback="r.displayName?.[0] || '?'" size="sm" />
            <div class="row-main">
              <strong>{{ r.displayName }}</strong>
              <small>{{ r.note || '申请添加你为好友' }}</small>
            </div>
            <button type="button" class="mini-btn primary" @click="respond(r, true)">接受</button>
            <button type="button" class="mini-btn" @click="respond(r, false)">忽略</button>
          </div>
          <div class="section-title">已发送</div>
          <div v-if="!outgoing.length" class="hint">暂无已发送的申请</div>
          <div v-for="r in outgoing" :key="r.requestId" class="person-row">
            <UiAvatar :src="r.avatarUrl" :fallback="r.displayName?.[0] || '?'" size="sm" />
            <div class="row-main"><strong>{{ r.displayName }}</strong><small>等待对方确认</small></div>
            <span class="tag">待通过</span>
          </div>
        </template>

        <template v-else>
          <div v-if="!blacklist.length" class="hint">黑名单为空</div>
          <div v-for="u in blacklist" :key="u.id" class="person-row">
            <UiAvatar :src="u.avatarUrl" :fallback="u.displayName?.[0] || '?'" size="sm" />
            <div class="row-main"><strong>{{ u.displayName }}</strong><small>细聊号：{{ u.chatId }}</small></div>
            <button type="button" class="mini-btn" @click="unblock(u)">解除</button>
          </div>
        </template>
      </div>
    </aside>

    <main class="contacts-empty">
      <div class="empty-card">
        <div class="empty-icon">💬</div>
        <h2>细聊 · 通讯录</h2>
        <p>通过细聊号添加好友，和微信一样自然地聊天、建群、发朋友圈。</p>
        <UiButton @click="router.push('/')">去聊天</UiButton>
      </div>
    </main>
  </div>
</template>

<style scoped>
.contacts-layout { display: flex; height: 100vh; width: 100%; background: #f5f5f5; }
.contacts-panel { flex-shrink: 0; width: 360px; display: flex; flex-direction: column; background: #fff; border-right: 1px solid #e7e7e7; }
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 12px; }
.panel-head h1 { margin: 0; font-size: 20px; color: #191919; }
.add-btn { width: 32px; height: 32px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
.search-box { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid #f0f0f0; }
.search-box > input:first-child { flex: 1; }
.search-box input { padding: 9px 12px; border: 1px solid #e2e2e2; border-radius: 8px; font-size: 13px; outline: none; }
.search-box input:focus { border-color: #07c160; }
.search-box button { padding: 9px 14px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 13px; cursor: pointer; }
.search-box .note-input { background: #fafafa; }
.search-results { max-height: 240px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; }
.search-row, .person-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.search-row { border-bottom: 1px solid #f4f4f4; }
.row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.row-main strong { font-size: 14px; color: #191919; }
.row-main small { font-size: 11px; color: #9a9a9a; }
.tabs { display: flex; border-bottom: 1px solid #eee; }
.tabs button { flex: 1; padding: 12px 0; border: none; background: transparent; font-size: 12px; color: #7a7a7a; cursor: pointer; position: relative; }
.tabs button.active { color: #07c160; font-weight: 600; }
.tabs button.active::after { content: ''; position: absolute; left: 25%; right: 25%; bottom: 0; height: 2px; background: #07c160; }
.dot { display: inline-block; min-width: 16px; height: 16px; line-height: 16px; border-radius: 8px; background: #fa5151; color: #fff; font-size: 10px; }
.list { flex: 1; overflow-y: auto; }
.person-row { cursor: pointer; border-bottom: 1px solid #f6f6f6; }
.person-row:hover { background: #fafafa; }
.section-title { padding: 10px 14px; font-size: 12px; color: #9a9a9a; background: #f7f7f7; }
.hint { padding: 24px 16px; text-align: center; color: #aaa; font-size: 13px; }
.banner { margin: 8px 16px 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; }
.banner.ok { background: #eaf8ef; color: #1a7f43; }
.banner.err { background: #fdeaea; color: #c0392b; }
.mini-btn { padding: 5px 10px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #555; font-size: 12px; cursor: pointer; white-space: nowrap; }
.mini-btn.primary { background: #07c160; border-color: #07c160; color: #fff; }
.row-action { border: none; background: transparent; color: #9a9a9a; font-size: 12px; cursor: pointer; padding: 4px; }
.row-action.danger { color: #e74c3c; }
.tag { font-size: 11px; color: #9a9a9a; white-space: nowrap; }
.contacts-empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-card { text-align: center; color: #888; max-width: 360px; }
.empty-icon { font-size: 56px; margin-bottom: 12px; }
.empty-card h2 { font-size: 20px; color: #333; margin: 0 0 10px; }
.empty-card p { font-size: 14px; line-height: 1.6; margin-bottom: 20px; }
</style>
