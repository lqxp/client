<script setup lang="ts">
import type { PhantomFriend } from "@/composables/usePhantom";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import BadgeIcon from "@/components/BadgeIcon.vue";
import { badgeLabel as badgeLabelFor, normalizeBadgeId } from "@/config/badges";
import { escapeHtml } from "@/utils/twemoji";

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const phantom = inject<any>("phantom", null);

const props = defineProps({
  messenger: { type: Object, required: true },
  username: { type: String, required: true }
});

const emit = defineEmits(["close"]);

const profile = computed(() => props.messenger.profileFor(props.username));
const avatarSrc = computed(() => props.messenger.profileImageSrc(profile.value.avatar, "avatar"));
const bannerSrc = computed(() => props.messenger.profileImageSrc(profile.value.banner, "banner"));
const accent = computed(() => props.messenger.accentFor(props.username));
const isSystem = computed(() => props.messenger.isSystemUsername?.(props.username) || props.username.trim().toLowerCase() === "system");
const displayName = computed(() => isSystem.value ? "QxChat System" : `@${props.username}`);
const isSelf = computed(() => String(props.messenger.state.username || "").trim() === props.username);
const voiceMembers = computed(() => new Set(props.messenger.state.voiceMembersByRoom[props.messenger.state.activeRoom] || []));
const status = computed(() => props.messenger.statusFor(props.username));
const presenceClass = computed(() => {
  if (voiceMembers.value.has(props.username)) return "is-call";
  switch (status.value) {
    case "dnd":
      return "is-dnd";
    case "invisible":
      return "is-invisible";
    default:
      return "is-online";
  }
});
const platforms = computed(() => props.messenger.platformsForUser?.(props.username) || []);
const badges = computed(() => props.messenger.badgesFor?.(props.username) || []);
const mutualRooms = computed(() => props.messenger.mutualRoomsWith?.(props.username) || []);
const mutualRoomOptions = computed(() =>
  mutualRooms.value.map((room) => ({
    ...room,
    label: room.name,
    previewSrc: room.icon?.startsWith("data:image/") ? "" : room.icon
  }))
);
const createdAt = computed(() => props.messenger.createdAtFor?.(props.username) || 0);
const memberSinceLabel = computed(() => {
  if (!createdAt.value) return "";
  try {
    return new Intl.DateTimeFormat(locale.value || undefined, {
      dateStyle: "long",
    }).format(new Date(createdAt.value));
  } catch {
    return new Date(createdAt.value).toLocaleDateString();
  }
});
const descriptionHtml = computed(() => renderProfileMarkdown(profile.value.description || ""));
const isMobileProfile = ref(false);
let mobileMedia: MediaQueryList | null = null;

// ── Récupère le profil public (dont le timestamp de création) de l'utilisateur
// consulté, même quand la carte est ouverte directement (member click, search…).
watch(
  () => props.username,
  (username) => {
    const key = String(username || "").trim();
    if (!key || isSelf.value || isSystem.value) return;
    props.messenger.requestPublicProfilesForUsers?.([{ username: key }]);
  },
  { immediate: true },
);

// ── Relations ami / bloqué (via phantom) ────────────────────────────────────
const friends = computed<PhantomFriend[]>(() => Object.values(phantom?.state?.friendsByUser || {}) as PhantomFriend[]);
const isFriend = computed(() =>
  friends.value.some((f) => String(f?.peerDisplayName || "").trim().toLowerCase() === props.username.trim().toLowerCase())
);
const friendFp = computed(() => friends.value.find((f) => String(f?.peerDisplayName || "").trim().toLowerCase() === props.username.trim().toLowerCase())?.peerFp || "");
const isBlocked = computed(() => {
  const blockList: string[] = phantom?.state?.blockList || [];
  const fp = friendFp.value;
  return fp ? blockList.includes(fp) : false;
});
const sending = ref(false);
const sent = ref(false);

// ── Onglets de la colonne droite ────────────────────────────────────────────
const activeTab = ref<"friends" | "rooms">("rooms");

// Mes salons rejoints (vue « soi-même »).
const myRooms = computed(() =>
  (props.messenger.state.rooms || [])
    .filter((r: { roomId?: string; title?: string }) => r?.roomId && !props.messenger.isFriendRoom?.(r.roomId))
    .map((r: { roomId?: string; title?: string }) => ({
      roomId: String(r.roomId),
      label: props.messenger.displayRoomName?.(r.roomId) || String(r.roomId),
      previewSrc: props.messenger.roomIcon?.(r.roomId) || "",
    }))
);

// Amis affichés : pour soi-même = mes amis, sinon = amis en commun.
const tabFriends = computed<PhantomFriend[]>(() => {
  if (isSelf.value) return friends.value;
  return friends.value.filter((f) =>
    mutualRoomOptions.value.some(
      (room) => room.roomId === f?.roomId,
    ),
  );
});

// Salons affichés : pour soi-même = mes salons, sinon = salons en commun.
const tabRooms = computed(() =>
  isSelf.value ? myRooms.value : mutualRoomOptions.value,
);

function openFriend(friend: PhantomFriend) {
  const roomId = String(friend?.roomId || "").trim();
  if (!roomId) return;
  // Titre le salon ami avec son nom (sinon il apparaît comme un salon
  // « classique » à hash brut en haut de la liste des rooms).
  props.messenger.setLocalRoomTitle?.(roomId, friend?.peerDisplayName || roomId);
  props.messenger.selectConversation?.(roomId);
  emit("close");
}

function friendAvatar(friend: PhantomFriend) {
  const p = props.messenger.profileFor?.(friend.peerDisplayName);
  return props.messenger.profileImageSrc?.(p?.avatar, "avatar") || "";
}

async function addFriend() {
  if (!phantom || sending.value) return;
  sending.value = true;
  try {
    const mutual = mutualRoomOptions.value[0];
    const ok = mutual?.roomId
      ? await phantom.sendIntroByContext(props.username, mutual.roomId, "Hi!")
      : await phantom.sendIntroByUsername(props.username, "Hi!");
    sent.value = Boolean(ok);
  } catch {
    sent.value = false;
  } finally {
    sending.value = false;
  }
}

async function toggleBlock() {
  if (!phantom) return;
  if (isBlocked.value) {
    if (!friendFp.value) return;
    await phantom.unblockUser(friendFp.value);
  } else if (friendFp.value) {
    await phantom.blockUser(friendFp.value);
  }
}

function addFriendLabel() {
  if (sending.value) return "…";
  if (sent.value) return t('profile.requestSent');
  return t('profile.addFriend');
}

function updateMobileProfile() {
  isMobileProfile.value = typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
}

onMounted(() => {
  updateMobileProfile();
  if (typeof window === "undefined" || !window.matchMedia) return;
  mobileMedia = window.matchMedia("(max-width: 820px)");
  mobileMedia.addEventListener?.("change", updateMobileProfile);
});

onBeforeUnmount(() => {
  mobileMedia?.removeEventListener?.("change", updateMobileProfile);
});

function badgeLabel(badge: string) {
  return badgeLabelFor(t, badge);
}

function showBadgeLabel(badge: string) {
  if (!isMobileProfile.value) return;
  const toastBadge = normalizeBadgeId(badge);
  props.messenger.showToast?.(badgeLabel(badge), {
    badge: toastBadge,
    badgeAvatarSrc: toastBadge === "system" ? props.messenger.profileImageSrc(profile.value.avatar, "avatar") : ""
  });
}

function openMutualRoom(roomId: string) {
  const id = String(roomId || "").trim();
  if (!id) return;
  props.messenger.selectConversation?.(id);
  emit("close");
}

function initialsFor(name: string) {
  const clean = String(name || "?").trim();
  const parts = clean.split(/[\s\-_]+/).filter(Boolean).slice(0, 2);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}

// ── Markdown léger (gras, italique, citation `>`, lien) ──────────────────────
function safeHref(value: unknown) {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw, window.location.origin);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return escapeHtml(raw);
  } catch {
    /* ignore */
  }
  return "";
}

function renderProfileMarkdown(value: unknown) {
  const tokens: Array<[string, string]> = [];
  const hold = (html: string) => {
    const token = `@@pf-${tokens.length}@@`;
    tokens.push([token, html]);
    return token;
  };

  let text = String(value ?? "");

  // Citations : lignes consécutives commençant par `>`.
  text = text.replace(/(^|\n)((?:>[^\n]*(?:\n|$))+)/g, (_match, prefix, block) => {
    const inner = String(block)
      .split("\n")
      .filter(Boolean)
      .map((line) => escapeHtml(line.replace(/^>\s?/, "").trim()))
      .join("<br>");
    return `${prefix}${hold(`<blockquote>${inner}</blockquote>`)}`;
  });

  // Liens [texte](url).
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safe = safeHref(href);
    if (!safe) return match;
    return hold(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
  });

  let html = escapeHtml(text);
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");

  for (const [token, value] of tokens) html = html.replaceAll(token, value);
  return html;
}
</script>

<template>
  <div class="profile-card" role="dialog" aria-modal="true" :aria-label="t('members.openProfile', { username })"
    @click="emit('close')">
    <section class="profile-card__panel" @click.stop>
      <div class="profile-card__handle" aria-hidden="true"></div>
      <div class="profile-card__body">
        <div class="profile-card__left">
          <div class="profile-card__left-box">
            <div class="profile-card__banner" :class="{ 'has-image': bannerSrc }">
              <img v-if="bannerSrc" :src="bannerSrc" alt="" />
            </div>
        <span v-if="avatarSrc" class="profile-card__avatar profile-card__avatar--image">
          <span class="profile-card__avatar-clip">
            <img :src="avatarSrc" alt="" />
          </span>
          <span v-if="!isSystem" class="profile-card__presence" :class="presenceClass" aria-hidden="true"></span>
        </span>
        <span v-else class="avatar profile-card__avatar" :class="`avatar--${accent}`">
          {{ initialsFor(username) }}
          <span v-if="!isSystem" class="profile-card__presence" :class="presenceClass" aria-hidden="true"></span>
        </span>
        <div class="profile-card__identity">
          <div class="profile-card__name-row">
            <strong :title="`@${username}`">{{ displayName }}</strong>
            <div v-if="badges.length" class="profile-card__badges">
              <span v-for="badge in badges" :key="badge" class="profile-card__badge"
                :class="`profile-card__badge--${badge}`" :data-title="isMobileProfile ? '' : badgeLabel(badge)"
                :aria-label="badgeLabel(badge)" tabindex="0" @click.stop="showBadgeLabel(badge)"
                @keydown.enter.prevent="showBadgeLabel(badge)" @keydown.space.prevent="showBadgeLabel(badge)">
                <BadgeIcon :badge="badge"
                  :avatar-src="badge === 'system' ? messenger.profileImageSrc(profile.avatar, 'avatar') : ''" />
              </span>
            </div>
          </div>
          <small>
            <template v-if="profile.pronouns">
              {{ profile.pronouns }}<template v-if="isSelf"> · {{ t('members.you') }}</template>
            </template>
            <template v-else-if="isSelf">{{ t('members.you') }}</template>
            <span v-if="platforms.length" class="profile-card__platforms" :aria-label="t('profile.clientPlatforms')">
              <span v-for="platform in platforms" :key="platform" class="platforms__badge"
                :title="messenger.platformLabel(platform)">{{ messenger.platformIcon(platform) }}</span>
            </span>
          </small>

          <div v-if="!isSelf && !isSystem" class="profile-card__actions">
            <button v-if="!isFriend" type="button" class="profile-card__action-btn profile-card__action-btn--primary"
              :disabled="sending || sent" @click="addFriend">
              <svg v-if="!sent" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M19 8v6" />
                <path d="M22 11h-6" />
              </svg>
              {{ addFriendLabel() }}
            </button>
            <button type="button" class="profile-card__action-btn profile-card__action-btn--danger" @click="toggleBlock">
              {{ isBlocked ? t('profile.unblock') : t('profile.block') }}
            </button>
          </div>
        </div>

            <h4 class="profile-card__section-title">{{ t('profile.about') }}</h4>
            <div class="profile-card__section">
              <div v-if="profile.description" class="profile-card__description markdown" v-html="descriptionHtml"></div>
              <p v-else class="profile-card__empty">{{ t('profile.noDescription') }}</p>
            </div>

            <div v-if="memberSinceLabel" class="profile-card__joined">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4" />
                <path d="M8 2v4" />
                <path d="M3 10h18" />
              </svg>
              <span>{{ t('profile.memberSince') }} {{ memberSinceLabel }}</span>
            </div>
          </div>
        </div>

        <aside class="profile-card__mutual">
          <template v-if="isSystem">
            <h4 class="profile-card__mutual-title">{{ t('profile.systemTitle') }}</h4>
            <p class="profile-card__note">{{ t('profile.systemNote') }}</p>
          </template>

          <template v-else>
            <div class="profile-card__tabs" role="tablist">
              <button type="button" role="tab" class="profile-card__tab"
                :class="{ 'is-active': activeTab === 'friends' }" :aria-selected="activeTab === 'friends'"
                @click="activeTab = 'friends'">
                {{ t('profile.friends') }}<span v-if="tabFriends.length" class="profile-card__tab-count">{{ tabFriends.length }}</span>
              </button>
              <button type="button" role="tab" class="profile-card__tab"
                :class="{ 'is-active': activeTab === 'rooms' }" :aria-selected="activeTab === 'rooms'"
                @click="activeTab = 'rooms'">
                {{ t('profile.rooms') }}<span v-if="tabRooms.length" class="profile-card__tab-count">{{ tabRooms.length }}</span>
              </button>
            </div>

            <ul v-if="activeTab === 'friends'" class="profile-card__mutual-list" role="list">
              <li v-for="friend in tabFriends" :key="friend.peerFp || friend.peerDisplayName">
                <button type="button" class="profile-card__mutual-room" @click="openFriend(friend)">
                  <span v-if="friendAvatar(friend)" class="profile-card__mutual-room-media profile-card__mutual-room-media--round">
                    <img :src="friendAvatar(friend)" alt="" />
                  </span>
                  <span v-else class="profile-card__mutual-room-fallback profile-card__mutual-room-fallback--round">{{ (friend.peerDisplayName || '?').slice(0, 1).toUpperCase() }}</span>
                  <span class="profile-card__mutual-room-name">{{ friend.peerDisplayName }}</span>
                </button>
              </li>
              <li v-if="!tabFriends.length" class="profile-card__list-empty">{{ t('profile.noFriendsHere') }}</li>
            </ul>

            <ul v-else class="profile-card__mutual-list" role="list">
              <li v-for="room in tabRooms" :key="room.roomId">
                <button type="button" class="profile-card__mutual-room" @click="openMutualRoom(room.roomId)">
                  <span v-if="room.previewSrc" class="profile-card__mutual-room-media">
                    <img :src="room.previewSrc" alt="" />
                  </span>
                  <span v-else class="profile-card__mutual-room-fallback">{{ room.label.slice(0, 1).toUpperCase() || '#' }}</span>
                  <span class="profile-card__mutual-room-name">{{ room.label }}</span>
                </button>
              </li>
              <li v-if="!tabRooms.length" class="profile-card__list-empty">{{ t('profile.noRoomsHere') }}</li>
            </ul>
          </template>
        </aside>
      </div>
    </section>
  </div>
</template>
