<script setup lang="ts">
import { computed, inject, onBeforeUnmount, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import MessageBubble from "./MessageBubble.vue";

const props = defineProps({
  messenger: { type: Object, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const RUN_GAP_MS = 3 * 60 * 1000;
const BANNER_TIMEOUT_MS = 4500;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

function dayKey(ts) {
  return new Date(ts).toDateString();
}

watch(
  () => props.messenger.state.lastError,
  (message) => {
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
    if (!message) return;
    bannerTimer = setTimeout(() => {
      if (props.messenger.state.lastError === message) {
        props.messenger.state.lastError = "";
      }
      bannerTimer = null;
    }, BANNER_TIMEOUT_MS);
  }
);

onBeforeUnmount(() => {
  if (bannerTimer) clearTimeout(bannerTimer);
});

const typingLabel = computed(() => {
  const users = props.messenger.typingUsers?.value || [];
  if (!users.length) return "";
  if (users.length === 1) return t("thread.typingOne", { user: users[0] });
  return t("thread.typingMany", { count: String(users.length) });
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
</script>

<template>
  <section class="feed">
    <div
      v-if="messenger.state.lastError || messenger.state.systemBanner"
      class="banner"
      :class="{ 'is-err': !!messenger.state.lastError }"
    >
      {{ messenger.state.lastError || messenger.state.systemBanner }}
    </div>

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

    <div v-if="typingLabel" class="typing-indicator" aria-live="polite">{{ typingLabel }}</div>
  </section>
</template>
