-- 微信风格社交功能：细聊号、好友、黑名单、清空聊天记录、开放注册开关
PRAGMA foreign_keys = OFF;

-- 语音消息时长（秒）
ALTER TABLE messages ADD COLUMN attachment_duration INTEGER;

-- 1) 用户细聊号：用户名+随机后缀，全局唯一
ALTER TABLE users ADD COLUMN chat_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_chat_id
  ON users(chat_id)
  WHERE chat_id IS NOT NULL;

-- 2) 好友关系表：status = pending(待处理) / accepted(已互为好友)
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  addressee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (requester_id, addressee_id),
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (addressee_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester
  ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee
  ON friendships(addressee_id, status);

-- 3) 黑名单表
CREATE TABLE IF NOT EXISTS blacklist (
  user_id INTEGER NOT NULL,
  blocked_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, blocked_user_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (blocked_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_user
  ON blacklist(user_id);

-- 4) 会话清空点：记录每个用户每个会话清空到的消息ID（仅对自己生效）
CREATE TABLE IF NOT EXISTS channel_clear_points (
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  cleared_before_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 5) 开放注册开关：默认关闭
INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('allow_registration', '1');

-- 6) 熙熙账号 -> 细聊用户映射（内置注册防重复）
CREATE TABLE IF NOT EXISTS oauth_mappings (
  xi_sub TEXT PRIMARY KEY,
  edgechat_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edgechat_user_id) REFERENCES users(id)
);

-- 7) 朋友圈动态
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  image_keys TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(created_at DESC);

-- 8) 朋友圈点赞
CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (moment_id, user_id),
  FOREIGN KEY (moment_id) REFERENCES moments(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 9) 朋友圈评论（支持回复：reply_to_user_id）
CREATE TABLE IF NOT EXISTS moment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reply_to_user_id INTEGER,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (moment_id) REFERENCES moments(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (reply_to_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments(moment_id, created_at ASC);

-- ============================================================
-- 第二批：消息操作 / 资料扩展 / 群公告 / 投诉 / 大文件开关
-- ============================================================

-- 10) 消息：kind(user/system/forward)、引用消息、撤回时间
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'user';
ALTER TABLE messages ADD COLUMN quote_id INTEGER;
ALTER TABLE messages ADD COLUMN quote_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN revoked_at TEXT;

-- 10b) 自己删除的消息（仅自己隐藏，不影响他人）
CREATE TABLE IF NOT EXISTS message_delete_points (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id)
);

-- 11) 群组：公告
ALTER TABLE channels ADD COLUMN announcement TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN announcement_at TEXT;

-- 12) 用户：个性签名 / 性别 / 出生年月 / 是否新用户(欢迎提示)
ALTER TABLE users ADD COLUMN signature TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'secret';
ALTER TABLE users ADD COLUMN birthdate TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN is_new_user INTEGER NOT NULL DEFAULT 1;
-- 封号截止时间（ISO 字符串）；为空表示未封禁；特殊值 'permanent' 表示永久封禁
ALTER TABLE users ADD COLUMN banned_until TEXT;
-- 好友申请：是否需要验证（1=别人加我需要我同意，0=可直接添加）
ALTER TABLE users ADD COLUMN friend_verify_required INTEGER NOT NULL DEFAULT 1;

-- 13) 好友备注名（在群里显示为备注名）
ALTER TABLE friendships ADD COLUMN remark TEXT NOT NULL DEFAULT '';

-- 14) 投诉表
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled', 'ignored')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id),
  FOREIGN KEY (target_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_target ON complaints(target_id);

-- 15) 管理员开关：10 天后自动删除大文件（默认关闭）
INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('auto_delete_large_files', '0');

-- 16) 大文件删除阈值（字节），默认 10MB；超过该大小且超过10天的附件会被清理
INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('large_file_threshold', '10485760');

-- 17) 官方群"细聊团队"标记：用 site_settings 记录其 channel id（首次有人注册时创建）
INSERT OR IGNORE INTO site_settings (setting_key, setting_value)
VALUES ('official_team_channel_id', '');

PRAGMA foreign_keys = ON;
