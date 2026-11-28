// 复制文本到剪贴板：兼容网页、Capacitor APP WebView、Electron 客户端。
// Android WebView 里 navigator.clipboard 常因权限/非安全上下文不可用，
// 因此增加 execCommand('copy') 兜底，保证「复制细聊号 / 复制链接」在 APP 内可用。
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  // 1) 标准 Clipboard API（HTTPS / 已授权）
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 继续兜底 */ }

  // 2) Electron 桌面端桥接
  try {
    if (typeof window !== 'undefined' && window.XiliaoDesktop?.writeClipboard) {
      await window.XiliaoDesktop.writeClipboard(value);
      return true;
    }
  } catch { /* 继续兜底 */ }

  // 3) 旧式 execCommand（Android WebView 可用，需临时 textarea）
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  } catch { /* ignore */ }

  return false;
}
