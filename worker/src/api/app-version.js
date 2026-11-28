// APP 版本与更新信息（公开接口，无需登录）
// 每次发布新版本时只需修改 APP_VERSION 常量即可。

const APP_VERSION = {
  version: '1.01',
  versionCode: 2,
  releasedAt: '2026-11-28',
  forceUpdate: false,
  developer: 'cuixi1018',
  changelog: [
    '新增消息通知开关、免打扰时段与消息预览设置',
    '新增应用锁与隐私模式，聊天内容更安全',
    '应用内检查更新，发现新版可一键下载安装',
    '新增 APP 专属设置分区，界面更圆滑',
    '深色 / 浅色模式（跟随系统）',
    '清除缓存与本机聊天记录'
  ],
  downloads: {
    android: {
      url: 'https://xl.cuixi.qzz.io/files/releases/xiliao-v1.01.apk',
      size: '3.2 MB',
      filename: '细聊-1.01-Android.apk'
    },
    windows: {
      url: 'https://xl.cuixi.qzz.io/files/releases/xiliao-v1.01.exe',
      size: '100 MB',
      filename: '细聊-1.01-Windows便携版.exe'
    },
    mac: { available: false, note: '即将推出' },
    ios: { available: false, note: '即将推出' },
    linux: { available: false, note: '即将推出' },
    web: { available: true, url: 'https://xl.cuixi.qzz.io/' }
  }
};

export function registerAppVersionRoutes(app) {
  app.get('/api/app/version', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ ok: true, ...APP_VERSION });
  });
}
