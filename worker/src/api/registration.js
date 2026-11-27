import { createSession, hashPassword } from '../auth.js';
import { getSiteSettings, makeUniqueChatId } from '../db.js';
import { ApiError } from '../errors.js';
import { errorResponse, parseJsonRequest } from '../utils.js';
import { welcomeNewUser } from '../team.js';

function regDisabledResponse(c) {
  return errorResponse('注册功能未开放', 403);
}

async function ensureRegistrationOpen(c) {
  const site = await getSiteSettings(c.env.DB);
  return Boolean(site.allowRegistration);
}

export function registerRegistrationRoutes(app) {
  // 注册配置（供内置注册页拉取 OAuth 参数）
  app.get('/api/reg/config', async (c) => {
    if (!(await ensureRegistrationOpen(c))) {
      return regDisabledResponse(c);
    }
    const baseUrl = String(c.env.AUTH_ENDPOINT || 'https://auth.cuixi.qzz.io').replace(/\/$/, '');
    return c.json({
      clientId: String(c.env.CLIENT_ID || ''),
      authEndpoint: `${baseUrl}/oauth/authorize`,
      redirectUri: String(c.env.REDIRECT_URI || ''),
      scope: 'basic'
    });
  });

  // OAuth 回调换取用户信息，生成临时令牌存入 KV
  app.get('/api/reg/exchange', async (c) => {
    if (!(await ensureRegistrationOpen(c))) {
      return regDisabledResponse(c);
    }
    const code = String(c.req.query('code') || '').trim();
    if (!code) {
      return errorResponse('缺少授权码', 400);
    }

    const clientId = String(c.env.CLIENT_ID || '');
    const clientSecret = String(c.env.CLIENT_SECRET || '');
    const redirectUri = String(c.env.REDIRECT_URI || '');
    const tokenEndpoint = String(c.env.TOKEN_ENDPOINT || 'https://xi-auth.pages.dev/oauth/token');
    const userinfoEndpoint = String(c.env.USERINFO_ENDPOINT || 'https://xi-auth.pages.dev/oauth/userinfo');

    if (!clientId || !clientSecret || !redirectUri) {
      return errorResponse('注册服务配置缺失，请联系管理员', 500);
    }
    if (!c.env.OAUTH_TEMP) {
      return errorResponse('缺少 OAUTH_TEMP 存储绑定，请联系管理员', 500);
    }

    let tokenData;
    try {
      const tokenResp = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret
        })
      });
      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        return errorResponse(`换取令牌失败：${text.slice(0, 200)}`, 502);
      }
      tokenData = await tokenResp.json();
    } catch (error) {
      return errorResponse(`换取令牌网络错误：${error.message}`, 502);
    }

    let userinfo;
    try {
      const userResp = await fetch(userinfoEndpoint, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!userResp.ok) {
        const text = await userResp.text();
        return errorResponse(`获取用户信息失败：${text.slice(0, 200)}`, 502);
      }
      userinfo = await userResp.json();
    } catch (error) {
      return errorResponse(`获取用户信息网络错误：${error.message}`, 502);
    }

    const tempToken = crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.OAUTH_TEMP.put(
      tempToken,
      JSON.stringify({ sub: userinfo.sub, username: userinfo.username, email: userinfo.email || '' }),
      { expirationTtl: 600 }
    );

    return c.json({
      tempToken,
      userinfo: {
        sub: userinfo.sub,
        username: userinfo.username,
        email: userinfo.email || ''
      }
    });
  });

  // 共用：按熙熙账号唯一标识创建细聊账号（自动生成细聊号、欢迎流程、去重）
  async function createXiliaoUser(c, { xiSub, username, password, displayName }) {
    if (!xiSub) {
      return errorResponse('授权信息不完整', 400);
    }
    if (!username) {
      return errorResponse('用户名不能为空', 400);
    }
    if (password.length < 6) {
      return errorResponse('密码至少 6 位', 400);
    }

    // 防重复注册
    const existing = await c.env.DB.prepare(
      'SELECT xlim_user_id FROM oauth_mappings WHERE xi_sub = ? LIMIT 1'
    )
      .bind(xiSub)
      .all();
    if (existing.results[0]) {
      return errorResponse('该熙熙账号已注册过细聊，不可重复注册', 409);
    }

    const hashed = await hashPassword(password);
    const chatId = await makeUniqueChatId(c.env.DB, username);
    let result;
    try {
      result = await c.env.DB.prepare(
        `INSERT INTO users (username, display_name, password_hash, password_salt, chat_id)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(username, displayName, hashed.hash, hashed.salt, chatId)
        .run();
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        throw new ApiError('用户名已存在，请换一个');
      }
      throw error;
    }

    const userId = Number(result.meta.last_row_id);
    await c.env.DB.prepare(
      'INSERT INTO oauth_mappings (xi_sub, xlim_user_id) VALUES (?, ?)'
    )
      .bind(xiSub, userId)
      .run();

    await welcomeNewUser(c.env, userId, displayName);

    return { ok: true, user: { id: userId, username, displayName, chatId } };
  }

  // 用临时令牌创建细聊账号（自动生成细聊号）——主站内置 OAuth 注册用
  app.post('/api/reg/register', async (c) => {
    if (!(await ensureRegistrationOpen(c))) {
      return regDisabledResponse(c);
    }
    const payload = await parseJsonRequest(c.req.raw);
    const tempToken = String(payload.tempToken || '').trim();
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const displayName = String(payload.displayName || username).trim();

    if (!tempToken) {
      return errorResponse('临时令牌缺失', 400);
    }
    if (!c.env.OAUTH_TEMP) {
      return errorResponse('缺少 OAUTH_TEMP 存储绑定，请联系管理员', 500);
    }

    const raw = await c.env.OAUTH_TEMP.get(tempToken);
    if (!raw) {
      return errorResponse('临时令牌无效或已过期，请重新授权', 400);
    }
    let userInfo;
    try {
      userInfo = JSON.parse(raw);
    } catch {
      return errorResponse('令牌数据损坏', 500);
    }
    const xiSub = String(userInfo.sub || '');

    const result = await createXiliaoUser(c, { xiSub, username, password, displayName });
    if (result instanceof Response) return result;
    if (result.ok) await c.env.OAUTH_TEMP.delete(tempToken);
    return c.json(result);
  });

  // 专用注册接口：独立注册站直接调用，用共享密钥认证，无需管理员账号密码登录
  app.post('/api/public/oauth-register', async (c) => {
    if (!(await ensureRegistrationOpen(c))) {
      return regDisabledResponse(c);
    }
    const configuredSecret = String(c.env.REGISTER_SECRET || '');
    if (!configuredSecret) {
      return errorResponse('注册接口未配置密钥', 500);
    }
    const providedSecret = String(
      c.req.header('X-Register-Secret') || ''
    ).trim();
    // 简单字符串比较（定时安全无关紧要，此处仅作访问控制）
    if (providedSecret !== configuredSecret) {
      return errorResponse('注册密钥无效', 401);
    }

    const payload = await parseJsonRequest(c.req.raw);
    const xiSub = String(payload.xiSub || '').trim();
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const displayName = String(payload.displayName || username).trim();

    const result = await createXiliaoUser(c, { xiSub, username, password, displayName });
    if (result instanceof Response) return result;
    return c.json(result);
  });

  // 二合一：按熙熙账号唯一标识查绑定。
  // 已绑定 -> 免密签发细聊会话（token），未绑定 -> bound:false 让注册站展示注册表单。
  // 同样用共享密钥认证，供独立注册站调用。
  app.post('/api/public/oauth-resolve', async (c) => {
    const configuredSecret = String(c.env.REGISTER_SECRET || '');
    const providedSecret = String(c.req.header('X-Register-Secret') || '').trim();
    if (!configuredSecret || providedSecret !== configuredSecret) {
      return errorResponse('注册密钥无效', 401);
    }

    const payload = await parseJsonRequest(c.req.raw);
    const xiSub = String(payload.xiSub || '').trim();
    if (!xiSub) {
      return errorResponse('缺少熙熙账号标识', 400);
    }

    const mapping = await c.env.DB.prepare(
      'SELECT xlim_user_id FROM oauth_mappings WHERE xi_sub = ? LIMIT 1'
    )
      .bind(xiSub)
      .all();
    const userId = mapping.results[0]?.xlim_user_id;
    if (!userId) {
      return c.json({ bound: false });
    }

    // 找到绑定账号，检查状态后免密登录
    const user = await c.env.DB.prepare(
      `SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(Number(userId))
      .all();
    const row = user.results[0];
    if (!row || Number(row.is_disabled)) {
      return errorResponse('绑定的账号不可用，请联系管理员', 403);
    }
    if (
      row.banned_until === 'permanent' ||
      (row.banned_until && new Date(row.banned_until).getTime() > Date.now())
    ) {
      return errorResponse('账号已被封禁，暂时无法登录', 403);
    }

    const session = await createSession(c.env, row);
    return c.json({
      bound: true,
      token: session.token,
      session,
      user: {
        username: row.username,
        displayName: row.display_name,
        chatId: row.chat_id
      }
    });
  });
}
