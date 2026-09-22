<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import type { Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, nextTick, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true },
  open: { type: Boolean, default: false }
});

const emit = defineEmits(["close", "open-profile", "open-settings"]);

const query = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);

interface SearchResult {
  kind: "room" | "message" | "user" | "action";
  label: string;
  sub: string;
  roomId?: string;
  messageId?: string;
  username?: string;
  avatar?: string;
  icon?: string;
  run?: () => void;
  timestamp?: number;
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const actions = computed<SearchResult[]>(() => {
  const messenger = props.messenger;
  const list: SearchResult[] = [];
  const dnd = messenger.state.status === "dnd";
  list.push({
    kind: "action",
    label: dnd ? t("spotlight.online") : t("spotlight.dnd"),
    sub: t("spotlight.statusGroup"),
    icon: dnd ? "sun" : "moon",
    run: () => messenger.setPresenceStatus(dnd ? "online" : "dnd"),
  });
  const room = messenger.state.activeRoom;
  if (messenger.state.inCall) {
    list.push({ kind: "action", label: t("spotlight.hangUp"), sub: t("spotlight.callGroup"), icon: "phone-hangup", run: () => messenger.endCall() });
  } else if (room && messenger.state.joinedRooms.includes(room)) {
    list.push({
      kind: "action",
      label: t("spotlight.call", { room: messenger.displayRoomName(room) || room }),
      sub: t("spotlight.callGroup"),
      icon: "phone",
      run: () => messenger.startCall(),
    });
  }
  const state = messenger.state;
  const inRoom = Boolean(room && state.joinedRooms.includes(room));
  const add = (label: string, sub: string, icon: string, run: () => void) => list.push({ kind: "action", label, sub, icon, run });
  if (state.inCall) {
    add(state.callMuted ? t("spotlight.unmute") : t("spotlight.mute"), t("spotlight.callGroup"), state.callMuted ? "mic" : "mic-off", () => messenger.toggleMute());
    add(state.callDeafened ? t("spotlight.undeafen") : t("spotlight.deafen"), t("spotlight.callGroup"), state.callDeafened ? "headphones" : "headphones-off", () => messenger.toggleDeafen());
    add(t("spotlight.camera"), t("spotlight.callGroup"), "video", () => void messenger.toggleCamera());
    add(t("spotlight.screen"), t("spotlight.callGroup"), "upload", () => void messenger.toggleScreenShare());
  }
  if (inRoom) {
    add(t("spotlight.newPoll"), t("spotlight.roomGroup"), "plus-circle", () => (state.pollCreatorOpen = true));
    add(t("whiteboard.title"), t("spotlight.roomGroup"), "edit", () => (state.whiteboardRoom = room));
    add(messenger.isRoomPinned(room) ? t("spotlight.unpin") : t("spotlight.pin"), t("spotlight.roomGroup"), "heart", () => messenger.toggleRoomPin(room));
    add(t("spotlight.copyInvite"), t("spotlight.roomGroup"), "copy", () => {
      messenger.copyRoomInvite(room).then(() => messenger.showToast(t("thread.copyTokenSuccess"))).catch(() => messenger.showToast(t("thread.copyTokenError")));
    });
  }
  if (state.clientLockEnabled) add(t("spotlight.lockNow"), t("spotlight.securityGroup"), "lock", () => messenger.lockClient());
  add(t("spotlight.downloadRecovery"), t("spotlight.securityGroup"), "download", () => messenger.downloadRecoveryWords());
  add(state.streamerMode ? t("spotlight.streamerOff") : t("spotlight.streamerOn"), t("spotlight.securityGroup"), state.streamerMode ? "eye" : "eye-off", () => messenger.setStreamerMode(!state.streamerMode));
  const dark = state.themeMode === "dark" || (state.themeMode !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  add(dark ? t("spotlight.lightTheme") : t("spotlight.darkTheme"), t("spotlight.appearanceGroup"), dark ? "sun" : "moon", () => messenger.setThemeMode(dark ? "light" : "dark"));
  add(state.messageStyle === "discord" ? t("spotlight.bubbleStyle") : t("spotlight.discordStyle"), t("spotlight.appearanceGroup"), "reply", () => messenger.setMessageStyle(state.messageStyle === "discord" ? "bubble" : "discord"));
  for (const section of ["profile", "security", "opsec", "notifications", "calls", "tor"]) {
    add(t("spotlight.openSettings", { section: t(`settings.sections.${section}`) }), t("spotlight.settingsGroup"), "settings", () => emit("open-settings", section));
  }
  const me = String(messenger.state.userId || "");
  for (const account of messenger.localAccounts.value || []) {
    if (!account.userId || account.userId === me) continue;
    list.push({
      kind: "action",
      label: t("spotlight.switchAccount", { name: account.username }),
      sub: t("spotlight.accountGroup"),
      icon: "user",
      run: () => void messenger.switchAccount(account.userId),
    });
  }
  return list;
});

type FilterKey = "from" | "room" | "has" | "before" | "after";
type HasKind = "image" | "video" | "file" | "voice" | "link" | "poll";

const FILTER_ALIASES: Record<string, FilterKey> = {
  de: "from", from: "from", "от": "from",
  dans: "room", in: "room", en: "room", "в": "room",
  a: "has", has: "has", tiene: "has", "есть": "has",
  avant: "before", before: "before", antes: "before", "до": "before",
  apres: "after", after: "after", despues: "after", "после": "after",
};

const HAS_ALIASES: Record<string, HasKind> = {
  image: "image", images: "image", photo: "image", foto: "image", "фото": "image",
  video: "video", "видео": "video",
  fichier: "file", file: "file", archivo: "file", "файл": "file",
  vocal: "voice", voice: "voice", audio: "voice", voz: "voice", "голос": "voice",
  lien: "link", link: "link", enlace: "link", "ссылка": "link",
  sondage: "poll", poll: "poll", encuesta: "poll", "опрос": "poll",
};

interface ParsedQuery {
  text: string;
  from: string;
  room: string;
  has: HasKind | "";
  before: number;
  after: number;
  active: { key: FilterKey; value: string }[];
}

function parseDay(value: string) {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const eu = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : eu ? [eu[3], eu[2], eu[1]] : [];
  if (!y) return 0;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

const parsed = computed<ParsedQuery>(() => {
  const out: ParsedQuery = { text: "", from: "", room: "", has: "", before: 0, after: 0, active: [] };
  const words: string[] = [];
  for (const token of query.value.trim().split(/\s+/).filter(Boolean)) {
    const match = /^([^:]+):(.+)$/.exec(token);
    const key = match ? FILTER_ALIASES[fold(match[1])] : undefined;
    if (!match || !key) {
      words.push(token);
      continue;
    }
    const value = match[2].replace(/^@/, "");
    if (key === "has") {
      const kind = HAS_ALIASES[fold(value)];
      if (!kind) continue;
      out.has = kind;
    } else if (key === "before" || key === "after") {
      const day = parseDay(value);
      if (!day) continue;
      if (key === "before") out.before = day;
      else out.after = day + 86_400_000;
    } else {
      out[key] = fold(value);
    }
    out.active.push({ key, value });
  }
  out.text = words.join(" ");
  return out;
});

function messageMatchesKind(msg: { kind?: string; text?: string; preview?: unknown }, kind: HasKind) {
  if (kind === "voice") return msg.kind === "voice" || msg.kind === "audio";
  if (kind === "link") return Boolean(msg.preview) || /https?:\/\//i.test(String(msg.text || ""));
  return msg.kind === kind;
}

const filteredMessages = computed<SearchResult[]>(() => {
  const filter = parsed.value;
  const text = fold(filter.text);
  const items: SearchResult[] = [];
  for (const [roomId, messages] of Object.entries(props.messenger.state.messagesByRoom || {})) {
    const roomName = props.messenger.displayRoomName(roomId) || roomId;
    if (filter.room && !fold(roomName).includes(filter.room) && !fold(roomId).includes(filter.room)) continue;
    for (let i = (messages || []).length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.deleted || msg.system) continue;
      if (filter.from && !fold(String(msg.username || "")).includes(filter.from)) continue;
      if (filter.has && !messageMatchesKind(msg, filter.has)) continue;
      if (filter.before && msg.timestamp >= filter.before) continue;
      if (filter.after && msg.timestamp < filter.after) continue;
      const body = String(msg.text || msg.poll?.question || msg.attachment?.filename || "");
      if (text && !fold(body).includes(text)) continue;
      const label = body || t(`spotlight.kind.${msg.kind || "text"}`);
      items.push({
        kind: "message",
        label: label.length > 80 ? `${label.slice(0, 80)}…` : label,
        sub: `${msg.username} · ${roomName} · ${props.messenger.formatDay(msg.timestamp)}`,
        roomId,
        messageId: msg.messageId,
        timestamp: msg.timestamp,
      });
    }
  }
  return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 50);
});

const filterExamples = ["de:", "dans:", "a:image", "avant:", "apres:"];

function insertFilter(example: string) {
  query.value = `${query.value.trim()} ${example}`.trimStart();
  inputRef.value?.focus();
}

const results = computed<SearchResult[]>(() => {
  if (parsed.value.active.length) return filteredMessages.value;
  const raw = query.value.trim();
  const q = raw.toLowerCase();
  if (!q) return actions.value;
  const matchingActions = actions.value.filter((action) => fold(`${action.label} ${action.sub}`).includes(fold(raw)));
  if (q.length < 2) return matchingActions;

  const items: SearchResult[] = [...matchingActions];

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
  for (const [roomId, messages] of Object.entries(props.messenger.state.messagesByRoom || {})) {
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
  if (item.kind === "action" && item.run) {
    item.run();
    close();
  } else if (item.kind === "room" && item.roomId) {
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
            <Icon name="search-lg" class="spotlight-search-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
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

          <div v-if="parsed.active.length" class="spotlight-filters" :aria-label="t('spotlight.filters')">
            <span v-for="filter in parsed.active" :key="`${filter.key}-${filter.value}`" class="spotlight-filter">
              {{ t(`spotlight.filter.${filter.key}`) }} <strong>{{ filter.value }}</strong>
            </span>
          </div>
          <div v-else-if="!query.trim()" class="spotlight-filters spotlight-filters--hint">
            <span class="spotlight-filters__label">{{ t('spotlight.filters') }}</span>
            <button v-for="example in filterExamples" :key="example" type="button" class="spotlight-filter spotlight-filter--example"
              @click="insertFilter(example)">{{ example }}</button>
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
                <Icon name="person" v-else-if="item.kind === 'user'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                <Icon v-else-if="item.kind === 'action' && item.icon" :name="item.icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </span>
              <div class="spotlight-item-text">
                <span class="spotlight-item-label">{{ item.label }}</span>
                <span class="spotlight-item-sub">{{ item.sub }}</span>
              </div>
            </div>
          </div>

          <div v-else-if="query.length >= 2 || parsed.active.length" class="spotlight-empty">
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
  z-index: var(--z-spotlight);
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
  transition: background var(--dur-fast) var(--ease-out);
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
  transition: opacity var(--dur-fast) var(--ease-out);
}
.spotlight-enter-active .spotlight-panel {
  transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}
.spotlight-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}
.spotlight-leave-active .spotlight-panel {
  transition: transform var(--dur-fast) var(--ease-in), opacity var(--dur-fast) var(--ease-in);
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

.spotlight-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
}

.spotlight-filters__label {
  margin-right: 2px;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
}

.spotlight-filter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--text);
  font-size: 12px;
}

.spotlight-filter strong {
  font-weight: 650;
}

.spotlight-filter--example {
  background: color-mix(in srgb, var(--text) 8%, transparent);
  font-family: var(--mono);
  font-size: 11.5px;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.spotlight-filter--example:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
</style>
