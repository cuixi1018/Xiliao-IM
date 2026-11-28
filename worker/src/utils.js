export function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, { status });
}

export const MAX_JSON_BODY_SIZE = 10 * 1024 * 1024;

export function requestBodyTooLarge(request, maxBytes = MAX_JSON_BODY_SIZE) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export function parseJsonRequest(request) {
  return request.json().catch(() => ({}));
}

export function sanitizeLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function pickAttachment(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (!payload.key || !payload.name || !payload.type) {
    return null;
  }

  return {
    key: String(payload.key),
    name: String(payload.name),
    type: String(payload.type),
    size: Number(payload.size) || 0,
    ...(payload.duration ? { duration: Number(payload.duration) } : {}),
    url: `/files/${encodeURIComponent(String(payload.key))}`
  };
}

export function publicFileUrl(key) {
  return `/files/${encodeURIComponent(key)}`;
}

export function nextDailyUtcHour(hour) {
  const target = new Date();
  target.setUTCMinutes(0, 0, 0);
  target.setUTCHours(hour);
  if (target <= new Date()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

export function randomToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// 细聊号：仅字母数字（小写），4-20 位，无 # 或其他符号，如 cuixi8f3a
const CHAT_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function sanitizeChatUsername(username) {
  // 收敛为小写字母数字，作为细聊号前缀（保留 4 位给随机后缀，总长不超过 20）
  return String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16) || 'user';
}

export function generateChatId(username) {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let suffix = '';
  for (const byte of bytes) {
    suffix += CHAT_ID_ALPHABET[byte % CHAT_ID_ALPHABET.length];
  }
  return `${sanitizeChatUsername(username)}${suffix}`;
}
