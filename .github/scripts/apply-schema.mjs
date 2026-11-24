#!/usr/bin/env node

/**
 * 幂等地把“微信风格社交”改造所需的全部表 / 列 / 索引 / 默认设置应用到线上 D1。
 * 直接调用 Cloudflare D1 REST API，逐项检查后再执行，重复运行不会报错。
 * 这样无论数据库是全新还是历史库，CI 每次部署都能自动补齐结构，无需手动执行迁移 SQL。
 */

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

async function createIndex(name, ddl) {
  if (await indexExists(name)) {
    return;
  }
  console.log(`  + create index ${name}`);
  await query(ddl);
  applied += 1;
}

async function setSetting(key, value) {
  await query(
    "INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES (?, ?)",
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

  await createTable(
    "oauth_mappings",
    `CREATE TABLE IF NOT EXISTS oauth_mappings (
      xi_sub TEXT PRIMARY KEY,
      edgechat_user_id INTEGER NOT NULL,
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )`,
  );

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

  // 5) 索引
  console.log("[indexes]");
  await createIndex("idx_users_chat_id", "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id) WHERE chat_id IS NOT NULL");
  await createIndex("idx_friendships_requester", "CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)");
  await createIndex("idx_friendships_addressee", "CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)");
  await createIndex("idx_blacklist_user", "CREATE INDEX IF NOT EXISTS idx_blacklist_user ON blacklist(user_id)");
  await createIndex("idx_moments_user", "CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, created_at DESC)");
  await createIndex("idx_moments_created", "CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(created_at DESC)");
  await createIndex("idx_moment_comments_moment", "CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments(moment_id, created_at ASC)");
  await createIndex("idx_complaints_status", "CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status, created_at DESC)");
  await createIndex("idx_complaints_target", "CREATE INDEX IF NOT EXISTS idx_complaints_target ON complaints(target_id)");

  // 6) 默认设置
  console.log("[settings]");
  await setSetting("allow_registration", "0");
  await setSetting("auto_delete_large_files", "0");
  await setSetting("large_file_threshold", "10485760");
  await setSetting("official_team_channel_id", "");

  console.log(`Done. Applied ${applied} schema change(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
