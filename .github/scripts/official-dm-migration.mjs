#!/usr/bin/env node
/**
 * 一次性数据迁移：把"细聊团队官方群"改造为"注册自动添加的官方私聊"。
 * - 删除官方群及其关联数据，清除 official_team_channel_id 配置
 * - 官方账号重置密码并启用
 * - 给现有用户补官方好友 + 私聊 + 欢迎消息
 * 幂等：可重复运行。
 */
import { webcrypto } from 'node:crypto';

const API = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

// 从 ensure-cloudflare-resources 约定或已知常量取数据库 id
let databaseId = process.env.EDGECHAT_D1_DATABASE_ID || process.env.D1_DATABASE_ID || 'f700ecd4-9303-4c66-9eba-7ffcc6233401';

if (!token || !accountId) {
  console.error('缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

const enc = new TextEncoder();
const toB64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
};
async function hashPassword(password) {
  const salt = toB64(webcrypto.getRandomValues(new Uint8Array(16)));
  const km = await webcrypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(salt), iterations: 100000, hash: 'SHA-256' },
    km, 256
  );
  return { salt, hash: toB64(new Uint8Array(bits)) };
}

async function cf(path, opts = {}, retries = 8) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
      if (!res.ok || json.success === false) throw new Error(`${res.status} ${JSON.stringify(json.errors || json).slice(0, 200)}`);
      return json;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 800 + i * 400));
    }
  }
  throw last;
}

async function query(sql, params) {
  const json = await cf(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify(params ? { sql, params } : { sql })
  });
  return json.result?.[0];
}

// 若未通过环境变量拿到 database id，则从 D1 列表按名称解析
if (!databaseId) {
  const list = await cf(`/accounts/${accountId}/d1/database`);
  const db = list.result?.find((d) => /xlim|edgechat/i.test(d.name)) || list.result?.[0];
  if (!db) { console.error('找不到 D1 数据库'); process.exit(1); }
  databaseId = db.uuid;
  console.log('解析数据库 id:', databaseId, db.name);
}

// 幂等保护：迁移完成后写入标记，避免每次部署都重置官方账号密码
const doneFlag = await query("SELECT setting_value FROM site_settings WHERE setting_key='official_dm_migrated'");
if (doneFlag?.results?.[0]) {
  console.log('迁移已完成（标记存在），跳过');
  process.exit(0);
}

const NEW_PWD = 'Xiliao@2026';
const { salt, hash } = await hashPassword(NEW_PWD);
console.log('官方账号新密码已生成:', NEW_PWD);

// 1) 找出官方群（细聊团队 public，或配置里的 id）
const setting = await query("SELECT setting_value FROM site_settings WHERE setting_key='official_team_channel_id'");
const cfgId = Number(setting?.results?.[0]?.setting_value || 0);
const groups = await query("SELECT id FROM channels WHERE name='细聊团队' AND kind='public'");
const groupIds = new Set([...(groups?.results || []).map((r) => Number(r.id)), cfgId].filter(Boolean));
console.log('待删除官方群 id:', [...groupIds]);

for (const gid of groupIds) {
  await query(`DELETE FROM channel_members WHERE channel_id=${gid}`);
  await query(`DELETE FROM messages WHERE channel_id=${gid}`);
  await query(`DELETE FROM channel_invite_codes WHERE channel_id=${gid}`);
  await query(`DELETE FROM message_reads WHERE channel_id=${gid}`);
  await query(`DELETE FROM channel_clear_points WHERE channel_id=${gid}`);
  await query(`DELETE FROM channels WHERE id=${gid}`);
}
await query("DELETE FROM site_settings WHERE setting_key='official_team_channel_id'");
console.log('官方群及配置已清理');

// 2) 官方账号：重置密码 + 启用
const official = await query("SELECT id FROM users WHERE chat_id='xlofficial' OR username='xlofficial' LIMIT 1");
let officialId = Number(official?.results?.[0]?.id || 0);
if (!officialId) {
  const created = await query(
    `INSERT INTO users (username,display_name,password_hash,password_salt,chat_id,is_disabled,is_new_user)
     VALUES ('xlofficial','细聊团队',?,?,'xlofficial',0,0)`,
    [hash, salt]
  );
  officialId = Number(created?.meta?.last_row_id);
} else {
  await query(
    `UPDATE users SET password_hash=?, password_salt=?, is_disabled=0, deleted_at=NULL,
     updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [hash, salt, officialId]
  );
}
console.log('官方账号 id:', officialId);

// 3) 给现有正常用户补官方好友 + 私聊 + 欢迎消息
const users = await query('SELECT id, display_name, username FROM users WHERE deleted_at IS NULL AND id != ? ORDER BY id', [officialId]);
const WELCOME = [
  '你好，我是「细聊团队」官方助手 👋 很高兴认识你！',
  '这里是我们的一对一聊天窗口，我会在这里通知你新功能、系统公告和重要提醒。',
  '有任何问题或建议，都可以直接在这里留言，我们会尽快回复。祝你在细聊玩得开心 🎉'
];
for (const u of users?.results || []) {
  const uid = Number(u.id);
  const dmKey = [officialId, uid].sort((a, b) => a - b).join(':');
  await query(
    "INSERT OR IGNORE INTO friendships (requester_id,addressee_id,status,note) VALUES (?,?,'accepted','欢迎使用细聊')",
    [officialId, uid]
  );
  let ch = await query("SELECT id FROM channels WHERE kind='dm' AND dm_key=? AND deleted_at IS NULL LIMIT 1", [dmKey]);
  let chId = Number(ch?.results?.[0]?.id || 0);
  if (!chId) {
    const cr = await query(
      "INSERT INTO channels (name,description,kind,dm_key,created_by) VALUES (?,'','dm',?,?)",
      [dmKey, dmKey, officialId]
    );
    chId = Number(cr?.meta?.last_row_id);
    await query("INSERT OR IGNORE INTO channel_members (channel_id,user_id,role,invited_by) VALUES (?,?,'member',?)", [chId, officialId, officialId]);
    await query("INSERT OR IGNORE INTO channel_members (channel_id,user_id,role,invited_by) VALUES (?,?,'member',?)", [chId, uid, officialId]);
  }
  // 先清旧欢迎消息再插，保证幂等
  await query("DELETE FROM messages WHERE channel_id=? AND sender_id=? AND kind='system'", [chId, officialId]);
  for (const content of WELCOME) {
    await query("INSERT INTO messages (channel_id,sender_id,content,kind) VALUES (?,?,?,'system')", [chId, officialId, content]);
  }
  console.log('已初始化官方私聊 user=', uid, 'dm=', chId);
}

// 验证
const vCh = await query('SELECT id,name,kind FROM channels ORDER BY id');
console.log('最终 channels:', JSON.stringify(vCh?.results));
const vOff = await query('SELECT id,username,is_disabled,deleted_at FROM users WHERE id=?', [officialId]);
console.log('最终官方账号:', JSON.stringify(vOff?.results));

// 写入完成标记
await query("INSERT OR REPLACE INTO site_settings (setting_key,setting_value) VALUES ('official_dm_migrated','1')");
console.log('迁移完成 ✅');
