<script setup lang="ts">
import { initialsOf } from "@/utils/initials";
import Icon from "@/components/Icon.vue";
import type { Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import ProfileCard from "@/components/ProfileCard.vue";
import { currentWindowZoom } from "@/utils/windowZoom";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true },
});

const now = ref(Date.now());
const fullscreenTileId = ref("");
const selectedProfile = ref("");
const isMobile = ref(false);
const mobileExpanded = ref(false);
const mobileActiveIndex = ref(0);
const memberMenu = ref({ open: false, x: 0, y: 0, username: "" });
const shareSettingsOpen = ref(false);
const cursorIdle = ref(false);
const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
const isAndroidRuntime =
  typeof navigator !== "undefined" &&
  /Android/i.test(navigator.userAgent) &&
  isTauri;
const showNativeTitlebar = isTauri && !isAndroidRuntime;
/** What the browser reports about one participant's streams. */
type CallMedia = { audio?: boolean; camera?: boolean; screen?: boolean };

/** One cell of the call grid, exactly as `callTiles` builds it. */
interface CallTile {
  id: string;
  username: string;
  kind: string;
  video: boolean;
  self: boolean;
  media: CallMedia;
  trackIndex: number;
}

let tickId: ReturnType<typeof setInterval> | null = null;
let panelWindow: Window | null = null;
let panelWindowSyncId: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// In fullscreen, hide the tile chrome after a short period of no real mouse
// movement; bring it back as soon as the cursor actually moves again. This
// avoids the aggressive `:hover` pop-in when the cursor merely rests over the
// tile.
function wakeCursor() {
  cursorIdle.value = false;
  if (idleTimer) clearTimeout(idleTimer);
  if (fullscreenTileId.value) {
    idleTimer = setTimeout(() => {
      cursorIdle.value = true;
    }, 1200);
  }
}

function handleFullscreenChange(next: string) {
  if (idleTimer) clearTimeout(idleTimer);
  cursorIdle.value = false;
  if (next) {
    wakeCursor();
  }
}

function syncMobile() {
  isMobile.value = window.matchMedia("(max-width: 760px)").matches;
}

function clampMenuPosition(x: number, y: number) {
  // Input coords and window size are visual (unzoomed) pixels; the menu's
  // fixed position and its authored size live in zoomed CSS pixels.
  const zoom = currentWindowZoom();
  const width = 224;
  const height = 176;
  const margin = 12;
  const maxX = Math.max(margin, window.innerWidth / zoom - width - margin);
  const maxY = Math.max(margin, window.innerHeight / zoom - height - margin);
  return {
    x: Math.min(Math.max(margin, x / zoom), maxX),
    y: Math.min(Math.max(margin, y / zoom), maxY),
  };
}

function openMobileCall() {
  mobileExpanded.value = true;
  mobileActiveIndex.value = 0;
  fullscreenTileId.value = "";
}
function closeMobileCall() {
  mobileExpanded.value = false;
  fullscreenTileId.value = "";
}

function toggleTileFullscreen(tile: CallTile) {
  if (fullscreenTileId.value === tile.id) {
    fullscreenTileId.value = "";
  } else {
    fullscreenTileId.value = tile.id;
  }
}

function onMobileStageScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (!el) return;
  const idx = Math.round(el.scrollLeft / el.clientWidth);
  if (idx >= 0 && idx < callTiles.value.length) {
    mobileActiveIndex.value = idx;
  }
}

let stageDragStartX = 0;
let stageDragScrollStart = 0;
let stageDragging = false;

function onStageMouseDown(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  stageDragStartX = e.clientX;
  stageDragScrollStart = el.scrollLeft;
  stageDragging = true;
  el.style.cursor = "grabbing";
}

function onStageMouseMove(e: MouseEvent) {
  if (!stageDragging) return;
  const el = e.currentTarget as HTMLElement;
  // scrollLeft is in zoomed CSS pixels while the pointer delta is in visual
  // pixels: convert so the stage follows the cursor 1:1 at any window scale.
  const dx = (stageDragStartX - e.clientX) / currentWindowZoom();
  el.scrollLeft = stageDragScrollStart + dx;
}

function onStageMouseUp(e: MouseEvent) {
  if (!stageDragging) return;
  stageDragging = false;
  const el = e.currentTarget as HTMLElement;
  el.style.cursor = "";
}

onMounted(() => {
  syncMobile();
  window.addEventListener("resize", syncMobile, { passive: true });
  window.addEventListener("click", closeMemberMenu, { passive: true });
  window.addEventListener("click", closeShareSettings, { passive: true });
  window.addEventListener("contextmenu", closeMemberMenu, { passive: true });
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener("mousemove", wakeCursor, { passive: true });
  window.addEventListener("mousedown", wakeCursor, { passive: true });
  window.addEventListener("wheel", wakeCursor, { passive: true });
  window.addEventListener("touchstart", wakeCursor, { passive: true });
  window.addEventListener("keydown", wakeCursor, { passive: true });
  tickId = setInterval(() => {
    now.value = Date.now();
  }, 500);
});

watch(fullscreenTileId, (next) => {
  handleFullscreenChange(next);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncMobile);
  window.removeEventListener("click", closeMemberMenu);
  window.removeEventListener("click", closeShareSettings);
  window.removeEventListener("contextmenu", closeMemberMenu);
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener("mousemove", wakeCursor);
  window.removeEventListener("mousedown", wakeCursor);
  window.removeEventListener("wheel", wakeCursor);
  window.removeEventListener("touchstart", wakeCursor);
  window.removeEventListener("keydown", wakeCursor);
  if (tickId) clearInterval(tickId);
  if (panelWindowSyncId) clearInterval(panelWindowSyncId);
  if (idleTimer) clearTimeout(idleTimer);
});

const callRoom = computed(() => props.messenger.state.callRoom);
const screenShareTitle = computed(() =>
  props.messenger.state.callScreenEnabled
    ? t("call.stopScreen")
    : props.messenger.screenShareUnavailableReason.value ||
      t("call.shareScreen"),
);

const members = computed(() => {
  const roomId = callRoom.value;
  if (!roomId) return [];
  const list = props.messenger.state.voiceMembersByRoom[roomId] || [];
  const me = props.messenger.state.username;
  const sorted = [...list].sort((a, b) => {
    if (a === me) return -1;
    if (b === me) return 1;
    return a.localeCompare(b);
  });
  return sorted;
});

const remoteMembers = computed(() =>
  members.value.filter((username) => !isSelf(username)),
);

const callTiles = computed<CallTile[]>(() => {
  const tiles: CallTile[] = [];
  for (const username of members.value) {
    const self = isSelf(username);
    const media = mediaOf(username);
    const videoKinds: string[] = [];
    if (media.screen) videoKinds.push("screen");
    if (media.camera) videoKinds.push("camera");

    if (videoKinds.length) {
      for (const kind of videoKinds) {
        tiles.push({
          id: `${username}-${kind}`,
          username,
          kind,
          video: true,
          self,
          media,
          trackIndex:
            kind === "screen" && media.camera ? 0 : videoKinds.indexOf(kind),
        });
      }
    } else {
      tiles.push({
        id: `${username}-avatar`,
        username,
        kind: "audio",
        video: false,
        self,
        media,
        trackIndex: 0,
      });
    }
  }
  return tiles;
});

const callGridClass = computed(() => {
  const count = callTiles.value.length;
  if (count <= 1) return "callpanel__stage--solo";
  if (count === 2) return "callpanel__stage--duo";
  if (count <= 4) return "callpanel__stage--grid";
  return "callpanel__stage--many";
});

const speakingSet = computed(() => {
  const roomId = callRoom.value;
  const table = props.messenger.state.speakingByRoom[roomId] || {};
  const cutoff = now.value - 600;
  return new Set(Object.keys(table).filter((u) => table[u] >= cutoff));
});

const activeMemberMenuVolume = computed(() =>
  volumeOf(memberMenu.value.username),
);


function avatarSrcOf(username: string) {
  return (
    props.messenger.profileImageSrc?.(
      props.messenger.profileFor?.(username)?.avatar,
      "avatar",
    ) || ""
  );
}

function isSelf(username: string) {
  return (
    String(username || "") === String(props.messenger.state.username || "")
  );
}

function isLocallyMuted(username: string) {
  return !isSelf(username) && volumeOf(username) <= 0;
}

function isSpeaking(username: string) {
  return speakingSet.value.has(username);
}

function volumeOf(username: string) {
  return props.messenger.callUserVolume(username);
}

function inputValue(event: Event) {
  return (event.target as HTMLInputElement | null)?.value ?? "";
}

function mediaOf(username: string): CallMedia {
  if (isSelf(username)) return props.messenger.state.localCallMedia || {};
  return props.messenger.state.remoteCallMediaByUser[username] || {};
}

function isRemotelyMuted(username: string) {
  if (isSelf(username)) return false;
  const media = mediaOf(username);
  return media.audio === false;
}

function isDeafened(username: string) {
  if (isSelf(username)) return Boolean(props.messenger.state.callDeafened);
  return Boolean(props.messenger.state.deafenedByUser[username]);
}

function applyDeafenToAudio() {
  const els = document.querySelectorAll<HTMLAudioElement>(
    ".callpanel__audio audio",
  );
  for (const el of els) el.muted = Boolean(props.messenger.state.callDeafened);
}

watch(
  () => props.messenger.state.callDeafened,
  () => applyDeafenToAudio(),
);

watch(
  () => props.messenger.state.screenStream,
  (stream) => {
    if (!stream) return;
    const els = document.querySelectorAll<HTMLVideoElement>(
      ".callpanel .calltile.is-self.is-screen video",
    );
    for (const el of els) {
      if (el.srcObject !== stream) el.srcObject = stream;
    }
  },
);

function tileLabel(tile: CallTile) {
  if (tile.kind === "screen") return t("call.screen");
  if (tile.kind === "camera") return t("call.camera");
  return t("call.voice");
}

function escapePopupHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function videoStreamForTile(tile: CallTile) {
  if (!tile?.video) return null;
  if (tile.self) return props.messenger.localPreviewStream(tile.kind);
  const stream = props.messenger.remoteVideoStream(tile.username);
  const tracks = (stream?.getVideoTracks?.() || []).filter(
    (track) => track.readyState === "live" && !track.muted,
  );
  const track = tracks[tile.trackIndex] || tracks[0];
  return track ? new MediaStream([track]) : null;
}

function bindLocalPreview(el: HTMLVideoElement | null, kind: string) {
  if (!el) return;
  const stream = props.messenger.localPreviewStream(kind);
  if (el.srcObject !== stream) el.srcObject = stream;
}

function bindRemoteVideo(el: HTMLVideoElement | null, username: string, trackIndex = 0) {
  if (!el) return;
  const stream = props.messenger.remoteVideoStream(username);
  const tracks = (stream?.getVideoTracks?.() || []).filter(
    (track) => track.readyState === "live" && !track.muted,
  );
  const track = tracks[trackIndex] || tracks[0];
  if (!track) {
    el.srcObject = null;
    return;
  }
  const attached = el.srcObject instanceof MediaStream ? el.srcObject : null;
  const existingTrack = attached?.getVideoTracks()[0];
  if (existingTrack?.id !== track.id) el.srcObject = new MediaStream([track]);
}

function openProfile(username: string) {
  selectedProfile.value = String(username || "").trim();
  closeMemberMenu();
}

function closeProfile() {
  selectedProfile.value = "";
}

function openTileWindow(tile: CallTile) {
  if (!tile?.video) return;

  // On Tauri Desktop, window.open() creates a cross-origin WebviewWindow that
  // cannot access this window's MediaStream, so the extracted preview stays blank.
  // Fall back to the in-app fullscreen tile view.
  const isTauri =
    typeof window !== "undefined" &&
    ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ || (window as unknown as Record<string, unknown>).__TAURI__);
  if (isTauri) {
    toggleTileFullscreen(tile);
    return;
  }

  const stream = videoStreamForTile(tile);
  const child = window.open(
    "",
    `qxp-tile-${tile.id}`,
    "popup=yes,width=960,height=640",
  );
  if (!child) return;
  const safeTitle = `${escapePopupHtml(tile.username)} - ${escapePopupHtml(tileLabel(tile))}`;
  child.document.write(
    `<!doctype html><html><head><title>${safeTitle}</title><style>html,body{margin:0;width:100%;height:100%;background:#020305;color:#fff;font-family:system-ui,sans-serif}body{display:flex;flex-direction:column}.bar{height:42px;display:flex;align-items:center;padding:0 14px;background:#090b10;border-bottom:1px solid rgba(255,255,255,.12);font-weight:700}video{width:100%;height:calc(100% - 43px);object-fit:${tile.kind === "screen" ? "contain" : "cover"};background:#000}</style></head><body><div class="bar">${safeTitle}</div><video autoplay playsinline ${tile.self ? "muted" : ""}></video></body></html>`,
  );
  child.document.close();
  const video = child.document.querySelector("video");
  if (video) {
    video.srcObject = stream;
    video.play?.().catch?.(() => {});
  }
}

function syncPanelWindow() {
  if (!panelWindow || panelWindow.closed) return;
  const doc = panelWindow.document;
  const mount = doc.getElementById("tiles");
  if (!mount) return;
  mount.innerHTML = "";
  for (const tile of callTiles.value) {
    const card = doc.createElement("article");
    card.className = `tile ${tile.kind === "screen" ? "screen" : ""}`;
    const label = doc.createElement("div");
    label.className = "label";
    label.textContent = `${tile.username} · ${tileLabel(tile)}`;
    card.appendChild(label);
    if (tile.video) {
      const video = doc.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = tile.self;
      video.srcObject = videoStreamForTile(tile);
      video.play?.().catch?.(() => {});
      card.appendChild(video);
    } else {
      const empty = doc.createElement("div");
      empty.className = "empty";
      const avatarSrc = avatarSrcOf(tile.username);
      if (avatarSrc) {
        const img = doc.createElement("img");
        img.src = avatarSrc;
        img.alt = `${tile.username} avatar`;
        empty.appendChild(img);
      } else {
        empty.textContent = initialsOf(tile.username);
      }
      card.appendChild(empty);
    }
    mount.appendChild(card);
  }
}

function openPanelWindow() {
  panelWindow = window.open(
    "",
    "qxp-voice-panel",
    "popup=yes,width=1180,height=760",
  );
  if (!panelWindow) return;
  panelWindow.document.write(
    `<!doctype html><html><head><title>QxChat Call Panel</title><style>html,body{margin:0;min-height:100%;background:#111318;color:#f4f4f5;font-family:system-ui,sans-serif}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;padding:10px}.tile{position:relative;min-height:220px;border-radius:10px;overflow:hidden;background:#1d2129;border:1px solid rgba(255,255,255,.08)}video{width:100%;height:100%;display:block;object-fit:cover;background:#000}.screen video{object-fit:contain}.label{position:absolute;z-index:2;left:8px;bottom:8px;padding:6px 8px;border-radius:6px;background:rgba(10,12,16,.64);font-weight:700}.empty{height:100%;display:grid;place-items:center;font-size:42px;font-weight:800}.empty img{width:96px;height:96px;border-radius:50%;object-fit:cover}</style></head><body><main id="tiles" class="grid"></main></body></html>`,
  );
  panelWindow.document.close();
  syncPanelWindow();
  if (panelWindowSyncId) clearInterval(panelWindowSyncId);
  panelWindowSyncId = setInterval(syncPanelWindow, 1000);
}

function bindRemoteAudio(el: HTMLAudioElement | null, username: string) {
  if (!el) return;
  const stream = props.messenger.remoteCallStream(username);
  if (el.srcObject !== stream) el.srcObject = stream;
  el.volume = Math.max(0, Math.min(1, volumeOf(username) / 100));
  el.muted = Boolean(props.messenger.state.callDeafened);
  props.messenger.applyAudioOutput(el);
  el.play?.().catch?.(() => {});
}

function openMemberMenu(event: MouseEvent, username: string) {
  if (isSelf(username)) return;
  event.preventDefault();
  event.stopPropagation();
  const position = clampMenuPosition(event.clientX + 6, event.clientY + 6);
  memberMenu.value = {
    open: true,
    x: position.x,
    y: position.y,
    username,
  };
}

function closeMemberMenu() {
  if (!memberMenu.value.open) return;
  memberMenu.value = { open: false, x: 0, y: 0, username: "" };
}

function closeShareSettings() {
  shareSettingsOpen.value = false;
}

async function changeSourceAndClose() {
  shareSettingsOpen.value = false;
  await props.messenger.changeScreenShareSource();
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeMemberMenu();
    closeShareSettings();
    closeProfile();
  }
}

function setMemberVolume(username: string, value: number) {
  props.messenger.setCallUserVolume(username, value);
}

function toggleLocalMute(username: string) {
  const next = isLocallyMuted(username) ? 100 : 0;
  props.messenger.setCallUserVolume(username, next);
}
</script>

<template>
  <section
    class="callpanel"
    v-if="
      messenger.state.inCall &&
      messenger.state.callRoom === messenger.state.activeRoom
    "
  >
    <header class="callpanel__head">
      <div
        v-if="isMobile"
        class="callpanel__mobile-strip"
        @click="openMobileCall"
      >
        <span
          v-for="(tile, idx) in callTiles.slice(0, 3)"
          :key="tile.id"
          class="callpanel__mobile-avatar"
          :class="{ 'is-self': tile.self }"
          :style="{ zIndex: 3 - idx }"
        >
          <img
            v-if="avatarSrcOf(tile.username)"
            :src="avatarSrcOf(tile.username)"
            :alt="tile.username"
          />
          <span
            v-else
            class="avatar"
            :class="`avatar--${messenger.accentFor(tile.username)}`"
            >{{ initialsOf(tile.username) }}</span
          >
        </span>
        <span v-if="callTiles.length > 3" class="callpanel__mobile-overflow"
          >+{{ callTiles.length - 3 }}</span
        >
        <span v-else class="callpanel__mobile-count">{{
          callTiles.length
        }}</span>
      </div>
      <div class="callpanel__actions">
        <button
          class="icon-btn"
          :class="{ 'icon-btn--danger': messenger.state.callMuted }"
          type="button"
          :aria-label="
            messenger.state.callMuted ? t('call.unmute') : t('call.mute')
          "
          @click="messenger.toggleMute"
        >
          <Icon name="mic"
            v-if="!messenger.state.callMuted"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
          <Icon name="mic-off"
            v-else
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
        </button>
        <button
          class="icon-btn"
          :class="{ 'icon-btn--danger': messenger.state.callDeafened }"
          type="button"
          :aria-label="
            messenger.state.callDeafened ? t('call.undeafen') : t('call.deafen')
          "
          :title="
            messenger.state.callDeafened ? t('call.undeafen') : t('call.deafen')
          "
          @click="messenger.toggleDeafen"
        >
          <Icon name="headphones"
            v-if="!messenger.state.callDeafened"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
          <Icon name="headphones-off"
            v-else
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
        </button>
        <button
          class="icon-btn"
          :class="{ 'icon-btn--active': messenger.state.callCameraEnabled }"
          type="button"
          :aria-label="
            messenger.state.callCameraEnabled
              ? t('call.stopCamera')
              : t('call.startCamera')
          "
          @click="messenger.toggleCamera"
        >
          <Icon name="video"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
        </button>
        <div v-if="!isMobile" class="screen-share">
          <button
            class="icon-btn screen-share__main"
            :class="{
              'icon-btn--active': messenger.state.callScreenEnabled,
              'screen-share__main--split': messenger.state.callScreenEnabled,
            }"
            type="button"
            :aria-label="
              messenger.state.callScreenEnabled
                ? t('call.stopScreen')
                : t('call.shareScreen')
            "
            :title="screenShareTitle"
            @click="messenger.toggleScreenShare"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="m9 10 3-3 3 3" />
              <path d="M12 7v7" />
            </svg>
          </button>
          <button
            v-if="messenger.state.callScreenEnabled"
            class="icon-btn screen-share__chevron"
            :class="{ 'icon-btn--active': shareSettingsOpen }"
            type="button"
            :aria-label="t('call.screenSettings')"
            :title="t('call.screenSettings')"
            @click.stop="shareSettingsOpen = !shareSettingsOpen"
          >
            <Icon name="chevron-down"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              :class="{ 'screen-share__chevron-flip': shareSettingsOpen }"
             />
          </button>

          <Transition name="qx-menu">
            <div
              v-if="shareSettingsOpen"
              class="screen-share__menu"
              @click.stop
            >
              <button
                class="screen-share__source"
                type="button"
                @click="changeSourceAndClose"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
                  <path d="M3 21v-5h5" />
                  <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                {{ t("call.changeScreenSource") }}
              </button>
              <div class="screen-share__divider"></div>
              <span class="share-settings__label">{{ t("call.screenFps") }}</span>
              <div class="share-settings__segmented">
                <button
                  v-for="fps in messenger.screenShareFpsOptions"
                  :key="fps"
                  type="button"
                  :class="{ 'is-active': messenger.state.screenShareFps === fps }"
                  @click="messenger.setScreenShareFps(fps)"
                >
                  {{ fps }}
                </button>
              </div>
              <span class="share-settings__label">{{ t("call.screenQuality") }}</span>
              <div class="share-settings__segmented">
                <button
                  v-for="quality in messenger.screenShareQualities"
                  :key="quality.id"
                  type="button"
                  :class="{
                    'is-active':
                      messenger.state.screenShareQuality === quality.id,
                  }"
                  @click="messenger.setScreenShareQuality(quality.id)"
                >
                  {{ quality.id }}
                </button>
              </div>
            </div>
          </Transition>
        </div>
        <button
          v-if="!isMobile && !isTauri"
          class="icon-btn"
          type="button"
          :aria-label="t('call.extractPanel')"
          :title="t('call.extractPanel')"
          @click="openPanelWindow"
        >
          <Icon name="external-link"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
        </button>
        <button
          class="icon-btn icon-btn--danger"
          type="button"
          :aria-label="t('call.endCall')"
          @click="messenger.endCall"
        >
          <Icon name="phone-hangup"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
           />
        </button>
      </div>
    </header>

    <div class="callpanel__stage" :class="callGridClass">
      <div
        v-for="tile in callTiles"
        :key="tile.id"
        class="calltile"
        :class="{
          'is-self': tile.self,
          'is-muted': tile.self && messenger.state.callMuted,
          'has-video': tile.video,
          'is-screen': tile.kind === 'screen',
          'is-fullscreen': fullscreenTileId === tile.id,
          'is-cursor-idle': fullscreenTileId === tile.id && cursorIdle,
          'is-local-muted': isLocallyMuted(tile.username),
          'is-remote-muted': isRemotelyMuted(tile.username),
          'is-speaking': isSpeaking(tile.username),
        }"
        role="button"
        tabindex="0"
        :aria-label="t('members.openProfile', { username: tile.username })"
        @click="isMobile ? openMobileCall() : openProfile(tile.username)"
        @contextmenu="openMemberMenu($event, tile.username)"
        @keydown.enter.prevent="openProfile(tile.username)"
        @keydown.space.prevent="openProfile(tile.username)"
      >
        <div v-if="tile.video" class="calltile__video">
          <video
            v-if="tile.self"
            :ref="(el) => bindLocalPreview(el, tile.kind)"
            autoplay
            muted
            playsinline
          ></video>
          <video
            v-else
            :ref="(el) => bindRemoteVideo(el, tile.username, tile.trackIndex)"
            autoplay
            playsinline
          ></video>
        </div>
        <div v-else class="calltile__empty">
          <span
            class="calltile__avatar"
            :class="
              avatarSrcOf(tile.username)
                ? 'calltile__avatar--image'
                : `avatar--${messenger.accentFor(tile.username)}`
            "
          >
            <img
              v-if="avatarSrcOf(tile.username)"
              :src="avatarSrcOf(tile.username)"
              :alt="t('message.avatarOf', { name: tile.username })"
            />
            <template v-else>{{ initialsOf(tile.username) }}</template>
          </span>
        </div>
        <div v-if="tile.video" class="calltile__tools">
          <button
            v-if="!isMobile"
            type="button"
            :title="t('call.fullscreen')"
            :aria-label="t('call.fullscreen')"
            @click.stop="toggleTileFullscreen(tile)"
          >
            <svg viewBox="0 0 24 24">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M16 3h3a2 2 0 0 1 2 2v3" />
              <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
          <button
            v-if="!isMobile && !isTauri"
            type="button"
            :title="t('call.extractView')"
            :aria-label="t('call.extractView')"
            @click.stop="openTileWindow(tile)"
          >
            <Icon name="external-link" viewBox="0 0 24 24" />
          </button>
        </div>
        <div class="calltile__overlay">
          <span class="calltile__name">
            {{ tile.username
            }}<span v-if="tile.self" class="calltile__you">
              {{ t("call.you") }}</span
            >
          </span>
          <span
            v-if="!tile.self && isRemotelyMuted(tile.username)"
            class="calltile__muted-badge calltile__muted-badge--remote"
            :aria-label="t('call.muted')"
          >
            <Icon name="mic-off"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </span>
          <span
            v-if="isDeafened(tile.username)"
            class="calltile__muted-badge calltile__muted-badge--deafen"
            :aria-label="t('call.deafened')"
            :title="t('call.deafened')"
          >
            <Icon name="headphones-off"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </span>
          <span
            v-if="!tile.self && isLocallyMuted(tile.username)"
            class="calltile__muted-badge"
            :aria-label="t('call.localMute')"
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              <line x1="16" y1="8" x2="22" y2="14" />
              <line x1="22" y1="8" x2="16" y2="14" />
            </svg>
          </span>
          <span
            v-if="tile.self && messenger.state.callMuted"
            class="calltile__muted-badge"
            aria-label="muted"
          >
            <Icon name="mic-off"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="qx-pop">
        <div
          v-if="memberMenu.open"
          class="callpanel__menu-layer"
          @click="closeMemberMenu"
        >
          <div
            class="callpanel__context-menu context-menu-base"
            :style="{ left: `${memberMenu.x}px`, top: `${memberMenu.y}px` }"
            @click.stop
            @contextmenu.prevent
          >
            <div class="callpanel__context-head">
              <span class="callpanel__context-user">{{
                memberMenu.username
              }}</span>
            </div>
            <button
              type="button"
              class="callpanel__context-action"
              @click="openProfile(memberMenu.username)"
            >
              <Icon name="person" class="callpanel__context-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              <span>{{ t("members.viewProfile") }}</span>
            </button>
            <button
              type="button"
              class="callpanel__context-action"
              @click="toggleLocalMute(memberMenu.username)"
            >
              <svg v-if="isLocallyMuted(memberMenu.username)" class="callpanel__context-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              <Icon name="volume-off" v-else class="callpanel__context-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              <span>{{
                isLocallyMuted(memberMenu.username)
                  ? t("call.unmuteLocal")
                  : t("call.localMute")
              }}</span>
              <span class="callpanel__context-hint">{{
                isLocallyMuted(memberMenu.username) ? "100%" : "0%"
              }}</span>
            </button>
            <div class="callpanel__context-divider"></div>
            <label class="callpanel__context-volume">
              <span class="callpanel__context-label">
                <svg class="callpanel__context-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                {{ t("call.personalVolume") }}
              </span>
              <div class="callpanel__context-slider-row">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  :value="activeMemberMenuVolume"
                  @input="
                    setMemberVolume(memberMenu.username, inputValue($event))
                  "
                />
                <strong>{{ activeMemberMenuVolume }}%</strong>
              </div>
            </label>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="qx-modal" :duration="{ enter: 340, leave: 220 }">
        <ProfileCard
          v-if="selectedProfile"
          :messenger="messenger"
          :username="selectedProfile"
          @close="closeProfile"
        />
      </Transition>
    </Teleport>
  </section>

  <!-- Mobile: full-screen call overlay -->
  <Teleport to="body">
    <Transition name="qx-fade">
      <div
        v-if="isMobile && mobileExpanded && messenger.state.inCall"
        class="call-mobile-overlay"
        :class="{ 'has-native-titlebar': showNativeTitlebar }"
      >
        <header class="call-mobile-overlay__head">
          <span class="call-mobile-overlay__title">{{
            callTiles.length === 1
              ? t("call.oneParticipant")
              : t("call.nParticipants", { n: String(callTiles.length) })
          }}</span>
          <button
            class="icon-btn"
            type="button"
            :aria-label="t('camera.close')"
            @click="closeMobileCall"
          >
            <Icon name="close" viewBox="0 0 24 24" />
          </button>
        </header>

        <div
          class="call-mobile-overlay__stage"
          @scroll="onMobileStageScroll"
          @mousedown="onStageMouseDown"
          @mousemove="onStageMouseMove"
          @mouseup="onStageMouseUp"
          @mouseleave="onStageMouseUp"
        >
          <div
            v-for="(tile, idx) in callTiles"
            :key="tile.id"
            class="call-mobile-card"
            :class="{
              'is-active': idx === mobileActiveIndex,
              'is-self': tile.self,
              'is-fullscreen': fullscreenTileId === tile.id,
            }"
          >
            <div
              v-if="tile.video"
              class="call-mobile-card__video"
              @click="toggleTileFullscreen(tile)"
            >
              <video
                v-if="tile.self"
                :ref="(el) => bindLocalPreview(el, tile.kind)"
                autoplay
                muted
                playsinline
              ></video>
              <video
                v-else
                :ref="(el) => bindRemoteVideo(el, tile.username, tile.trackIndex)"
                autoplay
                playsinline
              ></video>
            </div>
            <div v-else class="call-mobile-card__empty">
              <span
                class="call-mobile-card__avatar"
                :class="
                  avatarSrcOf(tile.username)
                    ? ''
                    : `avatar--${messenger.accentFor(tile.username)}`
                "
              >
                <img
                  v-if="avatarSrcOf(tile.username)"
                  :src="avatarSrcOf(tile.username)"
                  :alt="tile.username"
                />
                <template v-else>{{ initialsOf(tile.username) }}</template>
              </span>
            </div>
            <div class="call-mobile-card__label">
              <strong>{{ tile.username }}</strong>
              <span v-if="tile.self">{{ t("call.you") }}</span>
              <span
                v-if="isRemotelyMuted(tile.username)"
                class="call-mobile-card__muted-icon"
                :aria-label="t('call.muted')"
              >
                <Icon name="mic-off"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                 />
              </span>
              <span
                v-if="isDeafened(tile.username)"
                class="call-mobile-card__muted-icon"
                :aria-label="t('call.deafened')"
              >
                <Icon name="headphones-off"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                 />
              </span>
              <span v-if="tile.kind === 'screen'">· {{ t("call.screen") }}</span>
              <span v-if="tile.kind === 'camera'">· {{ t("call.camera") }}</span>
            </div>
          </div>
        </div>

        <div class="call-mobile-overlay__dots" v-if="callTiles.length > 1">
          <span
            v-for="(_, idx) in callTiles"
            :key="idx"
            class="call-mobile-overlay__dot"
            :class="{ 'is-active': idx === mobileActiveIndex }"
          ></span>
        </div>

        <footer class="call-mobile-overlay__controls">
          <button
            class="icon-btn"
            :class="{ 'icon-btn--danger': messenger.state.callMuted }"
            type="button"
            :aria-label="messenger.state.callMuted ? t('call.unmute') : t('call.mute')"
            :title="messenger.state.callMuted ? t('call.unmute') : t('call.mute')"
            :aria-pressed="messenger.state.callMuted"
            @click="messenger.toggleMute"
          >
            <Icon name="mic"
              v-if="!messenger.state.callMuted"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
            <Icon name="mic-off"
              v-else
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </button>
          <button
            class="icon-btn"
            :class="{ 'icon-btn--danger': messenger.state.callDeafened }"
            type="button"
            :aria-label="
              messenger.state.callDeafened ? t('call.undeafen') : t('call.deafen')
            "
            @click="messenger.toggleDeafen"
          >
            <Icon name="headphones"
              v-if="!messenger.state.callDeafened"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
            <Icon name="headphones-off"
              v-else
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </button>
          <button
            class="icon-btn"
            :class="{ 'icon-btn--active': messenger.state.callCameraEnabled }"
            type="button"
            :aria-label="messenger.state.callCameraEnabled ? t('call.stopCamera') : t('call.startCamera')"
            :title="messenger.state.callCameraEnabled ? t('call.stopCamera') : t('call.startCamera')"
            :aria-pressed="messenger.state.callCameraEnabled"
            @click="messenger.toggleCamera"
          >
            <Icon name="video"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </button>
          <button
            class="icon-btn icon-btn--danger"
            type="button"
            :aria-label="t('call.endCall')"
            :title="t('call.endCall')"
            @click="
              messenger.endCall();
              closeMobileCall();
            "
          >
            <Icon name="phone-hangup"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
             />
          </button>
        </footer>
      </div>
    </Transition>
  </Teleport>

  <div
    v-if="messenger.state.inCall && remoteMembers.length"
    class="callpanel__audio callpanel__audio--hidden"
    aria-hidden="true"
  >
    <audio
      v-for="u in remoteMembers"
      :key="`hidden-audio-${u}`"
      :ref="(el) => bindRemoteAudio(el, u)"
      :muted="messenger.state.callDeafened"
      autoplay
      playsinline
    ></audio>
  </div>
</template>

<style scoped>
/* Call overlay panel (Discord-style, docked below the thread header) */

.callpanel {
  flex: none;
  padding: 10px 12px 12px;
  background: color-mix(in srgb, var(--surface) 94%, var(--bg) 6%);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: inset 0 -1px 0 var(--line);
}

.callpanel__head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-height: 0;
}

.callpanel__actions {
  display: flex;
  gap: 6px;
  flex: none;
  margin-left: auto;
}

.callpanel__stage {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));
  grid-auto-rows: minmax(130px, 1fr);
  gap: 8px;
  height: clamp(210px, 34vh, 430px);
  min-height: 0;
}

.callpanel__stage--solo {
  grid-template-columns: 1fr;
}

.callpanel__stage--duo {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.callpanel__stage--grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.callpanel__stage--many {
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  grid-auto-rows: minmax(115px, 1fr);
}

.calltile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-2) 88%, var(--bg) 12%);
  font-size: 13px;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.calltile.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 40;
  width: var(--app-viewport-width);
  height: var(--app-viewport-height);
  border-radius: 0;
  border: 0;
  background: var(--bg);
}

.calltile.is-muted {
  opacity: 0.7;
}

.calltile.is-speaking {
  box-shadow: 0 0 0 2px rgb(69, 163, 102);
}

.calltile__avatar {
  width: clamp(58px, 8vw, 96px);
  height: clamp(58px, 8vw, 96px);
  border-radius: 50%;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: clamp(20px, 3vw, 34px);
  font-weight: 800;
  color: #fff;
  flex: none;
}

.calltile__avatar--image {
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
}

.calltile__avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.calltile__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--surface-2) 90%, var(--bg) 10%);
}

.calltile__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #020305;
}

.calltile__video video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.calltile.is-screen .calltile__video video {
  object-fit: contain;
}

.calltile__overlay {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--line-strong) 88%, transparent);
}

.calltile__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.calltile__you {
  color: var(--muted);
  font-weight: 600;
}

.calltile__muted-badge {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--surface) 74%, var(--bg) 26%);
  border: 1px solid color-mix(in srgb, var(--line-strong) 88%, transparent);
  color: var(--red);
  flex: none;
}

.calltile__muted-badge--remote {
  color: #ef4444;
}

.calltile__tools {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: flex;
  gap: 5px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.calltile:hover .calltile__tools,
.calltile:focus-within .calltile__tools,
.calltile.is-focused .calltile__tools {
  opacity: 1;
  transform: translateY(0);
}

.calltile.is-fullscreen .calltile__tools {
  top: calc(30px + 8px);
}

.calltile.is-fullscreen .calltile__overlay {
  opacity: 1;
  transition: opacity var(--dur-base) var(--ease-out);
}

.calltile.is-fullscreen.is-cursor-idle .calltile__overlay {
  opacity: 0;
  pointer-events: none;
}

.calltile__tools button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid color-mix(in srgb, var(--line-strong) 88%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 74%, var(--bg) 26%);
  color: var(--text);
  cursor: pointer;
}

.calltile__tools button:hover {
  background: color-mix(in srgb, var(--surface-hover) 86%, var(--surface) 14%);
  border-color: var(--line-strong);
}

.calltile__tools svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-width: 760px) {
  .callpanel {
    flex: none;
    padding: 8px 10px;
    gap: 0;
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  /* Single row: avatars | controls */
  .callpanel__head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    justify-content: space-between;
  }

  /* Hide the stage — avatars are now in the header */
  .callpanel__stage {
    display: none;
  }

  /* Mobile avatar strip */
  .callpanel__mobile-strip {
    display: flex;
    align-items: center;
    gap: 0;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .callpanel__mobile-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--surface);
    background: var(--surface-2);
    overflow: hidden;
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    flex: none;
    margin-left: -6px;
  }
  .callpanel__mobile-avatar:first-child {
    margin-left: 0;
  }
  .callpanel__mobile-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .callpanel__mobile-avatar .avatar {
    width: 100%;
    height: 100%;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0;
    border-radius: 50%;
  }

  .callpanel__mobile-overflow,
  .callpanel__mobile-count {
    margin-left: 6px;
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    white-space: nowrap;
    flex: none;
  }
  .callpanel__mobile-overflow {
    color: var(--accent);
  }

  /* Controls */
  .callpanel__actions {
    margin-left: auto;
    gap: 6px;
    flex: none;
  }

  .callpanel__actions .icon-btn {
    width: 36px;
    height: 36px;
  }
}

@media (max-width: 760px) {

.callpanel__audio {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 1px;
}

.callpanel__audio--hidden {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

}

.callpanel__menu-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
}

.callpanel__context-menu {
  z-index: 71;
  min-width: 224px;
}

.callpanel__context-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 8px;
}

.callpanel__context-user {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text);
}

.callpanel__context-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  cursor: pointer;
}

.callpanel__context-action > span:not(.callpanel__context-hint) {
  flex: 1;
}

.callpanel__context-icon {
  display: block;
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--muted);
}

.callpanel__context-action:hover .callpanel__context-icon,
.callpanel__context-action:focus-visible .callpanel__context-icon {
  color: currentColor;
}

.callpanel__context-hint {
  font-size: 0.72rem;
  color: var(--muted);
}

.callpanel__context-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--line);
}

.callpanel__context-volume {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 6px;
}

.callpanel__context-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}

.callpanel__context-slider-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.callpanel__context-slider-row input[type="range"] {
  width: 100%;
}

.callpanel__context-slider-row strong {
  min-width: 40px;
  text-align: right;
  font-size: 0.78rem;
  color: var(--text);
}

/* ── Mobile full-screen call overlay ── */
.call-mobile-overlay {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
}

.call-mobile-overlay.has-native-titlebar {
  top: 30px;
}

.call-mobile-overlay__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(12px + var(--app-safe-top)) 16px 12px;
  flex: none;
}
.call-mobile-overlay__title {
  font-size: 16px;
  font-weight: 700;
}
.call-mobile-overlay__head .icon-btn {
  color: var(--text);
}

.call-mobile-overlay__stage {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.call-mobile-overlay__stage::-webkit-scrollbar {
  display: none;
}

.call-mobile-card {
  flex: none;
  width: 100%;
  height: 100%;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}

.call-mobile-card.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 96;
  width: var(--app-viewport-width);
  height: var(--app-viewport-height);
  background: #000;
}

.call-mobile-card.is-fullscreen .call-mobile-card__video {
  height: 100%;
}

.call-mobile-card.is-fullscreen .call-mobile-card__label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

.call-mobile-card__video {
  width: 100%;
  height: calc(100% - 48px);
  position: relative;
  background: #000;
}
.call-mobile-card__video video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.call-mobile-card.is-screen .call-mobile-card__video video {
  object-fit: contain;
}

.call-mobile-card__empty {
  width: 100%;
  height: calc(100% - 48px);
  display: grid;
  place-items: center;
  background: var(--surface-2);
}
.call-mobile-card__avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 44px;
  font-weight: 800;
  color: var(--text);
  overflow: hidden;
}
.call-mobile-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.call-mobile-card__label {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 15px;
  color: var(--muted);
  flex: none;
}
.call-mobile-card__label strong {
  color: var(--text);
  font-weight: 700;
}

.call-mobile-card__muted-icon {
  display: inline-flex;
  align-items: center;
  color: #ef4444;
  flex: none;
}

.call-mobile-overlay__dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 8px 0 4px;
  flex: none;
}
.call-mobile-overlay__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line-strong);
  transition: background var(--dur-fast) var(--ease-out);
}
.call-mobile-overlay__dot.is-active {
  background: var(--accent);
}

.call-mobile-overlay__controls {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 12px 16px calc(16px + var(--app-safe-bottom));
  flex: none;
}
.call-mobile-overlay__controls .icon-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text);
}
.call-mobile-overlay__controls .icon-btn--danger {
  background: var(--red);
  color: #fff;
}
.call-mobile-overlay__controls .icon-btn--active {
  background: var(--accent);
  color: #fff;
}

.screen-share {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: stretch;
}
.screen-share__main {
  border-radius: 8px;
}
.screen-share__main--split {
  border-radius: 8px 0 0 8px;
}
.screen-share__chevron {
  width: 24px;
  border-radius: 0 8px 8px 0;
  border-left: 1px solid var(--line);
  padding-left: 0;
  padding-right: 0;
  color: var(--muted);
}
.screen-share__chevron:hover {
  color: var(--text);
}
.screen-share__chevron-flip {
  transform: rotate(180deg);
  transition: transform var(--dur-fast) var(--ease-out);
}
.screen-share__chevron svg {
  transition: transform var(--dur-fast) var(--ease-out);
}
.screen-share__menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 72;
  width: 238px;
  padding: 10px;
  border-radius: var(--context-menu-radius);
  background: var(--context-menu-bg);
  border: var(--context-menu-border);
  box-shadow: var(--context-menu-shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.screen-share__source {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 700;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.screen-share__source:hover {
  background: var(--surface-hover);
  color: var(--accent);
}
.screen-share__divider {
  height: 1px;
  background: var(--line);
  margin: 2px 0;
}
.share-settings__label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.share-settings__segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.share-settings__segmented button {
  flex: 1 1 auto;
  min-width: 44px;
  height: 26px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 700;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.share-settings__segmented button:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.share-settings__segmented button.is-active {
  background: var(--surface-hover);
  color: var(--accent);
}
</style>
