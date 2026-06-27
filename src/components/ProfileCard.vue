<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  username: { type: String, required: true }
});

const emit = defineEmits(["close"]);

const profile = computed(() => props.messenger.profileFor(props.username));
const avatarSrc = computed(() => props.messenger.profileImageSrc(profile.value.avatar, "avatar"));
const bannerSrc = computed(() => props.messenger.profileImageSrc(profile.value.banner, "banner"));
const accent = computed(() => props.messenger.accentFor(props.username));
const isSelf = computed(() => String(props.messenger.state.username || "").trim() === props.username);
const voiceMembers = computed(() => new Set(props.messenger.state.voiceMembersByRoom[props.messenger.state.activeRoom] || []));
const status = computed(() => props.messenger.statusFor(props.username));
const statusLabel = computed(() => {
  if (voiceMembers.value.has(props.username)) return t("profile.inVoiceChat");
  switch (status.value) {
    case "invisible":
      return t("sidebar.invisible");
    case "dnd":
      return t("sidebar.dnd");
    default:
      return t("sidebar.online");
  }
});
const platforms = computed(() => props.messenger.platformsForUser?.(props.username) || []);
const mutualRooms = computed(() => props.messenger.mutualRoomsWith?.(props.username) || []);
const mutualRoomOptions = computed(() =>
  mutualRooms.value.map((room) => ({
    ...room,
    label: room.name,
    previewSrc: room.icon?.startsWith("data:image/") ? "" : room.icon
  }))
);
const selectedMutualRoom = ref("");

function openSelectedMutualRoom() {
  const roomId = String(selectedMutualRoom.value || "").trim();
  if (!roomId) return;
  props.messenger.selectConversation?.(roomId);
  emit("close");
}

function initialsFor(name: string) {
  const clean = String(name || "?").trim();
  const parts = clean.split(/[\s\-_]+/).filter(Boolean).slice(0, 2);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}
</script>

<template>
  <div class="profile-card" role="dialog" aria-modal="true" :aria-label="t('members.openProfile', { username })"
    @click="emit('close')">
    <section class="profile-card__panel" @click.stop>
      <div class="profile-card__banner" :class="{ 'has-image': bannerSrc }">
        <img v-if="bannerSrc" :src="bannerSrc" alt="" />
      </div>
      <div class="profile-card__body">
        <span v-if="avatarSrc" class="profile-card__avatar profile-card__avatar--image">
          <img :src="avatarSrc" alt="" />
        </span>
        <span v-else class="avatar profile-card__avatar" :class="`avatar--${accent}`">{{ initialsFor(username) }}</span>
        <button class="icon-btn profile-card__close" type="button" :aria-label="t('profile.close')"
          @click="emit('close')">
          <svg viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div class="profile-card__identity">
          <strong>@{{ username }}</strong>
          <small>
            <span class="members__dot" :class="{
              'is-call': voiceMembers.has(username),
              'is-dnd': status === 'dnd',
              'is-invisible': status === 'invisible'
            }"></span>
            {{ statusLabel }}<template v-if="profile.pronouns"> · {{ profile.pronouns }}</template><template
              v-if="isSelf"> · {{ t('members.you') }}</template>
          </small>
          <div v-if="platforms.length" class="profile-card__platforms" :aria-label="t('profile.clientPlatforms')">
            <span v-for="platform in platforms" :key="platform" class="platforms__badge"
              :title="messenger.platformLabel(platform)">{{ messenger.platformIcon(platform) }}</span>
          </div>
        </div>
        <div class="profile-card__section">
          <h4>{{ t('profile.about') }}</h4>
          <p v-if="profile.description" class="profile-card__description">{{ profile.description }}</p>
          <p v-else class="profile-card__empty">{{ t('profile.noDescription') }}</p>
        </div>

        <div class="profile-card__section">
          <h4>{{ t('profile.mutualRooms') }}</h4>
          <div v-if="mutualRoomOptions.length" class="profile-card__mutual-list" role="list">
            <button v-for="room in mutualRoomOptions" :key="room.roomId" type="button" class="profile-card__mutual-room"
              @click="selectedMutualRoom = room.roomId; openSelectedMutualRoom()">
              <span v-if="room.previewSrc" class="profile-card__mutual-room-media">
                <img :src="room.previewSrc" alt="" />
              </span>
              <span v-else class="profile-card__mutual-room-fallback">{{ room.label.slice(0, 1).toUpperCase() || '#'
                }}</span>
              <span class="profile-card__mutual-room-name">{{ room.label }}</span>
            </button>
          </div>
          <p v-else class="profile-card__empty">{{ t('profile.noMutualRooms') }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
