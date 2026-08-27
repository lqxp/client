<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import AddFriendModal from "@/components/AddFriendModal.vue";

const props = defineProps<{ messenger: any; phantom: any }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const addOpen = ref(false);
const friendMenu = ref<null | { friend: any; x: number; y: number }>(null);

const COLLAPSED_STORAGE_KEY = "qxphantom-friends-collapsed";
const collapsed = ref(false);
try {
  collapsed.value = localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
} catch {
  /* ignore */
}
function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const friends = computed<any[]>(() => Object.values(props.phantom.state.friendsByUser || {}) as any[]);
const requests = computed(() => props.phantom.state.pendingIncoming || []);
const ghostCodes = computed(() => props.phantom.state.ghostCodes || []);
const recoveryReady = computed(
  () =>
    Array.isArray(props.messenger.state.recoveryWords) &&
    props.messenger.state.recoveryWords.length === 12,
);

watch(
  friends,
  (list) => {
    if (list.length) {
      props.messenger.requestPublicProfilesForUsers?.(
        list.map((friend) => friend.peerDisplayName),
      );
    }
  },
  { immediate: true },
);

onMounted(() => {
  props.phantom.ensurePrekey().catch(() => {});
  props.phantom.loadRoster().catch(() => {});
  props.phantom.startScheduler();
  document.addEventListener("click", closeFriendMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeFriendMenu);
});

function openFriend(roomId: string) {
  if (roomId && props.messenger?.selectConversation) {
    props.messenger.selectConversation(roomId);
  }
}

function friendAvatar(friend: any) {
  const profile = props.messenger.profileFor?.(friend.peerDisplayName);
  return props.messenger.profileImageSrc?.(profile?.avatar, "avatar") || "";
}

async function copyGhostUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* ignore */
  }
}

function blockRequest(request: any) {
  props.phantom.blockUser(request.sender?.prekeyFp);
  props.phantom.ignoreIncoming(request.id);
}

function openFriendMenu(event: MouseEvent, friend: any) {
  friendMenu.value = { friend, x: event.clientX, y: event.clientY };
}

function closeFriendMenu() {
  friendMenu.value = null;
}

function friendMenuAction(action: string) {
  const friend = friendMenu.value?.friend;
  closeFriendMenu();
  if (!friend) return;
  if (action === "block") {
    props.phantom.blockUser(friend.peerFp);
  } else if (action === "remove") {
    props.phantom.removeFriend(friend.peerFp);
  } else if (action === "clear") {
    props.messenger.clearLocalRoomMessages?.(friend.roomId);
  }
}
</script>

<template>
  <section class="phantom-friends">
    <header class="phantom-friends__head">
      <button class="phantom-toggle" type="button" :aria-expanded="!collapsed" @click="toggleCollapsed">
        <svg class="phantom-toggle__chevron" :class="{ 'is-collapsed': collapsed }" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
        <strong>{{ t("phantom.title") }}</strong>
      </button>
      <button class="phantom-add-btn" type="button" :aria-label="t('phantom.send')" @click="addOpen = true">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </header>

    <template v-if="!collapsed">

    <div v-if="requests.length" class="phantom-requests">
      <span class="phantom-requests__badge">{{ requests.length }}</span>
      <div v-for="request in requests" :key="request.id" class="phantom-request">
        <span class="phantom-request__name">{{ request.sender?.displayName || "…" }}</span>
        <span class="phantom-request__intro">{{ request.intro || "" }}</span>
        <div class="phantom-request__actions">
          <button type="button" class="is-primary" @click="props.phantom.acceptIncoming(request.id)">{{ t("phantom.accept") }}</button>
          <button type="button" @click="props.phantom.ignoreIncoming(request.id)">{{ t("phantom.ignore") }}</button>
          <button type="button" @click="blockRequest(request)">{{ t("phantom.block") }}</button>
        </div>
      </div>
    </div>

    <p v-if="!recoveryReady" class="phantom-recovery-note">{{ t("phantom.recoveryNeeded") }}</p>

    <ul v-if="friends.length" class="phantom-friends__list">
      <li
        v-for="friend in friends"
        :key="friend.peerFp"
        class="phantom-friend"
        @contextmenu.prevent.stop="openFriendMenu($event, friend)"
      >
        <button type="button" @click="openFriend(friend.roomId)">
          <span class="phantom-friend__avatar" :class="{ 'phantom-friend__avatar--image': friendAvatar(friend) }">
            <img v-if="friendAvatar(friend)" :src="friendAvatar(friend)" alt="" />
            <template v-else>{{ (friend.peerDisplayName || "?").slice(0, 1).toUpperCase() }}</template>
          </span>
          <span class="phantom-friend__name">{{ friend.peerDisplayName }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="!requests.length && recoveryReady" class="phantom-friends__empty">{{ t("phantom.noFriends") }}</p>

    <div v-if="ghostCodes.length" class="phantom-ghosts">
      <span>{{ t("phantom.ghostLink") }}</span>
      <button v-for="(code, i) in ghostCodes" :key="i" type="button" @click="copyGhostUrl(code.url)">
        ⧉ {{ code.url.slice(0, 24) }}…
      </button>
    </div>

    <div
      v-if="friendMenu"
      class="phantom-friend-menu"
      :style="{ top: `${friendMenu.y}px`, left: `${friendMenu.x}px` }"
      @click.stop
      @contextmenu.prevent.stop
    >
      <button type="button" @click="friendMenuAction('block')">{{ t("phantom.block") }}</button>
      <button type="button" @click="friendMenuAction('remove')">{{ t("phantom.removeFriend") }}</button>
      <button type="button" @click="friendMenuAction('clear')">{{ t("phantom.clearMessages") }}</button>
    </div>

    </template>

    <AddFriendModal :messenger="messenger" :phantom="phantom" :open="addOpen" @close="addOpen = false" />
  </section>
</template>

<style scoped>
.phantom-friends {
  border-top: 1px solid var(--line);
  margin-top: 16px;
  padding: 12px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.phantom-friends__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.phantom-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.phantom-toggle__chevron {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 140ms ease;
}
.phantom-toggle__chevron.is-collapsed {
  transform: rotate(-90deg);
}
.phantom-add-btn {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.phantom-add-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.phantom-add-btn:hover {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.phantom-friends__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.phantom-friend button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.phantom-friend button:hover {
  background: var(--surface-hover);
}
.phantom-friend__avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  overflow: hidden;
}
.phantom-friend__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
.phantom-friend__avatar--image {
  background: transparent;
}
.phantom-friend__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phantom-friends__empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  padding: 0 4px;
}
.phantom-requests {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.phantom-requests__badge {
  position: absolute;
  top: -4px;
  right: 0;
  background: var(--red);
  color: #fff;
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  padding: 0 5px;
}
.phantom-request {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  color: var(--text);
}
.phantom-request__name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
}
.phantom-request__intro {
  font-size: 12px;
  color: var(--muted);
}
.phantom-request__actions {
  display: flex;
  gap: 6px;
}
.phantom-request__actions button {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
  background: transparent;
}
.phantom-request__actions button.is-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.phantom-ghosts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}
.phantom-ghosts button {
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  font-size: 11px;
}
.phantom-recovery-note {
  margin: 0;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
}
.phantom-friend-menu {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 170px;
  padding: 6px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 14px 40px color-mix(in srgb, var(--bg) 50%, transparent);
}
.phantom-friend-menu button {
  display: block;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
.phantom-friend-menu button:hover {
  background: var(--surface-hover);
}
.phantom-friend-menu button:last-child {
  color: var(--muted);
}
</style>
