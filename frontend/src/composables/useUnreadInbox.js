import { watch } from 'vue';
import api from '../api.js';
import { subscribeInbox, setActiveRoom } from './useGlobalInbox.js';

// 保留给 ChatPage 使用的接口：connectUnreadInbox / disconnectUnreadInbox。
// 底层连接已改为全局单例（useGlobalInbox），这里只负责：
//   1) 同步「当前会话」给全局通知判断；
//   2) 订阅房间消息，更新会话列表/未读、对当前会话自动标记已读。
// 系统通知由 App.vue 的全局订阅统一处理，因此离开聊天页也能收到。
export function useUnreadInbox({
  activeRoom,
  applyConversationActivity,
  markConversationRead
}) {
  let unsubscribe = null;

  // 当前会话变化时同步给全局通知判断（打开会话 / 返回列表都会触发）
  watch(
    activeRoom,
    (room) => setActiveRoom(room),
    { immediate: true, deep: false }
  );

  function isActive(room) {
    return (
      activeRoom.value &&
      activeRoom.value.kind === room.kind &&
      Number(activeRoom.value.id) === Number(room.id)
    );
  }

  function connectUnreadInbox() {
    // 同步当前会话引用对象给全局（保留响应式引用，读取时取最新值）
    setActiveRoom(activeRoom.value);
    if (unsubscribe) return;

    unsubscribe = subscribeInbox((payload) => {
      if (!payload || payload.type !== 'room_message' || !payload.room) return;

      const room = payload.room;
      if (isActive(room)) {
        // 正在看这个会话：静默标记已读，不打扰
        setActiveRoom(activeRoom.value);
        markConversationRead(room.kind, room.id);
        void api
          .markRoomRead(room.kind, room.id, payload.messageId)
          .catch(() => {});
        return;
      }

      applyConversationActivity({
        kind: room.kind,
        roomId: room.id,
        lastMessageAt: payload.createdAt,
        unreadCount: payload.unreadCount
      });
    });
  }

  function disconnectUnreadInbox() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    // 仅清理订阅，不关闭全局连接（APP 其他页面仍需要收消息）
    setActiveRoom(null);
  }

  // 每次当前会话变化时同步给全局通知判断
  // （通过 connect 时设置 + 消息到达时刷新；这里 watch 由调用方在 activeRoom 变化时自行触发）
  return {
    connectUnreadInbox,
    disconnectUnreadInbox,
    syncActiveRoom: () => setActiveRoom(activeRoom.value)
  };
}
