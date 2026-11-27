// D1/SQLite 的 created_at 是 UTC 的 "YYYY-MM-DD HH:MM:SS"（无时区标识）。
// 直接用 new Date() 会被当成本地时间解析，导致东八区少 8 小时。
// 这里统一补 T/Z 按 UTC 解析；已是 ISO（带 Z 或时区偏移）的原样解析。
export function parseServerDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  const hasZone = s.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  const date = new Date(s.replace(' ', 'T') + (hasZone ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date;
}

// HH:MM
export function formatClock(value) {
  const date = parseServerDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// 相对时间：刚刚 / N分钟前 / N小时前 / M月D日
export function formatRelativeTime(value) {
  const date = parseServerDate(value);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// 完整本地时间：YYYY/M/D HH:MM:SS（用于管理后台等）
export function formatFullTime(value) {
  const date = parseServerDate(value);
  if (!date) return '';
  return date.toLocaleString();
}

// 会话列表时间：今天显示 HH:MM，昨天显示“昨天”，更早显示 M月D日
export function formatListTime(value) {
  const date = parseServerDate(value);
  if (!date) return '';
  const now = new Date();
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(date, now)) return formatClock(value);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
