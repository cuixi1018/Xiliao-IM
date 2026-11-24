import { errorResponse, parseJsonRequest } from '../utils.js';
import { requireAccessibleRoom } from '../db.js';

function mapUserRow(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    chatId: row.chat_id || '',
    avatarUrl: row.avatar_key ? `/files/${encodeURIComponent(row.avatar_key)}` : ''
  };
}

// 判断两个用户是否互为好友
export async function areFriends(db, userIdA, userIdB) {
  const { results } = await db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?))
       LIMIT 1`
    )
    .bind(Number(userIdA), Number(userIdB), Number(userIdB), Number(userIdA))
    .all();
  return Boolean(results[0]);
}

// 判断是否被对方拉黑（blockedUserId 拉黑了 viewerId）
export async function isBlockedBy(db, viewerId, blockedUserId) {
  const { results } = await db
    .prepare(
      `SELECT 1 FROM blacklist
       WHERE user_id = ? AND blocked_user_id = ?
       LIMIT 1`
    )
    .bind(Number(blockedUserId), Number(viewerId))
    .all();
  return Boolean(results[0]);
}

export function registerSocialRoutes(app) {
  // ===== 好友列表 + 申请 =====
  app.get('/api/friends', async (c) => {
    const session = c.get('session');
    const me = session.userId;

    const [friendsResult, incomingResult, outgoingResult] = await Promise.all([
      c.env.DB.prepare(
        `SELECT u.id, u.username, u.display_name, u.chat_id, u.avatar_key
         FROM friendships f
         JOIN users u
           ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
           AND u.deleted_at IS NULL
         ORDER BY u.display_name ASC`
      )
        .bind(me, me, me)
        .all(),
      c.env.DB.prepare(
        `SELECT f.id AS request_id, f.note, f.created_at,
                u.id, u.username, u.display_name, u.chat_id, u.avatar_key
         FROM friendships f
         JOIN users u ON u.id = f.requester_id
         WHERE f.addressee_id = ? AND f.status = 'pending'
           AND u.deleted_at IS NULL
         ORDER BY f.created_at DESC`
      )
        .bind(me)
        .all(),
      c.env.DB.prepare(
        `SELECT f.id AS request_id, f.note, f.created_at,
                u.id, u.username, u.display_name, u.chat_id, u.avatar_key
         FROM friendships f
         JOIN users u ON u.id = f.addressee_id
         WHERE f.requester_id = ? AND f.status = 'pending'
           AND u.deleted_at IS NULL
         ORDER BY f.created_at DESC`
      )
        .bind(me)
        .all()
    ]);

    return c.json({
      friends: friendsResult.results.map(mapUserRow),
      incoming: incomingResult.results.map((row) => ({ ...mapUserRow(row), requestId: Number(row.request_id), note: row.note || '', createdAt: row.created_at })),
      outgoing: outgoingResult.results.map((row) => ({ ...mapUserRow(row), requestId: Number(row.request_id), note: row.note || '', createdAt: row.created_at }))
    });
  });

  // ===== 按细聊号/用户名搜索用户 =====
  app.post('/api/friends/search', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const keyword = String(payload.keyword || '').trim();
    if (!keyword) {
      return c.json({ users: [] });
    }

    // 精确按细聊号，或前缀匹配用户名/昵称/细聊号
    const like = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
    const { results } = await c.env.DB.prepare(
      `SELECT id, username, display_name, chat_id, avatar_key
       FROM users
       WHERE deleted_at IS NULL
         AND is_disabled = 0
         AND id != ?
         AND (chat_id = ? OR username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR chat_id LIKE ? ESCAPE '\\')
       ORDER BY (chat_id = ?) DESC, display_name ASC
       LIMIT 20`
    )
      .bind(session.userId, keyword, like, like, like, keyword)
      .all();

    // 标注好友/申请状态
    const users = [];
    for (const row of results) {
      const friend = await areFriends(c.env.DB, session.userId, row.id);
      const { results: rel } = await c.env.DB.prepare(
        `SELECT status, requester_id FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?)
         LIMIT 1`
      )
        .bind(session.userId, row.id, row.id, session.userId)
        .all();
      const blocked = await isBlockedBy(c.env.DB, session.userId, row.id);
      users.push({
        ...mapUserRow(row),
        isFriend: friend,
        relationStatus: rel[0]?.status || '',
        relationDirection: rel[0] ? (Number(rel[0].requester_id) === session.userId ? 'outgoing' : 'incoming') : '',
        blocked
      });
    }
    return c.json({ users });
  });

  // ===== 发送好友申请 =====
  app.post('/api/friends/request', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const note = String(payload.note || '').trim().slice(0, 100);
    const targetId = Number(payload.userId);

    let targetRow = null;
    if (Number.isFinite(targetId) && targetId) {
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND is_disabled = 0 LIMIT 1`
      )
        .bind(targetId)
        .all();
      targetRow = results[0] || null;
    } else if (payload.chatId) {
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM users WHERE chat_id = ? AND deleted_at IS NULL AND is_disabled = 0 LIMIT 1`
      )
        .bind(String(payload.chatId).trim())
        .all();
      targetRow = results[0] || null;
    }

    if (!targetRow || Number(targetRow.id) === session.userId) {
      return errorResponse('找不到该用户');
    }
    const targetUserId = Number(targetRow.id);

    if (await isBlockedBy(c.env.DB, targetUserId, session.userId)) {
      return errorResponse('无法添加该用户');
    }
    if (await areFriends(c.env.DB, session.userId, targetUserId)) {
      return errorResponse('你们已经是好友了');
    }

    // 若对方已申请过我，则直接互相通过
    const { results: incoming } = await c.env.DB.prepare(
      `SELECT id FROM friendships
       WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'
       LIMIT 1`
    )
      .bind(targetUserId, session.userId)
      .all();
    if (incoming[0]) {
      await c.env.DB.prepare(
        `UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
        .bind(Number(incoming[0].id))
        .run();
      return c.json({ ok: true, accepted: true });
    }

    try {
      await c.env.DB.prepare(
        `INSERT INTO friendships (requester_id, addressee_id, status, note)
         VALUES (?, ?, 'pending', ?)
         ON CONFLICT(requester_id, addressee_id) DO UPDATE
         SET note = excluded.note, updated_at = CURRENT_TIMESTAMP`
      )
        .bind(session.userId, targetUserId, note)
        .run();
    } catch (error) {
      return errorResponse('发送申请失败，请稍后重试', 500);
    }

    return c.json({ ok: true });
  });

  // ===== 处理好友申请 =====
  app.post('/api/friends/respond', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const requestId = Number(payload.requestId);
    const accept = Boolean(payload.accept);
    if (!Number.isFinite(requestId)) {
      return errorResponse('申请不存在');
    }

    const { results } = await c.env.DB.prepare(
      `SELECT id, addressee_id, status FROM friendships WHERE id = ? LIMIT 1`
    )
      .bind(requestId)
      .all();
    const req = results[0];
    if (!req || Number(req.addressee_id) !== session.userId || req.status !== 'pending') {
      return errorResponse('申请不存在或已处理', 404);
    }

    if (accept) {
      await c.env.DB.prepare(
        `UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
        .bind(requestId)
        .run();
    } else {
      await c.env.DB.prepare(`DELETE FROM friendships WHERE id = ?`).bind(requestId).run();
    }
    return c.json({ ok: true });
  });

  // ===== 删除好友 =====
  app.delete('/api/friends/:userId', async (c) => {
    const session = c.get('session');
    const userId = Number(c.req.param('userId'));
    await c.env.DB.prepare(
      `DELETE FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?))`
    )
      .bind(session.userId, userId, userId, session.userId)
      .run();
    return c.json({ ok: true });
  });

  // ===== 黑名单列表 =====
  app.get('/api/blacklist', async (c) => {
    const session = c.get('session');
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.chat_id, u.avatar_key
       FROM blacklist b
       JOIN users u ON u.id = b.blocked_user_id
       WHERE b.user_id = ? AND u.deleted_at IS NULL
       ORDER BY b.created_at DESC`
    )
      .bind(session.userId)
      .all();
    return c.json({ users: results.map(mapUserRow) });
  });

  // ===== 拉黑 =====
  app.post('/api/blacklist', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const userId = Number(payload.userId);
    if (!Number.isFinite(userId) || userId === session.userId) {
      return errorResponse('无效用户');
    }
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(userId)
      .all();
    if (!results[0]) {
      return errorResponse('用户不存在', 404);
    }
    const batch = [
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO blacklist (user_id, blocked_user_id) VALUES (?, ?)`
      )
        .bind(session.userId, userId),
      // 拉黑同时解除好友关系
      c.env.DB.prepare(
        `DELETE FROM friendships
         WHERE status = 'accepted'
           AND ((requester_id = ? AND addressee_id = ?)
             OR (requester_id = ? AND addressee_id = ?))`
      )
        .bind(session.userId, userId, userId, session.userId)
    ];
    await c.env.DB.batch(batch);
    return c.json({ ok: true });
  });

  // ===== 解除拉黑 =====
  app.delete('/api/blacklist/:userId', async (c) => {
    const session = c.get('session');
    const userId = Number(c.req.param('userId'));
    await c.env.DB.prepare(
      `DELETE FROM blacklist WHERE user_id = ? AND blocked_user_id = ?`
    )
      .bind(session.userId, userId)
      .run();
    return c.json({ ok: true });
  });

  // ===== 退群（群主不可直接退，需先删除群或转让；此处仅普通成员可退） =====
  app.post('/api/channels/:channelId/leave', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const membership = await c.env.DB.prepare(
      `SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1`
    )
      .bind(channelId, session.userId)
      .all();
    if (!membership[0]) {
      return errorResponse('你不在该群中', 404);
    }
    if (membership[0].role === 'owner') {
      return errorResponse('群主不能直接退群，请解散群聊或先转让群主');
    }
    await c.env.DB.prepare(
      `DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?`
    )
      .bind(channelId, session.userId)
      .run();
    return c.json({ ok: true });
  });

  // ===== 清空自己看到的聊天记录（仅对自己生效） =====
  app.post('/api/messages/clear', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const kind = String(payload.kind || '');
    const roomId = Number(payload.roomId);
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

    const { results } = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(id), 0) AS max_id FROM messages WHERE channel_id = ?`
    )
      .bind(roomId)
      .all();
    const maxId = Number(results[0]?.max_id || 0);

    await c.env.DB.prepare(
      `INSERT INTO channel_clear_points (channel_id, user_id, cleared_before_id, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, user_id) DO UPDATE
       SET cleared_before_id = MAX(channel_clear_points.cleared_before_id, excluded.cleared_before_id),
           updated_at = CURRENT_TIMESTAMP`
    )
      .bind(roomId, session.userId, maxId + 1)
      .run();

    return c.json({ ok: true });
  });
}
