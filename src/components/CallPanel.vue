<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});

const now = ref(Date.now());
const focusedTileId = ref("");
const fullscreenTileId = ref("");
const isMobile = ref(false);
const memberMenu = ref({ open: false, x: 0, y: 0, username: "" });
let tickId = null;
let panelWindow = null;
let panelWindowSyncId = null;

function syncMobile() {
  isMobile.value = window.matchMedia("(max-width: 820px)").matches;
}

onMounted(() => {
  syncMobile();
  window.addEventListener("resize", syncMobile, { passive: true });
  window.addEventListener("click", closeMemberMenu, { passive: true });
  window.addEventListener("contextmenu", closeMemberMenu, { passive: true });
  tickId = setInterval(() => { now.value = Date.now(); }, 500);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", syncMobile);
  window.removeEventListener("click", closeMemberMenu);
  window.removeEventListener("contextmenu", closeMemberMenu);
  if (tickId) clearInterval(tickId);
  if (panelWindowSyncId) clearInterval(panelWindowSyncId);
});

const callRoom = computed(() => props.messenger.state.callRoom);
const screenShareTitle = computed(() =>
  props.messenger.state.callScreenEnabled
    ? t('call.stopScreen')
    : props.messenger.screenShareUnavailableReason.value || t('call.shareScreen')
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

const remoteMembers = computed(() => members.value.filter((username) => !isSelf(username)));

const callTiles = computed(() => {
  const tiles = [];
  for (const username of members.value) {
    const self = isSelf(username);
    const media = mediaOf(username);
    const videoKinds = [];
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
          trackIndex: kind === "screen" && media.camera ? 0 : videoKinds.indexOf(kind)
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
        trackIndex: 0
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
  const cutoff = now.value - 1500;
  return new Set(Object.keys(table).filter((u) => table[u] >= cutoff));
});

const activeMemberMenuVolume = computed(() => volumeOf(memberMenu.value.username));

function initialsOf(name) {
  const trimmed = String(name || "?").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

function isSelf(username) {
  return String(username || "") === String(props.messenger.state.username || "");
}

function isLocallyMuted(username) {
  return !isSelf(username) && volumeOf(username) <= 0;
}

function isSpeaking(username) {
  if (isSelf(username)) {
    return props.messenger.state.inCall && !props.messenger.state.callMuted && props.messenger.state.micTestLevel > 0
      ? props.messenger.state.micTestLevel >= Number(props.messenger.state.microphoneThreshold || 0)
      : speakingSet.value.has(username);
  }
  return speakingSet.value.has(username);
}

function callElapsed() {
  return props.messenger.formatDuration(props.messenger.state.callElapsed);
}

function volumeOf(username) {
  return props.messenger.callUserVolume(username);
}

function inputValue(event) {
  return event.target?.value ?? "";
}

function mediaOf(username) {
  if (isSelf(username)) return props.messenger.state.localCallMedia || {};
  return props.messenger.state.remoteCallMediaByUser[username] || {};
}

const focusedTile = computed(() => callTiles.value.find((tile) => tile.id === focusedTileId.value));

function tileLabel(tile) {
  if (tile.kind === "screen") return t('call.screen');
  if (tile.kind === "camera") return t('call.camera');
  return t('call.voice');
}

function escapePopupHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function videoStreamForTile(tile) {
  if (!tile?.video) return null;
  if (tile.self) return props.messenger.localPreviewStream(tile.kind);
  const stream = props.messenger.remoteVideoStream(tile.username);
  const tracks = (stream?.getVideoTracks?.() || []).filter((track) => track.readyState === "live" && !track.muted);
  const track = tracks[tile.trackIndex] || tracks[0];
  return track ? new MediaStream([track]) : null;
}

function bindLocalPreview(el, kind) {
  if (!el) return;
  const stream = props.messenger.localPreviewStream(kind);
  if (el.srcObject !== stream) el.srcObject = stream;
}

function bindRemoteVideo(el, username, trackIndex = 0) {
  if (!el) return;
  const stream = props.messenger.remoteVideoStream(username);
  const tracks = (stream?.getVideoTracks?.() || []).filter((track) => track.readyState === "live" && !track.muted);
  const track = tracks[trackIndex] || tracks[0];
  if (!track) {
    el.srcObject = null;
    return;
  }
  const existingTrack = el.srcObject?.getVideoTracks?.()[0];
  if (existingTrack?.id !== track.id) el.srcObject = new MediaStream([track]);
}

function bindFocusedVideo(el) {
  if (!el || !focusedTile.value) return;
  const stream = videoStreamForTile(focusedTile.value);
  if (el.srcObject !== stream) el.srcObject = stream;
}

function setFocusedTile(tile) {
  if (!tile?.video) return;
  focusedTileId.value = focusedTileId.value === tile.id ? "" : tile.id;
}

function clearFocusedTile() {
  focusedTileId.value = "";
  fullscreenTileId.value = "";
}

function toggleTileFullscreen(tile) {
  if (!tile?.video) return;
  fullscreenTileId.value = fullscreenTileId.value === tile.id ? "" : tile.id;
  if (fullscreenTileId.value) focusedTileId.value = tile.id;
}

function openTileWindow(tile) {
  if (!tile?.video) return;
  const stream = videoStreamForTile(tile);
  const child = window.open("", `qxp-tile-${tile.id}`, "popup=yes,width=960,height=640");
  if (!child) return;
  const safeTitle = `${escapePopupHtml(tile.username)} - ${escapePopupHtml(tileLabel(tile))}`;
  child.document.write(`<!doctype html><html><head><title>${safeTitle}</title><style>html,body{margin:0;width:100%;height:100%;background:#020305;color:#fff;font-family:system-ui,sans-serif}body{display:flex;flex-direction:column}.bar{height:42px;display:flex;align-items:center;padding:0 14px;background:#090b10;border-bottom:1px solid rgba(255,255,255,.12);font-weight:700}video{width:100%;height:calc(100% - 43px);object-fit:${tile.kind === "screen" ? "contain" : "cover"};background:#000}</style></head><body><div class="bar">${safeTitle}</div><video autoplay playsinline ${tile.self ? "muted" : ""}></video></body></html>`);
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
      empty.textContent = initialsOf(tile.username);
      card.appendChild(empty);
    }
    mount.appendChild(card);
  }
}

function openPanelWindow() {
  panelWindow = window.open("", "qxp-voice-panel", "popup=yes,width=1180,height=760");
  if (!panelWindow) return;
  const safeRoomName = escapePopupHtml(props.messenger.displayRoomName(callRoom.value));
  panelWindow.document.write(`<!doctype html><html><head><title>QxChat VoicePanel</title><style>html,body{margin:0;min-height:100%;background:#060709;color:#fff;font-family:system-ui,sans-serif}.head{height:46px;display:flex;align-items:center;gap:10px;padding:0 14px;background:#090b10;border-bottom:1px solid rgba(255,255,255,.12)}.live{color:#4fd68a;font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;padding:10px}.tile{position:relative;min-height:220px;border-radius:10px;overflow:hidden;background:#15171c;border:1px solid rgba(255,255,255,.1)}video{width:100%;height:100%;display:block;object-fit:cover;background:#000}.screen video{object-fit:contain}.label{position:absolute;z-index:2;left:8px;bottom:8px;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.58);font-weight:700}.empty{height:100%;display:grid;place-items:center;font-size:42px;font-weight:800}</style></head><body><div class="head"><span class="live">Live</span><strong>${safeRoomName}</strong><span>${callElapsed()}</span></div><main id="tiles" class="grid"></main></body></html>`);
  panelWindow.document.close();
  syncPanelWindow();
  if (panelWindowSyncId) clearInterval(panelWindowSyncId);
  panelWindowSyncId = setInterval(syncPanelWindow, 1000);
}

function bindRemoteAudio(el, username) {
  if (!el) return;
  const stream = props.messenger.remoteCallStream(username);
  if (el.srcObject !== stream) el.srcObject = stream;
  el.volume = Math.max(0, Math.min(1, volumeOf(username) / 100));
  props.messenger.applyAudioOutput(el);
  el.play?.().catch?.(() => {});
}

function openMemberMenu(event, username) {
  if (isSelf(username)) return;
  event.preventDefault();
  event.stopPropagation();
  memberMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    username
  };
}

function closeMemberMenu() {
  if (!memberMenu.value.open) return;
  memberMenu.value = { open: false, x: 0, y: 0, username: "" };
}

function setMemberVolume(username, value) {
  props.messenger.setCallUserVolume(username, value);
}

function toggleLocalMute(username) {
  const next = isLocallyMuted(username) ? 100 : 0;
  props.messenger.setCallUserVolume(username, next);
}
</script>

<template>
  <section class="callpanel" v-if="messenger.state.inCall && messenger.state.callRoom === messenger.state.activeRoom">
    <header class="callpanel__head">
      <div class="callpanel__meta">
        <span class="callpanel__status">
          <span class="call-dot"></span>
          {{ t('call.live') }}
        </span>
        <span class="callpanel__title">{{ messenger.displayRoomName(callRoom) }}</span>
        <span class="callpanel__time">{{ callElapsed() }}</span>
      </div>
      <div class="callpanel__actions">
        <button
          class="icon-btn"
          :class="{ 'icon-btn--danger': messenger.state.callMuted }"
          type="button"
          :aria-label="messenger.state.callMuted ? t('call.unmute') : t('call.mute')"
          @click="messenger.toggleMute"
        >
          <svg v-if="!messenger.state.callMuted" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
        </button>
        <button
          class="icon-btn"
          :class="{ 'icon-btn--active': messenger.state.callCameraEnabled }"
          type="button"
          :aria-label="messenger.state.callCameraEnabled ? t('call.stopCamera') : t('call.startCamera')"
          @click="messenger.toggleCamera"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10.5 20 7v10l-5-3.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3.5Z"/></svg>
        </button>
        <button
          class="icon-btn"
          :class="{ 'icon-btn--active': messenger.state.callScreenEnabled }"
          type="button"
          :aria-label="messenger.state.callScreenEnabled ? t('call.stopScreen') : t('call.shareScreen')"
          :title="screenShareTitle"
          @click="messenger.toggleScreenShare"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m9 10 3-3 3 3"/><path d="M12 7v7"/></svg>
        </button>
        <button
          v-if="!isMobile"
          class="icon-btn"
          type="button"
          :aria-label="t('call.extractPanel')"
          :title="t('call.extractPanel')"
          @click="openPanelWindow"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
        </button>
        <button
          class="icon-btn icon-btn--danger"
          type="button"
          :aria-label="t('call.endCall')"
          @click="messenger.endCall"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 15.4c3.3-2.1 7.5-2.1 10.8 0l1.45.92c.7.44.92 1.37.48 2.07l-1.15 1.84c-.44.7-1.37.92-2.07.48l-1.55-.97a4.95 4.95 0 0 0-5.12 0l-1.55.97c-.7.44-1.63.22-2.07-.48l-1.15-1.84c-.44-.7-.22-1.63.48-2.07l1.45-.92Z"/><path d="M6 8.5C9.7 6.2 14.3 6.2 18 8.5"/><path d="M3.5 5.2c5.2-3.4 11.8-3.4 17 0"/></svg>
        </button>
      </div>
    </header>

    <div class="callpanel__stage" :class="callGridClass">
      <div
        v-for="tile in callTiles"
        :key="tile.id"
        class="calltile"
        :class="{
          'is-speaking': isSpeaking(tile.username),
          'is-self': tile.self,
          'is-muted': tile.self && messenger.state.callMuted,
          'has-video': tile.video,
          'is-screen': tile.kind === 'screen',
          'is-focused': focusedTileId === tile.id,
          'is-fullscreen': fullscreenTileId === tile.id,
          'is-local-muted': isLocallyMuted(tile.username)
        }"
        @contextmenu="openMemberMenu($event, tile.username)"
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
            :class="`avatar--${messenger.accentFor(tile.username)}`"
          >{{ initialsOf(tile.username) }}</span>
        </div>
        <div v-if="tile.video" class="calltile__tools">
          <button type="button" :title="t('call.zoom')" :aria-label="t('call.zoom')" @click="setFocusedTile(tile)">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/></svg>
          </button>
          <button type="button" :title="t('call.fullscreen')" :aria-label="t('call.fullscreen')" @click="toggleTileFullscreen(tile)">
            <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
          <button v-if="!isMobile" type="button" :title="t('call.extractView')" :aria-label="t('call.extractView')" @click="openTileWindow(tile)">
            <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
          </button>
        </div>
        <div class="calltile__overlay">
          <span class="calltile__name">
            {{ tile.username }}<span v-if="tile.self" class="calltile__you"> {{ t('call.you') }}</span>
          </span>
          <span class="calltile__kind">{{ tileLabel(tile) }}</span>
          <span v-if="!tile.self && isLocallyMuted(tile.username)" class="calltile__muted-badge" :aria-label="t('call.localMute')">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><line x1="16" y1="8" x2="22" y2="14"/><line x1="22" y1="8" x2="16" y2="14"/></svg>
          </span>
          <span v-if="tile.self && messenger.state.callMuted" class="calltile__muted-badge" aria-label="muted">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/></svg>
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="memberMenu.open"
      class="callpanel__menu"
      :style="{ left: `${memberMenu.x}px`, top: `${memberMenu.y}px` }"
      @click.stop
    >
      <div class="callpanel__menu-title">{{ memberMenu.username }}</div>
      <button type="button" class="callpanel__menu-action" @click="toggleLocalMute(memberMenu.username)">
        {{ isLocallyMuted(memberMenu.username) ? t('call.unmuteLocal') : t('call.localMute') }}
      </button>
      <label class="callpanel__menu-volume">
        <span>{{ t('call.personalVolume') }}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="activeMemberMenuVolume"
          @input="setMemberVolume(memberMenu.username, inputValue($event))"
        />
        <strong>{{ activeMemberMenuVolume }}%</strong>
      </label>
    </div>

    <div v-if="focusedTile" class="callpanel__focus" :class="{ 'is-fullscreen': fullscreenTileId === focusedTile.id }">
      <button class="callpanel__focus-close" type="button" :aria-label="t('call.closeView')" @click="clearFocusedTile">×</button>
      <video :ref="bindFocusedVideo" autoplay playsinline :muted="focusedTile.self"></video>
      <div class="callpanel__focus-label">{{ focusedTile.username }} · {{ tileLabel(focusedTile) }}</div>
    </div>
  </section>

  <div
    v-if="messenger.state.inCall && messenger.state.callRoom !== messenger.state.activeRoom && remoteMembers.length"
    class="callpanel__audio callpanel__audio--hidden"
    aria-hidden="true"
  >
    <audio
      v-for="u in remoteMembers"
      :key="`hidden-audio-${u}`"
      :ref="(el) => bindRemoteAudio(el, u)"
      autoplay
      playsinline
    ></audio>
  </div>
</template>
