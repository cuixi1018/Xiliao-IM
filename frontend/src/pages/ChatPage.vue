<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import MessageAttachment from '../components/chat/MessageAttachment.vue';
import PendingAttachmentPreview from '../components/chat/PendingAttachmentPreview.vue';
import UiAvatar from '../components/ui/Avatar.vue';
import UiTextarea from '../components/ui/Textarea.vue';
import WechatNav from '../components/WechatNav.vue';
import QRCode from 'qrcode';
import api from '../api.js';
import { useActiveRoom } from '../composables/useActiveRoom.js';
import { useChatRoom } from '../composables/useChatRoom.js';
import { useChatSidebar } from '../composables/useChatSidebar.js';
import { useUnreadInbox } from '../composables/useUnreadInbox.js';
import store from '../store.js';

const router = useRouter();
const error = ref('');
const activeRoom = ref(null);
const session = computed(() => store.session);
const showAdminEntry = computed(() => Boolean(session.value?.isAdmin));

const { activeRoomKey, canManageActiveRoom, applyActiveChannel, selectDm, roomLabel } =
  useActiveRoom({ activeRoom, groupSettingsForm: reactive({ name: '', avatarUrl: '', avatarKey: '' }) });

const {
  channels, users, sidebarLoading, conversationItems, collapsedGroups, toggleGroupCollapsed, formatListTime,
  refreshSidebar, openConversation, markConversationRead, applyConversationActivity
} = useChatSidebar({ error, applyActiveChannel, selectDm });

const showCollapsed = ref(false);

const {
  messages, loading, wsStatus, composerText, composerQuote, pendingAttachment, sending,
  messagesEl, fileInputEl, formatTime, isOwnMessage, bubbleRowClass, bubbleClass,
  loadMessages, connectSocket, disconnectSocket, sendMessage, handleComposerKeydown,
  openFilePicker, uploadAttachment, clearAttachment, loadOlder,
  recallLocally, removeLocally
} = useChatRoom({
  activeRoom, channels, users, session, error, refreshSidebar,
  markConversationRead, applyConversationActivity, canManageActiveRoom,
  syncGroupSettingsForm: () => {}, groupSettingsForm: { name: '', avatarUrl: '', avatarKey: '' },
  returnToConversationList: () => {}
});

const { connectUnreadInbox, disconnectUnreadInbox } = useUnreadInbox({
  activeRoom,
  markConversationRead,
  applyConversationActivity
});

const wsConnected = computed(() => wsStatus.value === 'open');

// 移动端：从聊天窗口返回会话列表
function backToList() {
  disconnectSocket();
  activeRoom.value = null;
  messages.value = [];
}

const showCreateGroup = ref(false);
const createGroupForm = reactive({ name: '', memberIds: [] });
const creatingGroup = ref(false);
const friendUsers = ref([]); // 创建群聊时仅可选自己的好友

async function openCreateGroup() {
  // 仅拉取已成为好友的用户，避免把全站用户当可选成员
  try {
    const data = await api.getFriends();
    friendUsers.value = (data.friends || []).map((f) => ({
      id: f.id,
      displayName: f.remarkName || f.displayName || f.username,
      avatarUrl: f.avatarUrl || ''
    }));
  } catch {
    friendUsers.value = [];
  }
  showCreateGroup.value = true;
}
function closeCreateGroup() {
  showCreateGroup.value = false;
  createGroupForm.name = '';
  createGroupForm.memberIds = [];
}

function toggleMember(userId) {
  const idx = createGroupForm.memberIds.indexOf(userId);
  if (idx >= 0) createGroupForm.memberIds.splice(idx, 1);
  else createGroupForm.memberIds.push(userId);
}

async function createGroup() {
  if (!createGroupForm.name.trim()) return;
  creatingGroup.value = true;
  error.value = '';
  try {
    const payload = await api.createGroup({
      name: createGroupForm.name.trim(),
      kind: 'private',
      memberUserIds: createGroupForm.memberIds
    });
    await refreshSidebar();
    const newChannel = payload.channel;
    const item = conversationItems.value.find(c => c.id === newChannel.id);
    if (item) await selectConversation(item);
    closeCreateGroup();
  } catch (e) {
    error.value = e.message;
  } finally {
    creatingGroup.value = false;
  }
}

// ===== 侧边栏加号菜单：创建群聊 / 添加好友 =====
const plusMenuOpen = ref(false);
function togglePlusMenu() {
  plusMenuOpen.value = !plusMenuOpen.value;
}
function plusCreateGroup() {
  plusMenuOpen.value = false;
  openCreateGroup();
}
function plusAddFriend() {
  plusMenuOpen.value = false;
  addFriendChatId.value = '';
  showAddFriend.value = true;
}

const showAddFriend = ref(false);
const addFriendChatId = ref('');
const addFriendNote = ref('');
const addFriendSubmitting = ref(false);
async function submitAddFriend() {
  const chatId = addFriendChatId.value.trim();
  if (!chatId) { error.value = '请输入对方的细聊号'; return; }
  addFriendSubmitting.value = true;
  error.value = '';
  try {
    await api.addFriend({ chatId, note: addFriendNote.value.trim() });
    showAddFriend.value = false;
    addFriendChatId.value = '';
    addFriendNote.value = '';
    error.value = `已向细聊号 ${chatId} 发送好友请求`;
    window.setTimeout(() => { if (error.value.startsWith('已向细聊号')) error.value = ''; }, 2600);
    await refreshSidebar();
  } catch (e) {
    error.value = e.message;
  } finally {
    addFriendSubmitting.value = false;
  }
}

async function selectConversation(item) {
  await openConversation(item);
}

function logout() { store.logout(); router.push('/login'); }
function openAdmin() { router.push('/admin'); }

// ===== 消息操作菜单（右键 / 长按触发）=====
const msgMenu = reactive({ show: false, x: 0, y: 0, message: null });
let longPressTimer = null;

function canRecall(msg) {
  if (!isOwnMessage(msg) || msg.revokedAt) return false;
  const t = new Date(String(msg.createdAt).replace(' ', 'T') + (String(msg.createdAt).includes('Z') || String(msg.createdAt).includes('+') ? '' : 'Z')).getTime();
  return Date.now() - t <= 2 * 60 * 1000;
}
function canDelete(msg) {
  return isOwnMessage(msg) && !msg.revokedAt;
}
function canForward(msg) {
  // 语音消息不支持转发
  if (!msg || msg.revokedAt) return false;
  const att = msg.attachment;
  if (att && String(att.type || '').startsWith('audio/')) return false;
  return true;
}
function openMsgMenu(msg, event) {
  if (msg.kind === 'system') return;
  event.preventDefault();
  msgMenu.message = msg;
  msgMenu.x = event.clientX || 0;
  msgMenu.y = event.clientY || 0;
  // 防止菜单超出视口
  if (msgMenu.x > window.innerWidth - 190) msgMenu.x = window.innerWidth - 190;
  if (msgMenu.y > window.innerHeight - 220) msgMenu.y = window.innerHeight - 220;
  msgMenu.show = true;
}
function startLongPress(msg, event) {
  const touch = event.touches?.[0] || event;
  const x = touch.clientX, y = touch.clientY;
  longPressTimer = setTimeout(() => {
    openMsgMenu(msg, { preventDefault() {}, clientX: x, clientY: y });
  }, 550);
}
function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}
function closeMsgMenu() { msgMenu.show = false; msgMenu.message = null; }

async function doRecall() {
  const msg = msgMenu.message;
  closeMsgMenu();
  if (!msg) return;
  try {
    await api.recallMessage(msg.id);
    recallLocally(msg.id);
  } catch (e) { error.value = e.message; }
}
async function doDeleteMsg() {
  const msg = msgMenu.message;
  closeMsgMenu();
  if (!msg) return;
  if (!window.confirm('确定删除这条消息吗？仅对你自己生效。')) return;
  try {
    await api.deleteMessage(msg.id);
    removeLocally(msg.id);
  } catch (e) { error.value = e.message; }
}
function doQuote() {
  const msg = msgMenu.message;
  closeMsgMenu();
  if (!msg) return;
  const preview = msg.content || (msg.attachment ? (msg.attachment.name || '[附件]') : '[消息]');
  composerQuote.value = { id: msg.id, senderName: msg.sender.displayName, preview };
}
function cancelQuote() { composerQuote.value = null; }

// 转发弹窗
const forwardOpen = ref(false);
const forwardMsg = ref(null);
const forwardRooms = ref([]);
const forwardLoading = ref(false);
function openForward() {
  const msg = msgMenu.message;
  closeMsgMenu();
  if (!msg || !canForward(msg)) return;
  forwardMsg.value = msg;
  forwardRooms.value = conversationItems.value.slice();
  forwardOpen.value = true;
}
async function doForward(room) {
  if (!forwardMsg.value) return;
  forwardLoading.value = true;
  try {
    await api.forwardMessage(forwardMsg.value.id, room.kind, room.id);
    forwardOpen.value = false;
    forwardMsg.value = null;
    error.value = '';
  } catch (e) { error.value = e.message; }
  finally { forwardLoading.value = false; }
}

// ===== 全局搜索弹窗 =====
const searchOpen = ref(false);
const searchQuery = ref('');
const searchResults = ref({ users: [], messages: [] });
const searching = ref(false);
async function doGlobalSearch() {
  const q = searchQuery.value.trim();
  if (!q) { searchResults.value = { users: [], messages: [] }; return; }
  searching.value = true;
  try {
    searchResults.value = await api.globalSearch(q);
  } catch (e) { error.value = e.message; }
  finally { searching.value = false; }
}
function jumpToSearchMessage(m) {
  const item = conversationItems.value.find(c => c.id === m.room.id && c.kind === m.room.kind);
  searchOpen.value = false;
  if (item) {
    selectConversation(item);
  }
}
function addFromSearch(user) {
  sessionStorage.setItem('searchAddUser', JSON.stringify(user));
  searchOpen.value = false;
  router.push('/contacts');
}

// ===== 初次注册欢迎弹窗 =====
const showWelcome = ref(false);
const welcomeText = computed(() => `欢迎来到细聊，${session.value?.displayName || ''}！\n\n你已自动加入「细聊团队」官方群（细聊号 xlofficial），公告与新功能会第一时间发布。\n\n你的细聊号是 ${session.value?.chatId || ''}，别人可以用它搜索并添加你为好友。`);
async function checkWelcome() {
  if (session.value?.isNewUser) {
    showWelcome.value = true;
    try { await api.markWelcomeSeen(); } catch { /* ignore */ }
  }
}

// ===== 群管理弹窗 =====
const groupManageOpen = ref(false);
const groupManageLoading = ref(false);
const groupManage = reactive({ name: '', announcement: '', members: [], allFriends: [], addUserId: '' });
function canManageGroup() {
  return activeRoom.value && activeRoom.value.kind !== 'dm' && canManageActiveRoom.value;
}
function openGroupManage() {
  showMoreMenu.value = false;
  if (!canManageGroup()) return;
  groupManageOpen.value = true;
  reloadGroupManage();
}
async function reloadGroupManage() {
  groupManageLoading.value = true;
  try {
    const [roomData, friendsData] = await Promise.all([
      api.getChannelMembers(activeRoom.value.id),
      api.getFriends()
    ]);
    groupManage.name = roomData.room?.name || '';
    groupManage.announcement = roomData.room?.announcement || '';
    groupManage.members = roomData.members || [];
    groupManage.allFriends = friendsData.friends || [];
  } catch (e) { error.value = e.message; }
  finally { groupManageLoading.value = false; }
}
async function saveGroupName() {
  if (!groupManage.name.trim()) return;
  try {
    await api.updateChannel(activeRoom.value.id, { name: groupManage.name.trim() });
    activeRoom.value.name = groupManage.name.trim();
    error.value = '';
  } catch (e) { error.value = e.message; }
}
async function saveAnnouncement() {
  try {
    await api.setChannelAnnouncement(activeRoom.value.id, groupManage.announcement);
    error.value = '';
  } catch (e) { error.value = e.message; }
}
async function addGroupMember() {
  const uid = Number(groupManage.addUserId);
  if (!uid) return;
  try {
    await api.inviteChannelMembers(activeRoom.value.id, [uid]);
    groupManage.addUserId = '';
    await reloadGroupManage();
    await refreshSidebar();
    error.value = '';
  } catch (e) { error.value = e.message; }
}
async function kickMember(member) {
  if (!window.confirm(`确定将「${member.displayInGroup || member.displayName}」移出群聊吗？`)) return;
  try {
    await api.removeChannelMember(activeRoom.value.id, member.id);
    await reloadGroupManage();
    await refreshSidebar();
    error.value = '';
  } catch (e) { error.value = e.message; }
}
async function dissolveGroup() {
  if (!window.confirm('确定解散该群聊吗？此操作不可恢复。')) return;
  try {
    await api.deleteOwnedChannel(activeRoom.value.id);
    groupManageOpen.value = false;
    activeRoom.value = null;
    await refreshSidebar();
    error.value = '';
  } catch (e) { error.value = e.message; }
}

// ===== 群二维码（扫码进群，10 天有效）=====
const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const groupQrOpen = ref(false);
const groupQrDataUrl = ref('');
const groupQrInfo = ref(null);
const groupQrLoading = ref(false);
async function openGroupQr() {
  groupQrOpen.value = true;
  groupQrDataUrl.value = '';
  groupQrInfo.value = null;
  await generateGroupQr();
}
async function generateGroupQr() {
  if (!activeRoom.value) return;
  groupQrLoading.value = true;
  error.value = '';
  try {
    const data = await api.createChannelInviteCode(activeRoom.value.id);
    groupQrInfo.value = data;
    const url = `${window.location.origin}/join/${encodeURIComponent(data.token)}`;
    groupQrDataUrl.value = await QRCode.toDataURL(url, {
      width: 460, margin: 2, color: { dark: '#191919ff', light: '#ffffffff' }
    });
  } catch (e) { error.value = e.message; }
  finally { groupQrLoading.value = false; }
}
function copyGroupQrLink() {
  if (!groupQrInfo.value) return;
  const url = `${window.location.origin}/join/${encodeURIComponent(groupQrInfo.value.token)}`;
  navigator.clipboard?.writeText(url).then(() => {
    error.value = '群邀请链接已复制';
    window.setTimeout(() => { if (error.value === '群邀请链接已复制') error.value = ''; }, 1800);
  }).catch(() => { error.value = '复制失败，请手动复制下方链接'; });
}
function saveGroupQr() {
  if (!groupQrDataUrl.value) return;
  const a = document.createElement('a');
  a.href = groupQrDataUrl.value;
  a.download = `群二维码-${activeRoom.value?.name || '群聊'}.png`;
  a.click();
}

// ===== 投诉用户 =====
const complaintReasons = ['色情低俗', '诈骗或广告', '辱骂人身攻击', '骚扰他人', '发布违法信息', '其他'];
const complaintOpen = ref(false);
const complaintForm = reactive({ targetId: null, targetName: '', reason: '', detail: '' });
const complaintSubmitting = ref(false);
function openComplaint(targetId, targetName) {
  if (!targetId) return;
  closeMsgMenu();
  complaintForm.targetId = targetId;
  complaintForm.targetName = targetName || '该用户';
  complaintForm.reason = '';
  complaintForm.detail = '';
  error.value = '';
  complaintOpen.value = true;
}
async function submitComplaint() {
  if (!complaintForm.reason) { error.value = '请选择投诉原因'; return; }
  complaintSubmitting.value = true;
  error.value = '';
  try {
    await api.submitComplaint({
      targetId: complaintForm.targetId,
      reason: complaintForm.reason,
      detail: complaintForm.detail.trim()
    });
    complaintOpen.value = false;
    error.value = '投诉已提交，管理员会尽快处理';
    window.setTimeout(() => { if (error.value === '投诉已提交，管理员会尽快处理') error.value = ''; }, 2600);
  } catch (e) { error.value = e.message; }
  finally { complaintSubmitting.value = false; }
}
function complainMessageSender() {
  const msg = msgMenu.message;
  if (!msg?.sender?.id) return;
  openComplaint(msg.sender.id, msg.sender.displayName || msg.sender.username);
}

// 更多操作菜单
const showMoreMenu = ref(false);
async function leaveGroup() {
  if (!activeRoom.value || activeRoom.value.kind === 'dm') return;
  if (!window.confirm('确定退出该群聊吗？')) return;
  try {
    await api.leaveChannel(activeRoom.value.id);
    activeRoom.value = null;
    showMoreMenu.value = false;
    await refreshSidebar();
  } catch (e) { error.value = e.message; }
}
async function clearHistory() {
  if (!activeRoom.value) return;
  if (!window.confirm('确定清空你看到的聊天记录吗？这只影响你自己，不会删除对方的记录。')) return;
  try {
    await api.clearMessages(activeRoom.value.kind, activeRoom.value.id);
    messages.value = [];
    showMoreMenu.value = false;
    error.value = '';
    await refreshSidebar();
  } catch (e) { error.value = e.message; }
}

// 语音播放（全局单一 audio 元素）
const playingVoice = ref(null);
const voiceAudio = ref(null);
const voiceUrl = ref('');
function isVoice(att) {
  return Boolean(att && (att.type || '').startsWith('audio/'));
}
function toggleVoice(msg, event) {
  const el = voiceAudio.value;
  if (!el) return;
  if (playingVoice.value === msg.id) {
    el.pause();
    playingVoice.value = null;
    return;
  }
  voiceUrl.value = msg.attachment.url;
  nextTick(() => {
    const audio = voiceAudio.value;
    if (!audio) return;
    audio.src = msg.attachment.url;
    audio.play().then(() => { playingVoice.value = msg.id; }).catch(() => {});
    audio.onended = () => { playingVoice.value = null; };
  });
}

// 表情面板
const showEmojiPicker = ref(false);
const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😋','😛','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','👍','👎','👌','🤝','🙏','💪','👏','🎉','❤️','🔥','✨','🌹','☕','🍺','🚀','💯','✅','👀','💡','⭐','🌈','🍀'];
function insertEmoji(emoji) {
  composerText.value = (composerText.value || '') + emoji;
}

// 语音录制
const recording = ref(false);
let mediaRecorder = null;
let audioChunks = [];
const recordingSeconds = ref(0);
let recordTimer = null;
async function toggleRecording() {
  if (recording.value) { stopRecording(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!audioChunks.length) return;
      const blob = new Blob(audioChunks, { type: audioChunks[0].type || 'audio/webm' });
      const duration = Math.max(1, recordingSeconds.value);
      const ext = (blob.type.includes('mp4') ? 'm4a' : 'webm');
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
      try {
        const upload = await api.uploadFile(file);
        await api.sendMessageApi(activeRoom.value.kind, activeRoom.value.id, {
          attachment: {
            key: upload.file.key,
            name: `语音 ${duration}″`,
            type: blob.type || 'audio/webm',
            size: blob.size,
            duration
          }
        });
        await loadMessages();
      } catch (e) { error.value = e.message; }
    };
    mediaRecorder.start();
    recording.value = true;
    recordingSeconds.value = 0;
    recordTimer = setInterval(() => { recordingSeconds.value += 1; }, 1000);
  } catch (e) {
    error.value = '无法使用麦克风，请检查浏览器权限';
  }
}
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  recording.value = false;
  if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
}
onBeforeUnmount(() => { if (recordTimer) clearInterval(recordTimer); });

async function bootstrap() {
  error.value = '';
  try {
    await refreshSidebar();

    // 处理从通讯录点击好友发起的会话
    const pendingRaw = sessionStorage.getItem('pendingDm');
    if (pendingRaw) {
      sessionStorage.removeItem('pendingDm');
      try {
        const dm = JSON.parse(pendingRaw);
        const item = conversationItems.value.find((c) => c.kind === 'dm' && c.id === dm.id);
        if (item) await selectConversation(item);
        else if (dm.otherUser) {
          selectDm({ ...dm, name: dm.otherUser.displayName, otherUser: dm.otherUser });
        }
      } catch { /* ignore bad payload */ }
    }
  } catch (e) { error.value = e.message; }
}

watch(activeRoomKey, async (k) => {
  if (!k) return;
  await loadMessages();
  connectSocket();
  for (const delay of [0, 50, 150, 300]) {
    await new Promise(r => setTimeout(r, delay));
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  }
});
onMounted(() => {
  void bootstrap().then(connectUnreadInbox);
  checkWelcome();
});
// 把系统消息与普通消息分开，避免在模板的 v-for 元素上再用 v-if
// （v-for + v-if 同元素会被 Vue 编译优化提升，导致 msg 未定义的运行时错误 → 群聊蓝屏）
const systemMessages = computed(() => messages.value.filter((m) => m?.kind === 'system'));
const userMessages = computed(() => messages.value.filter((m) => m?.kind !== 'system'));

function formatBubbleTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

onBeforeUnmount(() => {
  disconnectUnreadInbox();
  disconnectSocket();
});
</script>

<template>
  <div class="chat-layout" :class="{ 'has-active-room': !!activeRoom }">
    <!-- Far-Left Navigation Sidebar -->
    <WechatNav active="chat" />

    <!-- Middle-Left Chat List Sidebar -->
    <aside class="left-sidebar">
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <h1 class="brand-title">Xiliao</h1>
          <button type="button" class="header-action" @click="searchOpen = !searchOpen" title="搜索">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <div class="plus-wrap">
            <button type="button" class="header-action" @click="togglePlusMenu" title="添加">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <div v-if="plusMenuOpen" class="plus-menu" @click.self="plusMenuOpen = false">
              <button type="button" class="plus-menu__item" @click="plusAddFriend">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="8" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                <span>添加好友</span>
              </button>
              <button type="button" class="plus-menu__item" @click="plusCreateGroup">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="18" cy="8" r="3"/><path d="M18 14a3 3 0 0 0 3 3"/></svg>
                <span>创建群聊</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="searchOpen" class="global-search-box">
          <div class="gs-input-row">
            <input v-model="searchQuery" placeholder="搜索聊天记录 / 细聊号加好友" @keyup.enter="doGlobalSearch" />
            <button type="button" @click="doGlobalSearch">{{ searching ? '...' : '搜索' }}</button>
          </div>
          <div class="gs-results">
            <template v-if="searchResults.users?.length">
              <div class="gs-section-title">用户</div>
              <button v-for="u in searchResults.users" :key="'u'+u.id" type="button" class="gs-row" @click="addFromSearch(u)">
                <UiAvatar :src="u.avatarUrl" :fallback="u.displayName?.[0] || '?'" size="sm" />
                <span class="gs-row-name">{{ u.displayName }}</span>
                <span class="gs-row-sub">{{ u.chatId }}</span>
              </button>
            </template>
            <template v-if="searchResults.messages?.length">
              <div class="gs-section-title">聊天记录</div>
              <button v-for="m in searchResults.messages" :key="'m'+m.id" type="button" class="gs-row gs-row--msg" @click="jumpToSearchMessage(m)">
                <span class="gs-row-name">{{ m.senderName }} · {{ m.room.name }}</span>
                <span class="gs-row-sub">{{ m.content || m.attachmentName }}</span>
              </button>
            </template>
            <p v-if="searchQuery && !searching && !searchResults.users?.length && !searchResults.messages?.length" class="gs-empty">没有找到结果</p>
          </div>
        </div>

        <div class="sidebar-divider"></div>

        <div class="sidebar-section sidebar-list">
          <div v-if="sidebarLoading" class="sidebar-hint">加载中...</div>
          <div v-else-if="!conversationItems.length && !collapsedGroups.length" class="sidebar-hint">暂无会话</div>

          <button v-if="collapsedGroups.length" type="button" class="sidebar-item collapsed-entry" @click="showCollapsed = !showCollapsed">
            <span class="collapsed-icon">📁</span>
            <div class="sidebar-label-group">
              <div class="sidebar-item__top"><strong class="sidebar-label">折叠的群聊</strong></div>
              <div class="sidebar-item__bottom"><p class="sidebar-label sidebar-item__preview">{{ collapsedGroups.length }} 个群聊 · {{ showCollapsed ? '点击收起' : '点击展开' }}</p></div>
            </div>
          </button>
          <template v-if="showCollapsed">
            <button
              type="button"
              v-for="g in collapsedGroups" :key="'col-'+g.id"
              class="sidebar-item sidebar-item--collapsed"
              @click="selectConversation({ key: `${g.kind}:${g.id}`, id: g.id, kind: g.kind, source: g })"
            >
              <UiAvatar :src="g.avatarUrl" :fallback="g.name?.[0] || '群'" size="sm" />
              <div class="sidebar-label-group">
                <div class="sidebar-item__top"><strong class="sidebar-label">{{ g.name }}</strong></div>
              </div>
              <span class="uncollapse-btn" title="取消折叠" @click.stop="toggleGroupCollapsed(g.id)">⊞</span>
            </button>
          </template>

          <button
            type="button"
            v-for="item in conversationItems" :key="item.key"
            class="sidebar-item" :class="{ 'sidebar-item--active': activeRoomKey === item.key }"
            @click="selectConversation(item)"
          >
            <UiAvatar :src="item.avatarUrl" :fallback="item.fallback?.[0] || '?'" size="sm" />
            <div class="sidebar-label-group">
              <div class="sidebar-item__top">
                <strong class="sidebar-label">{{ item.title }}</strong>
                <span class="sidebar-label sidebar-item__time">{{ formatListTime(item.lastMessageAt) }}</span>
              </div>
              <div class="sidebar-item__bottom">
                <p class="sidebar-label sidebar-item__preview">{{ item.subtitle }}</p>
                <span v-if="item.unreadCount > 0" class="sidebar-unread-badge">
                  {{ item.unreadCount > 99 ? '99+' : item.unreadCount }}
                </span>
              </div>
            </div>
            <span v-if="item.kind !== 'dm'" class="fold-btn" title="折叠群聊" @click.stop="toggleGroupCollapsed(item.id)">📁</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- Right Main Chat Window -->
    <main class="chat-main">
      <template v-if="activeRoom">
        <header class="chat-header">
          <button type="button" class="chat-back-btn" title="返回" @click="backToList">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>{{ roomLabel(activeRoom) }}</h2>
          <div class="chat-header__status" :class="wsConnected ? 'online' : 'offline'"></div>
          <button type="button" class="chat-header__more" title="更多" @click="showMoreMenu = !showMoreMenu">⋯</button>
          <div v-if="showMoreMenu" class="more-menu">
            <button v-if="canManageGroup()" type="button" @click="openGroupManage">群管理</button>
            <button v-if="activeRoom.kind !== 'dm'" type="button" @click="leaveGroup">退出群聊</button>
            <button type="button" @click="clearHistory">清空聊天记录</button>
          </div>
        </header>

        <section ref="messagesEl" class="chat-messages">
          <button v-if="messages.length" type="button" class="load-more-btn" @click="loadOlder">加载更早</button>
          <div v-if="loading" class="messages-hint">加载中...</div>
          <div v-else-if="!messages.length" class="messages-hint">暂无消息</div>

          <template v-for="msg in systemMessages" :key="'sys-'+msg.id">
            <div class="system-message">
              <span>{{ msg.content }}</span>
            </div>
          </template>
          <article
            v-for="msg in userMessages" :key="msg.id"
            class="message-row" :class="{ 'message-row--own': isOwnMessage(msg) }"
            @contextmenu="openMsgMenu(msg, $event)"
            @touchstart="startLongPress(msg, $event)"
            @touchend="cancelLongPress"
            @touchmove="cancelLongPress"
          >
            <div class="message-bubble" :class="bubbleClass(msg, 0)">
              <div v-if="activeRoom.kind !== 'dm' && !isOwnMessage(msg)" class="message-sender-name">
                {{ msg.sender.displayName }}
              </div>
              <div v-if="msg.quote" class="message-quote">
                <span class="quote-name">{{ msg.quote.senderName }}</span>
                <span class="quote-preview">{{ msg.quote.preview }}</span>
              </div>
              <p v-if="msg.content">{{ msg.content }}</p>
              <p v-else-if="msg.revokedAt" class="revoked-hint">消息已撤回</p>
              <div v-if="msg.attachment && isVoice(msg.attachment)" class="voice-bubble" @click="toggleVoice(msg)">
                <span class="voice-icon">{{ playingVoice === msg.id ? '⏸' : '▶' }}</span>
                <span class="voice-wave">🔊 语音 {{ msg.attachment.duration || '?' }}″</span>
              </div>
              <MessageAttachment v-else-if="msg.attachment" :attachment="msg.attachment" />
              <span class="message-time">{{ formatBubbleTime(msg.createdAt) }}</span>
            </div>
          </article>
        </section>

        <footer class="chat-composer">
          <div v-if="composerQuote" class="quote-bar">
            <div class="quote-bar-info">
              <span class="quote-bar-name">回复 {{ composerQuote.senderName }}</span>
              <span class="quote-bar-preview">{{ composerQuote.preview }}</span>
            </div>
            <button type="button" class="quote-bar-close" @click="cancelQuote">✕</button>
          </div>
          <div v-if="pendingAttachment" class="composer-attachment">
            <PendingAttachmentPreview :attachment="pendingAttachment" @clear="clearAttachment" />
          </div>
          <div v-if="error" class="composer-error">{{ error }}</div>
          <div v-if="showEmojiPicker" class="emoji-picker">
            <button v-for="e in emojis" :key="e" type="button" @click="insertEmoji(e)">{{ e }}</button>
          </div>
          <div v-if="recording" class="recording-bar">🔴 正在录音 {{ recordingSeconds }}″ <button type="button" @click="stopRecording">发送</button></div>
          <div class="composer-row">
            <input ref="fileInputEl" type="file" class="composer-file-input" @change="uploadAttachment" />
            <button type="button" class="composer-btn" :disabled="!activeRoom" @click="showEmojiPicker = !showEmojiPicker" title="表情">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </button>
            <button type="button" class="composer-btn" :disabled="!activeRoom" @click="toggleRecording" :title="recording ? '停止录音' : '语音消息'">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/></svg>
            </button>
            <button type="button" class="composer-btn" :disabled="!activeRoom" @click="openFilePicker" title="添加附件">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <UiTextarea
              v-model="composerText" class="composer-input" auto-grow :max-height="120" rows="1"
              :disabled="!activeRoom" placeholder="输入消息..." @keydown="handleComposerKeydown"
            />
            <button type="button" class="composer-send" :disabled="sending || !activeRoom" @click="sendMessage">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <title>发送</title>
                <line x1="4" y1="12" x2="20" y2="12"/>
                <polyline points="14 6 20 12 14 18"/>
              </svg>
            </button>
          </div>
        </footer>
      </template>

      <div v-else class="chat-empty">
        <div class="empty-content">
          <div class="empty-brand">
            <span class="empty-title">Xiliao</span>
          </div>
        </div>
      </div>
    </main>

    <Transition name="modal-fade">
      <div v-if="showCreateGroup" class="modal-overlay" @click.self="closeCreateGroup">
        <div class="modal-card">
          <h3>创建群聊</h3>
          <input
            v-model="createGroupForm.name"
            type="text"
            class="modal-input"
            placeholder="群聊名称"
          />
          <div class="modal-members">
            <label>选择成员</label>
            <div class="member-list">
              <button
                v-for="user in friendUsers" :key="user.id" type="button"
                class="member-chip"
                :class="{ 'member-chip--selected': createGroupForm.memberIds.includes(user.id) }"
                @click="toggleMember(user.id)"
              >
                <UiAvatar :src="user.avatarUrl" :fallback="user.displayName?.[0] || '?'" size="sm" />
                <span>{{ user.displayName }}</span>
              </button>
              <p v-if="!friendUsers.length" class="member-empty">你还没有好友，请先在通讯录添加好友后再创建群聊</p>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="closeCreateGroup">取消</button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!createGroupForm.name.trim() || creatingGroup"
              @click="createGroup"
            >
              {{ creatingGroup ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 添加好友弹窗（输入细聊号） -->
    <Transition name="modal-fade">
      <div v-if="showAddFriend" class="modal-overlay" @click.self="showAddFriend = false">
        <div class="modal-card">
          <h3>添加好友</h3>
          <p class="add-friend-hint">输入对方的细聊号，发送好友申请</p>
          <input
            v-model="addFriendChatId"
            type="text"
            class="modal-input"
            placeholder="请输入细聊号，例如 xlofficial"
            @keyup.enter="submitAddFriend"
          />
          <input
            v-model="addFriendNote"
            type="text"
            class="modal-input"
            placeholder="验证消息（选填）"
          />
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="showAddFriend = false">取消</button>
            <button
              type="button"
              class="btn-primary"
              :disabled="!addFriendChatId.trim() || addFriendSubmitting"
              @click="submitAddFriend"
            >
              {{ addFriendSubmitting ? '发送中...' : '发送申请' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 消息操作菜单：右键/长按触发 -->
    <div v-if="msgMenu.show" class="msg-context-menu" :style="{ left: msgMenu.x + 'px', top: msgMenu.y + 'px' }" @click.stop>
      <button v-if="canRecall(msgMenu.message)" type="button" @click="doRecall">↩️ 撤回</button>
      <button v-if="canDelete(msgMenu.message)" type="button" class="danger" @click="doDeleteMsg">🗑️ 删除</button>
      <button type="button" @click="doQuote">💬 引用</button>
      <button v-if="canForward(msgMenu.message)" type="button" @click="openForward">➡️ 转发</button>
      <button v-if="msgMenu.message?.sender?.id && msgMenu.message.sender.id !== session?.userId" type="button" class="danger" @click="complainMessageSender">⚠️ 投诉用户</button>
    </div>
    <div v-if="msgMenu.show" class="msg-menu-backdrop" @click="closeMsgMenu" @contextmenu.prevent="closeMsgMenu"></div>

    <!-- 转发弹窗 -->
    <Transition name="modal-fade">
      <div v-if="forwardOpen" class="modal-overlay" @click.self="forwardOpen = false">
        <div class="modal-card">
          <h3>转发到</h3>
          <div class="forward-list">
            <button v-for="room in forwardRooms" :key="room.key" type="button" class="forward-row" :disabled="forwardLoading" @click="doForward(room)">
              <UiAvatar :src="room.avatarUrl" :fallback="room.title?.[0] || '?'" size="sm" />
              <span>{{ room.title }}</span>
            </button>
            <p v-if="!forwardRooms.length" class="hint-text">暂无可转发的会话</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="forwardOpen = false">取消</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 群管理弹窗 -->
    <Transition name="modal-fade">
      <div v-if="groupManageOpen" class="modal-overlay" @click.self="groupManageOpen = false">
        <div class="modal-card group-manage-card">
          <h3>群管理</h3>
          <div v-if="groupManageLoading" class="hint-text">加载中...</div>
          <div v-else class="gm-body">
            <div class="gm-field">
              <label>群名称</label>
              <div class="gm-inline">
                <input v-model="groupManage.name" class="modal-input" />
                <button type="button" class="btn-secondary" @click="saveGroupName">保存</button>
              </div>
            </div>
            <div class="gm-field">
              <label>群公告</label>
              <textarea v-model="groupManage.announcement" rows="3" class="gm-textarea" placeholder="输入群公告，所有成员可见"></textarea>
              <button type="button" class="btn-secondary" @click="saveAnnouncement">发布公告</button>
            </div>
            <div class="gm-field">
              <label>添加成员（仅限你的好友）</label>
              <div class="gm-inline">
                <select v-model="groupManage.addUserId" class="gm-select">
                  <option value="">选择好友</option>
                  <option v-for="f in groupManage.allFriends" :key="f.id" :value="f.id">{{ f.displayName }}（{{ f.chatId }}）</option>
                </select>
                <button type="button" class="btn-primary" @click="addGroupMember">添加</button>
              </div>
              <button type="button" class="gm-qr-trigger" @click="openGroupQr">📱 群二维码 · 扫码进群（10天有效）</button>
            </div>
            <div class="gm-field">
              <label>群成员（{{ groupManage.members.length }}）</label>
              <div class="gm-members">
                <div v-for="m in groupManage.members" :key="m.id" class="gm-member">
                  <UiAvatar :src="m.avatarUrl" :fallback="(m.displayInGroup||m.displayName)?.[0] || '?'" size="sm" />
                  <span class="gm-member-name">{{ m.displayInGroup || m.displayName }}</span>
                  <span v-if="m.role === 'owner'" class="gm-owner-tag">群主</span>
                  <button v-if="m.id !== session?.userId" type="button" class="gm-report" @click="openComplaint(m.id, m.displayInGroup || m.displayName)">投诉</button>
                  <button v-if="m.role !== 'owner'" type="button" class="gm-kick" @click="kickMember(m)">移出</button>
                </div>
              </div>
            </div>
            <div class="gm-field gm-danger-zone">
              <button type="button" class="btn-danger" @click="dissolveGroup">解散群聊</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="groupManageOpen = false">关闭</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 群二维码弹窗 -->
    <Transition name="modal-fade">
      <div v-if="groupQrOpen" class="modal-overlay" @click.self="groupQrOpen = false">
        <div class="modal-card group-qr-card">
          <h3>群二维码</h3>
          <p class="add-friend-hint">好友扫码即可加入本群，有效期 10 天</p>
          <div v-if="groupQrLoading" class="hint-text">生成中…</div>
          <template v-else>
            <img v-if="groupQrDataUrl" :src="groupQrDataUrl" alt="群二维码" class="group-qr-img" />
            <p v-if="groupQrInfo" class="group-qr-expire">有效期至 {{ new Date(groupQrInfo.expiresAt).toLocaleString() }}</p>
            <p v-if="groupQrInfo" class="group-qr-link">{{ appOrigin }}/join/{{ groupQrInfo.token }}</p>
          </template>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="copyGroupQrLink">复制链接</button>
            <button type="button" class="btn-secondary" @click="saveGroupQr">保存图片</button>
            <button type="button" class="btn-secondary" @click="generateGroupQr">刷新</button>
            <button type="button" class="btn-primary" @click="groupQrOpen = false">关闭</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 投诉弹窗 -->
    <Transition name="modal-fade">
      <div v-if="complaintOpen" class="modal-overlay" @click.self="complaintOpen = false">
        <div class="modal-card">
          <h3>投诉用户</h3>
          <p class="add-friend-hint">投诉对象：{{ complaintForm.targetName }}</p>
          <select v-model="complaintForm.reason" class="modal-input">
            <option value="">请选择投诉原因</option>
            <option v-for="r in complaintReasons" :key="r" :value="r">{{ r }}</option>
          </select>
          <textarea v-model="complaintForm.detail" rows="3" class="gm-textarea" placeholder="补充说明（选填）"></textarea>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" @click="complaintOpen = false">取消</button>
            <button type="button" class="btn-primary" :disabled="complaintSubmitting" @click="submitComplaint">
              {{ complaintSubmitting ? '提交中…' : '提交投诉' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 初次注册欢迎弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showWelcome" class="modal-overlay" @click.self="showWelcome = false">
        <div class="modal-card welcome-card">
          <div class="welcome-logo">🎉</div>
          <h3>欢迎来到细聊</h3>
          <p class="welcome-text">{{ welcomeText }}</p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" @click="showWelcome = false">开始聊天</button>
          </div>
        </div>
      </div>
    </Transition>

    <audio ref="voiceAudio" style="display:none"></audio>
  </div>
</template>

<style scoped>
.chat-layout {
  display: flex;
  height: 100vh;
  background: #efeae2;
  width: 100%;
}

.left-sidebar {
  flex-shrink: 0;
  width: 350px;
  height: 100vh;
  position: relative;
  z-index: 10;
  overflow: hidden;
  background: #ffffff;
  border-right: 1px solid #e9edef;
}

.left-sidebar .sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  background: #ffffff;
}

.brand-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #008069;
  font-family: system-ui, -apple-system, sans-serif;
}

.header-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.header-action:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

/* 侧边栏加号下拉菜单 */
.plus-wrap {
  position: relative;
  display: flex;
}
.plus-menu {
  position: absolute;
  top: 42px;
  right: 0;
  width: 172px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(0, 0, 0, 0.06);
  padding: 6px;
  z-index: 60;
  animation: plusMenuIn 0.16s ease;
}
.plus-menu__item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #191919;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  transition: background 150ms;
}
.plus-menu__item svg { color: #008069; flex-shrink: 0; }
.plus-menu__item:hover { background: #f2f5f4; }
@keyframes plusMenuIn {
  from { opacity: 0; transform: translateY(-6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.add-friend-hint { margin: 0 0 10px; font-size: 13px; color: #888; }

.sidebar-section {
  flex-shrink: 0;
}

.sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
}

.sidebar-list::-webkit-scrollbar { width: 4px; }
.sidebar-list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 2px; }

.sidebar-divider {
  flex-shrink: 0;
  height: 1px;
  background: #f0f2f5;
}

.sidebar-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 8px;
  font-size: 13px;
  color: #8696a0;
}

.sidebar-item svg {
  flex-shrink: 0;
}

.sidebar-label-group {
  flex: 1;
  min-width: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.sidebar-item :deep(.ui-avatar) {
  flex-shrink: 0;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 16px);
  margin: 4px 8px;
  padding: 12px 16px;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 150ms;
}

.sidebar-item:hover {
  background: #f5f6f6;
}

.sidebar-item--active {
  background: #f0f2f5;
}

.sidebar-item__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.sidebar-item__top strong {
  font-size: 15px;
  font-weight: 500;
  color: #111b21;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item__time {
  font-size: 12px;
  color: #667781;
  flex-shrink: 0;
}

.sidebar-item__preview {
  margin: 0;
  font-size: 13px;
  color: #667781;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  min-width: 0;
}

.sidebar-unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #25d366;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.right-sidebar {
  flex-shrink: 0;
  width: 68px;
  height: 100vh;
  position: relative;
  z-index: 10;
  overflow: hidden;
  background: #f0f2f5;
  border-right: 1px solid #e9edef;
}

.right-sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #f0f2f5;
  padding: 16px 8px;
  align-items: center;
}

.right-sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  width: 100%;
}

.right-sidebar-user-group {
  margin-top: auto;
}

.right-sidebar-action,
.right-sidebar-user {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  transition: background 150ms, color 150ms, transform 150ms;
  padding: 0;
  position: relative;
}

.right-sidebar-action:hover,
.right-sidebar-user:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.right-sidebar-action--danger:hover {
  background: rgba(254, 242, 242, 0.8);
  color: #dc2626;
}

.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 120%;
  top: 50%;
  transform: translateY(-50%);
  background: #333;
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms ease;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tooltip:hover::after {
  opacity: 1;
  transform: translateY(-50%) translateX(4px);
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #efeae2;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 10px 16px;
  background: #f0f2f5;
  border-bottom: 1px solid #e9edef;
}

.chat-header h2 {
  margin: 0;
  padding: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111b21;
  background: transparent;
  border-radius: 0;
}

.chat-header__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
}

.chat-header__status.online {
  background: #10b981;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.chat-messages::-webkit-scrollbar { width: 6px; }
.chat-messages::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }

.load-more-btn {
  display: block;
  margin: 0 auto 16px;
  padding: 6px 16px;
  border: 1px solid #e8ecf0;
  border-radius: 16px;
  background: #fff;
  color: #54656f;
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}

.load-more-btn:hover {
  background: #f5f7fa;
  border-color: #d1d5db;
}

.messages-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: #8696a0;
  font-size: 14px;
}

.message-row {
  display: flex;
  margin-bottom: 12px;
  width: 100%;
  justify-content: flex-start;
}

.message-row--own {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 65%;
  padding: 6px 10px 20px 10px;
  border-radius: 8px;
  background: #ffffff;
  border: none;
  position: relative;
  word-break: break-word;
  box-shadow: 0 1px 0.5px rgba(11,20,26,.13);
}

.message-row--own .message-bubble {
  background: #d9fdd3;
}

.message-sender-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #008069;
  margin-bottom: 4px;
}

.message-time {
  position: absolute;
  bottom: 3px;
  right: 7px;
  font-size: 11px;
  color: #667781;
  user-select: none;
}

.message-bubble p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.45;
  color: #111b21;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-composer {
  margin-top: auto;
  margin-bottom: 0;
  padding: 10px 16px;
  background: #f0f2f5;
  border-top: 1px solid #e9edef;
  position: relative;
  z-index: 2;
  margin-left: 0;
  margin-right: 0;
  border-radius: 0;
}

.composer-attachment {
  margin-bottom: 10px;
}

.composer-error {
  margin-bottom: 8px;
  font-size: 12px;
  color: #dc2626;
  text-align: center;
}

.composer-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.composer-file-input {
  display: none;
}

.composer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 150ms, color 150ms;
}

.composer-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.composer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.composer-input {
  flex: 1;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
:deep(.composer-input.ui-textarea) {
  border: none;
  background: #ffffff;
  box-shadow: none;
  min-height: 40px;
  border-radius: 8px;
  padding: 10px 16px;
  color: #111b21;
  font-size: 15px;
  resize: none;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
:deep(.composer-input.ui-textarea:focus) {
  border-color: transparent;
  box-shadow: none;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
:deep(.composer-input.ui-textarea::placeholder) {
  color: #8696a0;
}

.composer-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 150ms;
}

.composer-send:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
}

.composer-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.3;
  user-select: none;
}

.empty-title {
  font-size: 28px;
  font-weight: 400;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-style: italic;
  letter-spacing: 0.02em;
  color: #111b21;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  z-index: 100;
}

.modal-card {
  width: 100%;
  max-width: 420px;
  padding: 24px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.modal-card h3 {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 600;
  color: #111b21;
}

.modal-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #e8ecf0;
  border-radius: 10px;
  background: #f9fafb;
  color: #111b21;
  font-size: 14px;
  outline: none;
  transition: border-color 150ms, box-shadow 150ms;
  margin-bottom: 16px;
}

.modal-input:focus {
  border-color: #008069;
  box-shadow: 0 0 0 3px rgba(0, 128, 105, 0.1);
  background: #fff;
}

.modal-input::placeholder {
  color: #8696a0;
}

.modal-members {
  margin-bottom: 20px;
}

.modal-members label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: #6b7c93;
}

.member-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 160px;
  overflow-y: auto;
  padding: 4px;
}

.member-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid #e8ecf0;
  border-radius: 20px;
  background: #fff;
  color: #111b21;
  font-size: 13px;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}

.member-chip:hover {
  background: #f5f7fa;
}

.member-chip--selected {
  background: #e8f0fe;
  border-color: #008069;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn-secondary {
  padding: 10px 20px;
  border: 1px solid #e8ecf0;
  border-radius: 10px;
  background: #fff;
  color: #6b7c93;
  font-size: 14px;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.btn-secondary:hover {
  background: #f5f7fa;
  color: #111b21;
}

.btn-primary {
  padding: 10px 24px;
  border: none;
  border-radius: 10px;
  background: #008069;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms;
}

.btn-primary:hover:not(:disabled) {
  background: #006e5a;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-fade-enter-active {
  transition: opacity 200ms;
}

.modal-fade-leave-active {
  transition: opacity 150ms;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* 微信风格新增组件 */
.chat-header__more { margin-left: auto; border: none; background: transparent; color: #54656f; font-size: 24px; line-height: 1; cursor: pointer; padding: 0 8px; }
.chat-header { position: relative; }
.more-menu { position: absolute; top: 44px; right: 12px; z-index: 15; background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); padding: 6px 0; min-width: 140px; }
.more-menu button { display: block; width: 100%; text-align: left; padding: 10px 16px; border: none; background: transparent; font-size: 13px; color: #333; cursor: pointer; }
.more-menu button:hover { background: #f5f5f5; }
.emoji-picker { display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px; max-height: 180px; overflow-y: auto; padding: 8px; background: #fff; border: 1px solid #e8ecf0; border-radius: 10px; margin-bottom: 8px; }
.emoji-picker button { border: none; background: transparent; font-size: 20px; cursor: pointer; padding: 4px; border-radius: 6px; }
.emoji-picker button:hover { background: #f0f2f5; }
.recording-bar { padding: 8px 12px; margin-bottom: 8px; background: #fdeaea; color: #c0392b; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 12px; }
.recording-bar button { margin-left: auto; padding: 4px 14px; border: none; border-radius: 6px; background: #07c160; color: #fff; cursor: pointer; }
.voice-bubble { display: flex; align-items: center; gap: 8px; min-width: 130px; padding: 4px 2px; cursor: pointer; }
.voice-icon { font-size: 16px; }
.voice-wave { font-size: 13px; color: #333; }
.collapsed-entry { background: #fafafa; }
.collapsed-icon { font-size: 20px; width: 40px; text-align: center; }
.sidebar-item--collapsed { opacity: 0.8; }
.uncollapse-btn, .fold-btn { flex-shrink: 0; font-size: 15px; color: #9aa5ad; padding: 4px; cursor: pointer; border-radius: 4px; }
.fold-btn { position: absolute; right: 8px; top: 8px; opacity: 0; transition: opacity 150ms; }
.sidebar-item { position: relative; }
.sidebar-item:hover .fold-btn { opacity: 1; }
.uncollapse-btn:hover, .fold-btn:hover { background: #e8ecf0; color: #008069; }

/* ===== 消息操作菜单 / 引用 / 系统消息 / 搜索 / 转发 / 欢迎 ===== */
.msg-menu-backdrop { position: fixed; inset: 0; z-index: 90; }
.msg-context-menu {
  position: fixed; z-index: 91; width: 180px; padding: 5px;
  background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.18);
  display: flex; flex-direction: column;
}
.msg-context-menu button {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border: none; background: transparent; border-radius: 6px; font-size: 14px;
  color: #191919; cursor: pointer; text-align: left;
}
.msg-context-menu button:hover { background: #f2f2f2; }
.msg-context-menu button.danger { color: #fa5151; }
.message-quote {
  display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; margin-bottom: 6px;
  background: rgba(0,0,0,0.05); border-left: 3px solid #07c160; border-radius: 4px;
  max-width: 260px;
}
.quote-name { font-size: 12px; font-weight: 600; color: #07c160; }
.quote-preview { font-size: 12px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.revoked-hint { font-size: 13px; color: #aaa; font-style: italic; }
.system-message { text-align: center; margin: 12px 0; }
.system-message span {
  display: inline-block; padding: 5px 12px; background: rgba(0,0,0,0.05);
  color: #999; font-size: 12px; border-radius: 12px; max-width: 80%;
}
.quote-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; background: #f7f7f7; border-radius: 8px 8px 0 0; border-bottom: 1px solid #e5e5e5;
}
.quote-bar-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.quote-bar-name { font-size: 12px; font-weight: 600; color: #07c160; }
.quote-bar-preview { font-size: 12px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quote-bar-close { border: none; background: transparent; color: #999; cursor: pointer; font-size: 14px; }
.global-search-box { padding: 8px 12px; border-bottom: 1px solid #eee; background: #fafafa; }
.gs-input-row { display: flex; gap: 6px; }
.gs-input-row input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; outline: none; }
.gs-input-row input:focus { border-color: #07c160; }
.gs-input-row button { padding: 8px 12px; border: none; border-radius: 8px; background: #07c160; color: #fff; font-size: 13px; cursor: pointer; }
.gs-results { max-height: 320px; overflow-y: auto; margin-top: 8px; }
.gs-section-title { padding: 6px 4px; font-size: 11px; color: #aaa; }
.gs-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 6px; border: none; background: transparent; cursor: pointer; border-radius: 6px; text-align: left; }
.gs-row:hover { background: #f0f0f0; }
.gs-row-name { font-size: 13px; color: #191919; font-weight: 500; }
.gs-row-sub { font-size: 11px; color: #999; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.gs-row--msg { flex-direction: column; align-items: flex-start; gap: 2px; }
.gs-row--msg .gs-row-sub { margin-left: 0; max-width: 100%; }
.gs-empty { padding: 16px 4px; text-align: center; color: #aaa; font-size: 12px; }
.forward-list { max-height: 320px; overflow-y: auto; margin: 8px 0; }
.forward-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px; border: none; background: transparent; cursor: pointer; border-radius: 8px; font-size: 14px; }
.forward-row:hover { background: #f2f2f2; }
.hint-text { padding: 16px; text-align: center; color: #aaa; font-size: 13px; }
.welcome-card { text-align: center; }
.welcome-logo { font-size: 48px; margin-bottom: 8px; }
.welcome-text { white-space: pre-wrap; text-align: left; font-size: 13px; line-height: 1.8; color: #555; background: #f7f7f7; padding: 14px; border-radius: 10px; }
.group-manage-card { width: 520px; max-width: 92vw; }
.gm-body { display: flex; flex-direction: column; gap: 16px; margin: 12px 0; max-height: 60vh; overflow-y: auto; }
.gm-field { display: flex; flex-direction: column; gap: 6px; }
.gm-field > label { font-size: 12px; font-weight: 600; color: #666; }
.gm-inline { display: flex; gap: 8px; }
.gm-inline .modal-input, .gm-inline .gm-select { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; }
.gm-textarea { padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; resize: vertical; font-family: inherit; }
.gm-members { max-height: 180px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; }
.gm-member { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #f4f4f4; }
.gm-member:last-child { border-bottom: none; }
.gm-member-name { flex: 1; font-size: 13px; color: #191919; }
.gm-owner-tag { font-size: 11px; color: #07c160; background: #eaf8ef; padding: 2px 8px; border-radius: 10px; }
.gm-kick { border: none; background: transparent; color: #fa5151; font-size: 12px; cursor: pointer; }
.gm-report { border: none; background: transparent; color: #e6a23c; font-size: 12px; cursor: pointer; }
.gm-qr-trigger { margin-top: 6px; padding: 9px 12px; border: 1px solid #07c160; border-radius: 8px; background: #f0faf4; color: #07c160; font-size: 13px; cursor: pointer; }
.gm-qr-trigger:hover { background: #e4f7ec; }
.group-qr-card { width: 420px; max-width: 92vw; }
.group-qr-img { display: block; width: 240px; height: 240px; margin: 8px auto; }
.group-qr-expire { text-align: center; font-size: 12px; color: #888; margin-top: 4px; }
.group-qr-link { text-align: center; font-size: 11px; color: #576b95; word-break: break-all; margin-top: 8px; }
.group-qr-card .modal-actions { flex-wrap: wrap; }
.gm-danger-zone { border-top: 1px solid #f0f0f0; padding-top: 12px; }
.btn-danger { padding: 8px 16px; border: none; border-radius: 8px; background: #fa5151; color: #fff; font-size: 13px; cursor: pointer; }

/* 返回按钮：默认隐藏，移动端显示 */
.chat-back-btn {
  display: none;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin-left: -6px;
  padding: 0;
  border: none;
  background: transparent;
  color: #576b75;
  cursor: pointer;
}

@media (max-width: 768px) {
  /* 移动端改为微信式单栏：会话列表 / 聊天窗口二选一 */
  .chat-layout {
    width: 100vw;
    overflow: hidden;
  }
  .wx-nav {
    display: none;
  }
  .left-sidebar {
    width: 100%;
    flex-basis: 100%;
    border-right: none;
  }
  .right-sidebar {
    display: none;
  }
  .chat-main {
    display: none;
    width: 100%;
  }
  /* 打开会话后：隐藏列表，显示聊天窗口 */
  .chat-layout.has-active-room .left-sidebar {
    display: none;
  }
  .chat-layout.has-active-room .chat-main {
    display: flex;
  }
  .chat-back-btn {
    display: flex;
  }
  .chat-header h2 {
    font-size: 16px;
  }
  /* 移动端消息区占满，避免被挤压导致白屏 */
  .chat-messages {
    min-height: 0;
    flex: 1;
  }
}
</style>
