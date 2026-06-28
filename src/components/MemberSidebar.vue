<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import ImageViewer from "@/components/ImageViewer.vue";
import ProfileCard from "@/components/ProfileCard.vue";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});

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
const selectedProfile = ref("");
const selectedAvatarUser = ref("");
const selectedBannerUser = ref("");
const memberContextOpen = ref(false);
const memberContextUser = ref("");
const memberContextPos = ref({ x: 0, y: 0 });

function clampMemberContextPosition(clientX: number, clientY: number) {
  const menuWidth = 196;
  const menuHeight = 220;
  const padding = 12;
  const maxLeft = Math.max(padding, window.innerWidth - menuWidth - padding);
  const maxTop = Math.max(padding, window.innerHeight - menuHeight - padding);
  return {
    x: Math.min(Math.max(clientX, padding), maxLeft),
    y: Math.min(Math.max(clientY, padding), maxTop),
  };
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
  memberContextPos.value = clampMemberContextPosition(event.clientX, event.clientY);
  memberContextOpen.value = true;
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
  <aside class="members" :aria-label="t('thread.members')">
    <div class="members__head">
      <div>
        <div class="members__eyebrow">{{ t('members.presence') }}</div>
        <div class="members__title">{{ members.length }} {{ t('members.online') }}</div>
      </div>
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
                <span class="platforms" :aria-label="`Platforms: ${platformsFor(username).map((p) => messenger.platformLabel(p)).join(', ') || 'unknown'}`">
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
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="members__empty">{{ t('members.online') }}</div>

    <div
      v-if="memberContextOpen"
      class="members__context-menu"
      role="menu"
      :style="{ left: `${memberContextPos.x}px`, top: `${memberContextPos.y}px` }"
      @click.stop
    >
      <button v-if="avatarFor(memberContextUser)" type="button" role="menuitem" @click="openAvatarFromContext">See Avatar</button>
      <button v-if="bannerFor(memberContextUser)" type="button" role="menuitem" @click="openBannerFromContext">See Banner</button>
      <button type="button" role="menuitem" @click="openProfileFromContext">View Profile</button>
      <button type="button" role="menuitem" @click="copyUserIdFromContext">Copy User Id</button>
    </div>

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
  </aside>
</template>

<style scoped>
.members__context-menu {
  position: fixed;
  z-index: 140;
  min-width: 196px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 96%, black 4%);
  border: 1px solid var(--line);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(16px);
  padding: 6px;
}

.members__context-menu button {
  width: 100%;
  text-align: left;
  border-radius: 4px;
  padding: 8px 10px;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  transition: background-color 120ms ease, color 120ms ease;
}

.members__context-menu button:hover {
  background: color-mix(in srgb, var(--accent) 78%, transparent);
  color: #fff;
}
</style>
