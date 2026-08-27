<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import CreateRoomModal from "@/components/CreateRoomModal.vue";
import AddServerModal from "@/components/AddServerModal.vue";
import JoinRoomModal from "@/components/JoinRoomModal.vue";
import RoomSettingsModal from "@/components/RoomSettingsModal.vue";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

const props = defineProps({
  messenger: { type: Object, required: true }
});
const emit = defineEmits(["conversation-selected", "open-spotlight"]);

const sideListRef = ref<HTMLElement | null>(null);
const statusMenuOpen = ref(false);
const accountMenuOpen = ref(false);
const roomContextOpen = ref(false);
const roomContextRoomId = ref("");
const roomContextMenuRef = ref<HTMLElement | null>(null);
const roomContextPos = ref({ x: 0, y: 0 });
const roomIconInputRef = ref<HTMLInputElement | null>(null);
const roomIconUploadRoomId = ref("");
const sideListContextOpen = ref(false);
const sideListContextPos = ref({ x: 0, y: 0 });
const sideListContextMenuRef = ref<HTMLElement | null>(null);
const createRoomOpen = ref(false);
const addServerOpen = ref(false);
const joinRoomOpen = ref(false);
const roomSettingsOpen = ref(false);
const roomSettingsRoomId = ref("");

let sidebarTouchStartX = 0;
let sidebarTouchStartY = 0;
let sideListTouchStartX = 0;
let sideListTouchStartY = 0;
const isMobile = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);

function onSidebarTouchStart(event: TouchEvent) {
  sidebarTouchStartX = event.touches[0].clientX;
  sidebarTouchStartY = event.touches[0].clientY;
}

function onSidebarTouchEnd(event: TouchEvent) {
  const dx = (event.changedTouches[0]?.clientX || 0) - sidebarTouchStartX;
  const dy = (event.changedTouches[0]?.clientY || 0) - sidebarTouchStartY;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return;
  // Swipe left → open active conversation
  if (dx < -60) {
    const active = props.messenger.state.activeRoom;
    if (active) emit("conversation-selected", active);
  }
}

function onSideListTouchStart(event: TouchEvent) {
  sideListTouchStartX = event.touches[0].clientX;
  sideListTouchStartY = event.touches[0].clientY;
}

function onSideListTouchEnd(event: TouchEvent) {
  if (!isMobile.value) return;
  const dx = (event.changedTouches[0]?.clientX || 0) - sideListTouchStartX;
  const dy = (event.changedTouches[0]?.clientY || 0) - sideListTouchStartY;
  // Swipe up → open settings
  if (dy < -70 && Math.abs(dx) < 40) {
    openSettings();
  }
}

const meInitials = computed(() => initialsOf(props.messenger.state.username));
const meAccent = computed(() => props.messenger.accentFor(props.messenger.state.username || "you"));
const meAvatar = computed(() => props.messenger.profileImageSrc(props.messenger.myProfile.value.avatar, "avatar"));
const accounts = computed(() => props.messenger.localAccounts?.value || []);
const currentUserId = computed(() => String(props.messenger.state.userId || ""));

function accountAccent(username) {
  return props.messenger.accentFor(String(username || "you"));
}

function accountAvatar(account) {
  return props.messenger.profileImageSrc(account?.profile?.avatar, "avatar");
}

const statusLabel = computed(() => {
  switch (props.messenger.state.status) {
    case "invisible":
      return t("sidebar.invisible");
    case "dnd":
      return t("sidebar.dnd");
    default:
      return t("sidebar.online");
  }
});
const statusOptions = computed(() => [
  { value: "online", label: t('sidebar.online') },
  { value: "invisible", label: t('sidebar.invisible') },
  { value: "dnd", label: t('sidebar.dnd') }
]);

const desktopRoomContextStyle = computed(() => ({
  left: `${roomContextPos.value.x}px`,
  top: `${roomContextPos.value.y}px`
}));

const desktopSideListContextStyle = computed(() => ({
  left: `${sideListContextPos.value.x}px`,
  top: `${sideListContextPos.value.y}px`
}));

const roomContextRoomName = computed(() =>
  roomContextRoomId.value ? props.messenger.displayRoomName(roomContextRoomId.value) : ""
);
const roomContextIsCommunity = computed(() =>
  props.messenger.isCommunityRoom?.(roomContextRoomId.value) === true
);
const roomContextCanManage = computed(() =>
  props.messenger.canManageRoom?.(roomContextRoomId.value) === true
);

const conversations = computed(() => props.messenger.conversations.value || []);
const pinnedConversations = computed(() =>
  conversations.value.filter((c) => props.messenger.isRoomPinned?.(c.roomId)),
);
const regularConversations = computed(() =>
  conversations.value.filter((c) => !props.messenger.isRoomPinned?.(c.roomId)),
);
const roomContextIsPinned = computed(() =>
  props.messenger.isRoomPinned?.(roomContextRoomId.value) === true,
);

function initialsOf(name) {
  const trimmed = String(name || "?").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

async function leaveRoomFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  const label = props.messenger.displayRoomName(roomId);
  const suffix = props.messenger.state.deleteMessagesOnLeave ? ` ${t("thread.leaveRoomDeletesLocal")}` : "";
  const confirmed = await dialog.showConfirm(t("thread.leaveRoomConfirm", { room: label, suffix }));
  if (!confirmed) return;
  props.messenger.leaveRoom(roomId);
  closeRoomContext();
}

async function clearLocalMessagesFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  const confirmed = await dialog.showConfirm(t("thread.clearLocalMessagesConfirm", { room: props.messenger.displayRoomName(roomId) }));
  if (!confirmed) return;
  props.messenger.clearLocalRoomMessages?.(roomId);
  props.messenger.showToast?.(t("thread.clearLocalMessagesSuccess"));
  closeRoomContext();
}

function shareRoomTokenFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  props.messenger.copyRoomInvite(roomId)
    .then(() => {
      props.messenger.showToast(t("thread.copyTokenSuccess"));
      closeRoomContext();
    })
    .catch((error) => {
      props.messenger.state.lastError = error?.message || t("thread.copyTokenError");
      props.messenger.showToast(props.messenger.state.lastError);
      closeRoomContext();
    });
}

function togglePinRoomFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  props.messenger.toggleRoomPin?.(roomId);
  closeRoomContext();
}

function roomIcon(roomId) {
  return props.messenger.roomIcon?.(roomId) || "";
}

function roomIconIsImage(roomId) {
  const icon = roomIcon(roomId);
  return !!icon && !icon.startsWith("data:");
}

async function positionContextMenu(
  menuRef: { value: HTMLElement | null },
  posRef: { value: { x: number; y: number } },
  clientX: number,
  clientY: number
) {
  const padding = 16;
  posRef.value = { x: clientX, y: clientY };

  // Rendered in a Teleport with conditional content; wait for layout to settle.
  await nextTick();
  await nextTick();

  let rect = menuRef.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    await nextTick();
    rect = menuRef.value?.getBoundingClientRect();
  }

  if (!rect || rect.width === 0 || rect.height === 0) {
    return;
  }

  const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
  const maxY = Math.max(padding, window.innerHeight - rect.height - padding);

  let x = Math.min(Math.max(clientX, padding), maxX);
  const y = Math.min(Math.max(clientY, padding), maxY);

  const rightThreshold = window.innerWidth - rect.width - padding * 2;
  if (clientX > rightThreshold) {
    x = Math.max(padding, clientX - rect.width - padding);
  }

  posRef.value = { x, y };
}

function positionRoomContext(clientX: number, clientY: number) {
  return positionContextMenu(roomContextMenuRef, roomContextPos, clientX, clientY);
}

function positionSideListContext(clientX: number, clientY: number) {
  return positionContextMenu(sideListContextMenuRef, sideListContextPos, clientX, clientY);
}

function onRoomContext(event, roomId) {
  event.preventDefault();
  event.stopPropagation();
  roomContextRoomId.value = roomId;
  roomContextOpen.value = true;
  positionRoomContext(event.clientX, event.clientY);
}

function onSideListContext(event) {
  event.preventDefault();
  event.stopPropagation();
  sideListContextOpen.value = true;
  positionSideListContext(event.clientX, event.clientY);
}

function closeRoomContext() {
  roomContextOpen.value = false;
  roomContextRoomId.value = "";
}

function closeSideListContext() {
  sideListContextOpen.value = false;
}

async function leaveAllRoomsFromContext(deleteMessages: boolean) {
  if (!props.messenger.state.rooms.length) {
    closeSideListContext();
    return;
  }
  const confirmed = await dialog.showConfirm(
    t(deleteMessages ? "sidebar.leaveAllRoomsDeleteConfirm" : "sidebar.leaveAllRoomsConfirm")
  );
  if (!confirmed) return;
  props.messenger.leaveAllRooms(deleteMessages);
  closeSideListContext();
}

async function renameRoomFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  const current = props.messenger.displayRoomName(roomId);
  const next = await dialog.showPrompt(t("sidebar.promptRoomName"), current || roomId);
  if (next === null) return;
  props.messenger.setLocalRoomName(roomId, next);
  closeRoomContext();
}

function openRoomSettings() {
  if (!roomContextRoomId.value) return;
  roomSettingsRoomId.value = roomContextRoomId.value;
  roomSettingsOpen.value = true;
  closeRoomContext();
}

function pickRoomImageFromContext() {
  if (!roomContextRoomId.value) return;
  roomIconUploadRoomId.value = roomContextRoomId.value;
  roomIconInputRef.value?.click();
}

async function onRoomIconFileChange(event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  const roomId = roomIconUploadRoomId.value || roomContextRoomId.value;
  if (!roomId || !file) return;
  await props.messenger.setLocalRoomIconFromFile?.(roomId, file);
  roomIconUploadRoomId.value = "";
  input.value = "";
  closeRoomContext();
}

function openConversation(roomId) {
  props.messenger.selectConversation(roomId);
  emit("conversation-selected", roomId);
}

function openSettings() {
  if (sideListRef.value) sideListRef.value.scrollTop = 0;
  props.messenger.state.settingsOpen = true;
}

function createRoom() {
  createRoomOpen.value = true;
}

function createRoomFromAddServer() {
  addServerOpen.value = false;
  createRoom();
}

function joinRoomFromAddServer() {
  addServerOpen.value = false;
  joinRoomOpen.value = true;
}

function toggleStatusMenu(event) {
  event.stopPropagation();
  statusMenuOpen.value = !statusMenuOpen.value;
}

function setStatus(value) {
  props.messenger.setPresenceStatus(value);
  statusMenuOpen.value = false;
}

function toggleAccountMenu(event) {
  event.stopPropagation();
  accountMenuOpen.value = !accountMenuOpen.value;
}

function switchAccount(userId) {
  props.messenger.switchAccount?.(userId);
  accountMenuOpen.value = false;
}

function removeAccount(userId) {
  props.messenger.removeAccount?.(userId);
}

function addAccount() {
  props.messenger.addAccount?.();
  accountMenuOpen.value = false;
}

function onDocumentClick() {
  statusMenuOpen.value = false;
  accountMenuOpen.value = false;
  closeRoomContext();
  closeSideListContext();
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <aside class="side" @touchstart="onSidebarTouchStart" @touchend="onSidebarTouchEnd">
    <div class="side__search">
      <label class="search">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input v-model="messenger.state.searchTerm" type="search" :placeholder="t('sidebar.searchPlaceholder')"
          :aria-label="t('sidebar.searchPlaceholder')" @focus="emit('open-spotlight')" />
      </label>
      <button class="icon-btn side__compose" type="button" :aria-label="t('sidebar.addServer')" @click="addServerOpen = true">
        <svg viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>

    <div ref="sideListRef" class="side__list" @contextmenu="onSideListContext">
      <template v-if="conversations.length">
        <div v-if="pinnedConversations.length" class="side__pinned">
          <div class="side__pinned-label">{{ t('sidebar.pinnedRooms') }}</div>
          <div v-for="c in pinnedConversations" :key="c.roomId" class="conv" :class="{ 'is-active': c.active }"
            role="button" tabindex="0" @click="openConversation(c.roomId)"
            @keydown.enter.prevent="openConversation(c.roomId)" @contextmenu="onRoomContext($event, c.roomId)">
            <span class="avatar avatar--lg conv__icon"
              :class="roomIconIsImage(c.roomId) ? 'conv__icon--image' : `avatar--${c.accent}`">
              <img v-if="roomIconIsImage(c.roomId)" class="conv__icon-image" :src="roomIcon(c.roomId)" alt="" />
              <template v-else>{{ initialsOf(c.name) }}</template>
            </span>

            <span class="conv__head">
              <span class="conv__name">
                {{ messenger.displayRoomNameBeautified(c.roomId) }}
                <span v-if="c.joined" class="conv__joined" :title="t('sidebar.joined')"></span>
              </span>
              <span class="conv__time">{{ c.timestampLabel }}</span>
            </span>

            <span class="conv__preview" :class="{ 'conv__preview--hidden': messenger.state.streamerMode }">
              {{ messenger.state.streamerMode ? t('sidebar.streamerPreviewHidden') : c.preview }}
            </span>

            <span v-if="c.unread > 0" class="conv__badge">{{ c.unread > 99 ? "99+" : c.unread }}</span>
          </div>
        </div>

        <div v-for="c in regularConversations" :key="c.roomId" class="conv" :class="{ 'is-active': c.active }"
          role="button" tabindex="0" @click="openConversation(c.roomId)"
          @keydown.enter.prevent="openConversation(c.roomId)" @contextmenu="onRoomContext($event, c.roomId)">
          <span class="avatar avatar--lg conv__icon"
            :class="roomIconIsImage(c.roomId) ? 'conv__icon--image' : `avatar--${c.accent}`">
            <img v-if="roomIconIsImage(c.roomId)" class="conv__icon-image" :src="roomIcon(c.roomId)" alt="" />
            <template v-else>{{ initialsOf(c.name) }}</template>
          </span>

          <span class="conv__head">
            <span class="conv__name">
              {{ messenger.displayRoomNameBeautified(c.roomId) }}
              <span v-if="c.joined" class="conv__joined" :title="t('sidebar.joined')"></span>
            </span>
            <span class="conv__time">{{ c.timestampLabel }}</span>
          </span>

          <span class="conv__preview" :class="{ 'conv__preview--hidden': messenger.state.streamerMode }">
            {{ messenger.state.streamerMode ? t('sidebar.streamerPreviewHidden') : c.preview }}
          </span>

          <span v-if="c.unread > 0" class="conv__badge">{{ c.unread > 99 ? "99+" : c.unread }}</span>
        </div>
      </template>
      <div v-else class="conv--empty">
        <svg class="conv--empty-logo" width="80" height="80" viewBox="-3.68 -3.68 23.36 23.36" xmlns="http://www.w3.org/2000/svg">
          <g transform="translate(16 0) scale(-1 1)">
            <g transform="translate(0 1)">
              <path d="M5.939 0C2.666 0 0.009 1.987 0.009 4.438c0 2.236 2.215 4.082 5.092 4.387L3.88 11.26l4.249-2.7C10.318 7.906 12 6.309 12 4.438 12 1.988 9.213 0 5.939 0Z" />
              <path d="M15.947 8.89c0-1.124-1.062-2.288-2.289-2.868-.344 1.95-1.924 3.745-4.417 4.447l-1.187.642c.454.34 1.01.611 1.634.788l3.638 1.971-1.303-1.776c2.217-.225 3.924-1.571 3.924-3.204Z" />
            </g>
          </g>
        </svg>
        <p>{{ t('app.noConversationHint') }}</p>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="roomContextOpen" class="room-context-backdrop" @click="closeRoomContext">
        <div ref="roomContextMenuRef" class="room-context context-menu-base" role="menu"
          :style="desktopRoomContextStyle" @click.stop>
          <!-- Header (mobile only) -->
          <div class="room-context__header">
            <strong class="room-context__header-name">{{ messenger.displayRoomNameBeautified(roomContextRoomId) }}</strong>
          </div>
          <button type="button" role="menuitem" @click="togglePinRoomFromContext">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            <span>{{ roomContextIsPinned ? t('sidebar.unpinRoom') : t('sidebar.pinRoom') }}</span>
          </button>
          <button v-if="!roomContextIsCommunity" type="button" role="menuitem" @click="pickRoomImageFromContext">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>{{ t('sidebar.contextChangeImage') }}</span>
          </button>
          <button v-if="!roomContextIsCommunity" type="button" role="menuitem" @click="renameRoomFromContext">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            <span>{{ t('sidebar.contextRenameRoom') }}</span>
          </button>
          <button v-if="roomContextIsCommunity && roomContextCanManage" type="button" role="menuitem" @click="openRoomSettings">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.23.62.83 1 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15Z"/></svg>
            <span>{{ t('rooms.settings') }}</span>
          </button>
          <button type="button" role="menuitem" @click="clearLocalMessagesFromContext">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>{{ t('thread.clearLocalMessages') }}</span>
          </button>
          <button type="button" role="menuitem" @click="shareRoomTokenFromContext">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            <span>{{ t('thread.shareToken') }}</span>
          </button>
          <button class="room-context__danger context-menu-danger" type="button" role="menuitem"
            @click="leaveRoomFromContext">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>{{ t('thread.leaveRoom') }}</span>
          </button>
          <!-- Cancel (mobile only) -->
          <div class="room-context__separator" aria-hidden="true"></div>
          <button type="button" class="room-context__cancel" role="menuitem" @click="closeRoomContext">
            <span>{{ t('message.cancel') }}</span>
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="sideListContextOpen" class="room-context-backdrop" @click="closeSideListContext">
        <div ref="sideListContextMenuRef" class="room-context context-menu-base" role="menu"
          :style="desktopSideListContextStyle" @click.stop>
          <!-- Header (mobile only) -->
          <div class="room-context__header">
            <strong class="room-context__header-name">{{ t('sidebar.listOptions') }}</strong>
          </div>
          <button class="room-context__danger context-menu-danger" type="button" role="menuitem"
            @click="leaveAllRoomsFromContext(false)">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>{{ t('sidebar.leaveAllRooms') }}</span>
          </button>
          <button class="room-context__danger context-menu-danger" type="button" role="menuitem"
            @click="leaveAllRoomsFromContext(true)">
            <svg class="room-context__item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>{{ t('sidebar.leaveAllRoomsDelete') }}</span>
          </button>
          <!-- Cancel (mobile only) -->
          <div class="room-context__separator" aria-hidden="true"></div>
          <button type="button" class="room-context__cancel" role="menuitem" @click="closeSideListContext">
            <span>{{ t('message.cancel') }}</span>
          </button>
        </div>
      </div>
    </Teleport>

    <input ref="roomIconInputRef" type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
      class="sr-only" @change="onRoomIconFileChange" />

    <CreateRoomModal :messenger="messenger" :open="createRoomOpen" @close="createRoomOpen = false" />
    <AddServerModal :open="addServerOpen" @close="addServerOpen = false" @create="createRoomFromAddServer" @join="joinRoomFromAddServer" />
    <JoinRoomModal :messenger="messenger" :open="joinRoomOpen" @close="joinRoomOpen = false" />
    <RoomSettingsModal :messenger="messenger" :open="roomSettingsOpen" :room-id="roomSettingsRoomId" @close="roomSettingsOpen = false" />

    <div class="side__foot" @click.stop @touchstart="onSideListTouchStart" @touchend="onSideListTouchEnd">
      <button class="side-user" type="button" :title="messenger.state.username"
        :aria-expanded="accountMenuOpen" @click="toggleAccountMenu">
        <span v-if="meAvatar" class="side-user__avatar">
          <img :src="meAvatar" alt="" />
        </span>
        <span v-else class="avatar avatar--md" :class="`avatar--${meAccent}`">{{ meInitials }}</span>
        <span class="side-user__text">
          <strong>{{ messenger.state.username || t('sidebar.anonymous') }}</strong>
          <small>
            <span class="dot" :class="{
              'is-online': messenger.state.status === 'online',
              'is-dnd': messenger.state.status === 'dnd',
              'is-invisible': messenger.state.status === 'invisible',
              'is-connecting': messenger.state.connected && !messenger.state.identified
            }"></span>
            <span v-if="messenger.state.connected && messenger.state.identified">{{ statusLabel }}</span>
            <span v-else-if="messenger.state.connected">{{ t('sidebar.connecting') }}</span>
            <span v-else>{{ t('sidebar.offline') }}</span>
          </small>
        </span>
      </button>

      <div v-if="accountMenuOpen" class="account-menu-backdrop" @click="accountMenuOpen = false"></div>
      <div v-if="accountMenuOpen" class="account-menu" role="menu" @click.stop>
        <div class="account-menu__header">
          <strong>{{ t('sidebar.accounts') }}</strong>
          <span>{{ accounts.length }} / {{ messenger.MAX_ACCOUNTS }}</span>
        </div>
        <div v-for="account in accounts" :key="account.userId" class="account-menu__row"
          :class="{ 'is-active': account.userId === currentUserId }">
          <button type="button" class="account-menu__switch" role="menuitem"
            :aria-label="t('sidebar.switchAccount')" @click="switchAccount(account.userId)">
            <span v-if="accountAvatar(account)" class="account-menu__avatar">
              <img :src="accountAvatar(account)" alt="" />
            </span>
            <span v-else class="avatar avatar--sm" :class="`avatar--${accountAccent(account.username)}`">{{ initialsOf(account.username) }}</span>
            <span class="account-menu__name">@{{ account.username }}</span>
            <span v-if="account.userId === currentUserId" class="account-menu__check">✓</span>
          </button>
          <button v-if="account.userId !== currentUserId" type="button" class="account-menu__remove"
            :aria-label="t('sidebar.removeAccount')" @click="removeAccount(account.userId)">×</button>
        </div>
        <button type="button" class="account-menu__add" role="menuitem" @click="addAccount">
          <span class="account-menu__add-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          <span>{{ t('sidebar.addAccount') }}</span>
        </button>
      </div>

      <div class="side-status">
        <button class="icon-btn side-status__toggle" type="button" :aria-label="t('sidebar.changeStatus')"
          :aria-expanded="statusMenuOpen" @click="toggleStatusMenu">
          <svg viewBox="0 0 24 24">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <div v-if="statusMenuOpen" class="status-menu-backdrop" @click="statusMenuOpen = false">
          <div class="side-status__menu" role="menu" @click.stop>
            <!-- Header (mobile only) -->
            <div class="status-menu__header">
              <strong>{{ t('sidebar.statusOptions') }}</strong>
            </div>
            <button v-for="option in statusOptions" :key="option.value" type="button" role="menuitemradio"
              :aria-checked="messenger.state.status === option.value"
              :class="{ 'is-active': messenger.state.status === option.value }" @click="setStatus(option.value)">
              <span class="dot" :class="{
                'is-online': option.value === 'online',
                'is-dnd': option.value === 'dnd',
                'is-invisible': option.value === 'invisible'
              }"></span>
              {{ option.label }}
            </button>
            <!-- Cancel (mobile only) -->
            <div class="status-menu__separator" aria-hidden="true"></div>
            <button type="button" class="status-menu__cancel" role="menuitem" @click="statusMenuOpen = false">
              <span>{{ t('message.cancel') }}</span>
            </button>
          </div>
        </div>
      </div>

      <button v-if="messenger.state.clientLockEnabled && !messenger.state.clientLockLocked"
        class="icon-btn side-foot__lock" type="button" :aria-label="t('settings.security.lockNow')"
        :title="t('settings.security.lockNow')" @click="messenger.lockClient">
        <svg viewBox="0 0 24 24">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </button>

      <button class="icon-btn side-foot__settings" type="button" :aria-label="t('sidebar.settings')"
        @click="openSettings">
        <svg viewBox="0 0 24 24">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.23.62.83 1 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      </button>

      <button v-if="!messenger.state.connected" class="btn--ghost side-foot__link" type="button"
        @click="messenger.connect">{{ t('sidebar.connect') }}</button>
    </div>
  </aside>
</template>

<style scoped>
.conv__icon {
  font-size: 22px;
  line-height: 1;
  overflow: hidden;
}

.conv__icon--image {
  background: transparent;
}

.conv__icon-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.conv__preview--hidden {
  color: var(--muted);
  font-style: italic;
}

.side__pinned-label {
  padding: 10px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.side-user {
  cursor: pointer;
}

.account-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 45;
}

.account-menu {
  position: absolute;
  bottom: 60px;
  left: 8px;
  right: 8px;
  z-index: 46;
  padding: 6px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 96%, black 4%);
  border: 1px solid var(--line);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(16px);
}

.account-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}

.account-menu__row {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 7px;
}

.account-menu__row.is-active {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.account-menu__switch {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--text);
  text-align: left;
  font-size: 13.5px;
  font-weight: 600;
  background: transparent;
}

.account-menu__switch:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.account-menu__avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-2);
}

.account-menu__avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.account-menu__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu__check {
  color: var(--accent);
  font-weight: 700;
}

.account-menu__remove {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
}

.account-menu__remove:hover {
  background: var(--surface-hover);
  color: var(--red);
}

.account-menu__add {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--accent);
  text-align: left;
  font-size: 13.5px;
  font-weight: 600;
  background: transparent;
}

.account-menu__add:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.account-menu__add-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.conv--empty-logo {
  fill: rgb(243, 245, 248);
  opacity: 0.55;
  margin-bottom: 12px;
}

:root[data-theme="light"] .conv--empty-logo {
  fill: #1b1b1d;
}

/* ===== Room context menu ===== */
.room-context {
  z-index: 120;
}

.room-context__header,
.room-context__item-icon,
.room-context__separator,
.room-context__cancel {
  display: none;
}

.room-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 115;
}

/* ===== Status menu ===== */
.status-menu__header,
.status-menu__separator,
.status-menu__cancel {
  display: none;
}

/* ===== Mobile bottom sheets ===== */
@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  /* ---- Room context ---- */
  .room-context-backdrop {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: room-context-backdrop-in 160ms ease-out;
  }

  .room-context {
    left: 0 !important;
    right: 0;
    bottom: 0;
    top: auto !important;
    width: 100% !important;
    max-width: 100% !important;
    transform: none;
    display: flex;
    flex-direction: column;
    padding: 0 0 max(18px, env(safe-area-inset-bottom));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    animation: room-context-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .room-context::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .room-context__header {
    display: flex;
    align-items: center;
    padding: 8px 18px 14px;
    flex: none;
  }

  .room-context__header-name {
    font-size: 17px;
    font-weight: 750;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .room-context button {
    display: flex;
    align-items: center;
    min-height: 50px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    padding: 0 18px;
    gap: 14px;
    width: 100%;
    text-align: left;
    transition: background 120ms ease;
  }

  .room-context button:hover,
  .room-context button:focus-visible {
    background: var(--surface-hover);
  }

  .room-context button:active {
    background: var(--surface-active);
  }

  .room-context__item-icon {
    display: block;
    flex: none;
    color: var(--muted);
    transition: color 120ms ease;
  }

  .room-context button:hover .room-context__item-icon,
  .room-context button:focus-visible .room-context__item-icon {
    color: var(--text);
  }

  .room-context__danger .room-context__item-icon {
    color: var(--red);
  }

  .room-context__separator {
    display: block;
    height: 1px;
    margin: 4px 18px;
    background: var(--line);
    flex: none;
  }

  .room-context__cancel {
    display: flex;
    justify-content: center;
    text-align: center;
    font-weight: 700;
    color: var(--muted) !important;
    margin-top: 2px;
  }

  .room-context__cancel:hover,
  .room-context__cancel:focus-visible {
    color: var(--text) !important;
    background: var(--surface-hover) !important;
  }

  /* ---- Status menu ---- */
  .status-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: room-context-backdrop-in 160ms ease-out;
  }

  .side-status__menu {
    position: relative !important;
    left: 0 !important;
    right: 0;
    bottom: 0;
    top: auto !important;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0 0 max(18px, env(safe-area-inset-bottom));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    animation: room-context-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .side-status__menu::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .status-menu__header {
    display: flex;
    align-items: center;
    padding: 8px 18px 14px;
    flex: none;
  }

  .status-menu__header strong {
    font-size: 17px;
    font-weight: 750;
    color: var(--text);
  }

  .side-status__menu button {
    min-height: 50px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    padding: 0 18px;
    gap: 14px;
  }

  .side-status__menu button:hover,
  .side-status__menu button:focus-visible {
    background: var(--surface-hover);
  }

  .side-status__menu button:active {
    background: var(--surface-active);
  }

  .status-menu__separator {
    display: block;
    height: 1px;
    margin: 4px 18px;
    background: var(--line);
    flex: none;
  }

  .status-menu__cancel {
    display: flex;
    justify-content: center;
    text-align: center;
    font-weight: 700;
    color: var(--muted) !important;
    margin-top: 2px;
  }

  .status-menu__cancel:hover,
  .status-menu__cancel:focus-visible {
    color: var(--text) !important;
    background: var(--surface-hover) !important;
  }

  /* ---- Account menu ---- */
  .account-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 45;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: room-context-backdrop-in 160ms ease-out;
  }

  .account-menu {
    position: fixed !important;
    left: 0 !important;
    right: 0;
    bottom: 0;
    top: auto !important;
    width: 100%;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    padding: 0 0 max(18px, env(safe-area-inset-bottom));
    border-radius: 22px 22px 0 0;
    border: 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    animation: room-context-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .account-menu::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .account-menu__header {
    padding: 8px 18px 14px;
    font-size: 12px;
  }

  .account-menu__row {
    border-radius: 14px;
  }

  .account-menu__switch {
    min-height: 52px;
    padding: 0 16px;
    font-size: 16px;
    gap: 12px;
  }

  .account-menu__remove {
    width: 36px;
    height: 36px;
    font-size: 20px;
  }

  .account-menu__add {
    min-height: 52px;
    padding: 0 16px;
    font-size: 16px;
    gap: 12px;
  }
}

@keyframes room-context-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes room-context-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
