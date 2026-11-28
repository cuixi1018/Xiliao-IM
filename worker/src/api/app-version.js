// APP 版本与更新信息（公开接口，无需登录）
// 每次发布新版本时只需修改 APP_VERSION 常量即可。

const APP_VERSION = {
  version: '1.0.0',
  versionCode: 1,
  releasedAt: '2026-11-28',
  forceUpdate: false,
  changelog: [
    '支持新消息系统通知',
    '深色 / 浅色模式（跟随系统）',
    '清除缓存与本机聊天记录',
    '自动检查更新'
  ],
  downloads: {
    android: {
      url: 'https://xl.cuixi.qzz.io/files/releases/xiliao-v1.0.apk',
      size: '3.2 MB',
      filename: '细聊-1.0.0-Android.apk'
    },
    windows: {
      url: 'https://xl.cuixi.qzz.io/files/releases/xiliao-v1.0.exe',
      size: '100 MB',
      filename: '细聊-1.0.0-Windows便携版.exe'
    }
  }
};

export function registerAppVersionRoutes(app) {
  app.get('/api/app/version', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ ok: true, ...APP_VERSION });
  });
}
