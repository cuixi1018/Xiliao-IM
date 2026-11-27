// 新消息系统通知：APP 内用 Capacitor 本地通知，浏览器用 Web Notification API。
// 仅在页面处于后台/隐藏时才弹出，避免打扰正在聊天的用户。

let webPermissionRequested = false;

function isCapacitor() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.getPlatform?.() !== 'web');
}

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

async function notifyCapacitor(title, body) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    // 请求权限（仅首次）
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;
    await LocalNotifications.schedule({
      notifications: [{
        title,
        body,
        id: Date.now() % 2147483647,
        schedule: { at: new Date(Date.now() + 200) },
        sound: undefined,
        attachImageUrl: undefined
      }]
    });
  } catch {
    // 插件不可用时静默降级
  }
}

async function notifyWeb(title, body) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default' && !webPermissionRequested) {
    webPermissionRequested = true;
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'xiliao-msg', icon: '/favicon.ico' });
    setTimeout(() => n.close(), 6000);
    n.onclick = () => window.focus();
  } catch { /* ignore */ }
}

// 收到新消息时调用。payload: { room, senderName, preview }
export function showMessageNotification({ room, senderName, preview }) {
  if (!isHidden()) return;
  const who = String(senderName || '').trim();
  const text = String(preview || '').trim();
  const title = who ? `${who} 发来消息` : '细聊新消息';
  const roomName = room?.kind === 'dm' ? '' : (room?.name ? `「${room.name}」` : '');
  const body = roomName ? `${roomName} ${text}` : text;
  if (isCapacitor()) {
    void notifyCapacitor(title, body);
  } else {
    void notifyWeb(title, body);
  }
}

// APP 启动后可主动申请通知权限
export async function requestNotifyPermission() {
  if (isCapacitor()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.requestPermissions();
    } catch { /* ignore */ }
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
}
