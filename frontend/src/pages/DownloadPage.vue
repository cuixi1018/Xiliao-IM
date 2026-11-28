<script setup>
// 细聊客户端下载详情页（内部域名 /download）
// 展示版本信息、更新详情与各平台安装包，自动匹配当前设备。
import { onMounted, ref } from 'vue';
import api from '../api.js';

const info = ref(null);
const version = ref('1.01');
const changelog = ref([]);
const loading = ref(true);

const platform = (() => {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/mac/i.test(ua)) return 'mac';
  if (/linux/i.test(ua)) return 'linux';
  return 'other';
})();

onMounted(async () => {
  try {
    const data = await api.appVersion();
    if (data?.version) version.value = data.version;
    if (Array.isArray(data?.changelog)) changelog.value = data.changelog;
    info.value = data;
  } catch { /* 用兜底数据 */ }
  finally { loading.value = false; }
});

function downloads() {
  return info.value?.downloads || {};
}
function androidUrl() { return downloads().android?.url || 'https://xl.cuixi.qzz.io/files/releases/xiliao-v1.01.apk'; }
function windowsUrl() { return downloads().windows?.url || 'https://xl.cuixi.qzz.io/files/releases/xiliao-v1.01.exe'; }
</script>

<template>
  <div class="dl-page">
    <div class="dl-wrap">
      <header class="dl-header">
        <div class="dl-logo"><img src="/logo.svg" alt="细聊" /></div>
        <h1>细聊</h1>
        <p class="dl-tagline">随时随地，畅快聊天</p>
        <div class="dl-version"><span class="dl-dot"></span> v{{ version }} · 支持消息通知</div>
      </header>

      <p class="dl-tip">
        <template v-if="platform === 'android'">检测到你是 <b>Android</b> 设备，已为你推荐手机版 👇</template>
        <template v-else-if="platform === 'windows'">检测到你是 <b>Windows</b> 设备，已为你推荐桌面版 👇</template>
        <template v-else-if="platform === 'ios'">你正在使用 iOS 设备，iOS 版即将推出，可先用网页版 👇</template>
        <template v-else-if="platform === 'mac'">你正在使用 Mac，Mac 版即将推出，可先用网页版 👇</template>
        <template v-else>请选择适合你设备的安装包</template>
      </p>

      <div class="dl-card" :class="{ recommended: platform === 'android' }">
        <div class="dl-plat">
          <div class="dl-icon">🤖</div>
          <div><h2>Android 手机版</h2><div class="dl-sub">适用于 Android 7.0 及以上</div></div>
        </div>
        <div class="dl-meta"><span>📦 APK 安装包</span><span>💾 3.2 MB</span><span>✅ 已签名 · 开发者 cuixi1018</span></div>
        <a class="dl-btn" :href="androidUrl()" download>下载 Android 版</a>
      </div>

      <div class="dl-card" :class="{ recommended: platform === 'windows' }">
        <div class="dl-plat">
          <div class="dl-icon">💻</div>
          <div><h2>Windows 桌面版</h2><div class="dl-sub">适用于 Windows 10 / 11（64 位）</div></div>
        </div>
        <div class="dl-meta"><span>📦 便携版 EXE</span><span>💾 100 MB</span><span>⚡ 双击即用</span></div>
        <a class="dl-btn ghost" :href="windowsUrl()" download>下载 Windows 版</a>
      </div>

      <div v-if="changelog.length" class="dl-changelog">
        <h3>更新详情 · v{{ version }}</h3>
        <ul><li v-for="(line, i) in changelog" :key="i">{{ line }}</li></ul>
      </div>

      <div class="dl-section-title">其他用户端</div>
      <div class="dl-grid">
        <div class="dl-other"><div class="dl-other-ic">🍎</div><h3>Mac 桌面版</h3><p>macOS 10.15+</p><span class="dl-soon">即将推出</span></div>
        <div class="dl-other"><div class="dl-other-ic">📱</div><h3>iOS 版</h3><p>iPhone / iPad</p><span class="dl-soon">即将推出</span></div>
        <div class="dl-other"><div class="dl-other-ic">🐧</div><h3>Linux 版</h3><p>桌面 Linux</p><span class="dl-soon">即将推出</span></div>
        <div class="dl-other"><div class="dl-other-ic">🌐</div><h3>网页版</h3><p>无需安装</p><a href="/">立即打开 →</a></div>
      </div>

      <div class="dl-notes">
        <h3>安装说明</h3>
        <ul>
          <li>Android：下载 APK 后打开安装，如提示"未知来源"，请在设置中允许安装。</li>
          <li>Windows：下载后双击 EXE 即可运行，无需安装；首次打开如提示安全警告，选择"仍要继续"。</li>
          <li>各版本均加载线上服务，使用时请保持网络连接。</li>
          <li>APP 内可在「设置 → APP 专属设置」配置通知、隐私、应用锁与自动更新。</li>
        </ul>
      </div>

      <footer><span>细聊团队</span> · 让沟通更简单</footer>
    </div>
  </div>
</template>

<style scoped>
.dl-page { min-height: 100vh; box-sizing: border-box; padding: 0 18px 56px; background: radial-gradient(900px 500px at 12% -5%, rgba(7,193,96,.2), transparent 60%), radial-gradient(800px 500px at 100% 10%, rgba(91,163,191,.18), transparent 60%), linear-gradient(160deg,#f2f6f8,#e6ecef); }
.dl-wrap { max-width: 720px; margin: 0 auto; }
.dl-header { text-align: center; padding: 48px 18px 26px; }
.dl-logo { width: 96px; height: 96px; margin: 0 auto 18px; border-radius: 24px; background: linear-gradient(145deg,#fff,#eef7f1); display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 36px rgba(7,193,96,.18), inset 0 1px 0 #fff; }
.dl-logo img { width: 78px; height: 78px; object-fit: contain; }
.dl-header h1 { font-size: 30px; font-weight: 800; letter-spacing: 1px; margin: 0; color: #191919; }
.dl-tagline { color: #7a8a99; margin: 6px 0 0; font-size: 15px; }
.dl-version { display: inline-flex; align-items: center; gap: 7px; margin-top: 16px; padding: 6px 16px; background: rgba(7,193,96,.1); color: #06ad56; border-radius: 999px; font-size: 13px; font-weight: 600; border: 1px solid rgba(7,193,96,.18); }
.dl-dot { width: 7px; height: 7px; border-radius: 50%; background: #07c160; }
.dl-tip { text-align: center; color: #7a8a99; font-size: 13px; margin: 6px 0 22px; }
.dl-tip b { color: #06ad56; }
.dl-card { background: rgba(255,255,255,.82); border: 1px solid rgba(255,255,255,.8); border-radius: 22px; padding: 24px; margin-bottom: 18px; box-shadow: 0 10px 30px rgba(31,58,80,.07); position: relative; overflow: hidden; transition: transform .2s, box-shadow .2s; }
.dl-card:hover { transform: translateY(-3px); box-shadow: 0 18px 40px rgba(31,58,80,.12); }
.dl-card.recommended { border: 2px solid #07c160; }
.dl-card.recommended::after { content: "为你推荐"; position: absolute; top: 0; right: 0; background: linear-gradient(135deg,#07c160,#06ad56); color: #fff; font-size: 12px; font-weight: 600; padding: 7px 18px; border-bottom-left-radius: 14px; }
.dl-plat { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.dl-icon { width: 52px; height: 52px; flex: 0 0 52px; border-radius: 14px; background: rgba(7,193,96,.1); display: flex; align-items: center; justify-content: center; font-size: 27px; }
.dl-plat h2 { font-size: 19px; margin: 0; color: #191919; }
.dl-sub { color: #7a8a99; font-size: 12.5px; }
.dl-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: #7a8a99; font-size: 12.5px; margin-bottom: 20px; }
.dl-btn { display: block; width: 100%; padding: 14px; border-radius: 13px; text-align: center; text-decoration: none; font-size: 15.5px; font-weight: 600; background: linear-gradient(135deg,#07c160,#06ad56); color: #fff; box-shadow: 0 6px 16px rgba(7,193,96,.25); }
.dl-btn.ghost { background: rgba(7,193,96,.1); color: #06ad56; box-shadow: none; }
.dl-changelog { background: rgba(255,255,255,.82); border: 1px solid rgba(255,255,255,.8); border-radius: 20px; padding: 20px 24px; margin-bottom: 20px; }
.dl-changelog h3 { font-size: 15px; margin: 0 0 10px; color: #06ad56; }
.dl-changelog ul { margin: 0; padding-left: 18px; }
.dl-changelog li { font-size: 13px; line-height: 1.7; color: #555; }
.dl-changelog li::marker { color: #07c160; }
.dl-section-title { font-size: 14px; font-weight: 700; color: #191919; margin: 30px 4px 14px; display: flex; align-items: center; gap: 8px; }
.dl-section-title::before { content: ''; width: 4px; height: 16px; border-radius: 2px; background: #07c160; }
.dl-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
.dl-other { background: rgba(255,255,255,.82); border: 1px solid rgba(255,255,255,.8); border-radius: 18px; padding: 18px; text-align: center; box-shadow: 0 6px 18px rgba(31,58,80,.05); }
.dl-other-ic { font-size: 26px; }
.dl-other h3 { font-size: 14px; margin: 6px 0 2px; color: #191919; }
.dl-other p { font-size: 12px; color: #7a8a99; margin: 0; }
.dl-soon { display: inline-block; margin-top: 8px; font-size: 12.5px; font-weight: 600; color: #a7b2bb; }
.dl-other a { display: inline-block; margin-top: 8px; font-size: 12.5px; font-weight: 600; color: #06ad56; text-decoration: none; }
.dl-notes { margin-top: 30px; background: rgba(255,255,255,.82); border: 1px solid rgba(255,255,255,.8); border-radius: 20px; padding: 22px 24px; }
.dl-notes h3 { font-size: 15px; margin: 0 0 12px; color: #06ad56; }
.dl-notes ul { list-style: none; margin: 0; padding: 0; }
.dl-notes li { font-size: 13.5px; color: #7a8a99; padding: 6px 0 6px 20px; position: relative; }
.dl-notes li::before { content: "•"; position: absolute; left: 4px; color: #07c160; font-weight: bold; }
.dl-page footer { text-align: center; color: #7a8a99; font-size: 12px; margin-top: 28px; }
.dl-page footer span { color: #06ad56; font-weight: 600; }
@media (max-width: 480px) { .dl-header { padding-top: 32px; } .dl-header h1 { font-size: 25px; } .dl-card { padding: 20px; } }
</style>
