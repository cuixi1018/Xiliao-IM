// 主题管理：跟随系统 / 浅色 / 深色
// 通过 html[data-theme] 属性驱动样式，偏好存 localStorage。

const STORAGE_KEY = 'xiliao-theme';
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

let preference = 'system'; // 'system' | 'light' | 'dark'

function resolve(mode) {
  if (mode === 'system') return media?.matches ? 'dark' : 'light';
  return mode;
}

function apply() {
  const actual = resolve(preference);
  const root = document.documentElement;
  root.setAttribute('data-theme', actual);
  // 同步 meta 主题色，让移动端状态栏匹配
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', actual === 'dark' ? '#191919' : '#fefdf8');
}

export function initTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved;
  } catch { /* ignore */ }
  apply();
  if (media && media.addEventListener) {
    media.addEventListener('change', () => { if (preference === 'system') apply(); });
  }
}

export function getTheme() {
  return preference;
}

export function getResolvedTheme() {
  return resolve(preference);
}

export function setTheme(mode) {
  if (!['light', 'dark', 'system'].includes(mode)) return;
  preference = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  apply();
}
