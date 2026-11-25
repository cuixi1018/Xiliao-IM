import { hashPassword } from './auth.js';
import { randomToken } from './utils.js';

const TEAM_CHAT_ID = 'xlofficial';
const TEAM_NAME = '细聊团队';
const WELCOME_MESSAGES = [
  `你好，我是「${TEAM_NAME}」官方助手 👋 很高兴认识你！`,
  '这里是我们的一对一聊天窗口，我会在这里通知你新功能、系统公告和重要提醒。',
  '有任何问题或建议，都可以直接在这里留言，我们会尽快回复。祝你在细聊玩得开心 🎉'
];

// 找到或创建官方账号（细聊号 xlofficial）
async function ensureOfficialUser(db) {
  const found = await db.prepare(
    `SELECT id FROM users WHERE chat_id = ? AND deleted_at IS NULL LIMIT 1`
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

// 兼容旧调用：官方私聊模式下不再需要官方群，返回 null
export async function ensureOfficialTeam() {
  return null;
}

// 新用户注册后：自动加官方账号为好友 + 建立私聊 + 官方发送欢迎消息
export async function welcomeNewUser(env, userId, displayName) {
  try {
    const db = env.DB;
    const officialId = await ensureOfficialUser(db);
    const uid = Number(userId);
    if (!officialId || officialId === uid) return;

    // 1) 自动建立好友关系（官方账号为请求方，直接 accepted）
    await db.prepare(
      `INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status, note)
       VALUES (?, ?, 'accepted', ?)`
    ).bind(officialId, uid, '欢迎使用细聊').run();

    // 2) 建立官方账号与新用户的私聊会话
    const { ensureDmChannel, insertMessage } = await import('./db.js');
    const dm = await ensureDmChannel(db, officialId, uid);

    // 3) 官方账号发送欢迎消息（系统消息）
    for (const content of WELCOME_MESSAGES) {
      await insertMessage(db, {
        channelId: Number(dm.id),
        senderId: officialId,
        content,
        kind: 'system'
      });
    }
  } catch (error) {
    console.error('welcomeNewUser failed:', error);
    // 欢迎流程失败不影响注册本身
  }
}
