// APP 本地偏好：通知增强、隐私模式、应用锁、更新下载等，统一走 localStorage。
// 这些是「本机设置」，不上传服务器，卸载/清缓存即失效。

const KEY = 'xiliao-app-prefs';

const DEFAULTS = {
  notifyEnabled: true,      // 通知总开关
  quietEnabled: false,      // 免打扰时段开关
  quietStart: '22:00',      // 免打扰开始
  quietEnd: '08:00',        // 免打扰结束
  previewEnabled: true,     // 通知显示消息内容
  privacyMode: false,       // 隐私模式：通知内容一律打码
  appLockEnabled: false,    // 应用锁
  appLockPin: '',           // 应用锁 PIN（4 位）
  autoDownload: true        // 检测到更新后询问并自动下载
};

let cache = null;

export function getPrefs() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setPrefs(patch) {
  cache = { ...getPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  return cache;
}

// 当前是否处于免打扰时段（支持跨零点）
export function isQuietNow() {
  const p = getPrefs();
  if (!p.quietEnabled) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(p.quietStart || '22:00').split(':').map(Number);
  const [eh, em] = String(p.quietEnd || '08:00').split(':').map(Number);
  const start = (sh || 0) * 60 + (sm || 0);
  const end = (eh || 0) * 60 + (em || 0);
  if (start === end) return false;
  return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

// 按当前偏好处理通知正文（隐私 / 预览关闭时打码）
export function maskNotificationBody(body) {
  const p = getPrefs();
  if (p.privacyMode || !p.previewEnabled) return '你收到一条新消息';
  return body;
}
