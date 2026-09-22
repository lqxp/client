<script setup lang="ts">
import PresenceDot, { type Presence } from "@/components/PresenceDot.vue";
import { initialsOf } from "@/utils/initials";
import type { Messenger } from "@/composables/useMessenger";
import type { Phantom, PhantomFriend } from "@/composables/usePhantom";
import type { PropType } from "vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import BadgeIcon from "@/components/BadgeIcon.vue";
import { badgeLabel as badgeLabelFor, normalizeBadgeId } from "@/config/badges";
import { escapeHtml } from "@/utils/twemoji";

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const phantom = inject<Phantom | null>("phantom", null);

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true },
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
const presence = computed<Presence>(() => {
  if (voiceMembers.value.has(props.username)) return "call";
  return status.value === "dnd" || status.value === "invisible" ? status.value : "online";
});
const platforms = computed(() => props.messenger.platformsForUser?.(props.username) || []);
const badges = computed(() => props.messenger.badgesFor?.(props.username) || []);
const mutualRooms = computed(() => props.messenger.mutualRoomsWith?.(props.username) || []);
const mutualRoomOptions = computed(() =>
  mutualRooms.value.map((room) => ({
    ...room,
    label: roomLabel(String(room.roomId || "")),
    previewSrc: room.icon?.startsWith("data:image/") ? "" : room.icon
  }))
);
/** A room's own title, or a short opening of its id when it has none. */
function roomLabel(roomId: string): string {
  const id = String(roomId || "");
  if (!id) return "";
  return (
    props.messenger.displayRoomNameBeautified?.(id) ||
    props.messenger.displayRoomName?.(id) ||
    id.slice(0, 8)
  );
}

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
      roomId: String(r.roomId || ""),
      label: roomLabel(String(r.roomId || "")),
      previewSrc: props.messenger.roomIcon?.(String(r.roomId || "")) || "",
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

/** A row of the right hand list, whichever tab produced it. */
interface MutualEntry {
  key: string;
  label: string;
  media: string;
  round: boolean;
}

const tabEntries = computed<MutualEntry[]>(() =>
  activeTab.value === "friends"
    ? tabFriends.value.map((friend) => ({
        key: String(friend.peerFp || friend.peerDisplayName || ""),
        label: String(friend.peerDisplayName || ""),
        media: friendAvatar(friend),
        round: true,
      }))
    : tabRooms.value.map((room) => ({
        key: String(room.roomId || ""),
        label: String(room.label || ""),
        media: String(room.previewSrc || ""),
        round: false,
      })),
);

const TAB_ORDER = ["friends", "rooms"] as const;
/** Which way the pane travels, so the two never slide the same direction. */
const tabDirection = ref<"forward" | "back">("forward");

function selectTab(next: "friends" | "rooms") {
  if (next === activeTab.value) return;
  tabDirection.value =
    TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(activeTab.value) ? "forward" : "back";
  activeTab.value = next;
}

function openEntry(entry: MutualEntry) {
  if (activeTab.value === "rooms") return openMutualRoom(entry.key);
  const friend = tabFriends.value.find(
    (candidate) => String(candidate.peerFp || candidate.peerDisplayName || "") === entry.key,
  );
  if (friend) openFriend(friend);
}

function openFriend(friend: PhantomFriend) {
  const roomId = String(friend?.roomId || "").trim();
  if (!roomId) return;
  // Titre le salon ami avec son nom (sinon il apparaît comme un salon
  // « classique » à hash brut en haut de la liste des rooms).
  props.messenger.setLocalRoomTitle?.(roomId, friend?.peerDisplayName || roomId);
  props.messenger.selectConversation?.(roomId);
  emit("close");
}

function linkHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function friendAvatar(friend: PhantomFriend) {
  const p = props.messenger.profileFor?.(String(friend.peerDisplayName || ""));
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
    <section v-sheet-dismiss="() => emit('close')" class="profile-card__panel" @click.stop>
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
          <PresenceDot v-if="!isSystem" class="profile-card__presence" :status="presence" :size="16" :ring="6" />
          <span v-if="profile.customStatus" class="profile-card__thought">{{ profile.customStatus }}</span>
        </span>
        <span v-else class="avatar profile-card__avatar" :class="`avatar--${accent}`">
          {{ initialsOf(username) }}
          <PresenceDot v-if="!isSystem" class="profile-card__presence" :status="presence" :size="16" :ring="6" />
          <span v-if="profile.customStatus" class="profile-card__thought">{{ profile.customStatus }}</span>
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

            <div v-if="profile.links?.length" class="profile-card__links">
              <a v-for="link in profile.links" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer nofollow"
                class="profile-card__link" :title="link.url">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                </svg>
                <span>{{ link.label || linkHost(link.url) }}</span>
              </a>
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
            <!-- A segmented control: the selected pill slides between the two
                 rather than each half lighting up on its own. -->
            <div class="profile-card__tabs" role="tablist" :data-active="activeTab">
              <button type="button" role="tab" class="profile-card__tab"
                :class="{ 'is-active': activeTab === 'friends' }" :aria-selected="activeTab === 'friends'"
                @click="selectTab('friends')">
                {{ t('profile.friends') }}<span v-if="tabFriends.length"
                  class="profile-card__tab-count">{{ tabFriends.length }}</span>
              </button>
              <button type="button" role="tab" class="profile-card__tab"
                :class="{ 'is-active': activeTab === 'rooms' }" :aria-selected="activeTab === 'rooms'"
                @click="selectTab('rooms')">
                {{ t('profile.rooms') }}<span v-if="tabRooms.length"
                  class="profile-card__tab-count">{{ tabRooms.length }}</span>
              </button>
            </div>

            <div class="profile-card__mutual-stage">
              <Transition :name="`profile-pane-${tabDirection}`" mode="out-in">
                <ul :key="activeTab" class="profile-card__mutual-list" role="list">
                  <li v-for="entry in tabEntries" :key="entry.key">
                    <button type="button" class="profile-card__mutual-room" @click="openEntry(entry)">
                      <span v-if="entry.media" class="profile-card__mutual-room-media"
                        :class="{ 'profile-card__mutual-room-media--round': entry.round }">
                        <img :src="entry.media" alt="" />
                      </span>
                      <span v-else class="profile-card__mutual-room-fallback"
                        :class="{ 'profile-card__mutual-room-fallback--round': entry.round }">
                        {{ (entry.label || '?').slice(0, 1).toUpperCase() }}
                      </span>
                      <span class="profile-card__mutual-room-name">{{ entry.label }}</span>
                    </button>
                  </li>
                  <li v-if="!tabEntries.length" class="profile-card__list-empty">
                    {{ activeTab === 'friends' ? t('profile.noFriendsHere') : t('profile.noRoomsHere') }}
                  </li>
                </ul>
              </Transition>
            </div>
          </template>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
@media (min-width: 821px) {
  .profile-card__platforms {
    margin-left: 6px;
    vertical-align: middle;
  }

  .profile-card__platforms .platforms__badge {
    min-width: 26px;
    height: 22px;
    color: var(--text);
  }

  .profile-card {
    position: fixed;
    inset: 0;
    z-index: 85;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0, 0, 0, 0.62);
  }

  .profile-card__panel {
    position: relative;
    width: min(720px, calc(100vw - 32px));
    max-height: calc(var(--app-viewport-height) - 36px);
    overflow-y: auto;
    overflow-x: hidden;
    border-radius: 18px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong), 0 24px 70px rgba(0, 0, 0, .45);
  }

  .profile-card__banner {
    width: 100%;
    aspect-ratio: 21 / 9;
    border-radius: 12px;
    overflow: hidden;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent), rgba(63, 207, 111, 0.12)),
      var(--surface-2);
  }

  .profile-card__handle {
    display: none;
  }

  .profile-card__body {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    align-items: start;
    gap: 4px;
    padding: 18px;
  }

  .profile-card__left {
    position: relative;
    min-width: 0;
  }

  .profile-card__left-box {
    padding: 0 0 4px;
    border-radius: 0;
    background: transparent;
    border: 0;
  }

  .profile-card__left:only-child {
    grid-column: 1 / -1;
  }

  .profile-card__avatar {
    position: relative;
    left: 16px;
    margin: -44px 0 0 0;
    width: 88px;
    height: 88px;
    border: 5px solid var(--surface);
    border-radius: 50%;
    font-size: 28px;
  }

  .profile-card__avatar.profile-card__avatar--image {
    overflow: visible;
  }

  .profile-card__avatar-clip {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
  }

  .profile-card__avatar-clip img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .profile-card__presence {
    position: absolute;
    right: 6px;
    bottom: 6px;
  }

  .profile-card__identity {
    min-width: 0;
    margin-top: 6px;
    text-align: left;
  }

  .profile-card__name-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
  }

  .profile-card__identity strong,
  .profile-card__identity small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-card__name-row strong {
    min-width: 0;
  }

  .profile-card__badges {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 0 auto;
  }

  .profile-card__badge {
    --badge-size: 24px;
    position: relative;
    display: inline-grid;
    place-items: center;
    width: var(--badge-size);
    height: var(--badge-size);
    cursor: default;
    overflow: visible;
    outline: none;
  }

  .profile-card__badge svg {
    display: block;
  }

  .profile-card__badge>svg,
  .profile-card__badge>img {
    position: relative;
    z-index: 22;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .profile-card__badge::after {
    content: attr(data-title);
    position: absolute;
    bottom: calc(100% + 7px);
    left: 50%;
    z-index: 40;
    padding: 3px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.4;
    white-space: nowrap;
    opacity: 0;
    transform: translateX(-50%) translateY(3px);
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-out);
  }

  .profile-card__badge:hover>svg,
  .profile-card__badge:hover>img,
  .profile-card__badge:focus-visible>svg,
  .profile-card__badge:focus-visible>img {
    transform: scale(1.1);
  }

  .profile-card__badge:hover::after,
  .profile-card__badge:focus-visible::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    transition-delay: 420ms;
  }

  .profile-card__identity strong {
    font-size: 28px;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: 0;
  }

  .profile-card__identity small {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
  }

  .profile-card__section-title {
    margin: 20px 0 7px;
    padding: 0 2px;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
  }

  .profile-card__section {
    margin-top: 0;
    padding: 11px 13px;
    border-left: 0;
    border-radius: 10px;
    background: var(--surface-2);
  }

  .profile-card__section h4 {
    margin: 0 0 10px;
    color: var(--text);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0;
  }

  .profile-card__description,
  .profile-card__empty {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .profile-card__empty {
    color: var(--muted);
  }

  .profile-card__mutual-stage {
    position: relative;
    min-height: 132px;
    max-height: 288px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: 10px;
    background: var(--surface-2);
  }

  .profile-card__mutual-list {
    display: flex;
    flex-direction: column;
  }

  .profile-card__mutual-list > li + li .profile-card__mutual-room {
    background-image: linear-gradient(to right, transparent 0 42px, var(--line-strong) 42px);
    background-size: 100% 1px;
    background-repeat: no-repeat;
    background-position: top left;
  }

  .profile-card__mutual-room {
    width: 100%;
    min-width: 0;
    padding: 7px 12px;
    border-radius: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out);
  }

  .profile-card__mutual-room:hover {
    background-color: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .profile-card__mutual-room-media,
  .profile-card__mutual-room-fallback {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    overflow: hidden;
    display: grid;
    place-items: center;
    flex: none;
  }

  .profile-card__mutual-room-media {
    background: var(--surface-3, var(--surface-2));
  }

  .profile-card__mutual-room-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile-card__mutual-room-fallback {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface-2));
    color: var(--text);
    font-weight: 800;
  }

  .profile-card__mutual-room-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13.5px;
    font-weight: 400;
  }

  .profile-card__mutual-room-fallback {
    font-size: 11.5px;
    font-weight: 600;
  }

  .profile-card__list-empty {
    padding: 14px 12px;
    color: var(--muted);
    font-size: 13px;
    text-align: center;
  }

  .profile-card__mutual {
    min-width: 0;
    padding: 4px 0 4px 14px;
  }

  .profile-card__mutual-title {
    margin: 0 0 14px;
    color: var(--text);
    font-size: 13px;
    font-weight: 800;
  }

  .profile-card__note {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.55;
  }

  .profile-card__actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .profile-card__action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-3, var(--surface-2));
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .profile-card__action-btn:hover {
    background: var(--surface-hover);
  }

  .profile-card__action-btn--primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .profile-card__action-btn--primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, black 15%);
  }

  .profile-card__action-btn--danger {
    color: var(--red);
    border-color: color-mix(in srgb, var(--red) 40%, transparent);
  }

  .profile-card__action-btn--danger:hover {
    background: color-mix(in srgb, var(--red) 12%, transparent);
  }

  .profile-card__action-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .profile-card__mutual-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profile-card__tabs {
    position: relative;
    display: flex;
    margin-bottom: 10px;
    padding: 2px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }

  .profile-card__tabs::before {
    content: "";
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / 2);
    border-radius: 7px;
    background: var(--segment-pill);
    box-shadow: 0 1px 2px rgba(0, 0, 0, .22), inset 0 0 0 .5px var(--line-strong);
    transition: transform var(--dur-slow) var(--ease-out);
  }

  .profile-card__tabs[data-active="rooms"]::before {
    transform: translateX(100%);
  }

  .profile-card__tab {
    position: relative;
    z-index: 1;
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .profile-card__tab:hover {
    color: var(--text);
  }

  .profile-card__tab.is-active {
    color: var(--text);
    font-weight: 600;
  }

  .profile-card__tab-count {
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .profile-card__mutual-room-media--round,
  .profile-card__mutual-room-fallback--round {
    border-radius: 50%;
  }

  .profile-card__list-empty {
    list-style: none;
    padding: 12px 4px;
    font-size: 13px;
    color: var(--muted);
  }

  .profile-card__mutual-room {
    cursor: pointer;
  }

  .profile-card__joined {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .profile-card__joined svg {
    flex: none;
    opacity: 0.8;
  }

  .profile-card__joined span {
    min-width: 0;
  }

  .profile-card__description.markdown :deep(blockquote) {
    margin: 8px 0;
    padding: 4px 0 4px 12px;
    border-left: 4px solid color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--muted);
  }

  .profile-card__description.markdown :deep(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .profile-card__description.markdown :deep(a:hover) {
    text-decoration: underline;
  }

  .profile-card__description.markdown :deep(strong) {
    font-weight: 800;
  }

  .profile-card__description.markdown :deep(em) {
    font-style: italic;
  }

  :root[data-theme="light"] .profile-card {
    background: rgba(12, 22, 34, 0.22);
  }
}

@media (max-width: 820px) {
  .profile-card__platforms {
    margin-left: 6px;
    vertical-align: middle;
  }

  .profile-card__platforms .platforms__badge {
    min-width: 26px;
    height: 22px;
    color: var(--text);
  }

  .profile-card {
    position: fixed;
    inset: 0;
    z-index: 85;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0, 0, 0, 0.62);
  }

  .profile-card__panel {
    position: relative;
    width: min(900px, calc(100vw - 32px));
    max-height: calc(var(--app-viewport-height) - 36px);
    overflow-y: auto;
    overflow-x: hidden;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--line-strong);
  }

  .profile-card__banner {
    width: 100%;
    aspect-ratio: 21 / 9;
    border-radius: 12px;
    overflow: hidden;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent), rgba(63, 207, 111, 0.12)),
      var(--surface-2);
  }

  .profile-card__handle {
    display: none;
  }

  .profile-card__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }

  .profile-card__left {
    position: relative;
    min-width: 0;
    padding: 20px 16px 20px 20px;
    border-right: 1px solid var(--line);
  }

  .profile-card__left-box {
    padding: 24px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .profile-card__left:only-child {
    grid-column: 1 / -1;
    border-right: 0;
  }

  .profile-card__avatar {
    position: relative;
    left: 16px;
    margin: -60px 0 0 0;
    width: 116px;
    height: 116px;
    border: 6px solid var(--surface);
    border-radius: 50%;
    font-size: 36px;
  }

  .profile-card__avatar.profile-card__avatar--image {
    overflow: visible;
  }

  .profile-card__avatar-clip {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
  }

  .profile-card__avatar-clip img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .profile-card__identity {
    min-width: 0;
    margin-top: 6px;
    text-align: left;
  }

  .profile-card__name-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
  }

  .profile-card__identity strong,
  .profile-card__identity small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-card__name-row strong {
    min-width: 0;
  }

  .profile-card__badges {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 0 auto;
  }

  .profile-card__badge {
    --badge-size: 24px;
    position: relative;
    display: inline-grid;
    place-items: center;
    width: var(--badge-size);
    height: var(--badge-size);
    cursor: default;
    overflow: visible;
    outline: none;
  }

  .profile-card__badge svg {
    display: block;
  }

  .profile-card__badge>svg,
  .profile-card__badge>img {
    position: relative;
    z-index: 22;
    transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .profile-card__badge::after {
    content: attr(data-title);
    position: absolute;
    bottom: calc(100% + 7px);
    left: 50%;
    z-index: 40;
    padding: 3px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 11.5px;
    font-weight: 400;
    line-height: 1.4;
    white-space: nowrap;
    opacity: 0;
    transform: translateX(-50%) translateY(3px);
    pointer-events: none;
    transition: opacity 110ms ease-out, transform 180ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .profile-card__badge:hover>svg,
  .profile-card__badge:hover>img,
  .profile-card__badge:focus-visible>svg,
  .profile-card__badge:focus-visible>img {
    transform: scale(1.1);
  }

  .profile-card__badge:hover::after,
  .profile-card__badge:focus-visible::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
    transition-delay: 420ms;
  }

  .profile-card__identity strong {
    font-size: 28px;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: 0;
  }

  .profile-card__identity small {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
  }

  .profile-card__section-title {
    margin: 20px 0 10px;
    color: var(--text);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0;
  }

  .profile-card__section {
    margin-top: 0;
    padding-left: 16px;
    border-left: 5px solid color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .profile-card__section h4 {
    margin: 0 0 10px;
    color: var(--text);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0;
  }

  .profile-card__description,
  .profile-card__empty {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .profile-card__empty {
    color: var(--muted);
  }

  .profile-card__mutual-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .profile-card__mutual-room {
    width: 100%;
    min-width: 0;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--text);
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    text-align: left;
  }

  .profile-card__mutual-room:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .profile-card__mutual-room-media,
  .profile-card__mutual-room-fallback {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    overflow: hidden;
    display: grid;
    place-items: center;
    flex: none;
  }

  .profile-card__mutual-room-media {
    background: var(--surface-3, var(--surface-2));
  }

  .profile-card__mutual-room-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile-card__mutual-room-fallback {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface-2));
    color: var(--text);
    font-weight: 800;
  }

  .profile-card__mutual-room-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 700;
  }

  .profile-card__mutual {
    min-width: 0;
    padding: 28px 28px 32px;
  }

  .profile-card__mutual-title {
    margin: 0 0 14px;
    color: var(--text);
    font-size: 13px;
    font-weight: 800;
  }

  .profile-card__note {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.55;
  }

  .profile-card__actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .profile-card__action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-3, var(--surface-2));
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .profile-card__action-btn:hover {
    background: var(--surface-hover);
  }

  .profile-card__action-btn--primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .profile-card__action-btn--primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, black 15%);
  }

  .profile-card__action-btn--danger {
    color: var(--red);
    border-color: color-mix(in srgb, var(--red) 40%, transparent);
  }

  .profile-card__action-btn--danger:hover {
    background: color-mix(in srgb, var(--red) 12%, transparent);
  }

  .profile-card__action-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .profile-card__mutual-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profile-card__tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 14px;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .profile-card__tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }

  .profile-card__tab:hover {
    color: var(--text);
  }

  .profile-card__tab.is-active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .profile-card__tab-count {
    min-width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    padding: 0 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 800;
  }

  .profile-card__mutual-room-media--round,
  .profile-card__mutual-room-fallback--round {
    border-radius: 50%;
  }

  .profile-card__list-empty {
    list-style: none;
    padding: 12px 4px;
    font-size: 13px;
    color: var(--muted);
  }

  .profile-card__mutual-room {
    cursor: pointer;
  }

  .profile-card__joined {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .profile-card__joined svg {
    flex: none;
    opacity: 0.8;
  }

  .profile-card__joined span {
    min-width: 0;
  }

  .profile-card__description.markdown :deep(blockquote) {
    margin: 8px 0;
    padding: 4px 0 4px 12px;
    border-left: 4px solid color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--muted);
  }

  .profile-card__description.markdown :deep(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .profile-card__description.markdown :deep(a:hover) {
    text-decoration: underline;
  }

  .profile-card__description.markdown :deep(strong) {
    font-weight: 800;
  }

  .profile-card__description.markdown :deep(em) {
    font-style: italic;
  }

  :root[data-theme="light"] .profile-card {
    background: rgba(12, 22, 34, 0.22);
  }

  .profile-card__badge::after {
    display: none;
  }

  .profile-card__badge:hover>svg,
  .profile-card__badge:hover>img,
  .profile-card__badge:focus-visible>svg,
  .profile-card__badge:focus-visible>img {
    transform: none;
  }

  .profile-card__presence {
    position: absolute;
    right: 6px;
    bottom: 6px;
  }

  @media (max-width: 640px) {
    .profile-card {
      align-items: end;
      padding: 0;
    }

    .profile-card__panel {
      width: 100%;
      max-height: calc(var(--app-viewport-height) - 18px);
      border-radius: 16px 16px 0 0;
      border: 0;
      overflow: hidden;
      animation: profile-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    }

    .profile-card__handle {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 5;
      display: flex;
      justify-content: center;
      padding: 12px 0 2px;
      pointer-events: none;
    }

    .profile-card__handle::after {
      content: "";
      display: block;
      width: 40px;
      height: 5px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--muted) 48%, transparent);
    }

    .profile-card__body {
      grid-template-columns: minmax(0, 1fr);
    }

    .profile-card__left {
      padding: 0;
      border-right: 0;
    }

    .profile-card__left-box {
      padding: 0 0 24px;
      border-radius: 0;
      background: none;
      border: 0;
    }

    .profile-card__banner {
      border-radius: 0;
      border: 0;
      box-shadow: none;
    }

    .profile-card__avatar {
      margin-left: 18px;
    }

    .profile-card__identity,
    .profile-card__section,
    .profile-card__section-title {
      padding-left: 18px;
      padding-right: 18px;
    }

    .profile-card__section {
      margin-top: 0;
      border-left: 0;
      padding-left: 18px;
    }

    .profile-card__section-title {
      margin-top: 24px;
      margin-bottom: 10px;
      padding-left: 18px;
      padding-right: 18px;
    }

    .profile-card__joined {
      padding-left: 18px;
      padding-right: 18px;
    }

    .profile-card__mutual {
      display: none;
    }

    .profile-card__avatar {
      margin: -52px 0 0 0;
      width: 104px;
      height: 104px;
      font-size: 32px;
    }

    .profile-card__identity strong {
      font-size: 24px;
    }

    .profile-card__mutual-room {
      grid-template-columns: 36px minmax(0, 1fr);
      gap: 10px;
    }

    .profile-card__mutual-room-media,
    .profile-card__mutual-room-fallback {
      width: 36px;
      height: 36px;
    }

    .profile-card__presence {
        right: 5px;
        bottom: 5px;
      }
  }
}

@media (prefers-reduced-motion: reduce) {
  .profile-card__badge>svg,
  .profile-card__badge>img,
  .profile-card__badge::after {
    transition-duration: .01ms;
  }

  .profile-card__badge>svg,
  .profile-card__badge>img,
  .profile-card__badge::after {
    transition-duration: .01ms;
  }
}

.profile-card__thought {
  position: absolute;
  left: calc(100% + 16px);
  top: 4px;
  z-index: 3;
  width: max-content;
  max-width: min(220px, 52vw);
  padding: 8px 12px;
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--line-strong);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  animation: thought-pop var(--dur-slow) var(--ease-spring) both;
  transform-origin: left bottom;
}

.profile-card__thought::before,
.profile-card__thought::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line-strong);
}

.profile-card__thought::before {
  left: -8px;
  bottom: 2px;
  width: 11px;
  height: 11px;
}

.profile-card__thought::after {
  left: -16px;
  bottom: -5px;
  width: 6px;
  height: 6px;
}

@keyframes thought-pop {
  from { opacity: 0; transform: scale(.7); }
}

@media (max-width: 820px) {
  .profile-card__links {
    padding: 0 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .profile-card__thought {
    animation: none;
  }
}

.profile-card__links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.profile-card__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.profile-card__link:hover {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}

.profile-card__link svg {
  width: 13px;
  height: 13px;
  flex: none;
}

.profile-card__link span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
