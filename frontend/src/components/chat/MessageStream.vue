<script setup>
import { ref } from 'vue';
import MessageAttachment from './MessageAttachment.vue';
import UiAvatar from '../ui/Avatar.vue';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  emptyText: {
    type: String,
    default: '这里还没有消息。'
  },
  sessionUserId: {
    type: Number,
    default: 0
  },
  showOlder: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['load-older']);
const scrollContainer = ref(null);

function isOwnMessage(message) {
  return Number(message.sender.id) === Number(props.sessionUserId);
}

function isSameSender(left, right) {
  return left && right && Number(left.sender.id) === Number(right.sender.id);
}

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 跨天或第一条消息前插入日期分隔条
function isNewDay(index) {
  if (index === 0) return true;
  return dayKey(props.messages[index].createdAt) !== dayKey(props.messages[index - 1].createdAt);
}

// 同一天且同一发送人才算连续消息（跨天不堆叠）
function isStacked(index) {
  return index > 0 && !isNewDay(index) && isSameSender(props.messages[index - 1], props.messages[index]);
}

function isContinuedTail(index) {
  const next = index + 1;
  return next < props.messages.length && !isNewDay(next) && isSameSender(props.messages[index], props.messages[next]);
}

function bubbleRowClass(message, index) {
  return {
    'chat-bubble-row--own': isOwnMessage(message),
    'chat-bubble-row--stacked': isStacked(index)
  };
}

function bubbleClass(message, index) {
  return {
    'chat-bubble--own': isOwnMessage(message),
    'chat-bubble--continued': isStacked(index),
    'chat-bubble--tail-hidden': isContinuedTail(index)
  };
}

// 每条消息只显示简短时间，完整日期交给分隔条
function formatClock(value) {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(value) === dayKey(today)) return '今天';
  if (dayKey(value) === dayKey(yesterday)) return '昨天';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function scrollToBottom() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
}

defineExpose({
  scrollToBottom
});
</script>

<template>
  <section ref="scrollContainer" class="chat-message-scroll">
    <div class="chat-message-inner">
      <UiButton v-if="showOlder && messages.length" variant="secondary" size="sm" @click="emit('load-older')">
        加载更早消息
      </UiButton>

      <UiSurface v-if="loading" tone="soft" class="empty-state">
        正在加载消息...
      </UiSurface>

      <UiSurface v-else-if="error" tone="soft" class="empty-state">
        {{ error }}
      </UiSurface>

      <UiSurface v-else-if="!messages.length" tone="soft" class="empty-state">
        {{ emptyText }}
      </UiSurface>

      <template v-for="(message, index) in messages" :key="message.id">
        <div v-if="isNewDay(index)" class="chat-day-divider">
          <span>{{ formatDayLabel(message.createdAt) }}</span>
        </div>
        <article
          class="chat-bubble-row"
          :class="bubbleRowClass(message, index)"
        >
          <UiAvatar
            v-if="!isOwnMessage(message)"
            :src="message.sender.avatarUrl"
            :fallback="message.sender.displayName"
            size="sm"
          />
          <div class="chat-bubble" :class="bubbleClass(message, index)">
            <div class="chat-bubble__meta">
              <strong>{{ isOwnMessage(message) ? '我' : message.sender.displayName }}</strong>
              <span>{{ formatClock(message.createdAt) }}</span>
            </div>
            <p v-if="message.content">{{ message.content }}</p>
            <MessageAttachment v-if="message.attachment" :attachment="message.attachment" />
          </div>
        </article>
      </template>
    </div>
  </section>
</template>
