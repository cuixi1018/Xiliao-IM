// 全局收件箱连接管理器：解决手机 APP「有人发消息接不到」的问题。
//
// 旧实现的缺陷：
//   1) inbox WebSocket 只在 ChatPage 挂载时建立，离开聊天页即断开 → 其他页面收不到消息；
//   2) 断线后没有自动重连，网络抖动/切后台断开后永久失联；
//   3) 没有心跳保活，移动端长时间空闲会被运营商/NAT 回收；
//   4) 从后台回到前台不会重连、不补拉未读。
//
// 新实现：模块级单例，登录后在 App.vue 启动一次，直到登出才停止；
// 带指数退避重连、心跳、前后台切换恢复、并对外提供消息订阅。
import api from '../api.js';
import { connectInboxSocket } from '../ws.js';

let socket = null;
let started = false;
let intentionalStop = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let heartbeatTimer = null;
let visibilityBound = false;

const RECONNECT_BASE_DELAY = 700;
const RECONNECT_MAX_DELAY = 15000;
const HEARTBEAT_INTERVAL = 25000; // 25s 心跳，避免移动端 NAT 超时回收

// payload 订阅者：ChatPage 用它刷新会话列表/未读，App.vue 用它弹系统通知
const subscribers = new Set();

// 当前正在查看的会话，供全局通知判断是否打扰用户（由 ChatPage 同步）
let currentActiveRoom = null;

export function setActiveRoom(room) {
  currentActiveRoom = room || null;
}

export function getActiveRoom() {
  return currentActiveRoom;
}

export function isActiveRoom(room) {
  if (!currentActiveRoom || !room) return false;
  return (
    currentActiveRoom.kind === room.kind &&
    Number(currentActiveRoom.id) === Number(room.id)
  );
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!started || intentionalStop) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // 连接已不健康，立即尝试重建（兜底，防止 close 事件在移动端丢失）
      scheduleReconnect(0);
      return;
    }
    try {
      socket.send(JSON.stringify({ type: 'ping' }));
    } catch { /* ignore */ }
  }, HEARTBEAT_INTERVAL);
}

function scheduleReconnect(forceDelay) {
  if (reconnectTimer) return;
  if (!started || intentionalStop) return;
  const delay = typeof forceDelay === 'number'
    ? forceDelay
    : Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), RECONNECT_MAX_DELAY);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!started || intentionalStop) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    openSocket();
  }, delay);
}

function emit(payload) {
  for (const fn of Array.from(subscribers)) {
    try { fn(payload); } catch { /* ignore */ }
  }
}

function openSocket() {
  if (!started || intentionalStop) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  clearReconnect();

  socket = connectInboxSocket({
    onMessage(payload) {
      // 心跳回包，忽略
      if (!payload || payload.type === 'pong' || payload.type === 'ping') return;
      emit(payload);
    },
    onStatus(event) {
      if (event.socket !== socket) return;
      if (event.status === 'open') {
        reconnectAttempts = 0;
        startHeartbeat();
        return;
      }
      if (event.status === 'closed' || event.status === 'error') {
        stopHeartbeat();
        if (socket === event.socket) socket = null;
        scheduleReconnect();
      }
    }
  });
}

function handleVisibility() {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') {
    // 回到前台：若连接不在，立刻重连并补拉一次未读会话
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reconnectAttempts = 0;
      scheduleReconnect(0);
    }
    emit({ type: 'app_resume' });
  }
}

export function startGlobalInbox() {
  intentionalStop = false;
  if (started) {
    // 已启动但连接掉了，立刻检查
    if (!socket || socket.readyState !== WebSocket.OPEN) scheduleReconnect(0);
    return;
  }
  started = true;
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
    visibilityBound = true;
  }
  openSocket();
}

export function stopGlobalInbox() {
  started = false;
  intentionalStop = true;
  clearReconnect();
  stopHeartbeat();
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
}

// 订阅房间消息，返回取消订阅函数
export function subscribeInbox(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function isInboxConnected() {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}
