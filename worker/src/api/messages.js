import { getMessageById, insertMessage, listMessages, markRoomRead, requireAccessibleRoom } from '../db.js';
import { errorResponse, parseJsonRequest, pickAttachment, sanitizeLimit } from '../utils.js';

const RECALL_WINDOW_SECONDS = 120; // 2 分钟内可撤回，超时只能删除

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
      attachment,
      quote: payload.quote || null
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

  // 通用发送接口支持引用：payload.quote = { id, senderName, preview }
  // （send 接口已在上面，通过 insertMessage 天然支持 quote 字段）

  // ===== 撤回消息（仅自己发的、2 分钟内、未删除）=====
  app.post('/api/messages/:id/recall', async (c) => {
    const session = c.get('session');
    const messageId = Number(c.req.param('id'));
    if (!Number.isFinite(messageId)) {
      return errorResponse('消息不存在', 404);
    }

    const row = await c.env.DB.prepare(
      `SELECT id, sender_id, created_at, revoked_at, deleted_at, channel_id
       FROM messages WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(messageId)
      .all();
    const msg = row.results[0];
    if (!msg) {
      return errorResponse('消息不存在或已删除', 404);
    }
    if (Number(msg.sender_id) !== Number(session.userId)) {
      return errorResponse('只能撤回自己的消息', 403);
    }
    if (msg.revoked_at) {
      return errorResponse('消息已撤回');
    }

    const elapsed = (Date.now() - new Date(msg.created_at.replace(' ', 'T') + 'Z').getTime()) / 1000;
    if (elapsed > RECALL_WINDOW_SECONDS) {
      return errorResponse('超过 2 分钟，无法撤回，只能删除', 400);
    }

    await c.env.DB.prepare(
      `UPDATE messages SET revoked_at = CURRENT_TIMESTAMP, content = '',
         attachment_key = NULL, attachment_name = NULL, attachment_type = NULL,
         attachment_size = NULL, attachment_duration = NULL, quote_id = NULL,
         quote_snapshot = ''
       WHERE id = ? AND deleted_at IS NULL`
    )
      .bind(messageId)
      .run();

    // 广播撤回事件给房间内其他成员
    try {
      const channel = await c.env.DB.prepare('SELECT kind FROM channels WHERE id = ? LIMIT 1')
        .bind(msg.channel_id).all();
      const kind = channel.results[0]?.kind || 'private';
      const stub = c.env.CHANNEL_ROOM.get(c.env.CHANNEL_ROOM.idFromName(`${kind}:${msg.channel_id}`));
      await stub.fetch('https://cfchat.internal/broadcast', {
        method: 'POST',
        headers: { 'x-cfchat-internal-auth': 'worker-verified' },
        body: JSON.stringify({
          type: 'recall',
          message: { id: messageId, channelId: Number(msg.channel_id) }
        })
      });
    } catch {
      // 广播失败不影响撤回结果
    }

    return c.json({ ok: true });
  });

  // ===== 删除消息（仅自己发的，软删除，仅对自己可见）=====
  app.delete('/api/messages/:id', async (c) => {
    const session = c.get('session');
    const messageId = Number(c.req.param('id'));
    if (!Number.isFinite(messageId)) {
      return errorResponse('消息不存在', 404);
    }

    const row = await c.env.DB.prepare(
      `SELECT id, sender_id FROM messages WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(messageId)
      .all();
    const msg = row.results[0];
    if (!msg) {
      return errorResponse('消息不存在或已删除', 404);
    }
    if (Number(msg.sender_id) !== Number(session.userId)) {
      return errorResponse('只能删除自己的消息', 403);
    }

    // 用消息删除点表记录，仅对自己隐藏；避免影响他人
    await c.env.DB.prepare(
      `INSERT INTO message_delete_points (message_id, user_id, created_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(message_id, user_id) DO NOTHING`
    )
      .bind(messageId, session.userId)
      .run();

    return c.json({ ok: true });
  });

  // ===== 转发消息到另一个会话 =====
  app.post('/api/messages/:id/forward', async (c) => {
    const session = c.get('session');
    const messageId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const toKind = String(payload.toKind || '');
    const toRoomId = Number(payload.toRoomId);
    const extraContent = String(payload.content || '').trim();

    if (!Number.isFinite(messageId)) {
      return errorResponse('消息不存在', 404);
    }
    if (!['public', 'private', 'dm'].includes(toKind) || !Number.isFinite(toRoomId)) {
      return errorResponse('目标会话无效');
    }

    const source = await getMessageById(c.env.DB, messageId);
    if (!source || source.revokedAt) {
      return errorResponse('原消息不存在或已撤回', 404);
    }

    // 语音消息不支持转发
    if (source.attachment && String(source.attachment.type || '').startsWith('audio/')) {
      return errorResponse('语音消息不支持转发');
    }

    const room = await requireAccessibleRoom(
      c.env.DB, session.userId, toKind, toRoomId, session.isAdmin
    );
    if (!room) {
      return errorResponse('无权访问目标会话', 403);
    }

    const saved = await insertMessage(c.env.DB, {
      channelId: toRoomId,
      senderId: session.userId,
      content: extraContent || source.content || '',
      attachment: source.attachment,
      kind: 'forward'
    });

    try {
      const stub = c.env.CHANNEL_ROOM.get(c.env.CHANNEL_ROOM.idFromName(`${toKind}:${toRoomId}`));
      await stub.fetch('https://cfchat.internal/broadcast', {
        method: 'POST',
        headers: { 'x-cfchat-internal-auth': 'worker-verified' },
        body: JSON.stringify({
          type: 'message', message: saved, excludeUserId: session.userId
        })
      });
    } catch {
      // ignore
    }

    return c.json({ message: saved });
  });

  // ===== 搜索聊天记录（全局或指定会话）=====
  app.get('/api/messages/search', async (c) => {
    const session = c.get('session');
    const keyword = String(c.req.query('keyword') || '').trim();
    const roomIdRaw = c.req.query('roomId');
    const limit = sanitizeLimit(c.req.query('limit'), 50, 200);
    if (!keyword) {
      return c.json({ messages: [] });
    }

    const escaped = keyword.replace(/[\\%_]/g, '\\$&');
    const filters = [
      'm.deleted_at IS NULL',
      'm.revoked_at IS NULL',
      "(m.content LIKE ? ESCAPE '\\' OR m.attachment_name LIKE ? ESCAPE '\\')"
    ];
    const binds = [`%${escaped}%`, `%${escaped}%`];

    // 仅搜索我有权限的会话（我所在的群 或 我的私信）
    filters.push(`EXISTS (
      SELECT 1 FROM channel_members cm
      WHERE cm.channel_id = m.channel_id AND cm.user_id = ?
    )`);
    binds.push(Number(session.userId));

    if (roomIdRaw && Number.isFinite(Number(roomIdRaw))) {
      filters.push('m.channel_id = ?');
      binds.push(Number(roomIdRaw));
    }

    // 屏蔽我拉黑的用户
    filters.push(`m.sender_id NOT IN (SELECT blocked_user_id FROM blacklist WHERE user_id = ?)`);
    binds.push(Number(session.userId));

    const { results } = await c.env.DB.prepare(
      `SELECT
         m.id, m.content, m.attachment_name, m.kind, m.created_at,
         m.channel_id, c.name AS channel_name, c.kind AS channel_kind,
         u.id AS sender_id, u.display_name AS sender_display_name
       FROM messages m
       JOIN channels c ON c.id = m.channel_id
       JOIN users u ON u.id = m.sender_id
       WHERE ${filters.join(' AND ')}
       ORDER BY m.id DESC
       LIMIT ?`
    )
      .bind(...binds, limit)
      .all();

    return c.json({
      messages: results.map((row) => ({
        id: Number(row.id),
        content: row.content,
        attachmentName: row.attachment_name || '',
        kind: row.kind || 'user',
        createdAt: row.created_at,
        room: {
          id: Number(row.channel_id),
          name: row.channel_name,
          kind: row.channel_kind
        },
        sender: {
          id: Number(row.sender_id),
          displayName: row.sender_display_name
        }
      }))
    });
  });
}
