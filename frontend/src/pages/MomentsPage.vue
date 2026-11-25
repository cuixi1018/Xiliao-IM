<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import UiAvatar from '../components/ui/Avatar.vue';
import WechatNav from '../components/WechatNav.vue';

const route = useRoute();
const router = useRouter();
const moments = ref([]);
const loading = ref(false);
const error = ref('');
const hasMore = ref(true);
// 查看指定用户的朋友圈（从个人主页进入）
const viewUserId = computed(() => Number(route.query.userId || 0));
const isViewingOther = computed(() => Boolean(viewUserId.value && viewUserId.value !== store.session?.userId));
const pageTitle = computed(() => isViewingOther.value ? 'TA的朋友圈' : '朋友圈');

// 表情
const showEmoji = ref(''); // '' | 'compose' | 'comment'
const emojis = ['😀','😃','😄','😁','😆','😂','🤣','😊','😍','🥰','😘','😋','😎','🥳','🤔','😭','😡','👍','👏','🙏','💪','🎉','❤️','🔥','✨','🌹','☕','🍺','💯','✅','👀','💡','⭐','🌈','🍀','🐶','🐱','🌸'];
function insertEmoji(emoji) {
  if (showEmoji.value === 'compose') composeText.value += emoji;
  else if (showEmoji.value === 'comment') commentText.value += emoji;
  showEmoji.value = '';
}

const composeOpen = ref(false);
const composeText = ref('');
const composeImages = ref([]); // { key, url }
const composeVisibility = ref('public'); // public | friends | private
const visibilityOptions = [
  { value: 'public', label: '公开（所有人可见）' },
  { value: 'friends', label: '仅好友可见' },
  { value: 'private', label: '仅自己可见（私密）' }
];
const publishing = ref(false);
const fileInput = ref(null);

const commentOpen = ref(null); // moment id
const commentText = ref('');
const replyTo = ref(null); // { userId, name }

function flash(text) {
  error.value = text;
  setTimeout(() => { error.value = ''; }, 3000);
}

async function load(reset = false) {
  if (loading.value) return;
  loading.value = true;
  try {
    const before = !reset && moments.value.length ? moments.value[moments.value.length - 1].id : null;
    const payload = await api.getMoments(before, viewUserId.value || null);
    const list = payload.moments || [];
    if (reset) moments.value = list;
    else moments.value = [...moments.value, ...list];
    hasMore.value = list.length > 0;
  } catch (e) {
    flash(e.message);
  } finally {
    loading.value = false;
  }
}

function openCompose() {
  composeOpen.value = true;
  composeText.value = '';
  composeImages.value = [];
  composeVisibility.value = 'public';
}

function pickImages() {
  fileInput.value?.click();
}

async function onFiles(event) {
  const files = Array.from(event.target.files || []).slice(0, 9 - composeImages.value.length);
  event.target.value = '';
  for (const file of files) {
    try {
      const upload = await api.uploadFile(file);
      composeImages.value.push({ key: upload.file.key, url: upload.file.url || `/files/${encodeURIComponent(upload.file.key)}` });
    } catch (e) {
      flash(e.message);
    }
  }
}

function removeImage(index) {
  composeImages.value.splice(index, 1);
}

async function publish() {
  if (!composeText.value.trim() && !composeImages.value.length) return;
  publishing.value = true;
  try {
    await api.createMoment({
      content: composeText.value.trim(),
      imageKeys: composeImages.value.map((i) => i.key),
      visibility: composeVisibility.value
    });
    composeOpen.value = false;
    await load(true);
  } catch (e) {
    flash(e.message);
  } finally {
    publishing.value = false;
  }
}

async function toggleLike(m) {
  try {
    await api.likeMoment(m.id, !m.likedByMe);
    if (m.likedByMe) {
      m.likes = m.likes.filter((l) => l.userId !== store.session.userId);
      m.likedByMe = false;
    } else {
      m.likes.push({ userId: store.session.userId, displayName: store.session.displayName });
      m.likedByMe = true;
    }
  } catch (e) { flash(e.message); }
}

function openComment(m, reply = null) {
  commentOpen.value = m.id;
  commentText.value = '';
  replyTo.value = reply;
}

async function postComment(m) {
  const text = commentText.value.trim();
  if (!text) return;
  try {
    const result = await api.commentMoment(m.id, {
      content: text,
      replyToUserId: replyTo.value?.userId || null
    });
    m.comments.push({
      id: result.id,
      userId: result.userId,
      authorName: result.authorName,
      replyToUserId: result.replyToUserId,
      replyName: replyTo.value?.name || '',
      content: result.content,
      createdAt: result.createdAt
    });
    commentText.value = '';
    replyTo.value = null;
    commentOpen.value = null;
  } catch (e) { flash(e.message); }
}

async function removeMoment(m) {
  if (!window.confirm('确定删除这条朋友圈吗？')) return;
  try {
    await api.deleteMoment(m.id);
    moments.value = moments.value.filter((x) => x.id !== m.id);
  } catch (e) { flash(e.message); }
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

onMounted(() => load(true));
</script>

<template>
  <div class="moments-layout">
    <WechatNav active="moments" />

    <main class="moments-main">
      <header class="moments-header">
        <h1>{{ pageTitle }}</h1>
        <button v-if="!isViewingOther" type="button" class="camera-btn" title="发布动态" @click="openCompose">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#191919" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </header>

      <div class="moments-scroll">
        <div v-if="!isViewingOther" class="moments-cover">
          <UiAvatar :src="store.session?.avatarUrl" :fallback="store.session?.displayName?.[0] || '我'" size="lg" />
          <div class="cover-name">{{ store.session?.displayName }}</div>
          <div class="cover-chatid">细聊号：{{ store.session?.chatId }}</div>
        </div>

        <p v-if="error" class="banner err">{{ error }}</p>

        <article v-for="m in moments" :key="m.id" class="moment">
          <UiAvatar :src="m.author.avatarUrl" :fallback="m.author.displayName?.[0] || '?'" size="sm" />
          <div class="moment-body">
            <div class="moment-author">{{ m.author.displayName }}</div>
            <p v-if="m.content" class="moment-content">{{ m.content }}</p>
            <div v-if="m.imageUrls?.length" class="moment-images" :class="`img-count-${Math.min(m.imageUrls.length, 4)}`">
              <img v-for="(url, i) in m.imageUrls" :key="i" :src="url" alt="动态图片" />
            </div>
            <div class="moment-meta">
              <span class="time">{{ formatTime(m.createdAt) }}</span>
              <button type="button" class="meta-action" @click="toggleLike(m)">
                {{ m.likedByMe ? '♥ 取消' : '♡ 赞' }}
              </button>
              <button type="button" class="meta-action" @click="openComment(m)">💬 评论</button>
              <button v-if="m.isMine" type="button" class="meta-action danger" @click="removeMoment(m)">删除</button>
            </div>

            <div v-if="m.likes?.length || m.comments?.length" class="moment-interactions">
              <div v-if="m.likes?.length" class="likes-row">
                <span class="heart">♥</span>
                <span v-for="l in m.likes" :key="l.userId" class="like-name">{{ l.displayName }}</span>
              </div>
              <div v-if="m.comments?.length" class="comments-row">
                <div v-for="cm in m.comments" :key="cm.id" class="comment-line">
                  <strong>{{ cm.authorName }}</strong><template v-if="cm.replyToUserId"> 回复 <strong>{{ cm.replyName }}</strong></template>：{{ cm.content }}
                </div>
              </div>
            </div>

            <div v-if="commentOpen === m.id" class="comment-editor-wrap">
              <div class="comment-editor">
                <span v-if="replyTo" class="reply-hint">回复 {{ replyTo.name }} <button @click="replyTo = null">✕</button></span>
                <input v-model="commentText" placeholder="说点什么..." @keyup.enter="postComment(m)" />
                <button type="button" class="emoji-trigger" @click="showEmoji = showEmoji === 'comment' ? '' : 'comment'">😊</button>
                <button type="button" @click="postComment(m)">发送</button>
              </div>
              <div v-if="showEmoji === 'comment'" class="emoji-panel inline">
                <button v-for="e in emojis" :key="e" type="button" @click="insertEmoji(e)">{{ e }}</button>
              </div>
            </div>
          </div>
        </article>

        <div v-if="!moments.length && !loading" class="empty-moments">还没有动态，点右上角相机发一条吧～</div>
        <button v-if="hasMore && moments.length" type="button" class="load-more" @click="load()">加载更多</button>
        <div v-if="loading" class="loading-hint">加载中...</div>
      </div>
    </main>

    <Transition name="fade">
      <div v-if="composeOpen" class="modal-overlay" @click.self="composeOpen = false">
        <div class="compose-modal">
          <div class="compose-head">
            <button type="button" @click="composeOpen = false">取消</button>
            <strong>发表朋友圈</strong>
            <button type="button" class="publish" :disabled="publishing" @click="publish">{{ publishing ? '发布中' : '发表' }}</button>
          </div>
          <textarea v-model="composeText" placeholder="这一刻的想法..." rows="5"></textarea>
          <div class="emoji-toolbar">
            <button type="button" @click="showEmoji = showEmoji === 'compose' ? '' : 'compose'">😊 表情</button>
            <div v-if="showEmoji === 'compose'" class="emoji-panel">
              <button v-for="e in emojis" :key="e" type="button" @click="insertEmoji(e)">{{ e }}</button>
            </div>
          </div>
          <div class="compose-images">
            <div v-for="(img, i) in composeImages" :key="i" class="compose-img">
              <img :src="img.url" alt="预览" />
              <button type="button" class="remove-img" @click="removeImage(i)">✕</button>
            </div>
            <button v-if="composeImages.length < 9" type="button" class="add-img" @click="pickImages">＋</button>
          </div>
          <input ref="fileInput" type="file" accept="image/*" multiple style="display:none" @change="onFiles" />
          <div class="visibility-picker">
            <span class="vp-label">谁可以看</span>
            <div class="vp-options">
              <button
                v-for="opt in visibilityOptions"
                :key="opt.value"
                type="button"
                class="vp-option"
                :class="{ active: composeVisibility === opt.value }"
                @click="composeVisibility = opt.value"
              >{{ opt.label }}</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.moments-layout { display: flex; height: 100vh; width: 100%; background: #fff; }
.moments-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.moments-header { flex-shrink: 0; height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #ededed; background: #fff; }
.moments-header h1 { margin: 0; font-size: 18px; color: #191919; }
.camera-btn { width: 38px; height: 38px; border: none; background: transparent; cursor: pointer; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
.camera-btn:hover { background: #f5f5f5; }
.moments-scroll { flex: 1; overflow-y: auto; background: #f5f5f5; }
.moments-cover { height: 240px; background: linear-gradient(135deg, #4a5c78, #2f3d52); display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-end; padding: 0 24px 18px; color: #fff; }
.moments-cover :deep(.ui-avatar) { margin-bottom: 8px; border: 3px solid #fff; border-radius: 8px; }
.cover-name { font-size: 17px; font-weight: 600; }
.cover-chatid { font-size: 12px; opacity: 0.8; }
.moment { display: flex; gap: 12px; padding: 18px 24px; background: #fff; border-bottom: 6px solid #f5f5f5; }
.moment-body { flex: 1; min-width: 0; }
.moment-author { color: #576b95; font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.moment-content { margin: 0 0 8px; font-size: 14px; line-height: 1.6; color: #191919; white-space: pre-wrap; }
.moment-images { display: grid; gap: 4px; margin-bottom: 8px; max-width: 360px; }
.moment-images.img-count-1 { grid-template-columns: 1fr; max-width: 220px; }
.moment-images.img-count-2, .moment-images.img-count-4 { grid-template-columns: repeat(2, 1fr); }
.moment-images.img-count-3, .moment-images.img-count-1 + * { grid-template-columns: repeat(3, 1fr); }
.moment-images img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; }
.moment-meta { display: flex; align-items: center; gap: 14px; }
.moment-meta .time { font-size: 11px; color: #b2b2b2; margin-right: auto; }
.meta-action { border: none; background: transparent; color: #576b95; font-size: 12px; cursor: pointer; padding: 2px; }
.meta-action.danger { color: #e74c3c; }
.moment-interactions { margin-top: 8px; background: #f7f7f7; border-radius: 6px; padding: 8px 10px; }
.likes-row { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 13px; color: #576b95; padding-bottom: 4px; border-bottom: 1px solid #ececec; }
.heart { color: #e74c3c; }
.comment-line { font-size: 13px; color: #333; line-height: 1.7; }
.comment-line strong { color: #576b95; font-weight: 600; }
.comment-editor { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.comment-editor input { flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; outline: none; }
.comment-editor button { border: none; background: #07c160; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.reply-hint { font-size: 12px; color: #888; }
.reply-hint button { background: transparent; color: #999; border: none; cursor: pointer; }
.banner { margin: 12px 24px 0; padding: 8px 12px; border-radius: 6px; font-size: 12px; }
.banner.err { background: #fdeaea; color: #c0392b; }
.empty-moments { padding: 60px 20px; text-align: center; color: #aaa; font-size: 14px; }
.load-more { display: block; margin: 16px auto; border: none; background: #fff; color: #576b95; padding: 8px 20px; border-radius: 16px; font-size: 13px; cursor: pointer; }
.loading-hint { text-align: center; padding: 16px; color: #aaa; font-size: 12px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.compose-modal { width: min(520px, 92vw); max-height: 88dvh; overflow-y: auto; -webkit-overflow-scrolling: touch; background: #fff; border-radius: 12px; padding: 16px; }
.visibility-picker { margin-top: 14px; border-top: 1px solid #f0f0f0; padding-top: 12px; }
.vp-label { display: block; font-size: 13px; color: #999; margin-bottom: 8px; }
.vp-options { display: flex; flex-wrap: wrap; gap: 8px; }
.vp-option { border: 1px solid #ddd; border-radius: 16px; padding: 6px 12px; background: #fff; color: #666; font-size: 12px; cursor: pointer; }
.vp-option.active { border-color: #07c160; background: #e7f8ee; color: #07c160; }
.compose-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.compose-head button { border: none; background: transparent; color: #576b95; font-size: 14px; cursor: pointer; }
.compose-head .publish { background: #07c160; color: #fff; padding: 6px 16px; border-radius: 6px; }
.compose-head .publish:disabled { opacity: 0.5; }
.compose-modal textarea { width: 100%; border: none; outline: none; resize: none; font-size: 15px; padding: 8px; box-sizing: border-box; }
.compose-images { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.compose-img { position: relative; }
.compose-img img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; }
.remove-img { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; border: none; background: rgba(0,0,0,0.6); color: #fff; font-size: 12px; cursor: pointer; }
.add-img { width: 80px; height: 80px; border: 1px dashed #ccc; border-radius: 6px; background: #fafafa; color: #999; font-size: 28px; cursor: pointer; }
.emoji-toolbar { position: relative; margin: 6px 0; }
.emoji-toolbar > button, .emoji-trigger { border: none; background: #f5f5f5; border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer; color: #555; }
.emoji-panel { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; max-height: 160px; overflow-y: auto; padding: 8px; border: 1px solid #e5e5e5; border-radius: 8px; margin-top: 6px; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
.emoji-panel.inline { max-width: 320px; }
.emoji-panel button { border: none; background: transparent; font-size: 19px; cursor: pointer; padding: 3px; border-radius: 5px; }
.emoji-panel button:hover { background: #f0f0f0; }
.comment-editor-wrap { position: relative; }
.fade-enter-active, .fade-leave-active { transition: opacity 200ms; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
