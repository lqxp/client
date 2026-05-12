<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});
const emit = defineEmits(["conversation-selected"]);

const composeRef = ref(null);
const statusMenuOpen = ref(false);
const isMobile = ref(false);
const roomContextOpen = ref(false);
const roomContextRoomId = ref("");
const roomContextPos = ref({ x: 0, y: 0 });
const roomIconInputRef = ref<HTMLInputElement | null>(null);
const roomIconUploadRoomId = ref("");

const meInitials = computed(() => initialsOf(props.messenger.state.username));
const meAccent = computed(() => props.messenger.accentFor(props.messenger.state.username || "you"));
const meAvatar = computed(() => props.messenger.profileImageSrc(props.messenger.myProfile.value.avatar));
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

function initialsOf(name) {
  const trimmed = String(name || "?").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

watch(
  () => props.messenger.state.composing,
  async (isComposing) => {
    if (isComposing) { await nextTick(); composeRef.value?.focus(); }
  }
);

function onComposeKey(event) {
  if (event.key === "Escape") props.messenger.cancelCompose();
  if (event.key.length === 1 && !/[a-z0-9]/i.test(event.key)) event.preventDefault();
}

function removeConversation(event, roomId) {
  event.stopPropagation();
  event.preventDefault();
  if (!confirm(t("sidebar.removeConversationConfirm", { room: props.messenger.displayRoomName(roomId) }))) return;
  props.messenger.removeRoom(roomId);
}

function roomIcon(roomId) {
  return props.messenger.roomIcon?.(roomId) || "";
}

function roomIconIsImage(roomId) {
  return roomIcon(roomId).startsWith("data:image/");
}

function onRoomContext(event, roomId) {
  event.preventDefault();
  event.stopPropagation();
  roomContextRoomId.value = roomId;
  roomContextPos.value = { x: event.clientX, y: event.clientY };
  roomContextOpen.value = true;
}

function closeRoomContext() {
  roomContextOpen.value = false;
  roomContextRoomId.value = "";
}

function renameRoomFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  const current = props.messenger.displayRoomName(roomId);
  const next = window.prompt(t("sidebar.promptLocalRoomName"), current || roomId);
  if (next === null) return;
  props.messenger.setLocalRoomName(roomId, next);
  closeRoomContext();
}

function setRoomIconFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  const current = roomIcon(roomId);
  const next = window.prompt(t("sidebar.promptLocalRoomIcon"), current || "");
  if (next === null) return;
  props.messenger.setLocalRoomIcon(roomId, next);
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

function clearRoomIconFromContext() {
  const roomId = roomContextRoomId.value;
  if (!roomId) return;
  props.messenger.clearLocalRoomIcon(roomId);
  closeRoomContext();
}

function openConversation(roomId) {
  props.messenger.selectConversation(roomId);
  emit("conversation-selected", roomId);
}

function openSettings() {
  props.messenger.state.settingsOpen = true;
}

function createRoom() {
  props.messenger.createRandomRoom();
}

function toggleStatusMenu(event) {
  event.stopPropagation();
  statusMenuOpen.value = !statusMenuOpen.value;
}

function setStatus(value) {
  props.messenger.setPresenceStatus(value);
  statusMenuOpen.value = false;
}

function onDocumentClick() {
  statusMenuOpen.value = false;
  closeRoomContext();
}

function syncMobile() {
  isMobile.value = window.matchMedia("(max-width: 820px)").matches;
}

onMounted(() => {
  syncMobile();
  window.addEventListener("resize", syncMobile, { passive: true });
  document.addEventListener("click", onDocumentClick);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", syncMobile);
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <aside class="side">
    <div v-if="messenger.state.composing" class="compose">
      <input
        ref="composeRef"
        v-model="messenger.state.composeInput"
        type="text"
        maxlength="64"
        minlength="8"
        pattern="[A-Za-z0-9]{8,64}"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('sidebar.pasteRoomToken')"
        @keydown.enter.prevent="messenger.submitCompose"
        @keydown="onComposeKey"
        @blur="messenger.state.composeInput ? null : messenger.cancelCompose()"
      />
      <button type="button" :aria-label="t('sidebar.generateToken')" @mousedown.prevent @click="createRoom">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15 21 21"/><path d="M4 4l5 5"/></svg>
      </button>
      <button type="button" :aria-label="t('composer.cancelEdit')" @mousedown.prevent @click="messenger.cancelCompose">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="side__search" v-if="!messenger.state.composing">
      <label class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input
          v-model="messenger.state.searchTerm"
          type="search"
          :placeholder="t('sidebar.searchPlaceholder')"
          :aria-label="t('sidebar.searchPlaceholder')"
        />
      </label>
      <button class="icon-btn side__shuffle" type="button" :aria-label="t('sidebar.generateToken')" @click="createRoom">
        <svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15 21 21"/><path d="M4 4l5 5"/></svg>
      </button>
      <button class="icon-btn side__compose" type="button" :aria-label="t('sidebar.newConversation')" @click="messenger.startCompose">
        <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>
    </div>

    <div class="side__list">
      <template v-if="messenger.conversations.value.length">
        <div
          v-for="c in messenger.conversations.value"
          :key="c.roomId"
          class="conv"
          :class="{ 'is-active': c.active }"
          role="button"
          tabindex="0"
          @click="openConversation(c.roomId)"
          @keydown.enter.prevent="openConversation(c.roomId)"
          @contextmenu="onRoomContext($event, c.roomId)"
        >
          <span class="avatar avatar--lg" :class="`avatar--${c.accent}`">
            <img v-if="roomIconIsImage(c.roomId)" class="conv__icon-image" :src="roomIcon(c.roomId)" alt="" />
            <span v-else-if="roomIcon(c.roomId)" class="conv__icon">{{ roomIcon(c.roomId) }}</span>
            <template v-else>{{ initialsOf(c.name) }}</template>
          </span>

          <span class="conv__head">
            <span class="conv__name">
              {{ c.name }}
              <span v-if="c.joined" class="conv__joined" :title="t('sidebar.joined')"></span>
            </span>
            <span class="conv__time">{{ c.timestampLabel }}</span>
          </span>

          <span class="conv__preview">
            {{ c.preview }}
          </span>

          <span v-if="c.unread > 0" class="conv__badge">{{ c.unread > 99 ? "99+" : c.unread }}</span>

          <button
            v-if="!isMobile"
            class="conv__remove"
            type="button"
            :aria-label="t('sidebar.removeConversation', { room: c.name })"
            @click="removeConversation($event, c.roomId)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </template>
      <div v-else class="conv--empty">
        {{ t('app.noConversationHint') }}
      </div>
    </div>

    <div
      v-if="roomContextOpen"
      class="room-context"
      role="menu"
      :style="{ left: `${roomContextPos.x}px`, top: `${roomContextPos.y}px` }"
      @click.stop
    >
      <button type="button" role="menuitem" @click="pickRoomImageFromContext">{{ t('sidebar.contextChangeImage') }}</button>
      <button type="button" role="menuitem" @click="setRoomIconFromContext">{{ t('sidebar.contextChangeIcon') }}</button>
      <button type="button" role="menuitem" @click="clearRoomIconFromContext">{{ t('sidebar.contextClearIcon') }}</button>
      <button type="button" role="menuitem" @click="renameRoomFromContext">{{ t('sidebar.contextRenameLocal') }}</button>
    </div>

    <input
      ref="roomIconInputRef"
      type="file"
      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
      class="sr-only"
      @change="onRoomIconFileChange"
    />

    <div class="side__foot" @click.stop>
      <button class="side-user" type="button" @click="openSettings" :title="messenger.state.username">
        <span v-if="meAvatar" class="side-user__avatar">
          <img :src="meAvatar" alt="" />
        </span>
        <span v-else class="avatar avatar--md" :class="`avatar--${meAccent}`">{{ meInitials }}</span>
        <span class="side-user__text">
          <strong>{{ messenger.state.username || t('sidebar.anonymous') }}</strong>
          <small>
            <span
              class="dot"
              :class="{
                'is-online': messenger.state.status === 'online',
                'is-dnd': messenger.state.status === 'dnd',
                'is-invisible': messenger.state.status === 'invisible',
                'is-connecting': messenger.state.connected && !messenger.state.identified
              }"
            ></span>
            <span v-if="messenger.state.connected && messenger.state.identified">{{ statusLabel }}</span>
            <span v-else-if="messenger.state.connected">{{ t('sidebar.connecting') }}</span>
            <span v-else>{{ t('sidebar.offline') }}</span>
          </small>
        </span>
      </button>

      <div class="side-status">
        <button
          class="icon-btn side-status__toggle"
          type="button"
          :aria-label="t('sidebar.changeStatus')"
          :aria-expanded="statusMenuOpen"
          @click="toggleStatusMenu"
        >
          <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div v-if="statusMenuOpen" class="side-status__menu" role="menu">
          <button
            v-for="option in statusOptions"
            :key="option.value"
            type="button"
            role="menuitemradio"
            :aria-checked="messenger.state.status === option.value"
            :class="{ 'is-active': messenger.state.status === option.value }"
            @click="setStatus(option.value)"
          >
            <span class="dot" :class="{
              'is-online': option.value === 'online',
              'is-dnd': option.value === 'dnd',
              'is-invisible': option.value === 'invisible'
            }"></span>
            {{ option.label }}
          </button>
        </div>
      </div>

      <button class="icon-btn side-foot__settings" type="button" :aria-label="t('sidebar.settings')" @click="openSettings">
        <svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.23.62.83 1 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15Z"/></svg>
      </button>

      <button
        v-if="!messenger.state.connected"
        class="btn--ghost side-foot__link"
        type="button"
        @click="messenger.connect"
      >{{ t('sidebar.connect') }}</button>
      <button
        v-else
        class="btn--ghost side-foot__link"
        type="button"
        @click="messenger.disconnect"
      >{{ t('sidebar.disconnect') }}</button>
    </div>
  </aside>
</template>

<style scoped>
.conv__icon {
  font-size: 22px;
  line-height: 1;
}

.conv__icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.room-context {
  position: fixed;
  z-index: 120;
  min-width: 196px;
  border-radius: 8px;
  background: #111214;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
  padding: 6px;
}

.room-context button {
  width: 100%;
  text-align: left;
  border-radius: 4px;
  padding: 8px 10px;
  color: #dbdee1;
  font-size: 13px;
  font-weight: 500;
}

.room-context button:hover {
  background: #4752c4;
  color: #fff;
}
</style>
