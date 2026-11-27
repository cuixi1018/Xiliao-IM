<script setup>
import { onMounted, ref } from 'vue';
import api from '../api.js';
import { formatFullTime } from '../time-utils.js';
import UiSurface from '../components/ui/Surface.vue';
import UiButton from '../components/ui/Button.vue';

const loading = ref(false);
const error = ref('');
const complaints = ref([]);
const status = ref('pending');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.adminComplaints(status.value);
    complaints.value = data.complaints || [];
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function handle(item, nextStatus) {
  try {
    await api.handleComplaint(item.id, nextStatus);
    await load();
  } catch (e) { error.value = e.message; }
}

onMounted(load);
</script>

<template>
  <section class="ac-section">
    <header class="ac-head">
      <div>
        <h2>投诉管理</h2>
        <p>核实用户投诉，可封禁违规账号（在用户管理中进行）</p>
      </div>
      <div class="ac-tabs">
        <button :class="{ active: status === 'pending' }" @click="status = 'pending'; load()">待处理</button>
        <button :class="{ active: status === 'handled' }" @click="status = 'handled'; load()">已处理</button>
        <button :class="{ active: status === 'ignored' }" @click="status = 'ignored'; load()">已忽略</button>
      </div>
    </header>

    <p v-if="error" class="ac-error">{{ error }}</p>

    <UiSurface class="ac-panel">
      <div v-if="loading" class="ac-empty">加载中...</div>
      <div v-else-if="!complaints.length" class="ac-empty">暂无{{ status === 'pending' ? '待处理' : '' }}投诉</div>
      <div v-else class="ac-list">
        <div v-for="c in complaints" :key="c.id" class="ac-item">
          <div class="ac-item__head">
            <strong>{{ c.reason }}</strong>
            <span class="ac-time">{{ formatFullTime(c.createdAt) }}</span>
          </div>
          <div class="ac-item__body">
            <div class="ac-party">
              <span class="ac-label">投诉人</span>
              <span>{{ c.reporter.displayName }}</span>
            </div>
            <div class="ac-party">
              <span class="ac-label">被投诉</span>
              <span>{{ c.target.displayName }}（{{ c.target.chatId }}）</span>
            </div>
            <p v-if="c.detail" class="ac-detail">{{ c.detail }}</p>
          </div>
          <div v-if="c.status === 'pending'" class="ac-actions">
            <UiButton variant="secondary" size="sm" @click="handle(c, 'ignored')">忽略</UiButton>
            <UiButton size="sm" @click="handle(c, 'handled')">标记已处理</UiButton>
          </div>
          <div v-else class="ac-status">{{ c.status === 'handled' ? '已处理' : '已忽略' }}</div>
        </div>
      </div>
    </UiSurface>
  </section>
</template>

<style scoped>
.ac-section { display: flex; flex-direction: column; gap: 16px; animation: fadeSlideUp 0.5s ease forwards; }
.ac-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.ac-head h2 { margin: 0 0 4px; font-size: 22px; color: #191919; }
.ac-head p { margin: 0; font-size: 13px; color: #888; }
.ac-tabs { display: flex; gap: 6px; }
.ac-tabs button { padding: 8px 14px; border: 1px solid #ddd; border-radius: 8px; background: #fff; color: #666; font-size: 13px; cursor: pointer; }
.ac-tabs button.active { background: #07c160; border-color: #07c160; color: #fff; }
.ac-error { padding: 10px 14px; background: #fdeaea; color: #c0392b; border-radius: 8px; font-size: 13px; }
.ac-panel { padding: 8px; }
.ac-empty { padding: 40px; text-align: center; color: #aaa; font-size: 14px; }
.ac-list { display: flex; flex-direction: column; }
.ac-item { padding: 16px; border-bottom: 1px solid #f0f0f0; }
.ac-item:last-child { border-bottom: none; }
.ac-item__head { display: flex; justify-content: space-between; align-items: center; }
.ac-item__head strong { color: #191919; font-size: 15px; }
.ac-time { color: #aaa; font-size: 12px; }
.ac-item__body { margin: 10px 0; display: flex; flex-direction: column; gap: 6px; }
.ac-party { font-size: 13px; color: #555; }
.ac-label { display: inline-block; width: 56px; color: #aaa; }
.ac-detail { margin: 6px 0 0; padding: 10px; background: #f7f7f7; border-radius: 8px; font-size: 13px; color: #555; }
.ac-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ac-status { text-align: right; font-size: 12px; color: #aaa; }
@keyframes fadeSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
