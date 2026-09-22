<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, type PropType } from "vue";
import Icon from "@/components/Icon.vue";
import MessageBubble from "@/components/MessageBubble.vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const thread = computed(() => props.messenger.state.openThread);
const root = computed(() => {
  const current = thread.value;
  return current ? (props.messenger.state.messagesByRoom[current.roomId] || []).find((m) => m.messageId === current.rootId) : undefined;
});
const replies = computed(() => (thread.value ? props.messenger.threadMessages(thread.value.roomId, thread.value.rootId) : []));
const draft = ref("");
const sending = ref(false);
const bodyRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);

function plural(count: number) {
  const key = `threads.replies.${new Intl.PluralRules(locale.value).select(count)}`;
  const value = t(key, { count: String(count) });
  return value === key ? t("threads.replies.other", { count: String(count) }) : value;
}

function close() {
  props.messenger.state.openThread = null;
}

async function scrollToEnd() {
  await nextTick();
  if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight;
}

async function send() {
  if (!draft.value.trim() || sending.value) return;
  sending.value = true;
  if (await props.messenger.sendThreadReply(draft.value)) draft.value = "";
  sending.value = false;
  inputRef.value?.focus();
}

watch(() => replies.value.length, scrollToEnd);
watch(thread, (value) => {
  if (!value) return;
  draft.value = "";
  void scrollToEnd();
  setTimeout(() => inputRef.value?.focus(), 300);
});
watch(() => props.messenger.state.activeRoom, (room) => {
  if (thread.value && thread.value.roomId !== room) close();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="thread-panel">
      <aside v-if="thread" class="thread-panel" role="dialog" :aria-label="t('threads.title')" @keydown.esc="close">
        <header class="thread-panel__head">
          <strong>{{ t('threads.title') }}</strong>
          <button type="button" class="icon-btn" :aria-label="t('message.close')" @click="close">
            <Icon name="close" viewBox="0 0 24 24" />
          </button>
        </header>
        <div ref="bodyRef" class="thread-panel__body">
          <MessageBubble v-if="root" :message="root" :messenger="messenger" position="single" in-thread />
          <div class="thread-panel__divider">{{ plural(replies.length) }}</div>
          <MessageBubble v-for="reply in replies" :key="reply.messageId" :message="reply" :messenger="messenger"
            position="single" in-thread />
          <p v-if="!replies.length" class="thread-panel__empty">{{ t('threads.empty') }}</p>
        </div>
        <form class="thread-panel__composer" @submit.prevent="send">
          <textarea ref="inputRef" v-model="draft" rows="1" maxlength="2000" class="qx-field"
            :placeholder="t('threads.placeholder')" @keydown.enter.exact.prevent="send"></textarea>
          <button type="submit" class="thread-panel__send" :disabled="!draft.trim() || sending" :aria-label="t('composer.send')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
          </button>
        </form>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.thread-panel {
  position: fixed;
  top: var(--app-top-inset, 0px);
  right: 0;
  bottom: 0;
  z-index: var(--z-sheet);
  display: flex;
  flex-direction: column;
  width: min(420px, 100vw);
  background: var(--surface);
  color: var(--text);
  box-shadow: -18px 0 50px rgba(0, 0, 0, 0.28), -1px 0 0 var(--line-strong);
}

.thread-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(12px + var(--mobile-status-offset, 0px)) 14px 12px 18px;
  border-bottom: 1px solid var(--line);
}

.thread-panel__head strong {
  font-size: 15px;
  font-weight: 700;
}

.thread-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 12px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.thread-panel__divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 6px;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
}

.thread-panel__divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.thread-panel__empty {
  margin: 18px 0;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.thread-panel__composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px max(12px, var(--app-safe-bottom));
  border-top: 1px solid var(--line);
}

.thread-panel__composer textarea {
  flex: 1;
  min-height: 38px;
  max-height: 140px;
  resize: none;
}

.thread-panel__send {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.thread-panel__send:disabled {
  opacity: 0.4;
}

.thread-panel__send:active {
  transform: scale(.92);
}

.thread-panel__send svg {
  width: 16px;
  height: 16px;
}

.thread-panel-enter-active {
  transition: transform var(--dur-slow) var(--ease-out), opacity var(--dur-base) var(--ease-out);
}

.thread-panel-leave-active {
  transition: transform var(--dur-base) var(--ease-in), opacity var(--dur-fast) var(--ease-in);
}

.thread-panel-enter-from,
.thread-panel-leave-to {
  transform: translateX(100%);
  opacity: 0.6;
}

@media (max-width: 700px) {
  .thread-panel {
    width: 100vw;
    box-shadow: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .thread-panel-enter-from,
  .thread-panel-leave-to {
    transform: none;
  }
}
</style>
