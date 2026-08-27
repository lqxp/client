<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import ImageViewer from "@/components/ImageViewer.vue";
import ProfileCard from "@/components/ProfileCard.vue";
import MuteMemberModal from "@/components/MuteMemberModal.vue";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  showMobile: { type: Boolean, default: false }
});

const emit = defineEmits(["close-mobile"]);

let sidebarTouchStartX = 0;
let sidebarTouchStartY = 0;

function onSidebarTouchStart(event: TouchEvent) {
  if (!props.showMobile) return;
  sidebarTouchStartX = event.touches[0].clientX;
  sidebarTouchStartY = event.touches[0].clientY;
}

function onSidebarTouchEnd(event: TouchEvent) {
  if (!props.showMobile) return;
  const dx = (event.changedTouches[0]?.clientX || 0) - sidebarTouchStartX;
  const dy = (event.changedTouches[0]?.clientY || 0) - sidebarTouchStartY;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return;
  if (dx > 60) emit("close-mobile");
}

function initialsFor(name: string) {
  const clean = String(name || "?").trim();
  const parts = clean.split(/[\s\-_]+/).filter(Boolean).slice(0, 2);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}

function accentFor(name: string) {
  const palette = ["blue", "green", "amber", "violet", "olive", "slate", "teal", "rose"];
  let hash = 0;
  for (const char of String(name || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function avatarFor(username: string) {
  return props.messenger.profileImageSrc(props.messenger.profileFor(username).avatar, "avatar");
}

function bannerFor(username: string) {
  return props.messenger.profileImageSrc(props.messenger.profileFor(username).banner, "banner");
}

function statusFor(username: string) {
  return props.messenger.statusFor(username);
}

function statusLabel(username: string) {
  switch (statusFor(username)) {
    case "invisible":
      return t("sidebar.invisible");
    case "dnd":
      return t("sidebar.dnd");
    default:
      return t("sidebar.online");
  }
}

function platformsFor(username: string) {
  return props.messenger.platformsForUser?.(username) || [];
}

const members = computed(() =>
  [...(props.messenger.memberRoster.value || [])].sort((a, b) => a.localeCompare(b))
);

const voiceMembers = computed(() => new Set(props.messenger.state.voiceMembersByRoom[props.messenger.state.activeRoom] || []));
const isCommunity = computed(() => props.messenger.isCommunityRoom?.(props.messenger.state.activeRoom) === true);
const canModerate = computed(() => props.messenger.canModerateRoom?.(props.messenger.state.activeRoom) === true);
const canManage = computed(() => props.messenger.canManageRoom?.(props.messenger.state.activeRoom) === true);
const isOwner = computed(() => props.messenger.isRoomOwner?.(props.messenger.state.activeRoom) === true);

function roleFor(username: string) {
  return props.messenger.roleForUsername?.(props.messenger.state.activeRoom, username) || "member";
}

function roleBadge(username: string) {
  const role = roleFor(username);
  if (role === "member" && !isCommunity.value) return "";
  return props.messenger.roleLabel?.(role) || "";
}

function targetUserId(username: string) {
  return props.messenger.userIdForUsername?.(username) || "";
}

const contextIsSelf = computed(() =>
  memberContextUser.value === props.messenger.state.username
);
const contextRole = computed(() => roleFor(memberContextUser.value));
const contextIsMuted = computed(() => {
  const id = targetUserId(memberContextUser.value);
  if (!id) return false;
  return props.messenger.isMemberMuted?.(props.messenger.state.activeRoom, id) === true;
});

function doBan() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.banMember?.(props.messenger.state.activeRoom, id);
  closeMemberContext();
}

function doKick() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.kickMember?.(props.messenger.state.activeRoom, id);
  closeMemberContext();
}

function doMute() {
  const id = targetUserId(memberContextUser.value);
  if (!id) return;
  muteTargetUserId.value = id;
  muteModalOpen.value = true;
  closeMemberContext();
}

function doUnmute() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.unmuteMember?.(props.messenger.state.activeRoom, id);
  closeMemberContext();
}

function doPromoteModerator() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.setMemberRole?.(props.messenger.state.activeRoom, id, "moderator");
  closeMemberContext();
}

function doPromoteSubAdmin() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.setMemberRole?.(props.messenger.state.activeRoom, id, "subAdmin");
  closeMemberContext();
}

function doDemote() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.setMemberRole?.(props.messenger.state.activeRoom, id, "member");
  closeMemberContext();
}

function doTransferOwnership() {
  const id = targetUserId(memberContextUser.value);
  if (id) props.messenger.transferOwnership?.(props.messenger.state.activeRoom, id);
  closeMemberContext();
}
const selectedProfile = ref("");
const selectedAvatarUser = ref("");
const selectedBannerUser = ref("");
const memberContextOpen = ref(false);
const memberContextUser = ref("");
const memberContextMenuRef = ref<HTMLElement | null>(null);
const muteModalOpen = ref(false);
const muteTargetUserId = ref("");
const memberContextPos = ref({ x: 0, y: 0 });

async function positionMemberContext(clientX: number, clientY: number) {
  const padding = 16;
  memberContextPos.value = { x: clientX, y: clientY };

  // The menu is rendered inside a <Teleport to="body"> and contains
  // conditional (v-if) content, so a single nextTick is not enough for its
  // final layout to be measurable. Wait for the teleport + render to settle.
  await nextTick();
  await nextTick();

  let rect = memberContextMenuRef.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    // Fallback: give the browser one more frame to flush layout.
    await nextTick();
    rect = memberContextMenuRef.value?.getBoundingClientRect();
  }

  if (!rect || rect.width === 0 || rect.height === 0) {
    // Last resort fallback so we never compute a nonsense clamp.
    memberContextPos.value = { x: clientX, y: clientY };
    return;
  }

  const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
  const maxY = Math.max(padding, window.innerHeight - rect.height - padding);

  let x = Math.min(Math.max(clientX, padding), maxX);
  let y = Math.min(Math.max(clientY, padding), maxY);

  // If the click is near the right edge of the viewport, open the menu to the
  // left of the cursor so it stays fully visible instead of hugging the edge.
  const rightThreshold = window.innerWidth - rect.width - padding * 2;
  if (clientX > rightThreshold) {
    x = clientX - rect.width - padding;
    x = Math.max(padding, x);
  }

  memberContextPos.value = { x, y };
}

const sections = computed(() => {
  const inCall: string[] = [];
  const online: string[] = [];

  for (const username of members.value) {
    if (voiceMembers.value.has(username)) {
      inCall.push(username);
      continue;
    }
    online.push(username);
  }

  return [
    { key: "call", label: t('call.live'), users: inCall },
    { key: "online", label: t('members.online'), users: online }
  ].filter((section) => section.users.length);
});

function openProfile(event: MouseEvent, username: string) {
  event.preventDefault();
  event.stopPropagation();
  closeMemberContext();
  selectedProfile.value = username;
}

function openMemberContext(event: MouseEvent, username: string) {
  event.preventDefault();
  event.stopPropagation();
  memberContextUser.value = username;
  memberContextOpen.value = true;
  positionMemberContext(event.clientX, event.clientY);
}

function closeProfile() {
  selectedProfile.value = "";
}

function closeAvatarViewer() {
  selectedAvatarUser.value = "";
}

function closeBannerViewer() {
  selectedBannerUser.value = "";
}

function closeMemberContext() {
  memberContextOpen.value = false;
  memberContextUser.value = "";
}

function openAvatarFromContext() {
  if (!memberContextUser.value || !avatarFor(memberContextUser.value)) return;
  selectedAvatarUser.value = memberContextUser.value;
  closeMemberContext();
}

function openBannerFromContext() {
  if (!memberContextUser.value || !bannerFor(memberContextUser.value)) return;
  selectedBannerUser.value = memberContextUser.value;
  closeMemberContext();
}

function openProfileFromContext() {
  if (!memberContextUser.value) return;
  selectedProfile.value = memberContextUser.value;
  closeMemberContext();
}

async function copyUserIdFromContext() {
  const userId = String(props.messenger.userIdForUsername?.(memberContextUser.value) || "").trim();
  if (!userId) {
    props.messenger.showToast?.("User ID unavailable.");
    closeMemberContext();
    return;
  }
  const copied = await navigator.clipboard.writeText(userId).then(() => true).catch(() => false);
  if (copied) props.messenger.showToast?.("User ID copied.");
  closeMemberContext();
}

function onGlobalPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(".members__context-menu")) return;
  closeMemberContext();
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeMemberContext();
    closeProfile();
    closeAvatarViewer();
    closeBannerViewer();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", onGlobalPointerDown);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("pointerdown", onGlobalPointerDown);
});
</script>

<template>
  <aside class="members" :aria-label="t('thread.members')" @touchstart="onSidebarTouchStart" @touchend="onSidebarTouchEnd">
    <div class="members__head">
      <div>
        <div class="members__eyebrow">{{ t('members.presence') }}</div>
        <div class="members__title">{{ members.length }} {{ t('members.online') }}</div>
      </div>
      <button v-if="showMobile" class="icon-btn members__close-mobile" type="button"
        :aria-label="t('profile.close')" @click="emit('close-mobile')">
        <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>

    <div v-if="sections.length" class="members__sections">
      <section v-for="section in sections" :key="section.key" class="members__group">
        <div class="members__label">{{ section.label }} — {{ section.users.length }}</div>
        <div class="members__list">
          <div
            v-for="username in section.users"
            :key="username"
            class="members__item"
            role="button"
            tabindex="0"
            :aria-label="t('members.openProfile', { username })"
            @click="openProfile($event, username)"
            @contextmenu.prevent.stop="openMemberContext($event, username)"
            @keydown.enter.prevent="selectedProfile = username"
            @keydown.space.prevent="selectedProfile = username"
          >
            <span v-if="avatarFor(username)" class="members__avatar-image">
              <img :src="avatarFor(username)" alt="" />
            </span>
            <span v-else class="avatar avatar--sm" :class="`avatar--${accentFor(username)}`">
              {{ initialsFor(username) }}
            </span>
            <div class="members__meta">
              <div class="members__name">
                {{ username }}
                <span class="platforms" :aria-label="`Platforms: ${platformsFor(username).map((p: string) => messenger.platformLabel(p)).join(', ') || 'unknown'}`">
                  <span
                    v-for="platform in platformsFor(username)"
                    :key="platform"
                    class="platforms__badge"
                    :title="messenger.platformLabel(platform)"
                  >{{ messenger.platformIcon(platform) }}</span>
                </span>
              </div>
              <div class="members__status">
                <span
                  class="members__dot"
                  :class="{
                    'is-call': voiceMembers.has(username),
                    'is-dnd': statusFor(username) === 'dnd',
                    'is-invisible': statusFor(username) === 'invisible'
                  }"
                ></span>
                {{ voiceMembers.has(username) ? t('call.live') : statusLabel(username) }}
                <span v-if="roleBadge(username)" class="members__role">{{ roleBadge(username) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="members__empty">{{ t('members.online') }}</div>

    <Teleport to="body">
      <div v-if="memberContextOpen" class="members__context-backdrop" @click="closeMemberContext" @contextmenu.prevent>
        <div
          ref="memberContextMenuRef"
          class="members__context-menu context-menu-base"
          role="menu"
          :style="{ left: `${memberContextPos.x}px`, top: `${memberContextPos.y}px` }"
          @click.stop
        >
          <!-- Header (mobile only) -->
          <div class="members__context-header">
            <span v-if="avatarFor(memberContextUser)" class="members__context-header-avatar">
              <img :src="avatarFor(memberContextUser)" alt="" />
            </span>
            <span v-else class="members__context-header-avatar" :class="`avatar--${accentFor(memberContextUser)}`">{{ initialsFor(memberContextUser) }}</span>
            <strong class="members__context-header-name">@{{ memberContextUser }}</strong>
          </div>
          <button v-if="avatarFor(memberContextUser)" type="button" role="menuitem" @click="openAvatarFromContext">
            <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>{{ t('members.seeAvatar') }}</span>
          </button>
          <button v-if="bannerFor(memberContextUser)" type="button" role="menuitem" @click="openBannerFromContext">
            <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h.01"/></svg>
            <span>{{ t('members.seeBanner') }}</span>
          </button>
          <button type="button" role="menuitem" @click="openProfileFromContext">
            <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>{{ t('members.viewProfile') }}</span>
          </button>
          <button type="button" role="menuitem" @click="copyUserIdFromContext">
            <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>{{ t('members.copyUserId') }}</span>
          </button>

          <template v-if="isCommunity && !contextIsSelf && contextRole !== 'administrator'">
            <div class="members__context-separator" aria-hidden="true"></div>
            <button v-if="canModerate" type="button" role="menuitem" class="context-menu-danger" @click="doBan">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span>{{ t('rooms.ban') }}</span>
            </button>
            <button v-if="canModerate" type="button" role="menuitem" @click="doKick">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>{{ t('rooms.kick') }}</span>
            </button>
            <button v-if="canModerate && !contextIsMuted" type="button" role="menuitem" @click="doMute">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              <span>{{ t('rooms.mute') }}</span>
            </button>
            <button v-if="canModerate && contextIsMuted" type="button" role="menuitem" @click="doUnmute">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 9.34v4.32a2 2 0 0 0 4 0V10l4-4"/><path d="m19 5 3 3"/></svg>
              <span>{{ t('rooms.unmute') }}</span>
            </button>
            <button v-if="canManage" type="button" role="menuitem" @click="doPromoteModerator">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V5l7-3z"/></svg>
              <span>{{ t('rooms.promoteModerator') }}</span>
            </button>
            <button v-if="canManage" type="button" role="menuitem" @click="doPromoteSubAdmin">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V5l7-3z"/><path d="M9 12l2 2 4-4"/></svg>
              <span>{{ t('rooms.promoteSubAdmin') }}</span>
            </button>
            <button v-if="canManage && contextRole !== 'member'" type="button" role="menuitem" @click="doDemote">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V5l7-3z"/><line x1="9" y1="12" x2="15" y2="12"/></svg>
              <span>{{ t('rooms.demote') }}</span>
            </button>
            <button v-if="isOwner && (contextRole === 'moderator' || contextRole === 'subAdmin')" type="button" role="menuitem" @click="doTransferOwnership">
              <svg class="members__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V5l7-3z"/><path d="M12 8v8M8 12h8"/></svg>
              <span>{{ t('rooms.transferOwnership') }}</span>
            </button>
          </template>

          <!-- Cancel (mobile only) -->
          <div class="members__context-separator" aria-hidden="true"></div>
          <button type="button" class="members__context-cancel" role="menuitem" @click="closeMemberContext">
            <span>{{ t('message.cancel') }}</span>
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <ImageViewer
        v-if="selectedAvatarUser"
        :src="avatarFor(selectedAvatarUser)"
        :filename="`${selectedAvatarUser}-avatar`"
        size-label="Avatar"
        @close="closeAvatarViewer"
      />
      <ImageViewer
        v-if="selectedBannerUser"
        :src="bannerFor(selectedBannerUser)"
        :filename="`${selectedBannerUser}-banner`"
        size-label="Banner"
        @close="closeBannerViewer"
      />
      <ProfileCard
        v-if="selectedProfile"
        :messenger="messenger"
        :username="selectedProfile"
        @close="closeProfile"
      />
    </Teleport>

    <MuteMemberModal
      :messenger="messenger"
      :open="muteModalOpen"
      :room-id="messenger.state.activeRoom"
      :target-user-id="muteTargetUserId"
      @close="muteModalOpen = false"
    />
  </aside>
</template>

<style scoped>
.members__role {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  border-radius: 999px;
  background: var(--accent-soft, rgba(99, 102, 241, 0.16));
  color: var(--accent, #6366f1);
  white-space: nowrap;
}

.members__context-menu {
  z-index: 140;
}

.members__close-mobile {
  display: none;
}

/* Hidden on desktop, shown on mobile */
.members__context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 135;
}

.members__context-header,
.members__context-item-icon,
.members__context-separator,
.members__context-cancel {
  display: none;
}

@media (max-width: 760px) {
  .members__close-mobile {
    display: inline-grid;
    width: 32px;
    height: 32px;
  }

  /* ---- Member context bottom sheet ---- */
  .members__context-backdrop {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: members-context-backdrop-in 160ms ease-out;
  }

  .members__context-menu {
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
    animation: members-context-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .members__context-menu::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .members__context-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 18px 14px;
    flex: none;
  }

  .members__context-header-avatar {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    flex: none;
    overflow: hidden;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 18px;
    color: #fff;
    background: var(--surface-2);
  }

  .members__context-header-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .members__context-header-name {
    font-size: 16px;
    font-weight: 750;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .members__context-menu button {
    min-height: 50px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    padding: 0 18px;
    gap: 14px;
    width: 100%;
    text-align: left;
    transition: background 120ms ease;
    display: flex;
    align-items: center;
  }

  .members__context-menu button:hover,
  .members__context-menu button:focus-visible {
    background: var(--surface-hover);
  }

  .members__context-item-icon {
    display: block;
    flex: none;
    color: var(--muted);
    transition: color 120ms ease;
  }

  .members__context-menu button:hover .members__context-item-icon {
    color: var(--text);
  }

  .members__context-separator {
    display: block;
    height: 1px;
    margin: 4px 18px;
    background: var(--line);
    flex: none;
  }

  .members__context-cancel {
    display: flex;
    justify-content: center;
    text-align: center;
    font-weight: 700;
    color: var(--muted) !important;
    margin-top: 2px;
  }

  .members__context-cancel:hover {
    color: var(--text) !important;
    background: var(--surface-hover) !important;
  }
}

@keyframes members-context-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes members-context-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
