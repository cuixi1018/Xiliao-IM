import { hashPassword } from './auth.js';
import { randomToken } from './utils.js';

const TEAM_CHAT_ID = 'xlofficial';
const TEAM_NAME = '细聊团队';
const WELCOME_MESSAGE = '欢迎来到细聊 🎉 这里是「细聊团队」官方群，公告与新功能会第一时间在这里发布。祝你聊天愉快！';

async function getSetting(db, key) {
  const row = await db.prepare(
    'SELECT setting_value FROM site_settings WHERE setting_key = ? LIMIT 1'
  ).bind(key).all();
  return row.results[0]?.setting_value || '';
}

async function setSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO site_settings (setting_key, setting_value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(setting_key) DO UPDATE
     SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`
  ).bind(key, String(value)).run();
}

// 找到或创建官方账号（细聊号 xlofficial）
async function ensureOfficialUser(db) {
  const found = await db.prepare(
    `SELECT id FROM users WHERE chat_id = ? LIMIT 1`
  ).bind(TEAM_CHAT_ID).all();
  if (found.results[0]) return Number(found.results[0].id);

  const hashed = await hashPassword(randomToken(24));
  const result = await db.prepare(
    `INSERT INTO users (username, display_name, password_hash, password_salt, chat_id, is_disabled, is_new_user)
     VALUES (?, ?, ?, ?, ?, 1, 0)`
  )
    .bind(TEAM_CHAT_ID, TEAM_NAME, hashed.hash, hashed.salt, TEAM_CHAT_ID)
    .run();
  return Number(result.meta.last_row_id);
}

// 确保"细聊团队"官方群存在，返回 channel id
export async function ensureOfficialTeam(env) {
  const db = env.DB;
  let channelId = Number(await getSetting(db, 'official_team_channel_id'));
  if (channelId) {
    const exists = await db.prepare(
      'SELECT id FROM channels WHERE id = ? AND deleted_at IS NULL LIMIT 1'
    ).bind(channelId).all();
    if (exists.results[0]) return channelId;
  }

  const ownerId = await ensureOfficialUser(db);

  const existing = await db.prepare(
    `SELECT id FROM channels WHERE name = ? AND kind = 'public' AND deleted_at IS NULL LIMIT 1`
  ).bind(TEAM_NAME).all();
  if (existing.results[0]) {
    channelId = Number(existing.results[0].id);
    await setSetting(db, 'official_team_channel_id', channelId);
    return channelId;
  }

  const created = await db.prepare(
    `INSERT INTO channels (name, description, kind, created_by, announcement, announcement_at)
     VALUES (?, ?, 'public', ?, ?, CURRENT_TIMESTAMP)`
  )
    .bind(TEAM_NAME, '细聊官方团队群，公告与新功能第一时间发布。', ownerId, '欢迎来到细聊团队，请遵守社区规范，友好交流。')
    .run();
  channelId = Number(created.meta.last_row_id);

  await db.prepare(
    `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
     VALUES (?, ?, 'owner', ?)`
  ).bind(channelId, ownerId, ownerId).run();

  await setSetting(db, 'official_team_channel_id', channelId);
  return channelId;
}

// 新用户注册后：加入官方群 + 发送欢迎系统消息
export async function welcomeNewUser(env, userId, displayName) {
  try {
    const teamId = await ensureOfficialTeam(env);
    // 加入官方群（若已在则忽略）
    await env.DB.prepare(
      `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
       VALUES (?, ?, 'member', ?)`
    ).bind(teamId, userId, null).run();

    // 欢迎消息：用系统账号(sender=官方 owner)发送，kind=system
    const owner = await env.DB.prepare(
      `SELECT user_id FROM channel_members WHERE channel_id = ? AND role = 'owner' LIMIT 1`
    ).bind(teamId).all();
    const senderId = owner.results[0]?.user_id || userId;
    const { insertMessage } = await import('./db.js');
    await insertMessage(env.DB, {
      channelId: teamId,
      senderId,
      content: `${displayName}，${WELCOME_MESSAGE}`,
      kind: 'system'
    });
  } catch (error) {
    console.error('welcomeNewUser failed:', error);
    // 欢迎流程失败不影响注册本身
  }
}
