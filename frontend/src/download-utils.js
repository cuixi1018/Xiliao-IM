// 统一下载工具：全端可靠触发安装包下载。
// 核心问题：APP 的 WebView 里 window.open(url,'_blank') 会被拦截，下载走不通。
// 方案：APP 用原生 DownloadManager 桥（新包注入），旧包降级系统浏览器；
//       桌面端用 shell.openExternal；纯网页用锚点 download。
import { isCapacitorApp, isDesktopApp } from './platform.js';

export function currentPlatform() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/mac/i.test(ua)) return 'mac';
  if (/linux/i.test(ua)) return 'linux';
  return 'other';
}

// 根据平台从版本接口数据里挑出下载链接
export function pickDownload(downloads, platform) {
  const d = downloads || {};
  if (platform === 'android') return { url: d.android?.url, filename: d.android?.filename || 'xiliao.apk' };
  if (platform === 'windows') return { url: d.windows?.url, filename: d.windows?.filename || 'xiliao.exe' };
  if (platform === 'mac') {
    const arm = d.mac?.arm64?.url;
    return { url: arm || d.mac?.x64?.url, filename: arm ? 'xiliao-mac-arm64.zip' : 'xiliao-mac-x64.zip' };
  }
  if (platform === 'linux') return { url: d.linux?.url, filename: d.linux?.filename || 'xiliao.AppImage' };
  return { url: null, filename: '' };
}

export function compareVersion(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 触发下载/打开外部链接（全端通用）
export function openDownloadUrl(url, filename) {
  if (!url) return false;

  // 1) 原生 APP：优先用注入的下载桥（系统 DownloadManager，最可靠）
  if (isCapacitorApp()) {
    try {
      if (window.XiliaoNative?.downloadFile) {
        window.XiliaoNative.downloadFile(String(url), String(filename || 'xiliao.apk'));
        return true;
      }
    } catch (e) { /* fall through */ }
    // 旧版 APK 没有下载桥：用 _system 交给系统浏览器（Capacitor 原生会拦截）
    try {
      const w = window.open(String(url), '_system');
      if (w) return true;
    } catch (e) { /* fall through */ }
  }

  // 2) 桌面端：用 Electron shell 打开系统浏览器下载
  if (isDesktopApp()) {
    try {
      if (window.XiliaoDesktop?.openExternal) {
        window.XiliaoDesktop.openExternal(String(url));
        return true;
      }
    } catch (e) { /* fall through */ }
  }

  // 3) 纯网页兜底：锚点 download
  try {
    const a = document.createElement('a');
    a.href = String(url);
    a.download = String(filename || '');
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch (e) {
    try { window.open(String(url), '_blank'); return true; } catch (_) { return false; }
  }
}
