import { generateChatId, pickAttachment, publicFileUrl } from './utils.js';

// 生成一个 database 内唯一的细聊号，冲突时重试
export async function makeUniqueChatId(db, username) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const chatId = generateChatId(username);
    const { results } = await db
      .prepare('SELECT 1 FROM users WHERE chat_id = ? LIMIT 1')
      .bind(chatId)
      .all();
    if (!results[0]) {
      return chatId;
    }
  }
  // 极端兜底：追加时间戳，几乎不可能冲突
  return `${generateChatId(username)}${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getUserByUsername(db, username) {
  const { results } = await db
    .prepare(
      `SELECT *
       FROM users
       WHERE username = ?
         AND deleted_at IS NULL
       LIMIT 1`
    )
    .bind(username)
    .all();

  return results[0] || null;
}

export async function isUserActiveById(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT id
       FROM users
       WHERE id = ?
         AND deleted_at IS NULL
         AND is_disabled = 0
       LIMIT 1`
    )
    .bind(Number(userId))
    .all();

  return Boolean(results[0]);
}

export async function getSiteSettings(db) {
  const { results } = await db
    .prepare(
      `SELECT setting_key, setting_value
       FROM site_settings`
    )
    .all();

  const map = Object.fromEntries(results.map((row) => [row.setting_key, row.setting_value]));
  return {
    siteName: String(map.site_name || 'Xiliao'),
    siteIconUrl: String(map.site_icon_url || ''),
    allowRegistration: String(map.allow_registration ?? '1') === '1',
    autoDeleteLargeFiles: String(map.auto_delete_large_files || '0') === '1',
    largeFileThreshold: Number(map.large_file_threshold || 10485760)
  };
}

export async function updateSiteSettings(db, { siteName, siteIconUrl, allowRegistration, autoDeleteLargeFiles, largeFileThreshold }) {
  const statements = [];

  if (siteName !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_settings (setting_key, setting_value, updated_at)
           VALUES ('site_name', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE
           SET setting_value = excluded.setting_value,
               updated_at = CURRENT_TIMESTAMP`
        )
        .bind(String(siteName || 'Xiliao').trim() || 'Xiliao')
    );
  }

  if (siteIconUrl !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_settings (setting_key, setting_value, updated_at)
           VALUES ('site_icon_url', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE
           SET setting_value = excluded.setting_value,
               updated_at = CURRENT_TIMESTAMP`
        )
        .bind(String(siteIconUrl || '').trim())
    );
  }

  if (allowRegistration !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_settings (setting_key, setting_value, updated_at)
           VALUES ('allow_registration', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE
           SET setting_value = excluded.setting_value,
               updated_at = CURRENT_TIMESTAMP`
        )
        .bind(allowRegistration ? '1' : '0')
    );
  }

  if (autoDeleteLargeFiles !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_settings (setting_key, setting_value, updated_at)
           VALUES ('auto_delete_large_files', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE
           SET setting_value = excluded.setting_value,
               updated_at = CURRENT_TIMESTAMP`
        )
        .bind(autoDeleteLargeFiles ? '1' : '0')
    );
  }

  if (largeFileThreshold !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_settings (setting_key, setting_value, updated_at)
           VALUES ('large_file_threshold', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE
           SET setting_value = excluded.setting_value,
               updated_at = CURRENT_TIMESTAMP`
        )
        .bind(String(Math.max(1024, Number(largeFileThreshold) || 10485760)))
    );
  }

  if (statements.length) {
    await db.batch(statements);
  }

  return getSiteSettings(db);
}

export async function getChannelById(db, channelId) {
  const { results } = await db
    .prepare(
      `SELECT id, name, description, avatar_key, kind, dm_key, created_by, announcement, announcement_at
       FROM channels
       WHERE id = ?
         AND deleted_at IS NULL
       LIMIT 1`
    )
    .bind(Number(channelId))
    .all();

  return results[0] || null;
}

export async function getChannelMembership(db, channelId, userId) {
  const { results } = await db
    .prepare(
      `SELECT channel_id, user_id, role, joined_at
       FROM channel_members
       WHERE channel_id = ?
         AND user_id = ?
       LIMIT 1`
    )
    .bind(Number(channelId), Number(userId))
    .all();

  return results[0] || null;
}

export async function requireAccessibleRoom(db, userId, kind, roomId, isAdmin = false) {
  const numericRoomId = Number(roomId);
  if (!Number.isFinite(numericRoomId)) {
    return null;
  }

  const membershipCondition = isAdmin
    ? '1 = 1'
    : 'EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?)';

  const statement = db.prepare(
    `SELECT c.id, c.name, c.description, c.avatar_key, c.kind, c.dm_key
     FROM channels c
     WHERE c.id = ?
       AND c.kind = ?
       AND c.deleted_at IS NULL
       AND ${membershipCondition}
     LIMIT 1`
  );

  const bound = isAdmin
    ? statement.bind(numericRoomId, kind)
    : statement.bind(numericRoomId, kind, Number(userId));
  const { results } = await bound.all();
  return results[0] || null;
}

export async function canManageChannel(db, channelId, userId, isAdmin = false) {
  const channel = await getChannelById(db, channelId);
  if (!channel || channel.kind === 'dm') {
    return null;
  }

  if (isAdmin) {
    return {
      channel,
      membership: { role: 'owner' }
    };
  }

  const membership = await getChannelMembership(db, channelId, userId);
  if (!membership || membership.role !== 'owner') {
    return null;
  }

  return { channel, membership };
}

export async function listChannelMembers(db, channelId, viewerId = null) {
  const { results } = await db
    .prepare(
      `SELECT
         cm.user_id,
         cm.role,
         cm.joined_at,
         u.username,
         u.display_name,
         u.chat_id,
         u.avatar_key,
         u.signature,
         u.gender,
         u.birthdate,
         (
           SELECT f.remark FROM friendships f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = ? AND f.addressee_id = cm.user_id)
               OR (f.addressee_id = ? AND f.requester_id = cm.user_id))
           LIMIT 1
         ) AS remark
       FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.channel_id = ?
         AND u.deleted_at IS NULL
       ORDER BY CASE cm.role WHEN 'owner' THEN 0 ELSE 1 END, u.display_name ASC`
    )
      .bind(Number(viewerId || 0), Number(viewerId || 0), Number(channelId))
    .all();

  return results.map((row) => ({
    id: Number(row.user_id),
    username: row.username,
    displayName: row.display_name,
    chatId: row.chat_id || '',
    avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : '',
    signature: row.signature || '',
    gender: row.gender || 'secret',
    birthdate: row.birthdate || '',
    // 群里优先显示我给对方设置的备注名，其次昵称
    remarkName: row.remark || '',
    displayInGroup: row.remark || row.display_name,
    role: row.role,
    joinedAt: row.joined_at
  }));
}

export async function listMessages(db, roomId, before = null, limit = 30, viewerId = null) {
  const filters = ['m.channel_id = ?', 'm.deleted_at IS NULL'];
  const binds = [Number(roomId)];
  // SELECT 中备注名子查询需要两个 viewerId（放在最前）
  const displayViewer = viewerId === null || viewerId === undefined ? 0 : Number(viewerId);
  if (before) {
    filters.push('m.id < ?');
    binds.push(Number(before));
  }
  if (viewerId !== null && viewerId !== undefined) {
    filters.push(`m.id >= COALESCE((
      SELECT ccp.cleared_before_id FROM channel_clear_points ccp
      WHERE ccp.channel_id = m.channel_id AND ccp.user_id = ?
    ), 0)`);
    binds.push(Number(viewerId));
    // 屏蔽被我拉黑用户发送的消息
    filters.push(`m.sender_id NOT IN (
      SELECT blocked_user_id FROM blacklist WHERE user_id = ?
    )`);
    binds.push(Number(viewerId));
    // 屏蔽我自己删除的消息
    filters.push(`m.id NOT IN (
      SELECT message_id FROM message_delete_points WHERE user_id = ?
    )`);
    binds.push(Number(viewerId));
  }

  const { results } = await db
    .prepare(
      `SELECT
         m.id,
         m.content,
         m.attachment_key,
         m.attachment_name,
         m.attachment_type,
         m.attachment_size,
         m.attachment_duration,
         m.kind,
         m.quote_id,
         m.quote_snapshot,
         m.revoked_at,
         m.created_at,
         u.id AS sender_id,
         u.username AS sender_username,
         COALESCE((
           SELECT f.remark FROM friendships f
           WHERE f.status = 'accepted' AND f.remark != ''
             AND ((f.requester_id = ? AND f.addressee_id = m.sender_id)
               OR (f.addressee_id = ? AND f.requester_id = m.sender_id))
           LIMIT 1
         ), u.display_name) AS sender_display_name,
         u.avatar_key AS sender_avatar_key
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE ${filters.join(' AND ')}
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .bind(displayViewer, displayViewer, ...binds, Number(limit))
    .all();

  return results
    .map((row) => mapMessage(row))
    .reverse();
}

async function resolveReadableMessageId(db, channelId, messageId = null) {
  const filters = ['channel_id = ?', 'deleted_at IS NULL'];
  const binds = [Number(channelId)];
  if (messageId !== null && messageId !== undefined) {
    filters.push('id <= ?');
    binds.push(Number(messageId));
  }

  const { results } = await db
    .prepare(
      `SELECT COALESCE(MAX(id), 0) AS message_id
       FROM messages
       WHERE ${filters.join(' AND ')}`
    )
    .bind(...binds)
    .all();

  return Number(results[0]?.message_id || 0);
}

export async function markRoomRead(db, { channelId, userId, messageId = null }) {
  const lastReadMessageId = await resolveReadableMessageId(db, channelId, messageId);
  await db
    .prepare(
      `INSERT INTO message_reads (
         channel_id,
         user_id,
         last_read_message_id,
         updated_at
       ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, user_id) DO UPDATE
       SET last_read_message_id = MAX(message_reads.last_read_message_id, excluded.last_read_message_id),
           updated_at = CURRENT_TIMESTAMP`
    )
    .bind(Number(channelId), Number(userId), lastReadMessageId)
    .run();

  return lastReadMessageId;
}

export async function countUnreadMessages(db, { channelId, userId }) {
  const { results } = await db
    .prepare(
      `SELECT COUNT(*) AS unread_count
       FROM messages m
       WHERE m.channel_id = ?
         AND m.deleted_at IS NULL
         AND m.sender_id != ?
         AND m.id > COALESCE((
           SELECT mr.last_read_message_id
           FROM message_reads mr
           WHERE mr.channel_id = ?
             AND mr.user_id = ?
         ), 0)
         AND m.id >= COALESCE((
           SELECT ccp.cleared_before_id FROM channel_clear_points ccp
           WHERE ccp.channel_id = m.channel_id AND ccp.user_id = ?
         ), 0)
         AND m.sender_id NOT IN (
           SELECT blocked_user_id FROM blacklist WHERE user_id = ?
         )
         AND m.id NOT IN (
           SELECT message_id FROM message_delete_points WHERE user_id = ?
         )`
    )
      .bind(Number(channelId), Number(userId), Number(channelId), Number(userId), Number(userId), Number(userId), Number(userId))
      .all();

  return Number(results[0]?.unread_count || 0);
}

export async function listRoomMemberIds(db, channelId) {
  const { results } = await db
    .prepare(
      `SELECT user_id
       FROM channel_members
       WHERE channel_id = ?`
    )
    .bind(Number(channelId))
    .all();

  return results.map((row) => Number(row.user_id)).filter((userId) => Number.isFinite(userId));
}

export async function insertMessage(db, { channelId, senderId, content, attachment, kind = 'user', quote = null }) {
  const cleanAttachment = pickAttachment(attachment);
  const cleanContent = String(content || '').trim();

  if (!cleanContent && !cleanAttachment) {
    throw new Error('Message content cannot be empty');
  }

  const cleanKind = ['user', 'system', 'forward'].includes(kind) ? kind : 'user';
  const quoteId = quote && Number(quote.id) ? Number(quote.id) : null;
  const quoteSnapshot = quote ? JSON.stringify({
    id: Number(quote.id) || 0,
    senderName: String(quote.senderName || ''),
    preview: String(quote.preview || '').slice(0, 300)
  }) : '';

  const result = await db
    .prepare(
      `INSERT INTO messages (
         channel_id,
         sender_id,
         content,
         attachment_key,
         attachment_name,
         attachment_type,
         attachment_size,
         attachment_duration,
         kind,
         quote_id,
         quote_snapshot
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        Number(channelId),
        Number(senderId),
        cleanContent,
        cleanAttachment?.key || null,
        cleanAttachment?.name || null,
        cleanAttachment?.type || null,
        cleanAttachment?.size || null,
        cleanAttachment?.duration || null,
        cleanKind,
        quoteId,
        quoteSnapshot
      )
    .run();

  return getMessageById(db, result.meta.last_row_id);
}

export async function getMessageById(db, messageId) {
  const { results } = await db
    .prepare(
      `SELECT
         m.id,
         m.content,
         m.attachment_key,
         m.attachment_name,
         m.attachment_type,
         m.attachment_size,
         m.attachment_duration,
         m.kind,
         m.quote_id,
         m.quote_snapshot,
         m.revoked_at,
         m.created_at,
         u.id AS sender_id,
         u.username AS sender_username,
         u.display_name AS sender_display_name,
         u.avatar_key AS sender_avatar_key
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?
       LIMIT 1`
    )
    .bind(Number(messageId))
    .all();

  return results[0] ? mapMessage(results[0]) : null;
}

export function mapMessage(row) {
  const kind = row.kind || 'user';
  const revokedAt = row.revoked_at || null;
  let quote = null;
  if (row.quote_snapshot) {
    try {
      quote = JSON.parse(row.quote_snapshot);
    } catch {
      quote = null;
    }
  }

  return {
    id: Number(row.id),
    content: revokedAt ? '' : row.content,
    createdAt: row.created_at,
    kind,
    revokedAt,
    quote,
    sender: {
      id: Number(row.sender_id),
      username: row.sender_username,
      displayName: row.sender_display_name,
      avatarUrl: row.sender_avatar_key ? publicFileUrl(row.sender_avatar_key) : ''
    },
    attachment: !revokedAt && row.attachment_key
      ? {
          key: row.attachment_key,
          name: row.attachment_name,
          type: row.attachment_type,
          size: toNullableNumber(row.attachment_size) || 0,
          ...(row.attachment_duration ? { duration: Number(row.attachment_duration) } : {}),
          url: publicFileUrl(row.attachment_key)
        }
      : null
  };
}

export async function ensureDmChannel(db, actorId, targetUserId) {
  const dmKey = [Number(actorId), Number(targetUserId)].sort((a, b) => a - b).join(':');
  const existing = await db
    .prepare(
      `SELECT id, name, dm_key
       FROM channels
       WHERE kind = 'dm'
         AND dm_key = ?
         AND deleted_at IS NULL
       LIMIT 1`
    )
    .bind(dmKey)
    .all();

  if (existing.results[0]) {
    return existing.results[0];
  }

  const created = await db
    .prepare(
      `INSERT INTO channels (name, description, kind, dm_key, created_by)
       VALUES (?, '', 'dm', ?, ?)`
    )
    .bind(dmKey, dmKey, Number(actorId))
    .run();

  const channelId = created.meta.last_row_id;
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
         VALUES (?, ?, 'member', ?)`
      )
      .bind(channelId, Number(actorId), Number(actorId)),
    db
      .prepare(
        `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
         VALUES (?, ?, 'member', ?)`
      )
      .bind(channelId, Number(targetUserId), Number(actorId))
  ]);

  return {
    id: channelId,
    name: dmKey,
    dm_key: dmKey
  };
}

// ===== 注销账号：退出所有群聊 + 清空聊天记录 + 提醒好友 + 软删除 =====
// 供用户自助注销和管理员删除共用。返回被通知的好友数量。
export async function deactivateUserAccount(db, userId) {
  const uid = Number(userId);

  // 1. 先取好友列表（accepted），用于后续通知
  const friendsResult = await db.prepare(
    `SELECT u.id, u.display_name
     FROM friendships f
     JOIN users u
       ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted'
       AND (f.requester_id = ? OR f.addressee_id = ?)
       AND u.deleted_at IS NULL`
  ).bind(uid, uid, uid).all();
  const friends = friendsResult.results || [];

  // 2. 退出所有群聊/私聊：移除该用户的成员关系
  await db.prepare(`DELETE FROM channel_members WHERE user_id = ?`).bind(uid).run();

  // 3. 清空该用户发送的全部聊天记录
  await db.prepare(`DELETE FROM messages WHERE sender_id = ?`).bind(uid).run();

  // 4. 清理引用，避免外键/脏数据
  await db.batch([
    db.prepare(`UPDATE channels SET created_by = NULL WHERE created_by = ?`).bind(uid),
    db.prepare(`UPDATE channel_members SET invited_by = NULL WHERE invited_by = ?`).bind(uid),
    db.prepare(`UPDATE registration_invites SET created_by = NULL WHERE created_by = ?`).bind(uid),
    db.prepare(`UPDATE registration_invites SET consumed_by_user_id = NULL WHERE consumed_by_user_id = ?`).bind(uid),
    db.prepare(`DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?`).bind(uid, uid),
    db.prepare(`DELETE FROM blacklist WHERE user_id = ? OR blocked_user_id = ?`).bind(uid, uid),
    db.prepare(`DELETE FROM oauth_mappings WHERE xlim_user_id = ?`).bind(uid),
    db.prepare(`DELETE FROM message_reads WHERE user_id = ?`).bind(uid),
    db.prepare(`DELETE FROM channel_clear_points WHERE user_id = ?`).bind(uid),
    db.prepare(`DELETE FROM message_delete_points WHERE user_id = ?`).bind(uid)
  ]);

  // 5. 给每位好友的私聊会话写一条系统提醒消息
  let notified = 0;
  for (const friend of friends) {
    try {
      const dm = await ensureDmChannel(db, uid, Number(friend.id));
      await insertMessage(db, {
        channelId: Number(dm.id),
        senderId: uid,
        content: '我已注销账号，之后可能无法再联系，感谢陪伴。',
        kind: 'system'
      });
      notified += 1;
    } catch {
      // 单条通知失败不影响注销主流程
    }
  }

  // 6. ensureDmChannel 会把注销者重新加入私聊，这里再清一次成员关系，
  //    确保退出所有群聊/私聊彻底（好友侧仍能通过自己的成员关系看到提醒消息）
  await db.prepare(`DELETE FROM channel_members WHERE user_id = ?`).bind(uid).run();

  // 7. 软删除用户本体（沿用 GC 机制，之后物理清理）
  await db.prepare(
    `UPDATE users
     SET deleted_at = CURRENT_TIMESTAMP,
         is_disabled = 1,
         session_version = session_version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(uid).run();

  return { notifiedFriends: notified };
}
