<script setup>
// 网页版「下载 APP」提示：每次打开网站显示，提供「下载 APP」与「以后再说」。
// 原生 APP / 桌面客户端内不显示；按设备自动匹配 APK / EXE。
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isWebOnly } from '../platform.js';

const route = useRoute();
// 下载详情页本身不再弹下载提示
const isDownloadPage = () => route.path === '/download';

const APP_DOWNLOAD_PAGE = import.meta.env.VITE_APP_DOWNLOAD_URL || '/download';
const APP_VERSION = '1.01';

const visible = ref(false);

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  return 'other';
}
const platform = detectPlatform();
const platformLabel = platform === 'android' ? 'Android 版' : platform === 'windows' ? 'Windows 版' : '客户端';

// 点击进入下载详情页（展示版本信息与各平台安装包），不直接下载
function download() {
  window.open(APP_DOWNLOAD_PAGE, '_blank');
  dismiss();
}
function dismiss() { visible.value = false; }

onMounted(() => {
  if (isWebOnly() && !isDownloadPage()) {
    // 轻微延迟，避免遮挡首屏渲染
    setTimeout(() => { visible.value = true; }, 600);
  }
});

// 进入下载页时立即关闭弹窗
watch(() => route.path, (path) => {
  if (path === '/download') visible.value = false;
});
</script>

<template>
  <Transition name="dlg">
    <div v-if="visible" class="appdlg-mask" @click.self="dismiss">
      <div class="appdlg" role="dialog" aria-label="下载细聊客户端">
        <button type="button" class="appdlg-close" aria-label="关闭" @click="dismiss">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="appdlg-icon">
          <img src="/logo.svg" alt="细聊" />
        </div>
        <h3 class="appdlg-title">下载细聊客户端</h3>
        <p class="appdlg-desc">体验更流畅的消息通知与完整功能<br/>已为你匹配 <strong>{{ platformLabel }}</strong></p>
        <div class="appdlg-version">v{{ APP_VERSION }} · 点击查看版本详情</div>
        <div class="appdlg-actions">
          <button type="button" class="appdlg-primary" @click="download">查看详情并下载</button>
          <button type="button" class="appdlg-secondary" @click="dismiss">以后再说</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.appdlg-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(26, 35, 50, 0.42);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.appdlg {
  position: relative;
  width: min(340px, 100%);
  box-sizing: border-box;
  padding: 30px 26px 24px;
  border-radius: 20px;
  text-align: center;
  background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,250,253,0.92));
  border: 1px solid rgba(255,255,255,0.8);
  box-shadow: 0 24px 70px rgba(26,35,50,0.24), inset 0 1px 0 rgba(255,255,255,0.9);
}
.appdlg-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.04);
  color: #9a9a9a;
  cursor: pointer;
}
.appdlg-close:hover { background: rgba(0,0,0,0.08); color: #555; }
.appdlg-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 14px;
  border-radius: 16px;
  background: #eaf8ef;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(7,193,96,0.16);
}
.appdlg-icon img { width: 46px; height: 46px; object-fit: contain; }
.appdlg-title { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #191919; }
.appdlg-desc { margin: 0 0 22px; font-size: 13px; line-height: 1.6; color: #888; }
.appdlg-desc strong { color: #07c160; }
.appdlg-version { display: inline-block; margin: -8px 0 18px; padding: 4px 12px; border-radius: 999px; background: rgba(7,193,96,0.09); color: #07c160; font-size: 12px; font-weight: 600; }
.appdlg-actions { display: flex; flex-direction: column; gap: 10px; }
.appdlg-primary {
  height: 44px;
  border: none;
  border-radius: 10px;
  background: #07c160;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(7,193,96,0.25);
  transition: background 0.15s ease;
}
.appdlg-primary:hover { background: #06ad56; }
.appdlg-secondary {
  height: 40px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #888;
  font-size: 13.5px;
  cursor: pointer;
}
.appdlg-secondary:hover { color: #555; }

.dlg-enter-active, .dlg-leave-active { transition: opacity 220ms ease; }
.dlg-enter-active .appdlg, .dlg-leave-active .appdlg { transition: transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease; }
.dlg-enter-from, .dlg-leave-to { opacity: 0; }
.dlg-enter-from .appdlg { transform: scale(0.92) translateY(14px); opacity: 0; }
.dlg-leave-to .appdlg { transform: scale(0.96); opacity: 0; }
</style>
