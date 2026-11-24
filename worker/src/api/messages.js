import { insertMessage, listMessages, markRoomRead, requireAccessibleRoom } from '../db.js';
import { errorResponse, parseJsonRequest, pickAttachment, sanitizeLimit } from '../utils.js';

export function registerMessageRoutes(app) {
  app.get('/api/messages', async (c) => {
    const session = c.get('session');
    const kind = c.req.query('kind');
    const roomId = Number(c.req.query('roomId'));
    const before = c.req.query('before');
    const limit = sanitizeLimit(c.req.query('limit'));

    if (!['public', 'private', 'dm'].includes(kind) || !Number.isFinite(roomId)) {
      return errorResponse('参数无效');
    }

    const room = await requireAccessibleRoom(
      c.env.DB,
      session.userId,
      kind,
      roomId,
      session.isAdmin
    );

    if (!room) {
      return errorResponse('无权访问该会话', 403);
    }

    const messages = await listMessages(c.env.DB, roomId, before, limit, session.userId);
    await markRoomRead(c.env.DB, {
      channelId: roomId,
      userId: session.userId
    });

    return c.json({
      room: {
        id: Number(room.id),
        kind: room.kind,
        name: room.name,
        description: room.description
      },
      messages
    });
  });

  // 通过 REST 发送消息（语音等附件场景，避免依赖 WebSocket 就绪状态）
  app.post('/api/messages/send', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const kind = String(payload.kind || '');
    const roomId = Number(payload.roomId);
    const content = String(payload.content || '');
    const attachment = pickAttachment(payload.attachment);
    if (!['public', 'private', 'dm'].includes(kind) || !Number.isFinite(roomId)) {
      return errorResponse('参数无效');
    }
    if (!content.trim() && !attachment) {
      return errorResponse('消息内容不能为空');
    }

    const room = await requireAccessibleRoom(
      c.env.DB,
      session.userId,
      kind,
      roomId,
      session.isAdmin
    );
    if (!room) {
      return errorResponse('无权访问该会话', 403);
    }

    const saved = await insertMessage(c.env.DB, {
      channelId: roomId,
      senderId: session.userId,
      content,
      attachment
    });

    // 通过 WebSocket Durable Object 广播给房间内其他在线成员
    try {
      const stub = c.env.CHANNEL_ROOM.get(c.env.CHANNEL_ROOM.idFromName(`${kind}:${roomId}`));
      await stub.fetch('https://cfchat.internal/broadcast', {
        method: 'POST',
        headers: { 'x-cfchat-internal-auth': 'worker-verified' },
        body: JSON.stringify({
          type: 'message',
          message: saved,
          excludeUserId: session.userId
        })
      });
    } catch {
      // 广播失败不影响消息入库
    }

    return c.json({ message: saved });
  });

  app.post('/api/messages/read', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const kind = String(payload.kind || '');
    const roomId = Number(payload.roomId);
    const messageId = payload.messageId === undefined ? null : Number(payload.messageId);

    if (
      !['public', 'private', 'dm'].includes(kind) ||
      !Number.isFinite(roomId) ||
      (messageId !== null && !Number.isFinite(messageId))
    ) {
      return errorResponse('参数无效');
    }

    const room = await requireAccessibleRoom(
      c.env.DB,
      session.userId,
      kind,
      roomId,
      session.isAdmin
    );

    if (!room) {
      return errorResponse('无权访问该会话', 403);
    }

    const lastReadMessageId = await markRoomRead(c.env.DB, {
      channelId: roomId,
      userId: session.userId,
      messageId
    });

    return c.json({ ok: true, lastReadMessageId });
  });
}
