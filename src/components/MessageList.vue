<script setup lang="ts">
import type { ChatMessage, Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import MessageBubble from "./MessageBubble.vue";
import Avatar from "@/components/Avatar.vue";
import ProfileCard from "@/components/ProfileCard.vue";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const RUN_GAP_MS = 3 * 60 * 1000;
const SCROLL_BOTTOM_THRESHOLD = 32;
const SKELETON_MAX_MS = 10_000;
const feedRef = ref<HTMLElement | null>(null);
const REVEAL_MAX = 64;
const reveal = ref(0);
const revealReleasing = ref(false);
let revealStart = { x: 0, y: 0 };
let revealTracking = false;
let revealEngaged = false;
let revealDecided = false;

// Leftward drag slides own messages aside and shows every message's exact time.
function onRevealDown(event: PointerEvent) {
  if (event.pointerType === "mouse") return;
  revealStart = { x: event.clientX, y: event.clientY };
  revealTracking = event.clientX < window.innerWidth - 24;
  revealEngaged = false;
  revealDecided = false;
}

function onRevealMove(event: PointerEvent) {
  if (!revealTracking) return;
  const dx = event.clientX - revealStart.x;
  const dy = event.clientY - revealStart.y;
  if (!revealDecided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    revealDecided = true;
    revealEngaged = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (!revealEngaged) revealTracking = false;
  }
  if (revealEngaged) reveal.value = Math.min(REVEAL_MAX, Math.max(0, -dx * 0.7));
}

function onRevealEnd() {
  revealTracking = false;
  if (!revealEngaged && !reveal.value) return;
  revealEngaged = false;
  revealReleasing.value = true;
  reveal.value = 0;
  setTimeout(() => (revealReleasing.value = false), 280);
}
const stickToBottom = ref(true);
const unreadAbove = ref(false);
const missedBelow = ref(0);
const skeletonExpired = ref(false);
let unreadDivider: HTMLElement | null = null;
let feedResizeObserver: ResizeObserver | null = null;
let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

function dayKey(ts: number) {
  return new Date(ts).toDateString();
}

function plural(base: string, count: number) {
  const category = new Intl.PluralRules(locale.value).select(count);
  const key = `${base}.${category}`;
  const value = t(key, { count: String(count) });
  return value === key ? t(`${base}.other`, { count: String(count) }) : value;
}

const myName = computed(() => String(props.messenger.state.username || "").trim().toLowerCase());

function fromOthers(message: ChatMessage) {
  return !message.system && String(message.username || "").trim().toLowerCase() !== myName.value;
}

function isNearBottom() {
  const feed = feedRef.value;
  if (!feed) return true;
  return (feed.scrollHeight - feed.scrollTop - feed.clientHeight) <= SCROLL_BOTTOM_THRESHOLD;
}

function updateUnreadAbove() {
  const feed = feedRef.value;
  if (!feed || !unreadDivider) {
    unreadAbove.value = false;
    return;
  }
  unreadAbove.value = unreadDivider.getBoundingClientRect().bottom < feed.getBoundingClientRect().top + 8;
}

function onFeedScroll() {
  stickToBottom.value = isNearBottom();
  if (stickToBottom.value) missedBelow.value = 0;
  updateUnreadAbove();
}

function scrollToBottom() {
  const feed = feedRef.value;
  if (!feed) return;
  feed.scrollTop = feed.scrollHeight;
}

function smoothBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function jumpToUnread() {
  unreadDivider?.scrollIntoView({ block: "center", behavior: smoothBehavior() });
}

function jumpToBottom() {
  const feed = feedRef.value;
  if (!feed) return;
  feed.scrollTo({ top: feed.scrollHeight, behavior: smoothBehavior() });
  missedBelow.value = 0;
}

function setUnreadDivider(element: unknown) {
  unreadDivider = element instanceof HTMLElement ? element : null;
}

async function onFeedResize() {
  if (stickToBottom.value) {
    await nextTick();
    scrollToBottom();
  }
  updateUnreadAbove();
}

const messages = computed(() => props.messenger.sortedMessages.value || []);
const idOf = (m: ChatMessage) => String(m.messageId || "");

const typingUsers = computed(() => props.messenger.typingUsers?.value || []);
const selectedTyperProfile = ref("");

function openTyperProfile() {
  if (typingUsers.value.length !== 1) return;
  const name = String(typingUsers.value[0] || "").trim().toLowerCase();
  if (!name) return;
  selectedTyperProfile.value = name;
}

function closeTyperProfile() {
  selectedTyperProfile.value = "";
}
const typingText = computed(() => {
  const users = typingUsers.value;
  if (!users.length) return "";
  return users.length === 1 ? t("thread.typingOne", { user: users[0] }) : t("thread.typingMany", { count: String(users.length) });
});


const decorated = computed(() => {
  const list = messages.value;
  const discordStyle = props.messenger.state.messageStyle === "discord";
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

    out.push({
      m,
      position,
      showAuthor: !sameAsPrev,
      showAvatar: discordStyle ? (!sameAsPrev) : (position === "end" || position === "single")
    });
  }
  return out;
});

const groups = computed(() => {
  const out: { key: string; label: string; entries: typeof decorated.value }[] = [];
  for (const entry of decorated.value) {
    const key = dayKey(entry.m.timestamp);
    const last = out[out.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else out.push({ key, label: props.messenger.formatDay(entry.m.timestamp), entries: [entry] });
  }
  return out;
});

const unreadCount = computed(() => {
  const anchor = props.messenger.state.unreadAnchor;
  return anchor && anchor.roomId === props.messenger.state.activeRoom ? anchor.count : 0;
});

const firstUnreadId = computed(() => {
  let remaining = unreadCount.value;
  if (!remaining) return "";
  const list = messages.value;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!fromOthers(list[i])) continue;
    remaining -= 1;
    if (remaining === 0) return list[i].messageId;
  }
  return list.find(fromOthers)?.messageId ?? "";
});

const historyLoading = computed(() => {
  const room = props.messenger.state.activeRoom;
  const state = props.messenger.state;
  return Boolean(room) && (state.pendingJoinRooms.includes(room) || state.historyPendingRooms.includes(room));
});

const showSkeleton = computed(() => historyLoading.value && !messages.value.length && !skeletonExpired.value);

const skeletonRows = [
  { own: false, lines: [62, 38] },
  { own: false, lines: [44] },
  { own: true, lines: [52] },
  { own: false, lines: [70, 56, 30] },
  { own: true, lines: [36, 58] },
  { own: false, lines: [48] },
  { own: true, lines: [64] },
];

watch(showSkeleton, (visible) => {
  if (skeletonTimer) clearTimeout(skeletonTimer);
  skeletonTimer = visible ? setTimeout(() => (skeletonExpired.value = true), SKELETON_MAX_MS) : null;
});

watch(
  () => props.messenger.state.activeRoom,
  async () => {
    stickToBottom.value = true;
    missedBelow.value = 0;
    skeletonExpired.value = false;
    await nextTick();
    scrollToBottom();
    updateUnreadAbove();
  },
  { immediate: true }
);

watch(
  () => idOf(messages.value[messages.value.length - 1] || ({} as ChatMessage)),
  async (lastId, previousLastId) => {
    if (!lastId || lastId === previousLastId) return;
    if (!stickToBottom.value) {
      const list = messages.value;
      const from = list.findIndex((m) => idOf(m) === previousLastId);
      if (from >= 0) missedBelow.value += list.slice(from + 1).filter(fromOthers).length;
      return;
    }
    await nextTick();
    scrollToBottom();
    updateUnreadAbove();
  }
);

watch(firstUnreadId, () => nextTick(updateUnreadAbove), { flush: "post" });

watch(
  () => props.messenger.typingUsers?.value?.join("|") || "",
  async () => {
    if (!stickToBottom.value) return;
    await nextTick();
    scrollToBottom();
  }
);

watch(
  () =>
    [
      props.messenger.state.streamerMode,
      props.messenger.state.inCall,
      props.messenger.state.callRoom,
    ].join("|"),
  async () => {
    if (!stickToBottom.value) return;
    await nextTick();
    scrollToBottom();
  }
);

onMounted(() => {
  feedRef.value?.addEventListener("scroll", onFeedScroll, { passive: true });
  onFeedScroll();
  if (feedRef.value) {
    feedResizeObserver = new ResizeObserver(onFeedResize);
    feedResizeObserver.observe(feedRef.value);
  }
});

onBeforeUnmount(() => {
  feedResizeObserver?.disconnect();
  feedResizeObserver = null;
  if (skeletonTimer) clearTimeout(skeletonTimer);
  feedRef.value?.removeEventListener("scroll", onFeedScroll);
});
</script>

<template>
  <div class="feed-wrap">
    <section ref="feedRef" class="feed" :class="{ 'is-revealing': reveal > 0, 'is-reveal-release': revealReleasing }"
      :style="{ '--reveal': `${reveal}px`, '--reveal-p': String(reveal / REVEAL_MAX) }"
      @pointerdown="onRevealDown" @pointermove="onRevealMove" @pointerup="onRevealEnd" @pointercancel="onRevealEnd">
      <Transition name="qx-fade">
        <div v-if="showSkeleton" class="feed-skeleton" role="status" :aria-label="t('thread.loadingHistory')">
          <div v-for="(row, index) in skeletonRows" :key="index" class="feed-skeleton__row"
            :class="{ 'is-own': row.own }" :style="{ '--row': index }">
            <span v-if="!row.own" class="feed-skeleton__avatar"></span>
            <span class="feed-skeleton__bubble">
              <span v-for="(width, line) in row.lines" :key="line" class="feed-skeleton__line"
                :style="{ width: `${width}%` }"></span>
            </span>
          </div>
        </div>
      </Transition>

      <div v-for="group in groups" :key="group.key" class="day-group">
        <div class="day" role="separator">{{ group.label }}</div>
        <template v-for="entry in group.entries" :key="entry.m.clientNonce || entry.m.messageId">
          <div v-if="entry.m.messageId === firstUnreadId" :ref="setUnreadDivider" class="unread-divider"
            role="separator">
            <span>{{ t('thread.newMessages') }}</span>
          </div>
          <MessageBubble
            :message="entry.m"
            :messenger="messenger"
            :position="entry.position"
            :show-author="entry.showAuthor"
            :show-avatar="entry.showAvatar"
          />
        </template>
      </div>
      <Transition name="typing-bubble">
        <div v-if="typingUsers.length" class="typing-row" :class="{ 'is-clickable': typingUsers.length === 1 }" role="status" aria-live="polite"
          @click="openTyperProfile">
          <Avatar :name="typingUsers[0]" :accent="messenger.accentFor(typingUsers[0])"
            :src="messenger.profileImageSrc(messenger.profileFor(typingUsers[0])?.avatar, 'avatar')" size="sm" />
          <span class="typing-bubble" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="typing-row__who">{{ typingText }}</span>
        </div>
      </Transition>
      <Teleport to="body">
        <Transition name="qx-modal" :duration="{ enter: 340, leave: 220 }">
          <ProfileCard v-if="selectedTyperProfile" :messenger="messenger" :username="selectedTyperProfile" docked @close="closeTyperProfile" />
        </Transition>
      </Teleport>
    </section>

    <Transition name="feed-pill">
      <button v-if="unreadAbove" type="button" class="feed-pill feed-pill--top" @click="jumpToUnread">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        {{ plural('thread.unreadPill', unreadCount) }}
      </button>
    </Transition>
    <Transition name="feed-pill">
      <button v-if="missedBelow > 0" type="button" class="feed-pill feed-pill--bottom" @click="jumpToBottom">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
        {{ plural('thread.unreadPill', missedBelow) }}
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.feed-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.day-group {
  display: flex;
  flex-direction: column;
  gap: inherit;
}

.unread-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 6px;
  color: var(--red);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.unread-divider::before,
.unread-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--red) 55%, transparent);
}

:global(:root[data-theme="light"] .unread-divider) {
  color: color-mix(in srgb, var(--red) 70%, #000);
}

.feed-pill {
  position: absolute;
  left: 50%;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px 0 11px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
  translate: -50% 0;
  transition: filter var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-spring);
}

.feed-pill:hover {
  filter: brightness(1.08);
}

.feed-pill:active {
  transform: scale(.95);
}

.feed-pill svg {
  width: 14px;
  height: 14px;
}

.feed-pill--top {
  top: 46px;
}

.feed-pill--bottom {
  bottom: 16px;
}

.feed-pill-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-slow) var(--ease-spring);
}

.feed-pill-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}

.feed-pill--top.feed-pill-enter-from,
.feed-pill--top.feed-pill-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(.94);
}

.feed-pill--bottom.feed-pill-enter-from,
.feed-pill--bottom.feed-pill-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(.94);
}

.feed-skeleton {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 0;
}

.feed-skeleton__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: min(68%, 520px);
  animation: skeleton-rise var(--dur-slow) var(--ease-out) both;
  animation-delay: calc(var(--row) * 45ms);
}

.feed-skeleton__row.is-own {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.feed-skeleton__avatar {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
}

.feed-skeleton__bubble {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 260px;
  max-width: 100%;
  padding: 11px 12px;
  border-radius: var(--radius-bubble, 16px);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.feed-skeleton__row.is-own .feed-skeleton__bubble {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.feed-skeleton__line {
  display: block;
  height: 9px;
  border-radius: 999px;
}

.feed-skeleton__avatar,
.feed-skeleton__line {
  background: linear-gradient(90deg,
      color-mix(in srgb, var(--text) 9%, transparent) 0%,
      color-mix(in srgb, var(--text) 16%, transparent) 50%,
      color-mix(in srgb, var(--text) 9%, transparent) 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s linear infinite;
}

:global(:root[data-message-style="discord"] .feed-skeleton) {
  padding: 16px;
}

:global(:root[data-message-style="discord"] .feed-skeleton__row),
:global(:root[data-message-style="discord"] .feed-skeleton__row.is-own) {
  align-self: stretch;
  flex-direction: row;
  align-items: flex-start;
  max-width: none;
}

:global(:root[data-message-style="discord"] .feed-skeleton__row.is-own::before) {
  content: "";
  width: 30px;
  flex: none;
}

:global(:root[data-message-style="discord"] .feed-skeleton__bubble),
:global(:root[data-message-style="discord"] .feed-skeleton__row.is-own .feed-skeleton__bubble) {
  width: min(420px, 80%);
  padding: 2px 0;
  background: none;
}

@keyframes skeleton-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

@keyframes skeleton-rise {
  from { opacity: 0; transform: translateY(6px); }
}

@media (prefers-reduced-motion: reduce) {
  .feed-skeleton__row,
  .feed-skeleton__avatar,
  .feed-skeleton__line {
    animation: none;
  }

  .feed-pill-enter-active,
  .feed-pill-leave-active {
    transition: opacity var(--dur-fast) linear;
  }

  .feed-pill--top.feed-pill-enter-from,
  .feed-pill--top.feed-pill-leave-to,
  .feed-pill--bottom.feed-pill-enter-from,
  .feed-pill--bottom.feed-pill-leave-to {
    transform: none;
  }
}

.typing-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.typing-bubble {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 13px;
  border-radius: var(--radius-bubble, 18px);
  background: var(--bubble-in);
}

.typing-bubble i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted);
  animation: typing-dot 1.2s var(--ease-out) infinite;
}

.typing-bubble i:nth-child(2) { animation-delay: .15s; }
.typing-bubble i:nth-child(3) { animation-delay: .3s; }

.typing-row__who {
  align-self: center;
  color: var(--muted);
  font-size: 12px;
}

.typing-row.is-clickable {
  cursor: pointer;
}

.typing-row.is-clickable:hover .typing-row__who {
  color: var(--accent);
  text-decoration: underline;
}

.typing-bubble-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-slow) var(--ease-spring);
}

.typing-bubble-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}

.typing-bubble-enter-from,
.typing-bubble-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(.9);
  transform-origin: bottom left;
}

@keyframes typing-dot {
  0%, 60%, 100% { opacity: .35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

@media (prefers-reduced-motion: reduce) {
  .typing-bubble i { animation: none; opacity: .6; }
}

.feed.is-revealing :deep(.msg.is-own),
.feed.is-reveal-release :deep(.msg.is-own) {
  transform: translateX(calc(-1 * var(--reveal)));
}

.feed.is-reveal-release :deep(.msg.is-own) {
  transition: transform var(--dur-base) var(--ease-spring);
}

:global(:root[data-message-style="discord"] .feed.is-revealing .msg),
:global(:root[data-message-style="discord"] .feed.is-reveal-release .msg) {
  transform: translateX(calc(-1 * var(--reveal)));
}
</style>
