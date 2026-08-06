<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  open: { type: Boolean, default: false }
});

const emit = defineEmits(["close", "open-profile"]);

const query = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);

interface SearchResult {
  kind: "room" | "message" | "user";
  label: string;
  sub: string;
  roomId?: string;
  messageId?: string;
  username?: string;
  avatar?: string;
}

const results = computed<SearchResult[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q || q.length < 2) return [];

  const items: SearchResult[] = [];

  // Search rooms
  for (const room of props.messenger.state.rooms || []) {
    const name = (props.messenger.displayRoomName(room.roomId) || room.roomId || "").toLowerCase();
    if (name.includes(q)) {
      items.push({
        kind: "room",
        label: props.messenger.displayRoomName(room.roomId) || room.roomId,
        sub: t("sidebar.conversation"),
        roomId: room.roomId,
        avatar: props.messenger.roomIcon?.(room.roomId) || ""
      });
    }
  }

  // Search messages (last 50 per room, limit total)
  let messageCount = 0;
  for (const [roomId, messages] of Object.entries(props.messenger.state.messagesByRoom || {}) as [string, any[]][]) {
    if (messageCount > 50) break;
    const recent = (messages || []).slice(-100);
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      if (!msg || msg.deleted || msg.system) continue;
      const text = String(msg.text || "").toLowerCase();
      if (text.includes(q)) {
        const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
        items.push({
          kind: "message",
          label: preview,
          sub: `${msg.username} · ${props.messenger.displayRoomName(roomId) || roomId}`,
          roomId,
          messageId: msg.messageId,
        });
        messageCount++;
        if (messageCount > 30) break;
      }
    }
  }

  // Search users
  for (const roomId of props.messenger.state.joinedRooms || []) {
    const users = props.messenger.state.usersByRoom?.[roomId] || [];
    for (const username of users) {
      if (String(username || "").toLowerCase().includes(q)) {
        const alreadyAdded = items.some((r) => r.kind === "user" && r.username === username);
        if (!alreadyAdded) {
          items.push({
            kind: "user",
            label: `@${username}`,
            sub: t("members.online"),
            username,
          });
        }
      }
    }
  }

  return items.slice(0, 40);
});

watch(() => props.open, async (v) => {
  if (v) {
    query.value = "";
    selectedIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
  }
});

watch(query, () => {
  selectedIndex.value = 0;
});

function select(item: SearchResult) {
  if (item.kind === "room" && item.roomId) {
    props.messenger.selectConversation(item.roomId);
    close();
  } else if (item.kind === "message" && item.roomId && item.messageId) {
    props.messenger.selectConversation(item.roomId);
    close();
    setTimeout(() => {
      jumpToMessage(item.roomId!, item.messageId!);
    }, 350);
  } else if (item.kind === "user" && item.username) {
    emit("open-profile", item.username);
    close();
  }
}

function jumpToMessage(roomId: string, messageId: string) {
  const element = document.getElementById(`msg-${messageId}`);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("is-jump-highlight");
    setTimeout(() => element.classList.remove("is-jump-highlight"), 2000);
  }
}

function close() {
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const item = results.value[selectedIndex.value];
    if (item) select(item);
  }
}

</script>

<template>
  <Teleport to="body">
    <Transition name="spotlight">
      <div v-if="open" class="spotlight-backdrop" @click="close">
        <div class="spotlight-panel" @click.stop>
          <div class="spotlight-search">
            <svg class="spotlight-search-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref="inputRef"
              v-model="query"
              class="spotlight-input"
              type="text"
              :placeholder="t('sidebar.searchPlaceholder')"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKeydown"
            />
            <kbd class="spotlight-shortcut">⌘K</kbd>
          </div>

          <div v-if="results.length" class="spotlight-results">
            <div
              v-for="(item, index) in results"
              :key="`${item.kind}-${item.roomId || item.username || index}-${index}`"
              class="spotlight-item"
              :class="{ 'is-selected': index === selectedIndex }"
              role="option"
              :aria-selected="index === selectedIndex"
              @click="select(item)"
              @mouseenter="selectedIndex = index"
            >
              <span class="spotlight-item-icon">
                <svg v-if="item.kind === 'room'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <svg v-else-if="item.kind === 'message'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <svg v-else-if="item.kind === 'user'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <div class="spotlight-item-text">
                <span class="spotlight-item-label">{{ item.label }}</span>
                <span class="spotlight-item-sub">{{ item.sub }}</span>
              </div>
            </div>
          </div>

          <div v-else-if="query.length >= 2" class="spotlight-empty">
            {{ t('sidebar.noResults') }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spotlight-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  justify-content: center;
  padding-top: 18vh;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
}

.spotlight-panel {
  width: min(600px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 96%, black 4%);
  border: 1px solid var(--line-strong);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255, 255, 255, 0.1);
  overflow: hidden;
  align-self: start;
}

.spotlight-results {
  overflow-y: auto;
  padding: 6px;
  max-height: min(360px, 45vh);
}

.spotlight-search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}

.spotlight-search-icon {
  flex: none;
  color: var(--muted);
}

.spotlight-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 18px;
  font-weight: 500;
  font-family: var(--font);
  outline: none;
}

.spotlight-input::placeholder {
  color: var(--dim);
}

.spotlight-shortcut {
  flex: none;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font);
  letter-spacing: 0.04em;
}

.spotlight-results {
  overflow-y: auto;
  padding: 6px;
}

.spotlight-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 80ms ease;
}

.spotlight-item:hover,
.spotlight-item.is-selected {
  background: var(--surface-hover);
}

.spotlight-item-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--muted);
  flex: none;
}

.spotlight-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.spotlight-item-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotlight-item-sub {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotlight-empty {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}

/* Transition */
.spotlight-enter-active {
  transition: opacity 120ms ease-out;
}
.spotlight-enter-active .spotlight-panel {
  transition: transform 140ms cubic-bezier(0.16, 0.8, 0.2, 1), opacity 120ms ease-out;
}
.spotlight-leave-active {
  transition: opacity 100ms ease-in;
}
.spotlight-leave-active .spotlight-panel {
  transition: transform 100ms ease-in, opacity 100ms ease-in;
}
.spotlight-enter-from {
  opacity: 0;
}
.spotlight-enter-from .spotlight-panel {
  transform: translateY(-12px) scale(0.97);
  opacity: 0;
}
.spotlight-leave-to {
  opacity: 0;
}
.spotlight-leave-to .spotlight-panel {
  transform: translateY(-8px) scale(0.98);
  opacity: 0;
}
</style>
