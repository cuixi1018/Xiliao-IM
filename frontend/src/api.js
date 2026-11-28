import { dispatchAuthInvalid, getStoredToken } from './auth-storage.js';

const API_PREFIX = '/api';

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers: buildHeaders(options.headers),
    body:
      options.body instanceof FormData || typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = payload?.error || payload || 'Request failed';
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;

    if (response.status === 401 && typeof window !== 'undefined') {
      dispatchAuthInvalid(message);
    }

    throw error;
  }

  return payload;
}

export default {
  login(credentials) {
    return request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: credentials
    });
  },
  logout() {
    return request('/auth/logout', { method: 'POST' });
  },
  session() {
    return request('/auth/session');
  },
  getSite() {
    return request('/site');
  },
  appVersion() {
    return request('/app/version');
  },
  changePassword(payload) {
    return request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateProfile(payload) {
    return request('/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getUsers() {
    return request('/users');
  },
  bootstrap() {
    return request('/bootstrap');
  },
  getChannels() {
    return request('/channels');
  },
  createGroup(payload) {
    return request('/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  joinChannel(channelId) {
    return request(`/channels/${channelId}/join`, { method: 'POST' });
  },
  // 群二维码（扫码进群，10 天有效）
  createChannelInviteCode(channelId) {
    return request(`/channels/${channelId}/invite-code`, { method: 'POST' });
  },
  getChannelInviteCode(token) {
    return request(`/channels/invite-code/${encodeURIComponent(token)}`);
  },
  joinChannelByInviteCode(token) {
    return request(`/channels/invite-code/${encodeURIComponent(token)}/join`, { method: 'POST' });
  },
  getChannelMembers(channelId) {
    return request(`/channels/${channelId}/members`);
  },
  inviteChannelMembers(channelId, userIds) {
    return request(`/channels/${channelId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userIds }
    });
  },
  removeChannelMember(channelId, userId) {
    return request(`/channels/${channelId}/members/${userId}`, {
      method: 'DELETE'
    });
  },
  deleteOwnedChannel(channelId) {
    return request(`/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  updateChannel(channelId, payload) {
    return request(`/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getMessages(kind, roomId, before) {
    const query = new URLSearchParams({ kind, roomId: String(roomId) });
    if (before) {
      query.set('before', String(before));
    }
    return request(`/messages?${query.toString()}`);
  },
  markRoomRead(kind, roomId, messageId) {
    return request('/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        kind,
        roomId,
        ...(messageId ? { messageId } : {})
      }
    });
  },
  openDm(userId) {
    return request('/dm/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userId }
    });
  },
  listDms() {
    return request('/dm');
  },
  uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    return request('/upload', {
      method: 'POST',
      body: form
    });
  },
  getRoomWebSocketUrl(kind, roomId) {
    const token = getStoredToken();
    const url = new URL(`/api/ws/${kind}/${roomId}`, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token || '');
    return url.toString();
  },
  getInboxWebSocketUrl() {
    const token = getStoredToken();
    const url = new URL('/api/inbox/ws', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token || '');
    return url.toString();
  },
  adminUsers() {
    return request('/admin/users');
  },
  adminOverview() {
    return request('/admin/overview');
  },
  adminSiteSettings() {
    return request('/admin/site-settings');
  },
  listAdminRegisterLinks() {
    return request('/admin/register-links');
  },
  createAdminRegisterLink(payload) {
    return request('/admin/register-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  revokeAdminRegisterLink(inviteId) {
    return request(`/admin/register-links/${inviteId}`, {
      method: 'DELETE'
    });
  },
  updateAdminSiteSettings(payload) {
    return request('/admin/site-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createUser(payload) {
    return request('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateUser(userId, payload) {
    return request(`/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  resetPassword(userId, password) {
    return request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { password }
    });
  },
  deleteUser(userId) {
    return request(`/admin/users/${userId}`, {
      method: 'DELETE'
    });
  },
  deactivateAccount() {
    return request('/me/deactivate', { method: 'POST' });
  },
  adminChannels() {
    return request('/admin/channels');
  },
  deleteChannel(channelId) {
    return request(`/admin/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  adminDms() {
    return request('/admin/dms');
  },
  adminRoomMessages(kind, roomId, before) {
    const query = before ? `?before=${encodeURIComponent(String(before))}` : '';
    return request(`/admin/rooms/${kind}/${roomId}/messages${query}`);
  },
  searchMessages(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
    return request(`/admin/messages/search?${query.toString()}`);
  },
  getRegisterInvite(token) {
    return request(`/register-links/${encodeURIComponent(token)}`);
  },
  registerWithInvite(token, payload) {
    return request(`/register-links/${encodeURIComponent(token)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },

  // ===== 好友 =====
  getFriends() {
    return request('/friends');
  },
  searchUsers(keyword) {
    return request('/friends/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { keyword }
    });
  },
  addFriend(payload) {
    return request('/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  respondFriend(requestId, accept) {
    return request('/friends/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { requestId, accept }
    });
  },
  removeFriend(userId) {
    return request(`/friends/${userId}`, { method: 'DELETE' });
  },

  // ===== 黑名单 =====
  getBlacklist() {
    return request('/blacklist');
  },
  blockUser(userId) {
    return request('/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userId }
    });
  },
  unblockUser(userId) {
    return request(`/blacklist/${userId}`, { method: 'DELETE' });
  },

  // ===== 群聊 / 消息 =====
  leaveChannel(channelId) {
    return request(`/channels/${channelId}/leave`, { method: 'POST' });
  },
  clearMessages(kind, roomId) {
    return request('/messages/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { kind, roomId }
    });
  },
  sendMessageApi(kind, roomId, payload) {
    return request('/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { kind, roomId, ...payload }
    });
  },

  // ===== 内置注册 =====
  getRegConfig() {
    return request('/reg/config');
  },
  regExchange(code) {
    return request(`/reg/exchange?code=${encodeURIComponent(code)}`);
  },
  regRegister(payload) {
    return request('/reg/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },

  // ===== 朋友圈 =====
  getMoments(before, userId) {
    const params = new URLSearchParams();
    if (before) params.set('before', String(before));
    if (userId) params.set('userId', String(userId));
    const qs = params.toString();
    return request(`/moments${qs ? `?${qs}` : ''}`);
  },
  createMoment(payload) {
    return request('/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  likeMoment(id, like) {
    return request(`/moments/${id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { like }
    });
  },
  commentMoment(id, payload) {
    return request(`/moments/${id}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteMoment(id) {
    return request(`/moments/${id}`, { method: 'DELETE' });
  },

  // ===== 消息操作：撤回 / 删除 / 转发 / 搜索 =====
  recallMessage(id) {
    return request(`/messages/${id}/recall`, { method: 'POST' });
  },
  deleteMessage(id) {
    return request(`/messages/${id}`, { method: 'DELETE' });
  },
  forwardMessage(id, toKind, toRoomId, content) {
    return request(`/messages/${id}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { toKind, toRoomId, content }
    });
  },
  searchChatMessages(keyword, roomId) {
    const query = new URLSearchParams({ keyword });
    if (roomId) query.set('roomId', String(roomId));
    return request(`/messages/search?${query.toString()}`);
  },

  // ===== 全局搜索 =====
  globalSearch(q) {
    return request(`/search?q=${encodeURIComponent(q)}`);
  },

  // ===== 资料扩展 / 细聊号 / 好友验证 / 备注 / 投诉 =====
  updateChatId(chatId) {
    return request('/me/chat-id', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { chatId }
    });
  },
  getMe() {
    return request('/me');
  },
  setFriendVerify(required) {
    return request('/me/friend-verify', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { required }
    });
  },
  markWelcomeSeen() {
    return request('/me/welcome-seen', { method: 'POST' });
  },
  setFriendRemark(userId, remark) {
    return request(`/friends/${userId}/remark`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { remark }
    });
  },
  getFriendDetail(userId) {
    return request(`/friends/${userId}/detail`);
  },
  submitComplaint(payload) {
    return request('/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },

  // ===== 群公告 =====
  setChannelAnnouncement(channelId, announcement) {
    return request(`/channels/${channelId}/announcement`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: { announcement }
    });
  },

  // ===== 管理后台：封号 / 投诉 / 站点设置 =====
  banUser(userId, mode, hours) {
    return request(`/admin/users/${userId}/ban`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { mode, hours }
    });
  },
  adminComplaints(status) {
    return request(`/admin/complaints?status=${encodeURIComponent(status || 'pending')}`);
  },
  handleComplaint(id, status) {
    return request(`/admin/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: { status }
    });
  }
};

