#!/usr/bin/env node

/**
 * 幂等地把“微信风格社交”改造所需的全部表 / 列 / 索引 / 默认设置应用到线上 D1。
 * 直接调用 Cloudflare D1 REST API，逐项检查后再执行，重复运行不会报错。
 * 这样无论数据库是全新还是历史库，CI 每次部署都能自动补齐结构，无需手动执行迁移 SQL。
 */

import { webcrypto } from "node:crypto";

const API_BASE_URL = "https://api.cloudflare.com/client/v4";

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId =
  process.env.EDGECHAT_D1_DATABASE_ID || process.env.D1_DATABASE_ID || "";

for (const [name, value] of [
  ["CLOUDFLARE_API_TOKEN", token],
  ["CLOUDFLARE_ACCOUNT_ID", accountId],
  ["D1 database id", databaseId],
]) {
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }
}

async function query(sql, params = []) {
  const url = `${API_BASE_URL}/accounts/${accountId}/d1/database/${databaseId}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`D1 query returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || payload?.success === false) {
    const msg = Array.isArray(payload?.errors)
      ? payload.errors.map((e) => `${e.code}: ${e.message}`).join("; ")
      : text.slice(0, 300);
    throw new Error(`D1 query failed: ${msg}\nSQL: ${sql}`);
  }
  return payload?.result?.[0]?.results ?? [];
}

async function tableExists(name) {
  const rows = await query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return rows.length > 0;
}

async function columnExists(table, column) {
  const rows = await query(`PRAGMA table_info(${table})`);
  return rows.some((r) => String(r.name).toLowerCase() === column.toLowerCase());
}

async function indexExists(name) {
  const rows = await query(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    [name],
  );
  return rows.length > 0;
}

let applied = 0;

async function addColumn(table, column, definition) {
  if (!(await tableExists(table))) {
    console.log(`  · skip ${table}.${column} (table missing)`);
    return;
  }
  if (await columnExists(table, column)) {
    return;
  }
  console.log(`  + add column ${table}.${column}`);
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  applied += 1;
}

async function createTable(name, ddl) {
  if (await tableExists(name)) {
    return;
  }
  console.log(`  + create table ${name}`);
  await query(ddl);
  applied += 1;
}

async function renameColumn(table, from, to) {
  if (!(await tableExists(table))) return;
  if (await columnExists(table, from) && !(await columnExists(table, to))) {
    console.log(`  ~ rename column ${table}.${from} -> ${to}`);
    await query(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
    applied += 1;
  }
}

async function createIndex(name, ddl) {
  if (await indexExists(name)) {
    return;
  }
  console.log(`  + create index ${name}`);
  await query(ddl);
  applied += 1;
}

// 确保 users.chat_id 上有真正的 UNIQUE 索引。
// 历史库里可能已存在同名的普通(非唯一)索引，createIndex 的 IF NOT EXISTS 会跳过，
// 导致唯一约束一直没生效、细聊号可能重复。这里主动检测并替换。
async function ensureUniqueChatIdIndex() {
  const name = "idx_users_chat_id";
  const rows = await query(
    "SELECT sql FROM sqlite_master WHERE type='index' AND name=?",
    [name],
  );
  const ddl = String(rows[0]?.sql || "");
  const isUnique = /CREATE\s+UNIQUE\s+INDEX/i.test(ddl);

  if (isUnique) {
    console.log("  = unique chat_id index already present");
    return;
  }

  // 先清理历史重复数据：重复的细聊号按 id 保留最小者，其余重新分配唯一号
  const dupRows = await query(
    `SELECT chat_id, COUNT(*) AS n FROM users
     WHERE chat_id IS NOT NULL AND chat_id <> ''
     GROUP BY chat_id HAVING n > 1`,
  );
  for (const dup of dupRows) {
    const cid = dup.chat_id;
    const ids = await query(
      "SELECT id, username FROM users WHERE chat_id=? ORDER BY id ASC",
      [cid],
    );
    for (let i = 1; i < ids.length; i += 1) {
      const u = ids[i];
      let newCid = `${cid.split("#")[0] || "user"}#${Math.random().toString(36).slice(2, 8)}`;
      let guard = 0;
      while ((await query("SELECT 1 FROM users WHERE chat_id=? LIMIT 1", [newCid])).length && guard < 20) {
        newCid = `${cid.split("#")[0] || "user"}#${Math.random().toString(36).slice(2, 8)}`;
        guard += 1;
      }
      await query("UPDATE users SET chat_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [newCid, Number(u.id)]);
      console.log(`  ~ dedup chat_id for user ${u.id}: ${cid} -> ${newCid}`);
    }
  }

  if (ddl) {
    console.log(`  - drop legacy non-unique index ${name}`);
    await query(`DROP INDEX IF EXISTS ${name}`);
  }
  console.log(`  + create unique index ${name}`);
  await query(
    `CREATE UNIQUE INDEX ${name} ON users(chat_id) WHERE chat_id IS NOT NULL`,
  );
  applied += 1;
}

async function setSetting(key, value) {
  await query(
    "INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES (?, ?)",
    [key, value],
  );
}

async function forceSetting(key, value) {
  await query(
    "INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
    [key, value],
  );
}

async function main() {
  console.log("Applying idempotent schema migrations to D1...");

  // 1) 用户列
  console.log("[users]");
  await addColumn("users", "chat_id", "TEXT");
  await addColumn("users", "signature", "TEXT NOT NULL DEFAULT ''");
  await addColumn("users", "gender", "TEXT NOT NULL DEFAULT 'secret'");
  await addColumn("users", "birthdate", "TEXT NOT NULL DEFAULT ''");
  await addColumn("users", "is_new_user", "INTEGER NOT NULL DEFAULT 1");
  await addColumn("users", "banned_until", "TEXT");
  await addColumn("users", "friend_verify_required", "INTEGER NOT NULL DEFAULT 1");

  // 2) 消息列
  console.log("[messages]");
  await addColumn("messages", "attachment_duration", "INTEGER");
  await addColumn("messages", "kind", "TEXT NOT NULL DEFAULT 'user'");
  await addColumn("messages", "quote_id", "INTEGER");
  await addColumn("messages", "quote_snapshot", "TEXT NOT NULL DEFAULT ''");
  await addColumn("messages", "revoked_at", "TEXT");

  // 3) 群组公告列
  console.log("[channels]");
  await addColumn("channels", "announcement", "TEXT NOT NULL DEFAULT ''");
  await addColumn("channels", "announcement_at", "TEXT");

  // 4) 新表
  console.log("[tables]");
  await createTable(
    "friendships",
    `CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
      note TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (addressee_id) REFERENCES users(id)
    )`,
  );
  // 兼容：旧 friendships 表可能没有 remark 列
  await addColumn("friendships", "remark", "TEXT NOT NULL DEFAULT ''");

  await createTable(
    "blacklist",
    `CREATE TABLE IF NOT EXISTS blacklist (
      user_id INTEGER NOT NULL,
      blocked_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, blocked_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (blocked_user_id) REFERENCES users(id)
    )`,
  );

  await createTable(
    "channel_clear_points",
    `CREATE TABLE IF NOT EXISTS channel_clear_points (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      cleared_before_id INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id)
    )`,
  );

  // 兼容旧字段名：edgechat_user_id -> xlim_user_id
  await renameColumn("oauth_mappings", "edgechat_user_id", "xlim_user_id");
  await createTable(
    "oauth_mappings",
    `CREATE TABLE IF NOT EXISTS oauth_mappings (
      xi_sub TEXT PRIMARY KEY,
      xlim_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  await createTable(
    "moments",
    `CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      image_keys TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'public',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )`,
  );

  // 兼容：旧 moments 表可能没有 visibility 列
  await addColumn("moments", "visibility", "TEXT NOT NULL DEFAULT 'public'");

  await createTable(
    "moment_likes",
    `CREATE TABLE IF NOT EXISTS moment_likes (
      moment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (moment_id, user_id)
    )`,
  );

  await createTable(
    "moment_comments",
    `CREATE TABLE IF NOT EXISTS moment_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reply_to_user_id INTEGER,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  await createTable(
    "message_delete_points",
    `CREATE TABLE IF NOT EXISTS message_delete_points (
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id)
    )`,
  );

  await createTable(
    "complaints",
    `CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled', 'ignored')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  await createTable(
    "channel_invite_codes",
    `CREATE TABLE IF NOT EXISTS channel_invite_codes (
      token TEXT PRIMARY KEY,
      channel_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // 5) 索引
  console.log("[indexes]");
  await ensureUniqueChatIdIndex();
  await createIndex("idx_friendships_requester", "CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)");
  await createIndex("idx_friendships_addressee", "CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)");
  await createIndex("idx_blacklist_user", "CREATE INDEX IF NOT EXISTS idx_blacklist_user ON blacklist(user_id)");
  await createIndex("idx_moments_user", "CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, created_at DESC)");
  await createIndex("idx_moments_created", "CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(created_at DESC)");
  await createIndex("idx_moment_comments_moment", "CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments(moment_id, created_at ASC)");
  await createIndex("idx_complaints_status", "CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status, created_at DESC)");
  await createIndex("idx_complaints_target", "CREATE INDEX IF NOT EXISTS idx_complaints_target ON complaints(target_id)");
  await createIndex("idx_channel_invite_codes_channel", "CREATE INDEX IF NOT EXISTS idx_channel_invite_codes_channel ON channel_invite_codes(channel_id, expires_at)");

  // 6) 默认设置
  console.log("[settings]");
  await forceSetting("allow_registration", "1");
  await setSetting("auto_delete_large_files", "0");
  await setSetting("large_file_threshold", "10485760");
  await setSetting("official_team_channel_id", "");

  // 7) 一次性数据迁移：把「细聊团队官方群」改造为「注册自动添加的官方私聊」
  //    用 official_dm_migrated 标记保证幂等（密码只重置一次）。
  await applyOfficialDmMigration();

  // 8) 官方账号头像：幂等地补全 logo（不依赖历史迁移标志，每次部署都执行）
  await applyOfficialAvatar();

  console.log(`Done. Applied ${applied} schema change(s).`);
}

// 给官方账号（细聊团队）补上 logo 头像，复用站点 logo 文件 key。
// 幂等：只更新 chat_id='xlofficial' 且头像缺失的记录。
async function applyOfficialAvatar() {
  const AVATAR_KEY = "1/1783947696765-d3e3be16-81b7-470a-a7b8-8ac1657413c0.png";
  const rows = await query("SELECT id, avatar_key FROM users WHERE chat_id='xlofficial' AND deleted_at IS NULL LIMIT 1");
  if (rows.length === 0) {
    console.log("[official-avatar] official user not found, skip");
    return;
  }
  if (rows[0].avatar_key) {
    console.log("[official-avatar] already set, skip");
    return;
  }
  await query(
    "UPDATE users SET avatar_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [AVATAR_KEY, Number(rows[0].id)],
  );
  console.log("[official-avatar] logo avatar applied to official user");
}

async function applyOfficialDmMigration() {
  const flag = await query("SELECT setting_value FROM site_settings WHERE setting_key='official_dm_migrated'");
  if (flag.length > 0) {
    console.log("[official-dm] already migrated, skip");
    return;
  }
  console.log("[official-dm] starting migration");

  const enc = new TextEncoder();
  const toB64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromB64 = (s) => {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64");
  };
  const salt = toB64(webcrypto.getRandomValues(new Uint8Array(16)));
  const km = await webcrypto.subtle.importKey("raw", enc.encode("Xiliao@2026"), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromB64(salt), iterations: 100000, hash: "SHA-256" },
    km, 256,
  );
  const hash = toB64(new Uint8Array(bits));

  // 官方账号：重置密码 + 启用
  const off = await query("SELECT id FROM users WHERE chat_id='xlofficial' OR username='xlofficial' LIMIT 1");
  let officialId = Number(off[0]?.id || 0);
  if (!officialId) {
    const created = await query(
      "INSERT INTO users (username,display_name,password_hash,password_salt,chat_id,is_disabled,is_new_user) VALUES ('xlofficial','细聊团队',?,?,'xlofficial',0,0)",
      [hash, salt],
    );
    officialId = Number(created.insertId || created.meta?.last_row_id || 0);
    // query() 只返回 results，需再查一次
    const re = await query("SELECT id FROM users WHERE chat_id='xlofficial' LIMIT 1");
    officialId = Number(re[0]?.id || officialId);
  } else {
    await query(
      "UPDATE users SET password_hash=?,password_salt=?,is_disabled=0,deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [hash, salt, officialId],
    );
  }
  console.log("[official-dm] official user id:", officialId);

  // 找出官方群（细聊团队 public）并删除关联
  const groups = await query("SELECT id FROM channels WHERE name='细聊团队' AND kind='public'");
  for (const g of groups) {
    const gid = Number(g.id);
    for (const sql of [
      "DELETE FROM channel_members WHERE channel_id=" + gid,
      "DELETE FROM messages WHERE channel_id=" + gid,
      "DELETE FROM channel_invite_codes WHERE channel_id=" + gid,
      "DELETE FROM message_reads WHERE channel_id=" + gid,
      "DELETE FROM channel_clear_points WHERE channel_id=" + gid,
      "DELETE FROM channels WHERE id=" + gid,
    ]) { await query(sql); }
  }
  await query("DELETE FROM site_settings WHERE setting_key='official_team_channel_id'");
  console.log("[official-dm] removed official group(s):", groups.length);

  // 给现有正常用户补官方好友 + 私聊 + 欢迎消息
  const users = await query("SELECT id FROM users WHERE deleted_at IS NULL AND id != ? ORDER BY id", [officialId]);
  const WELCOME = [
    "你好，我是「细聊团队」官方助手，很高兴认识你！",
    "这里是我们的一对一聊天窗口，我会在这里通知你新功能、系统公告和重要提醒。",
    "有任何问题或建议，都可以直接在这里留言，我们会尽快回复。祝你在细聊玩得开心！",
  ];
  for (const u of users) {
    const uid = Number(u.id);
    const dmKey = [officialId, uid].sort((a, b) => a - b).join(":");
    await query("INSERT OR IGNORE INTO friendships (requester_id,addressee_id,status,note) VALUES (?,?,'accepted','欢迎使用细聊')", [officialId, uid]);
    let ch = await query("SELECT id FROM channels WHERE kind='dm' AND dm_key=? AND deleted_at IS NULL LIMIT 1", [dmKey]);
    let chId = Number(ch[0]?.id || 0);
    if (!chId) {
      const cr = await query("INSERT INTO channels (name,description,kind,dm_key,created_by) VALUES (?,'','dm',?,?)", [dmKey, dmKey, officialId]);
      // D1 REST 不直接返回 last_row_id，重新查询
      ch = await query("SELECT id FROM channels WHERE kind='dm' AND dm_key=? ORDER BY id DESC LIMIT 1", [dmKey]);
      chId = Number(ch[0]?.id || 0);
      await query("INSERT OR IGNORE INTO channel_members (channel_id,user_id,role,invited_by) VALUES (?,?,'member',?)", [chId, officialId, officialId]);
      await query("INSERT OR IGNORE INTO channel_members (channel_id,user_id,role,invited_by) VALUES (?,?,'member',?)", [chId, uid, officialId]);
    }
    await query("DELETE FROM messages WHERE channel_id=? AND sender_id=? AND kind='system'", [chId, officialId]);
    for (const content of WELCOME) {
      await query("INSERT INTO messages (channel_id,sender_id,content,kind) VALUES (?,?,?,'system')", [chId, officialId, content]);
    }
  }
  console.log("[official-dm] initialized private chats for", users.length, "user(s)");

  await query("INSERT OR REPLACE INTO site_settings (setting_key,setting_value) VALUES ('official_dm_migrated','1')");
  console.log("[official-dm] migration done");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
