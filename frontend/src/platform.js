// 运行环境检测：区分纯网页 / Capacitor 原生 APP / Electron 桌面客户端。
// 供「设置页仅客户端显示本机功能」「网页端下载 APP 提示」等场景共用。

function getCapacitor() {
  if (typeof window === 'undefined') return null;
  return window.Capacitor || null;
}

export function isCapacitorApp() {
  const cap = getCapacitor();
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'web') return true;
  } catch { /* ignore */ }
  return false;
}

export function isDesktopApp() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.XiliaoDesktop?.isDesktop);
}

// 是否运行在客户端（原生 APP 或桌面客户端）
export function isClientApp() {
  return isCapacitorApp() || isDesktopApp();
}

// 是否纯网页版
export function isWebOnly() {
  return !isClientApp();
}

// 当前客户端类型：'android' | 'desktop' | 'web'
export function getPlatformType() {
  if (isDesktopApp()) return 'desktop';
  if (isCapacitorApp()) return 'android';
  return 'web';
}
