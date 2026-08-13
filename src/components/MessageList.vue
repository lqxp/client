<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MessageBubble from "./MessageBubble.vue";

const props = defineProps({
  messenger: { type: Object, required: true }
});

const RUN_GAP_MS = 3 * 60 * 1000;
const SCROLL_BOTTOM_THRESHOLD = 32;
const feedRef = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);

function dayKey(ts) {
  return new Date(ts).toDateString();
}

function isNearBottom() {
  const feed = feedRef.value;
  if (!feed) return true;
  return (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= SCROLL_BOTTOM_THRESHOLD;
}

function updateStickToBottom() {
  stickToBottom.value = isNearBottom();
}

function scrollToBottom() {
  const feed = feedRef.value;
  if (!feed) return;
  feed.scrollTop = feed.scrollHeight;
}

onBeforeUnmount(() => {
  feedRef.value?.removeEventListener("scroll", updateStickToBottom);
});

const decorated = computed(() => {
  const list = props.messenger.sortedMessages.value || [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const m = list[i];
    const prev = list[i - 1];
    const next = list[i + 1];
    const showDay = !prev || dayKey(prev.timestamp) !== dayKey(m.timestamp);
    const sameAsPrev = prev && prev.username === m.username && (m.timestamp - prev.timestamp) < RUN_GAP_MS && !showDay;
    const sameAsNext = next && next.username === m.username && (next.timestamp - m.timestamp) < RUN_GAP_MS && dayKey(m.timestamp) === dayKey(next.timestamp);

    let position;
    if (!sameAsPrev && !sameAsNext) position = "single";
    else if (!sameAsPrev && sameAsNext) position = "start";
    else if (sameAsPrev && sameAsNext) position = "mid";
    else position = "end";

    const discordStyle = props.messenger.state.messageStyle === "discord";
    out.push({
      m,
      showDay,
      position,
      showAuthor: !sameAsPrev,
      showAvatar: discordStyle ? (!sameAsPrev) : (position === "end" || position === "single")
    });
  }
  return out;
});

watch(
  () => props.messenger.state.activeRoom,
  async () => {
    stickToBottom.value = true;
    await nextTick();
    scrollToBottom();
  },
  { immediate: true }
);

watch(
  () => decorated.value.length,
  async (nextLength, prevLength) => {
    if (nextLength <= prevLength || !stickToBottom.value) return;
    await nextTick();
    scrollToBottom();
  }
);

watch(
  () => props.messenger.typingUsers?.value?.join("|") || "",
  async () => {
    if (!stickToBottom.value) return;
    await nextTick();
    scrollToBottom();
  }
);

onMounted(() => {
  feedRef.value?.addEventListener("scroll", updateStickToBottom, { passive: true });
  updateStickToBottom();
});
</script>

<template>
  <section ref="feedRef" class="feed">
    <template v-for="entry in decorated" :key="entry.m.messageId">
      <div v-if="entry.showDay" class="day">{{ messenger.formatDay(entry.m.timestamp) }}</div>
      <MessageBubble
        :message="entry.m"
        :messenger="messenger"
        :position="entry.position"
        :show-author="entry.showAuthor"
        :show-avatar="entry.showAvatar"
      />
    </template>
  </section>
</template>
