<script setup>
// 打开客户端后自动检查更新（仅 APP / 桌面端，网页端不检查）。
// 发现新版本时弹出更新详情，用户确认后走统一下载工具（系统级下载，规避 WebView 拦截）。
import { onMounted, onBeforeUnmount, ref } from 'vue';
import api from '../api.js';
import { getLocalAppVersion } from '../app-version-reader.js';
import { isClientApp } from '../platform.js';
import { currentPlatform, pickDownload, compareVersion, openDownloadUrl } from '../download-utils.js';

const visible = ref(false);
const info = ref(null);
const localVersion = ref('');
const downloading = ref(false);
const CHECK_KEY = 'xiliao-last-update-check';
const DISMISS_KEY = 'xiliao-update-dismissed-version';

function shouldCheck() {
  if (!isClientApp()) return false;
  try {
    const last = Number(localStorage.getItem(CHECK_KEY) || 0);
    // 每 6 小时最多检查一次，避免每次打开都请求
    return Date.now() - last > 6 * 60 * 60 * 1000;
  } catch { return true; }
}

async function check() {
  if (!shouldCheck()) return;
  try {
    localStorage.setItem(CHECK_KEY, String(Date.now()));
    localVersion.value = await getLocalAppVersion();
    const data = await api.appVersion();
    if (!data?.version) return;
    // 用户已手动忽略过这个版本，不再打扰
    let dismissed = '';
    try { dismissed = localStorage.getItem(DISMISS_KEY) || ''; } catch { /* ignore */ }
    if (dismissed === data.version) return;
    if (compareVersion(data.version, localVersion.value) > 0) {
      info.value = data;
      visible.value = true;
    }
  } catch (e) { /* 静默失败，不打扰用户 */ }
}

let timer = null;
onMounted(() => {
  // 延迟检查，避免影响首屏与登录流程
  timer = setTimeout(check, 2500);
});
onBeforeUnmount(() => { if (timer) clearTimeout(timer); });

function dismiss() {
  try { if (info.value?.version) localStorage.setItem(DISMISS_KEY, info.value.version); } catch { /* ignore */ }
  visible.value = false;
}

function download() {
  if (downloading.value) return;
  downloading.value = true;
  try {
    const { url, filename } = pickDownload(info.value?.downloads, currentPlatform());
    if (url) {
      openDownloadUrl(url, filename);
    } else {
      // 无直链：打开下载详情页
      openDownloadUrl('/download');
    }
    visible.value = false;
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <Transition name="upd">
    <div v-if="visible" class="upd-mask" @click.self="dismiss">
      <div class="upd-box" role="dialog" aria-label="发现新版本">
        <button type="button" class="upd-close" aria-label="关闭" @click="dismiss">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="upd-icon"><img src="/logo.svg" alt="细聊" /></div>
        <h3 class="upd-title">发现新版本</h3>
        <p class="upd-ver">v{{ localVersion }} → v{{ info?.version }}</p>
        <div class="upd-body">
          <div class="upd-sec">更新详情</div>
          <ul class="upd-list">
            <li v-for="(line, i) in info?.changelog || []" :key="i">{{ line }}</li>
          </ul>
        </div>
        <div class="upd-actions">
          <button type="button" class="upd-later" @click="dismiss">以后再说</button>
          <button type="button" class="upd-now" :disabled="downloading" @click="download">{{ downloading ? '正在打开…' : '下载更新' }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.upd-mask { position: fixed; inset: 0; z-index: 500; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(26,35,50,.46); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.upd-box { position: relative; width: min(360px, 100%); box-sizing: border-box; padding: 28px 24px 22px; border-radius: 20px; text-align: center; background: linear-gradient(180deg,#fff,#f6faf8); border: 1px solid rgba(255,255,255,.85); box-shadow: 0 24px 70px rgba(26,35,50,.24); }
.upd-close { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border: none; border-radius: 50%; background: rgba(0,0,0,.04); color: #999; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.upd-close:hover { background: rgba(0,0,0,.08); color: #555; }
.upd-icon { width: 64px; height: 64px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; }
.upd-icon img { width: 44px; height: 44px; object-fit: contain; }
.upd-title { margin: 0 0 4px; font-size: 18px; font-weight: 700; color: #191919; }
.upd-ver { margin: 0 0 16px; font-size: 12.5px; font-weight: 600; color: #07c160; }
.upd-body { text-align: left; background: rgba(7,193,96,.05); border: 1px solid rgba(7,193,96,.12); border-radius: 12px; padding: 14px 15px; margin-bottom: 18px; max-height: 230px; overflow: auto; }
.upd-sec { font-size: 13px; font-weight: 700; color: #06ad56; margin-bottom: 8px; }
.upd-list { margin: 0; padding-left: 18px; }
.upd-list li { font-size: 12.5px; line-height: 1.65; color: #555; }
.upd-list li::marker { color: #07c160; }
.upd-actions { display: flex; gap: 10px; }
.upd-later, .upd-now { flex: 1; height: 42px; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
.upd-later { background: transparent; color: #888; }
.upd-later:hover { color: #555; }
.upd-now { background: #07c160; color: #fff; box-shadow: 0 3px 10px rgba(7,193,96,.25); }
.upd-now:hover { background: #06ad56; }
.upd-now:disabled { opacity: .6; cursor: default; }
.upd-enter-active, .upd-leave-active { transition: opacity .22s ease; }
.upd-enter-active .upd-box, .upd-leave-active .upd-box { transition: transform .26s cubic-bezier(.22,1,.36,1), opacity .22s ease; }
.upd-enter-from, .upd-leave-to { opacity: 0; }
.upd-enter-from .upd-box { transform: scale(.92) translateY(14px); opacity: 0; }
.upd-leave-to .upd-box { transform: scale(.96); opacity: 0; }
</style>
