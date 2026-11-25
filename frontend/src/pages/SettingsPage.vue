<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import { clearStoredToken } from '../auth-storage.js';
import UiAvatar from '../components/ui/Avatar.vue';
import QRCode from 'qrcode';

const router = useRouter();
const session = computed(() => store.session);
const showAdminEntry = computed(() => Boolean(session.value?.isAdmin));

const profileForm = reactive({
  displayName: session.value?.displayName || '',
  signature: session.value?.signature || '',
  gender: session.value?.gender || 'secret',
  birthdate: session.value?.birthdate || '',
  customBackground: localStorage.getItem('customBackground') || ''
});
const passwordForm = reactive({
  currentPassword: '',
  newPassword: ''
});

const copied = ref(false);
function copyChatId() {
  const id = session.value?.chatId || '';
  if (!id) return;
  navigator.clipboard?.writeText(id).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }).catch(() => {});
}

// ===== 个人二维码 =====
const qrOpen = ref(false);
const qrDataUrl = ref('');
async function openQr() {
  const chatId = session.value?.chatId || '';
  if (!chatId) return;
  try {
    qrDataUrl.value = await QRCode.toDataURL(chatId, {
      width: 480, margin: 2, color: { dark: '#191919ff', light: '#ffffffff' }
    });
    qrOpen.value = true;
  } catch { error.value = '二维码生成失败'; }
}
function saveQr() {
  if (!qrDataUrl.value) return;
  const a = document.createElement('a');
  a.href = qrDataUrl.value;
  a.download = `细聊-${session.value?.chatId || 'qr'}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== 修改细聊号 =====
const chatIdForm = reactive({ value: '' });
const changingChatId = ref(false);
const showChatIdDialog = ref(false);
function openChangeChatId() {
  chatIdForm.value = session.value?.chatId || '';
  showChatIdDialog.value = true;
}
async function changeChatId() {
  changingChatId.value = true;
  clearMessage();
  try {
    const data = await api.updateChatId(chatIdForm.value.trim().toLowerCase());
    const next = await api.session();
    store.setSession(next.session);
    showChatIdDialog.value = false;
    info.value = '细聊号已修改';
  } catch (e) {
    error.value = e.message;
  } finally {
    changingChatId.value = false;
  }
}

const info = ref('');
const error = ref('');
const savingProfile = ref(false);
const savingPassword = ref(false);
const uploadingAvatar = ref(false);
const avatarInputEl = ref(null);

const showCropper = ref(false);
const cropperCanvas = ref(null);
const cropZoom = ref(1);
const cropFile = ref(null);
const cropImageUrl = ref('');
const cropImage = ref(null);
const cropOffset = reactive({ x: 0, y: 0 });
const cropDragging = ref(false);
const cropDragStart = reactive({ x: 0, y: 0 });
const cropOffsetStart = reactive({ x: 0, y: 0 });

const CANVAS_SIZE = 280;
const CROP_SIZE = 240;

function clearMessage() {
  info.value = '';
  error.value = '';
}

async function saveProfile() {
  clearMessage();
  savingProfile.value = true;
  try {
    const payload = await api.updateProfile(profileForm);
    store.setSession(payload.session);
    if (profileForm.customBackground) {
      localStorage.setItem('customBackground', profileForm.customBackground);
      document.body.style.background = profileForm.customBackground;
    } else {
      localStorage.removeItem('customBackground');
      document.body.style.background = '';
    }
    info.value = '资料已更新';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    savingProfile.value = false;
  }
}

function openAvatarPicker() {
  avatarInputEl.value?.click();
}

function onAvatarFileSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  cropFile.value = file;
  const url = URL.createObjectURL(file);
  cropImageUrl.value = url;
  cropZoom.value = 1;
  cropOffset.x = 0;
  cropOffset.y = 0;
  showCropper.value = true;
}

watch(showCropper, async (visible) => {
  if (!visible) return;
  await nextTick();
  const img = new Image();
  img.onload = () => {
    cropImage.value = img;
    drawCropCanvas();
  };
  img.src = cropImageUrl.value;
});

function drawCropCanvas() {
  const canvas = cropperCanvas.value;
  if (!canvas || !cropImage.value) return;
  const ctx = canvas.getContext('2d');
  const img = cropImage.value;

  const baseScale = Math.max(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight);
  const totalScale = baseScale * cropZoom.value;

  const drawW = img.naturalWidth * totalScale;
  const drawH = img.naturalHeight * totalScale;
  const drawX = (CANVAS_SIZE - drawW) / 2 + cropOffset.x;
  const drawY = (CANVAS_SIZE - drawH) / 2 + cropOffset.y;

  const cropLeft = (CANVAS_SIZE - CROP_SIZE) / 2;
  const cropTop = (CANVAS_SIZE - CROP_SIZE) / 2;

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.save();
  ctx.beginPath();
  ctx.rect(cropLeft, cropTop, CROP_SIZE, CROP_SIZE);
  ctx.clip();
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#1a2332';
  ctx.fillRect(0, 0, CANVAS_SIZE, cropTop);
  ctx.fillRect(0, cropTop + CROP_SIZE, CANVAS_SIZE, CANVAS_SIZE - cropTop - CROP_SIZE);
  ctx.fillRect(0, cropTop, cropLeft, CROP_SIZE);
  ctx.fillRect(cropLeft + CROP_SIZE, cropTop, CANVAS_SIZE - cropLeft - CROP_SIZE, CROP_SIZE);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cropLeft, cropTop, CROP_SIZE, CROP_SIZE);
  ctx.restore();
}

watch(() => cropZoom.value, () => { if (showCropper.value) drawCropCanvas(); });
watch(() => cropOffset.x, () => { if (showCropper.value) drawCropCanvas(); });
watch(() => cropOffset.y, () => { if (showCropper.value) drawCropCanvas(); });

function onCropPointerDown(event) {
  event.preventDefault();
  cropDragging.value = true;
  cropDragStart.x = event.clientX;
  cropDragStart.y = event.clientY;
  cropOffsetStart.x = cropOffset.x;
  cropOffsetStart.y = cropOffset.y;
}

function onCropPointerMove(event) {
  if (!cropDragging.value) return;
  event.preventDefault();
  cropOffset.x = cropOffsetStart.x + (event.clientX - cropDragStart.x);
  cropOffset.y = cropOffsetStart.y + (event.clientY - cropDragStart.y);
}

function onCropPointerUp() {
  cropDragging.value = false;
}

onBeforeUnmount(() => {
  cropDragging.value = false;
});

function getCroppedBlob() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = CROP_SIZE;
  exportCanvas.height = CROP_SIZE;
  const ctx = exportCanvas.getContext('2d');
  const img = cropImage.value;

  const baseScale = Math.max(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight);
  const totalScale = baseScale * cropZoom.value;

  const drawW = img.naturalWidth * totalScale;
  const drawH = img.naturalHeight * totalScale;
  const drawX = (CANVAS_SIZE - drawW) / 2 + cropOffset.x;
  const drawY = (CANVAS_SIZE - drawH) / 2 + cropOffset.y;

  const cropLeft = (CANVAS_SIZE - CROP_SIZE) / 2;
  const cropTop = (CANVAS_SIZE - CROP_SIZE) / 2;

  const sourceX = Math.max(0, (cropLeft - drawX) / totalScale);
  const sourceY = Math.max(0, (cropTop - drawY) / totalScale);
  const sourceW = Math.min(img.naturalWidth - sourceX, CROP_SIZE / totalScale);
  const sourceH = Math.min(img.naturalHeight - sourceY, CROP_SIZE / totalScale);

  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, CROP_SIZE, CROP_SIZE);

  return new Promise((resolve) => {
    exportCanvas.toBlob((blob) => resolve(blob), 'image/png', 0.92);
  });
}

async function confirmCrop() {
  clearMessage();
  uploadingAvatar.value = true;
  showCropper.value = false;
  try {
    const blob = await getCroppedBlob();
    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const upload = await api.uploadFile(file);
    const payload = await api.updateProfile({
      displayName: profileForm.displayName,
      avatarKey: upload.file.key
    });
    store.setSession(payload.session);
    info.value = '头像已更新';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    uploadingAvatar.value = false;
    cleanupCrop();
  }
}

function cancelCrop() {
  showCropper.value = false;
  cleanupCrop();
}

function cleanupCrop() {
  if (cropImageUrl.value) {
    URL.revokeObjectURL(cropImageUrl.value);
  }
  cropImageUrl.value = '';
  cropImage.value = null;
  cropFile.value = null;
  cropZoom.value = 1;
  cropOffset.x = 0;
  cropOffset.y = 0;
}

async function changePassword() {
  clearMessage();
  savingPassword.value = true;
  try {
    await api.changePassword(passwordForm);
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    info.value = '密码修改成功';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    savingPassword.value = false;
  }
}

// ===== 注销账号 =====
const deactivateDialogOpen = ref(false);
const deactivating = ref(false);
const deactivateConfirmText = ref('');
function openDeactivateDialog() {
  deactivateConfirmText.value = '';
  error.value = '';
  deactivateDialogOpen.value = true;
}
async function confirmDeactivate() {
  if (deactivateConfirmText.value.trim() !== '注销账号') {
    error.value = '请输入「注销账号」以确认';
    return;
  }
  deactivating.value = true;
  error.value = '';
  try {
    await api.deactivateAccount();
    deactivateDialogOpen.value = false;
    clearStoredToken();
    store.session = null;
    router.replace('/login');
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    deactivating.value = false;
  }
}

function logout() {
  if (!window.confirm('确定退出登录吗？')) return;
  clearStoredToken();
  store.session = null;
  router.replace('/login');
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-container">
      <header class="settings-header">
        <div class="settings-header__left">
          <h1>设置</h1>
          <span class="settings-kicker">个人中心</span>
        </div>
        <div class="settings-header__right">
          <div class="avatar-block">
            <button type="button" class="avatar-trigger" @click="openAvatarPicker" title="点击更换头像">
              <UiAvatar
                :src="session?.avatarUrl"
                :fallback="session?.displayName || session?.username || 'U'"
                size="md"
              />
              <span class="avatar-overlay">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              </span>
            </button>
            <input
              ref="avatarInputEl"
              type="file"
              class="avatar-input"
              accept="image/*"
              @change="onAvatarFileSelected"
            />
            <span class="avatar-hint">{{ uploadingAvatar ? '上传中...' : '点击头像更换' }}</span>
          </div>
        </div>
      </header>

      <Transition name="banner">
        <div v-if="info" class="info-banner" role="status">{{ info }}</div>
      </Transition>
      <Transition name="banner">
        <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
      </Transition>

      <div class="settings-grid">
        <section class="settings-section">
          <h2>个人资料</h2>
          <div class="chatid-card">
            <div class="chatid-card__main">
              <span class="chatid-card__label">我的细聊号</span>
              <strong>{{ session?.chatId || '—' }}</strong>
            </div>
            <div class="chatid-card__actions">
              <button type="button" @click="copyChatId">{{ copied ? '已复制' : '复制' }}</button>
              <button type="button" @click="openQr">二维码</button>
              <button type="button" @click="openChangeChatId">修改</button>
            </div>
          </div>
          <label class="field-compact">
            <span>显示名称（昵称）</span>
            <input
              v-model.trim="profileForm.displayName"
              placeholder="将展示给其他用户"
              autocomplete="nickname"
            />
          </label>
          <label class="field-compact">
            <span>个性签名</span>
            <input v-model.trim="profileForm.signature" placeholder="一句话介绍自己" maxlength="100" />
          </label>
          <label class="field-compact">
            <span>性别</span>
            <select v-model="profileForm.gender" class="field-select">
              <option value="secret">保密</option>
              <option value="male">男</option>
              <option value="female">女</option>
            </select>
          </label>
          <label class="field-compact">
            <span>出生年月</span>
            <input v-model.trim="profileForm.birthdate" placeholder="如 2000-05 或 2000-05-20" />
          </label>
          <label class="field-compact">
            <span>自定义背景</span>
            <input
              v-model.trim="profileForm.customBackground"
              placeholder="CSS 渐变、纯色或图片 URL"
            />
          </label>
          <button type="button" class="save-btn" :disabled="savingProfile" @click="saveProfile">
            {{ savingProfile ? '保存中' : '保存资料' }}
          </button>
        </section>

        <section class="settings-section">
          <h2>安全设置</h2>
          <label class="field-compact">
            <span>当前密码</span>
            <input
              v-model="passwordForm.currentPassword"
              type="password"
              autocomplete="current-password"
            />
          </label>
          <label class="field-compact">
            <span>新密码</span>
            <input
              v-model="passwordForm.newPassword"
              type="password"
              autocomplete="new-password"
            />
          </label>
          <button type="button" class="save-btn" :disabled="savingPassword" @click="changePassword">
            {{ savingPassword ? '更新中' : '更新密码' }}
          </button>
          <button type="button" class="logout-btn" @click="logout">退出登录</button>
          <button type="button" class="deactivate-link" @click="openDeactivateDialog">注销账号</button>
          <p class="deactivate-hint">注销后将退出所有群聊、清空聊天记录，并通知你的好友。此操作不可恢复。</p>
        </section>
      </div>

      <nav class="settings-nav">
        <button type="button" class="nav-link" @click="router.push('/')">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          返回聊天
        </button>
        <button type="button" class="nav-link" @click="router.push('/contacts')">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          </svg>
          通讯录 / 黑名单
        </button>
        <button
          v-if="showAdminEntry"
          type="button"
          class="nav-link"
          @click="router.push('/admin')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          管理后台
        </button>
      </nav>
    </div>

    <Transition name="modal">
      <div v-if="showCropper" class="crop-modal" @click.self="cancelCrop">
        <div class="crop-panel">
          <h3>裁剪头像</h3>
          <div class="crop-stage">
            <canvas
              ref="cropperCanvas"
              :width="CANVAS_SIZE"
              :height="CANVAS_SIZE"
              class="crop-canvas"
              @pointerdown="onCropPointerDown"
              @pointermove="onCropPointerMove"
              @pointerup="onCropPointerUp"
              @pointerleave="onCropPointerUp"
            />
          </div>
          <div class="crop-controls">
            <span>缩放</span>
            <input
              v-model.number="cropZoom"
              type="range"
              min="0.5"
              max="5"
              step="0.05"
              class="crop-zoom"
            />
          </div>
          <p class="crop-hint">拖动图片调整位置，滑动缩放选择范围</p>
          <div class="crop-actions">
            <button type="button" class="crop-cancel" @click="cancelCrop">取消</button>
            <button type="button" class="crop-confirm" @click="confirmCrop">确认裁剪</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 个人二维码弹窗 -->
    <Transition name="modal-fade">
      <div v-if="qrOpen" class="sp-overlay" @click.self="qrOpen = false">
        <div class="sp-dialog">
          <h3>我的二维码</h3>
          <p class="sp-sub">让别人扫描此二维码，即可查看并添加你为好友</p>
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="我的细聊二维码" class="qr-image" />
          <p class="qr-id">{{ session?.chatId }}</p>
          <div class="sp-actions">
            <button type="button" class="sp-btn" @click="qrOpen = false">关闭</button>
            <button type="button" class="sp-btn primary" @click="saveQr">保存二维码</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 修改细聊号弹窗 -->
    <Transition name="modal-fade">
      <div v-if="showChatIdDialog" class="sp-overlay" @click.self="showChatIdDialog = false">
        <div class="sp-dialog">
          <h3>修改细聊号</h3>
          <p class="sp-sub">格式：前缀#后缀（如 xiliao#8f3a），全局唯一。修改后别人需用新号添加你。</p>
          <input v-model="chatIdForm.value" class="sp-input" placeholder="前缀#后缀" />
          <div class="sp-actions">
            <button type="button" class="sp-btn" @click="showChatIdDialog = false">取消</button>
            <button type="button" class="sp-btn primary" :disabled="changingChatId" @click="changeChatId">保存</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 注销账号确认弹窗 -->
    <Transition name="modal-fade">
      <div v-if="deactivateDialogOpen" class="sp-overlay" @click.self="deactivateDialogOpen = false">
        <div class="sp-dialog">
          <h3>注销账号</h3>
          <p class="sp-sub">注销后你将退出所有群聊、清空聊天记录，并通知好友。此操作不可恢复，请谨慎。</p>
          <input v-model="deactivateConfirmText" class="sp-input" placeholder="请输入：注销账号" />
          <div class="sp-actions">
            <button type="button" class="sp-btn" @click="deactivateDialogOpen = false">取消</button>
            <button type="button" class="sp-btn danger" :disabled="deactivating" @click="confirmDeactivate">
              {{ deactivating ? '注销中' : '确认注销' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.settings-page {
  height: 100vh;
  height: 100dvh;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%);
}

.settings-container {
  width: min(900px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px;
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(247, 250, 253, 0.68)),
    rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    0 24px 60px rgba(91, 141, 191, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  opacity: 0;
  animation: containerRise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-header__left h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #2c4a6e;
  letter-spacing: -0.02em;
}

.settings-kicker {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(91, 141, 191, 0.08);
  border: 1px solid rgba(91, 141, 191, 0.12);
  color: #5b8dbf;
  font-size: 11px;
  font-weight: 600;
}

.avatar-block {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-direction: row;
}

.avatar-trigger {
  position: relative;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  border-radius: 16px;
  overflow: hidden;
  transition: transform 0.2s ease;
}

.avatar-trigger:hover {
  transform: scale(1.05);
}

.avatar-trigger:hover .avatar-overlay {
  opacity: 1;
}

.avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 35, 50, 0.45);
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s ease;
  border-radius: 16px;
}

.avatar-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.avatar-hint {
  font-size: 11px;
  color: #6b8aab;
  white-space: nowrap;
}

.info-banner,
.error-banner {
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 13px;
}

.info-banner {
  background: rgba(91, 141, 191, 0.08);
  border: 1px solid rgba(91, 141, 191, 0.15);
  color: #5b8dbf;
}

.error-banner {
  background: rgba(217, 83, 79, 0.08);
  border: 1px solid rgba(217, 83, 79, 0.15);
  color: #d9534f;
}

.banner-enter-active,
.banner-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 4px 16px rgba(91, 141, 191, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  opacity: 0;
  animation: sectionRise 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.settings-section:nth-child(1) {
  animation-delay: 0.2s;
}

.settings-section:nth-child(2) {
  animation-delay: 0.3s;
}

.settings-section h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #2c4a6e;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(91, 141, 191, 0.08);
}

.field-compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-compact span {
  font-size: 11px;
  font-weight: 600;
  color: #6b8aab;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-compact input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.6);
  color: #2c4a6e;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  box-sizing: border-box;
}

.field-compact input:focus {
  border-color: rgba(91, 141, 191, 0.35);
  box-shadow: 0 0 0 3px rgba(91, 141, 191, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.field-compact input::placeholder {
  color: rgba(107, 138, 171, 0.5);
  font-size: 13px;
}

.save-btn {
  margin-top: 6px;
  padding: 10px 20px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(91, 141, 191, 0.85), rgba(69, 121, 186, 0.8));
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(91, 141, 191, 0.2);
}

.save-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(91, 141, 191, 0.3);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  opacity: 0;
  animation: sectionRise 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.4s forwards;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(91, 141, 191, 0.1);
  background: rgba(255, 255, 255, 0.4);
  color: #6b8aab;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(91, 141, 191, 0.2);
  color: #2c4a6e;
  transform: translateY(-1px);
}

.nav-link svg {
  width: 13px;
  height: 13px;
}

.crop-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 35, 50, 0.5);
  backdrop-filter: blur(8px);
  z-index: 100;
  padding: 24px;
}

.crop-panel {
  width: min(480px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 36px;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(247, 250, 253, 0.72)),
    rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    0 30px 80px rgba(26, 35, 50, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(180%);
}

.crop-panel h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #2c4a6e;
}

.crop-stage {
  width: 280px;
  height: 280px;
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(91, 141, 191, 0.15),
    inset 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.crop-canvas {
  display: block;
  cursor: grab;
  touch-action: none;
}

.crop-canvas:active {
  cursor: grabbing;
}

.crop-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 0 8px;
}

.crop-controls span {
  font-size: 15px;
  font-weight: 600;
  color: #6b8aab;
  flex-shrink: 0;
}

.crop-zoom {
  flex: 1;
  height: 6px;
  appearance: none;
  border-radius: 3px;
  background: rgba(91, 141, 191, 0.15);
  outline: none;
}

.crop-zoom::-webkit-slider-thumb {
  appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8dbf, #4579ba);
  box-shadow: 0 2px 6px rgba(91, 141, 191, 0.3);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.crop-zoom::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.crop-hint {
  margin: 0;
  font-size: 13px;
  color: #6b8aab;
  text-align: center;
}

.crop-actions {
  display: flex;
  gap: 12px;
  width: 100%;
}

.crop-cancel {
  flex: 1;
  padding: 14px;
  border: 1px solid rgba(91, 141, 191, 0.15);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
  color: #6b8aab;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.crop-cancel:hover {
  background: rgba(255, 255, 255, 0.8);
  color: #2c4a6e;
}

.crop-confirm {
  flex: 1;
  padding: 14px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(91, 141, 191, 0.85), rgba(69, 121, 186, 0.8));
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(91, 141, 191, 0.2);
  transition: all 0.2s ease;
}

.crop-confirm:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(91, 141, 191, 0.3);
}

.modal-enter-active {
  transition: opacity 250ms ease;
}

.modal-enter-active .crop-panel {
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease;
}

.modal-leave-active {
  transition: opacity 200ms ease;
}

.modal-leave-active .crop-panel {
  transition: transform 200ms ease, opacity 200ms ease;
}

.modal-enter-from {
  opacity: 0;
}

.modal-enter-from .crop-panel {
  transform: scale(0.92) translateY(12px);
  opacity: 0;
}

.modal-leave-to {
  opacity: 0;
}

.modal-leave-to .crop-panel {
  transform: scale(0.96);
  opacity: 0;
}

@keyframes containerRise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes sectionRise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 640px) {
  .settings-page {
    padding: 16px 16px calc(72px + env(safe-area-inset-bottom));
  }

  .settings-container {
    padding: 24px;
    gap: 20px;
  }

  .settings-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .settings-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .avatar-compact {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-container,
  .settings-section,
  .settings-nav {
    animation: none;
    opacity: 1;
    transform: none;
  }
}

/* 微信风格微调 */
.chatid-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: linear-gradient(135deg, #eaf8ef, #f3faf5);
  border: 1px solid #d3eddc;
}
.chatid-card__main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.chatid-card span, .chatid-card__label { font-size: 12px; color: #5a7a68; white-space: nowrap; }
.chatid-card strong { flex: 1; min-width: 0; font-size: 15px; color: #07c160; letter-spacing: 0.5px; word-break: break-all; }
.chatid-card__actions { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
.chatid-card button { border: 1px solid #07c160; background: transparent; color: #07c160; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.settings-header__left h1, .settings-section h2 { color: #191919; }
.save-btn, .crop-confirm { background: #07c160; box-shadow: 0 2px 8px rgba(7,193,96,0.2); }
.save-btn:hover:not(:disabled), .crop-confirm:hover { background: #06ad56; }
.field-select { width: 100%; padding: 10px 12px; border: 1px solid var(--border, #d8dee4); border-radius: 8px; font-size: 14px; background: #fff; box-sizing: border-box; }
.sp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.sp-dialog { width: 360px; max-width: 92vw; max-height: 86dvh; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; background: #fff; border-radius: 14px; padding: 22px; text-align: center; }
.sp-dialog h3 { margin: 0 0 6px; font-size: 17px; color: #191919; }
.sp-sub { margin: 0 0 14px; font-size: 12px; color: #888; line-height: 1.5; }
.qr-image { width: 240px; height: 240px; image-rendering: pixelated; }
.qr-id { font-size: 13px; color: #07c160; font-weight: 600; margin: 8px 0 0; }
.sp-input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; outline: none; }
.sp-input:focus { border-color: #07c160; }
.sp-actions { display: flex; gap: 8px; margin-top: 18px; justify-content: center; }
.sp-btn { padding: 9px 20px; border: 1px solid #ddd; border-radius: 8px; background: #fff; color: #555; font-size: 13px; cursor: pointer; }
.sp-btn.primary { background: #07c160; border-color: #07c160; color: #fff; }
.sp-btn.danger { background: #e64340; border-color: #e64340; color: #fff; }
.sp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.logout-btn { display: block; width: 100%; margin-top: 16px; padding: 11px; border: 1px solid #ddd; border-radius: 8px; background: #fff; color: #576b95; font-size: 14px; cursor: pointer; }
.logout-btn:hover { background: #f7f7f7; }
.deactivate-link { display: inline-block; margin-top: 16px; padding: 0; border: none; background: none; color: #e64340; font-size: 13px; cursor: pointer; text-decoration: underline; }
.deactivate-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: #999; }
</style>
