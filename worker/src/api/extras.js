import { errorResponse, parseJsonRequest } from '../utils.js';
import { areFriends } from './social.js';
import { getSession, putSession } from '../auth.js';
import { deactivateUserAccount } from '../db.js';

function mapUserBrief(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    chatId: row.chat_id || '',
    avatarUrl: row.avatar_key ? `/files/${encodeURIComponent(row.avatar_key)}` : '',
    signature: row.signature || '',
    gender: row.gender || 'secret',
    birthdate: row.birthdate || ''
  };
}

// 细聊号：仅字母数字，4-20 位，全局唯一；每 7 天只能修改一次
const CHAT_ID_PATTERN = /^[a-z0-9]{4,20}$/;
const CHAT_ID_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function registerExtraRoutes(app) {
  // ===== 修改自己的细聊号（仅字母数字，7 天一次）=====
  app.put('/api/me/chat-id', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const raw = String(payload.chatId || '').trim().toLowerCase();
    if (!CHAT_ID_PATTERN.test(raw)) {
      return errorResponse('细聊号只能包含字母和数字，长度 4-20 位，不能包含 # 或其他符号');
    }

    // 7 天冷却：从上次修改时间算起（chat_id_changed_at 为 NULL 表示从未改过，允许修改）
    const me = await c.env.DB.prepare(
      `SELECT chat_id, chat_id_changed_at FROM users WHERE id = ? LIMIT 1`
    )
      .bind(session.userId)
      .first();
    if (me?.chat_id_changed_at) {
      const lastMs = new Date(me.chat_id_changed_at).getTime();
      if (Number.isFinite(lastMs) && Date.now() - lastMs < CHAT_ID_COOLDOWN_MS) {
        const remainMs = CHAT_ID_COOLDOWN_MS - (Date.now() - lastMs);
        const remainDays = Math.ceil(remainMs / (24 * 60 * 60 * 1000));
        return errorResponse(`细聊号 7 天内只能修改一次，请 ${remainDays} 天后再试`, 429);
      }
    }

    // 允许保留自己当前的号（去掉 # 后与当前相同视为无变化）——但当前号含 # 不合规，仍需改
    const existing = await c.env.DB.prepare(
      `SELECT id FROM users WHERE chat_id = ? AND id != ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(raw, session.userId)
      .all();
    if (existing.results[0]) {
      return errorResponse('该细聊号已被占用', 409);
    }

    try {
      await c.env.DB.prepare(
        `UPDATE users SET chat_id = ?, chat_id_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
        .bind(raw, session.userId)
        .run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        return errorResponse('该细聊号已被占用', 409);
      }
      throw error;
    }

    const current = await getSession(c.env, session.token);
    if (current) {
      await putSession(c.env, { ...current, chatId: raw });
    }
    return c.json({ ok: true, chatId: raw });
  });

  // ===== 全局搜索：聊天记录 + 用户（细聊号/昵称/用户名）=====
  app.get('/api/search', async (c) => {
    const session = c.get('session');
    const q = String(c.req.query('q') || '').trim();
    if (!q) {
      return c.json({ messages: [], users: [] });
    }
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const like = `%${escaped}%`;

    // 用户
    const userRows = await c.env.DB.prepare(
      `SELECT id, username, display_name, chat_id, avatar_key, signature
       FROM users
       WHERE deleted_at IS NULL AND is_disabled = 0 AND id != ?
         AND (chat_id = ? OR chat_id LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\')
         AND id NOT IN (SELECT blocked_user_id FROM blacklist WHERE user_id = ?)
       ORDER BY (chat_id = ?) DESC, display_name ASC
       LIMIT 20`
    )
      .bind(session.userId, q, like, like, like, session.userId, q)
      .all();

    const users = [];
    for (const row of userRows.results) {
      const friend = await areFriends(c.env.DB, session.userId, row.id);
      users.push({ ...mapUserBrief(row), isFriend: friend });
    }

    // 聊天记录（我有权限的会话）
    const msgRows = await c.env.DB.prepare(
      `SELECT m.id, m.content, m.attachment_name, m.created_at, m.kind,
              m.channel_id, ch.name AS channel_name, ch.kind AS channel_kind,
              u.display_name AS sender_name
       FROM messages m
       JOIN channels ch ON ch.id = m.channel_id
       JOIN users u ON u.id = m.sender_id
       WHERE m.deleted_at IS NULL AND m.revoked_at IS NULL
         AND (m.content LIKE ? ESCAPE '\\' OR m.attachment_name LIKE ? ESCAPE '\\')
         AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = m.channel_id AND cm.user_id = ?)
         AND m.id NOT IN (SELECT message_id FROM message_delete_points WHERE user_id = ?)
       ORDER BY m.id DESC
       LIMIT 30`
    )
      .bind(like, like, session.userId, session.userId)
      .all();

    const messages = msgRows.results.map((row) => ({
      id: Number(row.id),
      content: row.content,
      attachmentName: row.attachment_name || '',
      createdAt: row.created_at,
      kind: row.kind || 'user',
      room: { id: Number(row.channel_id), name: row.channel_name, kind: row.channel_kind },
      senderName: row.sender_name
    }));

    return c.json({ users, messages });
  });

  // ===== 好友备注名（仅自己可见，群里显示为备注名）=====
  app.put('/api/friends/:id/remark', async (c) => {
    const session = c.get('session');
    const targetId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const remark = String(payload.remark || '').trim().slice(0, 40);
    if (!Number.isFinite(targetId)) {
      return errorResponse('用户不存在', 404);
    }
    if (!(await areFriends(c.env.DB, session.userId, targetId))) {
      return errorResponse('只能备注你的好友', 403);
    }

    await c.env.DB.prepare(
      `UPDATE friendships SET remark = ?, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'accepted'
         AND ((requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?))`
    )
      .bind(remark, session.userId, targetId, targetId, session.userId)
      .run();

    return c.json({ ok: true, remark });
  });

  // 单条好友详情（含我的备注名 + 对方原始昵称）
  app.get('/api/friends/:id/detail', async (c) => {
    const session = c.get('session');
    const targetId = Number(c.req.param('id'));
    const row = await c.env.DB.prepare(
      `SELECT u.*, (
         SELECT f.remark FROM friendships f
         WHERE f.status = 'accepted'
           AND ((f.requester_id = ? AND f.addressee_id = u.id)
             OR (f.addressee_id = ? AND f.requester_id = u.id))
         LIMIT 1
       ) AS my_remark
       FROM users u WHERE u.id = ? AND u.deleted_at IS NULL LIMIT 1`
    )
      .bind(session.userId, session.userId, targetId)
      .all();
    const r = row.results[0];
    if (!r) return errorResponse('用户不存在', 404);

    const friend = await areFriends(c.env.DB, session.userId, targetId);
    const { results: rel } = await c.env.DB.prepare(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?)
          OR (requester_id = ? AND addressee_id = ?)
       LIMIT 1`
    )
      .bind(session.userId, targetId, targetId, session.userId)
      .all();
    const blocked = await c.env.DB.prepare(
      `SELECT 1 FROM blacklist WHERE user_id = ? AND blocked_user_id = ? LIMIT 1`
    )
      .bind(targetId, session.userId)
      .all();

    return c.json({
      user: {
        ...mapUserBrief(r),
        myRemark: r.my_remark || '',
        displayInGroup: r.my_remark || r.display_name,
        isFriend: friend,
        relationStatus: rel[0]?.status || '',
        relationDirection: rel[0] ? (Number(rel[0].requester_id) === session.userId ? 'outgoing' : 'incoming') : '',
        relationRequestId: rel[0] ? Number(rel[0].id) : null,
        blockedByThem: Boolean(blocked.results[0])
      }
    });
  });

  // ===== 投诉好友 =====
  app.post('/api/complaints', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const targetId = Number(payload.targetId);
    const reason = String(payload.reason || '').trim().slice(0, 80);
    const detail = String(payload.detail || '').trim().slice(0, 500);
    if (!Number.isFinite(targetId) || targetId === session.userId) {
      return errorResponse('无效的目标用户');
    }
    if (!reason) {
      return errorResponse('请选择投诉原因');
    }
    const target = await c.env.DB.prepare(
      'SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1'
    ).bind(targetId).all();
    if (!target.results[0]) {
      return errorResponse('用户不存在', 404);
    }

    await c.env.DB.prepare(
      `INSERT INTO complaints (reporter_id, target_id, reason, detail, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
      .bind(session.userId, targetId, reason, detail)
      .run();

    return c.json({ ok: true });
  });

  // ===== 设置是否需要好友验证 =====
  app.put('/api/me/friend-verify', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const required = Boolean(payload.required);
    await c.env.DB.prepare(
      `UPDATE users SET friend_verify_required = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(required ? 1 : 0, session.userId)
      .run();
    return c.json({ ok: true, required });
  });

  // ===== 我的资料（含好友验证开关）=====
  app.get('/api/me', async (c) => {
    const session = c.get('session');
    const row = await c.env.DB.prepare(
      `SELECT id, username, display_name, chat_id, avatar_key, signature, gender, birthdate, friend_verify_required
       FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(session.userId).all();
    const r = row.results[0];
    if (!r) return errorResponse('用户不存在', 404);
    return c.json({ profile: { ...mapUserBrief(r), friendVerifyRequired: Boolean(Number(r.friend_verify_required)) } });
  });

  // ===== 标记欢迎提示已读 =====
  app.post('/api/me/welcome-seen', async (c) => {
    const session = c.get('session');
    await c.env.DB.prepare(
      `UPDATE users SET is_new_user = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(session.userId).run();
    return c.json({ ok: true });
  });

  // ===== 群公告：读取（在 members 接口已返回 room，这里单独提供更新）=====
  app.patch('/api/channels/:id/announcement', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const announcement = String(payload.announcement || '').trim().slice(0, 1000);

    const mgmt = await c.env.DB.prepare(
      `SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ? LIMIT 1`
    ).bind(channelId, session.userId).all();
    const isOwner = mgmt.results[0]?.role === 'owner';
    if (!isOwner && !session.isAdmin) {
      return errorResponse('只有群主或管理员可以设置群公告', 403);
    }

    await c.env.DB.prepare(
      `UPDATE channels SET announcement = ?, announcement_at = CURRENT_TIMESTAMP
       WHERE id = ? AND kind IN ('public','private') AND deleted_at IS NULL`
    )
      .bind(announcement, channelId)
      .run();

    return c.json({ ok: true, announcement });
  });

  // ===== 注销账号：退出所有群聊 + 清空聊天记录 + 提醒好友 =====
  app.post('/api/me/deactivate', async (c) => {
    const session = c.get('session');
    if (!session || !session.userId) {
      return errorResponse('请先登录', 401);
    }
    const result = await deactivateUserAccount(c.env.DB, session.userId);
    return c.json({ ok: true, ...result });
  });
}
