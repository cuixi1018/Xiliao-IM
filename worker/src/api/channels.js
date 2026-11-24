import {
  canManageChannel,
  getChannelById,
  getChannelMembership,
  listChannelMembers,
  requireAccessibleRoom
} from '../db.js';
import { ApiError } from '../errors.js';
import { errorResponse, parseJsonRequest, publicFileUrl } from '../utils.js';
import { areFriends } from './social.js';
import { insertMessage } from '../db.js';

// 在群内写入"XXX 加入了群聊"系统提示
async function announceJoin(db, channelId, actorId, addedNames) {
  if (!addedNames.length) return;
  const content = `「${addedNames.join('、')}」加入了群聊`;
  try {
    await insertMessage(db, { channelId, senderId: actorId, content, kind: 'system' });
  } catch {
    // 系统消息写入失败不影响主流程
  }
}

function mapChannelRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    avatarKey: row.avatar_key || '',
    avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : '',
    kind: row.kind,
    ownerDisplayName: row.owner_display_name || '',
    isMember: Boolean(Number(row.is_member)),
    myRole: row.my_role || '',
    canManage: Boolean(Number(row.can_manage)),
    memberCount: Number(row.member_count || 0),
    lastMessageAt: row.last_message_at || null,
    unreadCount: Number(row.unread_count || 0)
  };
}

function normalizeMemberIds(payload) {
  const source = Array.isArray(payload.memberUserIds)
    ? payload.memberUserIds
    : Array.isArray(payload.userIds)
      ? payload.userIds
      : [];

  return [...new Set(source.map((value) => Number(value)).filter((value) => Number.isFinite(value)))];
}

async function ensureValidInvitees(db, userIds, actorId) {
  if (!userIds.length) {
    return [];
  }

  const placeholders = userIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT id
       FROM users
       WHERE deleted_at IS NULL
         AND is_disabled = 0
         AND id IN (${placeholders})`
    )
    .bind(...userIds)
    .all();

  // 建群/邀请只能添加已成为好友的用户（微信规则：需先加好友，拥有对方细聊号）
  const valid = [];
  for (const row of results) {
    if (Number(row.id) === Number(actorId)) {
      continue;
    }
    if (await areFriends(db, actorId, row.id)) {
      valid.push(Number(row.id));
    }
  }
  return valid;
}

export function registerChannelRoutes(app) {
  app.get('/api/channels', async (c) => {
    const session = c.get('session');
    const { results } = await c.env.DB.prepare(
      `SELECT
         c.id,
         c.name,
         c.description,
         c.avatar_key,
         c.kind,
         owner.display_name AS owner_display_name,
         EXISTS (
           SELECT 1 FROM channel_members cm
           WHERE cm.channel_id = c.id AND cm.user_id = ?
         ) AS is_member,
         COALESCE((
           SELECT cm.role
           FROM channel_members cm
           WHERE cm.channel_id = c.id AND cm.user_id = ?
           LIMIT 1
         ), '') AS my_role,
         EXISTS (
           SELECT 1 FROM channel_members cm
           WHERE cm.channel_id = c.id AND cm.user_id = ? AND cm.role = 'owner'
         ) AS can_manage,
         (
           SELECT COUNT(*)
           FROM channel_members cm
           WHERE cm.channel_id = c.id
         ) AS member_count,
         (
           SELECT MAX(m.created_at)
           FROM messages m
           WHERE m.channel_id = c.id AND m.deleted_at IS NULL
         ) AS last_message_at,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM channel_members cm
             WHERE cm.channel_id = c.id AND cm.user_id = ?
           ) THEN (
             SELECT COUNT(*)
             FROM messages m
             WHERE m.channel_id = c.id
               AND m.deleted_at IS NULL
               AND m.sender_id != ?
               AND m.id > COALESCE((
                 SELECT mr.last_read_message_id
                 FROM message_reads mr
                 WHERE mr.channel_id = c.id
                   AND mr.user_id = ?
               ), 0)
           )
           ELSE 0
         END AS unread_count
       FROM channels c
       LEFT JOIN users owner ON owner.id = c.created_by
       WHERE c.kind IN ('public', 'private')
         AND c.deleted_at IS NULL
         AND (
           c.kind = 'public'
           OR EXISTS (
             SELECT 1 FROM channel_members cm
             WHERE cm.channel_id = c.id AND cm.user_id = ?
           )
         )
       ORDER BY CASE c.kind WHEN 'public' THEN 0 ELSE 1 END, c.name ASC`
    )
      .bind(
        session.userId,
        session.userId,
        session.userId,
        session.userId,
        session.userId,
        session.userId,
        session.userId
      )
      .all();

    const channels = results.map(mapChannelRow);
    return c.json({
      channels,
      publicChannels: channels.filter((channel) => channel.kind === 'public'),
      privateChannels: channels.filter((channel) => channel.kind === 'private')
    });
  });

  app.post('/api/channels', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const kind = String(payload.kind || 'public').trim();

    if (!name) {
      return errorResponse('群组名称不能为空');
    }

    if (!['public', 'private'].includes(kind)) {
      return errorResponse('群组类型无效');
    }

    const inviteUserIds = normalizeMemberIds(payload).filter((userId) => userId !== session.userId);
    const validInvitees = await ensureValidInvitees(c.env.DB, inviteUserIds, session.userId);
    const result = await c.env.DB.prepare(
      `INSERT INTO channels (name, description, kind, created_by)
       VALUES (?, ?, ?, ?)`
    )
      .bind(name, description, kind, session.userId)
      .run()
      .catch((error) => {
        if (String(error.message).includes('UNIQUE')) {
          throw new ApiError('群组名称已存在');
        }
        throw error;
      });

    const channelId = Number(result.meta.last_row_id);
    const statements = [
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
           VALUES (?, ?, 'owner', ?)`
        )
        .bind(channelId, session.userId, session.userId)
    ];

    validInvitees.forEach((userId) => {
      statements.push(
        c.env.DB
          .prepare(
            `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
             VALUES (?, ?, 'member', ?)`
          )
          .bind(channelId, userId, session.userId)
      );
    });
    await c.env.DB.batch(statements);

    return c.json({
      channel: {
        id: channelId,
        name,
        description,
        avatarKey: '',
        avatarUrl: '',
        kind,
        ownerDisplayName: session.displayName,
        isMember: true,
        myRole: 'owner',
        canManage: true,
        memberCount: 1 + validInvitees.length
      }
    });
  });

  app.post('/api/channels/:channelId/join', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    if (!Number.isFinite(channelId)) {
      return errorResponse('群组不存在', 404);
    }

    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel || channel.kind !== 'public') {
      return errorResponse('公开群组不存在', 404);
    }

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
       VALUES (?, ?, 'member', ?)`
    )
      .bind(channelId, session.userId, session.userId)
      .run();

    return c.json({ ok: true });
  });

  app.get('/api/channels/:channelId/members', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const channel = await getChannelById(c.env.DB, channelId);
    if (!channel || channel.kind === 'dm') {
      return errorResponse('群组不存在', 404);
    }

    const room = await requireAccessibleRoom(
      c.env.DB,
      session.userId,
      channel.kind,
      channelId,
      session.isAdmin
    );
    if (!room) {
      return errorResponse('无权查看群组成员', 403);
    }

    const membership = await getChannelMembership(c.env.DB, channelId, session.userId);
    return c.json({
      room: {
        id: Number(channel.id),
        name: channel.name,
        description: channel.description,
        avatarKey: channel.avatar_key || '',
        avatarUrl: channel.avatar_key ? publicFileUrl(channel.avatar_key) : '',
        kind: channel.kind,
        myRole: membership?.role || '',
        canManage: session.isAdmin || membership?.role === 'owner',
        announcement: channel.announcement || '',
        announcementAt: channel.announcement_at || null
      },
      members: await listChannelMembers(c.env.DB, channelId, session.userId)
    });
  });

  app.patch('/api/channels/:channelId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    if (!Number.isFinite(channelId)) {
      return errorResponse('群组不存在', 404);
    }

    const payload = await parseJsonRequest(c.req.raw);
    const name =
      payload.name === undefined ? undefined : String(payload.name || '').trim();
    const avatarKey =
      payload.avatarKey === undefined
        ? undefined
        : payload.avatarKey
          ? String(payload.avatarKey)
          : null;

    if (name !== undefined && !name) {
      return errorResponse('群组名称不能为空');
    }

    const management = await canManageChannel(c.env.DB, channelId, session.userId, session.isAdmin);
    if (!management) {
      return errorResponse('只有群主或管理员可以编辑群组', 403);
    }

    const updates = [];
    const binds = [];
    if (name !== undefined) {
      updates.push('name = ?');
      binds.push(name);
    }
    if (avatarKey !== undefined) {
      updates.push('avatar_key = ?');
      binds.push(avatarKey);
    }

    if (!updates.length) {
      return c.json({ ok: true });
    }

    try {
      await c.env.DB.prepare(
        `UPDATE channels
         SET ${updates.join(', ')}
         WHERE id = ?
           AND kind IN ('public', 'private')
           AND deleted_at IS NULL`
      )
        .bind(...binds, channelId)
        .run();
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        return errorResponse('群组名称已存在');
      }
      throw error;
    }

    const updated = await getChannelById(c.env.DB, channelId);
    return c.json({
      channel: {
        id: Number(updated.id),
        name: updated.name,
        avatarKey: updated.avatar_key || '',
        avatarUrl: updated.avatar_key ? publicFileUrl(updated.avatar_key) : ''
      }
    });
  });

  app.post('/api/channels/:channelId/invite', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const payload = await parseJsonRequest(c.req.raw);
    const management = await canManageChannel(c.env.DB, channelId, session.userId, session.isAdmin);
    if (!management) {
      return errorResponse('只有群主或管理员可以邀请成员', 403);
    }

    const userIds = normalizeMemberIds(payload).filter((userId) => userId !== session.userId);
    const validInvitees = await ensureValidInvitees(c.env.DB, userIds, session.userId);
    if (!validInvitees.length) {
      return errorResponse('只能邀请你的好友入群，请先添加对方为好友');
    }

    // 计算本次真正新增的成员（排除已在群内的）
    const existing = await c.env.DB.prepare(
      `SELECT user_id FROM channel_members WHERE channel_id = ?`
    ).bind(channelId).all();
    const existingIds = new Set(existing.results.map((r) => Number(r.user_id)));
    const newlyAdded = validInvitees.filter((id) => !existingIds.has(id));

    const statements = validInvitees.map((userId) =>
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
           VALUES (?, ?, 'member', ?)`
        )
        .bind(channelId, userId, session.userId)
    );
    await c.env.DB.batch(statements);

    if (newlyAdded.length) {
      const names = await c.env.DB.prepare(
        `SELECT display_name FROM users WHERE id IN (${newlyAdded.map(() => '?').join(',')})`
      ).bind(...newlyAdded).all();
      await announceJoin(c.env.DB, channelId, session.userId, names.results.map((r) => r.display_name));
    }

    return c.json({
      ok: true,
      members: await listChannelMembers(c.env.DB, channelId, session.userId)
    });
  });

  app.delete('/api/channels/:channelId/members/:userId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const userId = Number(c.req.param('userId'));
    const management = await canManageChannel(c.env.DB, channelId, session.userId, session.isAdmin);
    if (!management) {
      return errorResponse('只有群主或管理员可以移除成员', 403);
    }

    const targetMembership = await getChannelMembership(c.env.DB, channelId, userId);
    if (!targetMembership) {
      return errorResponse('成员不存在', 404);
    }

    if (targetMembership.role === 'owner') {
      return errorResponse('不能移除群主，请直接删除群组');
    }

    await c.env.DB.prepare(
      `DELETE FROM channel_members
       WHERE channel_id = ?
         AND user_id = ?`
    )
      .bind(channelId, userId)
      .run();

    return c.json({
      ok: true,
      members: await listChannelMembers(c.env.DB, channelId, session.userId)
    });
  });

  app.delete('/api/channels/:channelId', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('channelId'));
    const management = await canManageChannel(c.env.DB, channelId, session.userId, session.isAdmin);
    if (!management) {
      return errorResponse('只有群主或管理员可以删除群组', 403);
    }

    await c.env.DB.prepare(
      `UPDATE channels
       SET deleted_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND kind IN ('public', 'private')
         AND deleted_at IS NULL`
    )
      .bind(channelId)
      .run();

    return c.json({ ok: true });
  });

  app.get('/api/admin/channels', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT
         c.id,
         c.name,
         c.description,
         c.avatar_key,
         c.kind,
         c.created_at,
         owner.display_name AS owner_display_name,
         (
           SELECT COUNT(*)
           FROM channel_members cm
           WHERE cm.channel_id = c.id
         ) AS member_count,
         (
           SELECT COUNT(*)
           FROM messages m
           WHERE m.channel_id = c.id AND m.deleted_at IS NULL
         ) AS message_count
       FROM channels c
       LEFT JOIN users owner ON owner.id = c.created_by
       WHERE c.deleted_at IS NULL
         AND c.kind IN ('public', 'private')
       ORDER BY c.created_at DESC`
    ).all();

    return c.json({
      channels: results.map((row) => ({
        id: Number(row.id),
        name: row.name,
        description: row.description,
        avatarKey: row.avatar_key || '',
        avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : '',
        kind: row.kind,
        createdAt: row.created_at,
        ownerDisplayName: row.owner_display_name || '未知',
        memberCount: Number(row.member_count),
        messageCount: Number(row.message_count)
      }))
    });
  });

  app.delete('/api/admin/channels/:channelId', async (c) => {
    const channelId = Number(c.req.param('channelId'));
    await c.env.DB.prepare(
      `UPDATE channels
       SET deleted_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND kind IN ('public', 'private')
         AND deleted_at IS NULL`
    )
      .bind(channelId)
      .run();

    return c.json({ ok: true });
  });
}
