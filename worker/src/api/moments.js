import { errorResponse, parseJsonRequest, publicFileUrl, sanitizeLimit } from '../utils.js';
import { areFriends } from './social.js';

function mapMomentAuthor(row) {
  return {
    id: Number(row.user_id),
    username: row.username,
    displayName: row.display_name,
    chatId: row.chat_id || '',
    avatarUrl: row.avatar_key ? publicFileUrl(row.avatar_key) : ''
  };
}

export function registerMomentRoutes(app) {
  // 发布动态
  app.post('/api/moments', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const content = String(payload.content || '').trim().slice(0, 5000);
    let imageKeys = [];
    if (Array.isArray(payload.imageKeys)) {
      imageKeys = payload.imageKeys.slice(0, 9).map((k) => String(k || '')).filter(Boolean);
    }
    if (!content && !imageKeys.length) {
      return errorResponse('说点什么或添加图片吧');
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO moments (user_id, content, image_keys) VALUES (?, ?, ?)`
    )
      .bind(session.userId, content, JSON.stringify(imageKeys))
      .run();
    return c.json({ id: Number(result.meta.last_row_id) });
  });

  // 好友动态列表
  app.get('/api/moments', async (c) => {
    const session = c.get('session');
    const limit = sanitizeLimit(c.req.query('limit'), 30, 60);
    const before = c.req.query('before');

    // 我可见的作者：我自己 + 互为好友，且双方未拉黑
    const friendIds = await c.env.DB.prepare(
      `SELECT
         CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END AS user_id
       FROM friendships f
       WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`
    )
      .bind(session.userId, session.userId, session.userId)
      .all();
    const visibleIds = new Set([session.userId, ...friendIds.results.map((r) => Number(r.user_id))]);
    // 排除我拉黑的及拉黑我的
    const blockedRows = await c.env.DB.prepare(
      `SELECT blocked_user_id AS uid FROM blacklist WHERE user_id = ?
       UNION
       SELECT user_id AS uid FROM blacklist WHERE blocked_user_id = ?`
    )
      .bind(session.userId, session.userId)
      .all();
    for (const row of blockedRows.results) {
      visibleIds.delete(Number(row.uid));
    }
    if (!visibleIds.size) {
      return c.json({ moments: [] });
    }

    const placeholders = [...visibleIds].map(() => '?').join(', ');
    const filters = [`m.deleted_at IS NULL`, `u.deleted_at IS NULL`, `m.user_id IN (${placeholders})`];
    const binds = [...visibleIds];
    if (before) {
      filters.push('m.id < ?');
      binds.push(Number(before));
    }
    binds.push(limit);

    const { results } = await c.env.DB.prepare(
      `SELECT m.id, m.user_id, m.content, m.image_keys, m.created_at,
              u.username, u.display_name, u.chat_id, u.avatar_key
       FROM moments m
       JOIN users u ON u.id = m.user_id
       WHERE ${filters.join(' AND ')}
       ORDER BY m.id DESC
       LIMIT ?`
    )
      .bind(...binds)
      .all();

    const moments = [];
    for (const row of results) {
      const [likesResult, commentsResult] = await Promise.all([
        c.env.DB.prepare(
          `SELECT l.user_id, u.display_name
           FROM moment_likes l JOIN users u ON u.id = l.user_id
           WHERE l.moment_id = ? ORDER BY l.created_at ASC`
        )
          .bind(row.id)
          .all(),
        c.env.DB.prepare(
          `SELECT cm.id, cm.user_id, cm.reply_to_user_id, cm.content, cm.created_at,
                  u.display_name AS author_name, ru.display_name AS reply_name
           FROM moment_comments cm
           JOIN users u ON u.id = cm.user_id
           LEFT JOIN users ru ON ru.id = cm.reply_to_user_id
           WHERE cm.moment_id = ? ORDER BY cm.created_at ASC`
        )
          .bind(row.id)
          .all()
      ]);
      let imageKeys = [];
      try {
        imageKeys = JSON.parse(row.image_keys || '[]');
      } catch {
        imageKeys = [];
      }
      moments.push({
        id: Number(row.id),
        content: row.content,
        imageKeys,
        imageUrls: imageKeys.map((k) => publicFileUrl(k)),
        createdAt: row.created_at,
        author: mapMomentAuthor(row),
        isMine: Number(row.user_id) === session.userId,
        likes: likesResult.results.map((r) => ({
          userId: Number(r.user_id),
          displayName: r.display_name
        })),
        likedByMe: likesResult.results.some((r) => Number(r.user_id) === session.userId),
        comments: commentsResult.results.map((cm) => ({
          id: Number(cm.id),
          userId: Number(cm.user_id),
          authorName: cm.author_name,
          replyToUserId: cm.reply_to_user_id ? Number(cm.reply_to_user_id) : null,
          replyName: cm.reply_name || '',
          content: cm.content,
          createdAt: cm.created_at
        }))
      });
    }
    return c.json({ moments });
  });

  // 点赞 / 取消点赞
  app.post('/api/moments/:id/like', async (c) => {
    const session = c.get('session');
    const momentId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const wantLike = payload.like === undefined ? true : Boolean(payload.like);

    const moment = await c.env.DB.prepare(
      `SELECT id FROM moments WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(momentId)
      .all();
    if (!moment.results[0]) {
      return errorResponse('动态不存在', 404);
    }

    if (wantLike) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO moment_likes (moment_id, user_id) VALUES (?, ?)`
      )
        .bind(momentId, session.userId)
        .run();
    } else {
      await c.env.DB.prepare(
        `DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?`
      )
        .bind(momentId, session.userId)
        .run();
    }
    return c.json({ ok: true, liked: wantLike });
  });

  // 发表评论 / 回复
  app.post('/api/moments/:id/comment', async (c) => {
    const session = c.get('session');
    const momentId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const content = String(payload.content || '').trim().slice(0, 1000);
    const replyToUserId = payload.replyToUserId ? Number(payload.replyToUserId) : null;
    if (!content) {
      return errorResponse('评论内容不能为空');
    }

    const moment = await c.env.DB.prepare(
      `SELECT id FROM moments WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(momentId)
      .all();
    if (!moment.results[0]) {
      return errorResponse('动态不存在', 404);
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO moment_comments (moment_id, user_id, reply_to_user_id, content)
       VALUES (?, ?, ?, ?)`
    )
      .bind(momentId, session.userId, replyToUserId, content)
      .run();
    return c.json({
      id: Number(result.meta.last_row_id),
      userId: session.userId,
      authorName: session.displayName,
      replyToUserId,
      content,
      createdAt: new Date().toISOString()
    });
  });

  // 删除自己的动态
  app.delete('/api/moments/:id', async (c) => {
    const session = c.get('session');
    const momentId = Number(c.req.param('id'));
    const moment = await c.env.DB.prepare(
      `SELECT user_id FROM moments WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(momentId)
      .all();
    if (!moment.results[0]) {
      return errorResponse('动态不存在', 404);
    }
    if (Number(moment.results[0].user_id) !== session.userId && !session.isAdmin) {
      return errorResponse('只能删除自己的动态', 403);
    }
    await c.env.DB.prepare(
      `UPDATE moments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(momentId)
      .run();
    // 清理关联的点赞和评论
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM moment_likes WHERE moment_id = ?').bind(momentId),
      c.env.DB.prepare('DELETE FROM moment_comments WHERE moment_id = ?').bind(momentId)
    ]);
    return c.json({ ok: true });
  });
}
