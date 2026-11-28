// 读取"本机已安装客户端版本"——必须从原生层读取，不能写死在前端。
// APP / 桌面端热加载线上网页，若把版本写死在前端，老用户打开后拿到的
// 也是线上新版本常量，会导致永远检测不到更新。
import { isCapacitorApp, isDesktopApp } from './platform.js';

// 纯网页端没有"已安装版本"概念，给一个高于线上的值避免误触发
// （网页版本身也不显示更新入口）
const WEB_FALLBACK = '99.0.0';
// 客户端读不到原生版本时（旧版本 APK / exe 没有版本桥），
// 视为很旧的版本，确保能检测到线上新版并提示更新。
const UNKNOWN_CLIENT_VERSION = '0.0.0';

function normalizeDesktopVersion(v) {
  const s = String(v || '');
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    // Electron 包版本用 semver 1.0.2，对外展示约定为 1.02
    if (m[2] === '0') return `${m[1]}.${m[3]}`;
    return `${m[1]}.${m[2]}${m[3] === '0' ? '' : m[3]}`;
  }
  return s;
}

export async function getLocalAppVersion() {
  // 1) Capacitor APP：优先读原生注入的全局 / 原生桥（APK versionName）
  if (isCapacitorApp()) {
    try {
      const v = window.__XILIAO_APP_VERSION__ || (window.XiliaoNative?.getAppVersion?.());
      if (v) return String(v);
    } catch { /* ignore */ }
    // 旧 APK 没有版本桥——视为旧版，触发更新
    return UNKNOWN_CLIENT_VERSION;
  }

  // 2) Electron 桌面端：通过 preload 暴露 app.getVersion()
  if (isDesktopApp()) {
    try {
      const v = await window.XiliaoDesktop?.getAppVersion?.();
      if (v) return normalizeDesktopVersion(v);
    } catch { /* ignore */ }
    // 旧 exe 没有版本桥——视为旧版，触发更新
    return UNKNOWN_CLIENT_VERSION;
  }

  // 3) 纯网页端
  return WEB_FALLBACK;
}
