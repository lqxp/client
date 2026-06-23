import { computed, nextTick, reactive } from "vue";
import { zipSync } from "fflate";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { EMPTY_CALL_MEDIA, normalizeCallMedia } from "@/calls/callTypes";
import type {
  CallMediaState,
  CallSignalPayload,
  RemoteCallMedia,
} from "@/calls/callTypes";
import {
  WebRtcCallManager,
  relayCallsConfigured,
  relayCallsRequirementMessage,
} from "@/calls/WebRtcCallManager";
import { apiUrl, appRuntimeConfig } from "@/config/runtime";
import {
  cryptoAvailable,
  decryptRoomPayload,
  encryptRoomPayload,
  generateRoomAccessToken,
  generateRoomKey,
  parseRoomAccessToken,
  normalizeRoomKey,
} from "@/crypto/e2ee";
import {
  playCameraOffSound,
  playCameraOnSound,
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playScreenOffSound,
  playScreenOnSound,
  playUnmuteSound,
  setCallSoundsActive,
  setSoundFlag,
} from "@/calls/callSounds";

const STORAGE_KEY = "qxprotocol-messenger-v5";
const PROFILE_STORAGE_KEY = "qxprotocol-profile-v1";
const CLIENT_ID_STORAGE_KEY = "qxprotocol-client-id-v1";
const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "💀", "🧢"];
const MAX_ROOMS_SHOWN = 100;
const MAX_HISTORY_PER_ROOM = 500;
const ROOM_ID_MIN_LENGTH = 8;
const ROOM_ID_MAX_LENGTH = 64;
const MAX_ROOM_NOTE_LENGTH = 512;
const MAX_LOCAL_ROOM_NAME_LENGTH = 64;
const MAX_LOCAL_ROOM_ICON_LENGTH = 2048;
const MESSAGE_LIMIT = 2000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_PROFILE_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_BANNER_BYTES = 5 * 1024 * 1024;
const MAX_PROFILE_DESCRIPTION_LENGTH = 512;
const MAX_PROFILE_PRONOUNS_LENGTH = 24;
const RECONNECT_DEFAULTS = {
  enabled: true,
  minDelayMs: 1000,
  maxDelayMs: 30000,
};
const PROFILE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/apng",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const PRESENCE_STATUSES = ["online", "invisible", "dnd"];
const DUPLICATE_MESSAGE_WINDOW_MS = 10 * 60 * 1000;
const RANDOM_ROOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const E2EE_MESSAGE_PLACEHOLDER = "Encrypted message";
const LINK_PREVIEW_URL_RE = /https?:\/\/[^\s<>"'`\\]+/i;
const pendingLinkPreviewRequests = new Set<string>();
const TYPING_IDLE_MS = 2800;
const TYPING_REMOTE_TTL_MS = 4500;
const TYPING_HEARTBEAT_MS = 4000;

function inferWebSocketUrl() {
  return appRuntimeConfig.wsUrl;
}

function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 32);
}

function validateUsername(value) {
  const username = sanitizeUsername(value);
  if (username.length < 2 || username.length > 32)
    return "Username must be 2 to 32 characters.";
  if (!/^[a-z0-9_.]+$/.test(username))
    return "Username can only use a-z, 0-9, underscore and period.";
  if (username.includes(".."))
    return "Username cannot contain two consecutive periods.";
  return "";
}

function sanitizePresenceStatus(value) {
  const status = String(value || "").trim();
  return PRESENCE_STATUSES.includes(status) ? status : "online";
}

function presenceStatusLabel(status) {
  switch (sanitizePresenceStatus(status)) {
    case "invisible":
      return "Invisible";
    case "dnd":
      return "Do Not Disturb";
    default:
      return "Online";
  }
}

function sanitizeProfileText(value, limit) {
  return String(value || "")
    .trim()
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit);
}

function findFirstLinkPreviewUrl(text) {
  const match = String(text || "").match(LINK_PREVIEW_URL_RE);
  return match ? match[0] : "";
}

function normalizeProfileImage(value, maxBytes) {
  if (!value || typeof value !== "object") return null;
  const mimeType = normalizeProfileMime(value.mimeType);
  const size = Math.max(0, Number(value.size) || 0);
  const width = Math.max(0, Math.round(Number(value.width) || 0));
  const height = Math.max(0, Math.round(Number(value.height) || 0));

  const url = sanitizeHttpUrl(value.url);
  const id = String(value.id || "").trim();
  if (mimeType && url && id && size && size <= maxBytes) {
    return { id, url, mimeType, size, width, height };
  }

  const dataB64 = String(value.dataB64 || "").trim();
  if (
    !mimeType ||
    !dataB64 ||
    size > maxBytes ||
    dataB64.length > Math.ceil((maxBytes * 4) / 3) + 8
  ) {
    return null;
  }
  return { mimeType, size, width, height, dataB64 };
}

function normalizeProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    avatar: normalizeProfileImage(source.avatar, MAX_PROFILE_AVATAR_BYTES),
    banner: normalizeProfileImage(source.banner, MAX_PROFILE_BANNER_BYTES),
    description: sanitizeProfileText(
      source.description,
      MAX_PROFILE_DESCRIPTION_LENGTH,
    ),
    pronouns: sanitizeProfileText(source.pronouns, MAX_PROFILE_PRONOUNS_LENGTH),
  };
}

function normalizeProfileMime(value) {
  const mime = String(value || "")
    .trim()
    .toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/apng") return "image/png";
  return PROFILE_IMAGE_MIME_TYPES.has(mime) ? mime : "";
}

function profileImageSrc(image) {
  const normalized = normalizeProfileImage(image, MAX_PROFILE_BANNER_BYTES);
  if (!normalized) return "";
  return normalized.url || `data:${normalized.mimeType};base64,${normalized.dataB64}`;
}

function sanitizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(
      raw,
      typeof window !== "undefined"
        ? window.location.origin
        : "https://localhost",
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isAndroidWebViewRuntime() {
  const ua =
    typeof navigator === "undefined"
      ? ""
      : String(navigator.userAgent || "").toLowerCase();
  return (
    ua.includes("android") &&
    (ua.includes("; wv") || ua.includes(" version/4."))
  );
}

function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const candidate = window as any;
  return Boolean(candidate.__TAURI_INTERNALS__ || candidate.__TAURI__);
}

function detectClientPlatform() {
  const ua =
    typeof navigator === "undefined"
      ? ""
      : String(navigator.userAgent || "").toLowerCase();
  if (isTauriRuntime()) {
    if (ua.includes("android")) return "android";
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    return "desktop";
  }
  if (ua.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("mobile")) return "mobile";
  return "web";
}

function sanitizeClientId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
}

function getPersistentClientId() {
  try {
    const existing = sanitizeClientId(
      localStorage.getItem(CLIENT_ID_STORAGE_KEY),
    );
    if (existing) return existing;
    const generated =
      globalThis.crypto?.randomUUID?.() ||
      `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const next = sanitizeClientId(generated);
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return sanitizeClientId(
      `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    );
  }
}

function sanitizePlatform(value) {
  const platform = String(value || "")
    .trim()
    .toLowerCase();
  if (["web", "desktop", "android", "ios", "mobile"].includes(platform))
    return platform;
  return platform ? "desktop" : "web";
}

function platformLabel(platform) {
  switch (sanitizePlatform(platform)) {
    case "android":
      return "Android";
    case "ios":
      return "iOS";
    case "mobile":
      return "Mobile";
    case "desktop":
      return "Desktop";
    default:
      return "Web";
  }
}

function platformIcon(platform) {
  switch (sanitizePlatform(platform)) {
    case "android":
      return "A";
    case "ios":
      return "iOS";
    case "mobile":
      return "M";
    case "desktop":
      return "PC";
    default:
      return "Web";
  }
}

function sanitizeRoomId(value) {
  return String(value || "")
    .trim()
    .slice(0, ROOM_ID_MAX_LENGTH);
}

function validateRoomId(value) {
  const id = sanitizeRoomId(value);
  if (id.length < ROOM_ID_MIN_LENGTH)
    return "Room name must be at least 8 characters.";
  if (id.length > ROOM_ID_MAX_LENGTH)
    return "Room name must be at most 64 characters.";
  if (!/^[a-z0-9]+$/i.test(id))
    return "Room name can only contain letters and numbers.";
  return "";
}

function isValidRoomId(value) {
  return !validateRoomId(value);
}

function generateRandomRoomId() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Browser crypto API is unavailable.");
  }

  let id = "";
  const bytes = new Uint8Array(ROOM_ID_MAX_LENGTH);
  const maxByte =
    Math.floor(256 / RANDOM_ROOM_ALPHABET.length) * RANDOM_ROOM_ALPHABET.length;
  while (id.length < ROOM_ID_MAX_LENGTH) {
    cryptoApi.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= maxByte) continue;
      id += RANDOM_ROOM_ALPHABET[byte % RANDOM_ROOM_ALPHABET.length];
      if (id.length === ROOM_ID_MAX_LENGTH) break;
    }
  }
  return id;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy failed.");
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const oneDay = 86_400_000;
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === new Date(now.getTime() - oneDay).toDateString())
    return "Yesterday";
  if (now.getTime() - date.getTime() < 7 * oneDay)
    return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function formatSidebarTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const oneDay = 86_400_000;
  if (date.toDateString() === now.toDateString()) return formatTime(timestamp);
  if (now.getTime() - date.getTime() < 7 * oneDay)
    return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function accentFor(seed) {
  const palette = [
    "blue",
    "green",
    "amber",
    "violet",
    "olive",
    "slate",
    "teal",
    "rose",
  ];
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function sanitizeRoomUsers(raw) {
  const users = new Set<string>();
  for (const player of Array.isArray(raw) ? raw : []) {
    const user = sanitizeUsername(
      typeof player === "string"
        ? player
        : player?.user || player?.username || player?.name,
    );
    if (!user) continue;
    users.add(user);
  }
  return [...users];
}

function sanitizeRoomKeys(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next = {};
  for (const [roomId, roomKey] of Object.entries(raw)) {
    const id = sanitizeRoomId(roomId);
    if (!isValidRoomId(id)) continue;
    try {
      next[id] = normalizeRoomKey(String(roomKey || ""));
    } catch {
      /* ignore malformed room keys */
    }
  }
  return next;
}

function parseInviteLink() {
  try {
    const hash = String(window.location.hash || "");
    const queryIndex = hash.indexOf("?");
    if (queryIndex === -1) return null;
    const params = new URLSearchParams(hash.slice(queryIndex + 1));
    const roomId = sanitizeRoomId(params.get("room") || "");
    const key = String(params.get("key") || "").trim();
    if (!isValidRoomId(roomId) || !key) return null;
    return { roomId, roomKey: normalizeRoomKey(key) };
  } catch {
    return null;
  }
}

function clearInviteLinkFromUrl() {
  try {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#/`,
    );
  } catch {
    /* hash cleanup is best effort */
  }
}

function loadPersisted() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const profile = loadPersistedProfile();
    const rooms = Array.isArray(raw.rooms)
      ? raw.rooms
          .filter(
            (r) => r && typeof r === "object" && typeof r.roomId === "string",
          )
          .slice(0, MAX_ROOMS_SHOWN)
          .map((r) => ({
            roomId: sanitizeRoomId(r.roomId),
            lastPreview: String(r.lastPreview || ""),
            lastTimestamp: Number(r.lastTimestamp) || 0,
            lastSender: String(r.lastSender || ""),
          }))
          .filter((r) => isValidRoomId(r.roomId))
      : [];

    const messagesByRoom = {};
    if (raw.messagesByRoom && typeof raw.messagesByRoom === "object") {
      for (const [id, arr] of Object.entries(raw.messagesByRoom)) {
        if (!Array.isArray(arr)) continue;
        const roomId = sanitizeRoomId(id);
        if (!isValidRoomId(roomId)) continue;
        messagesByRoom[roomId] = arr
          .slice(-MAX_HISTORY_PER_ROOM)
          .map((m) => normalizeMessage(m, id));
      }
    }

    const unreadByRoom = {};
    if (raw.unreadByRoom && typeof raw.unreadByRoom === "object") {
      for (const [id, n] of Object.entries(raw.unreadByRoom)) {
        const v = Number(n);
        const roomId = sanitizeRoomId(id);
        if (Number.isFinite(v) && v > 0 && isValidRoomId(roomId))
          unreadByRoom[roomId] = v;
      }
    }

    const joinedRooms = Array.isArray(raw.joinedRooms)
      ? [
          ...new Set(
            raw.joinedRooms
              .map((roomId) => sanitizeRoomId(roomId))
              .filter((roomId) => isValidRoomId(roomId)),
          ),
        ]
      : [];

    const usersByRoom = {};
    if (raw.usersByRoom && typeof raw.usersByRoom === "object") {
      for (const [id, players] of Object.entries(raw.usersByRoom)) {
        const roomId = sanitizeRoomId(id);
        if (!isValidRoomId(roomId)) continue;
        usersByRoom[roomId] = sanitizeRoomUsers(players);
      }
    }

    const profilesByUser = {};
    if (raw.profilesByUser && typeof raw.profilesByUser === "object") {
      for (const [username, profile] of Object.entries(raw.profilesByUser)) {
        const key = sanitizeUsername(username);
        if (!key) continue;
        profilesByUser[key] = normalizeProfile(profile);
      }
    }

    return {
      authToken: String(raw.authToken || ""),
      userId: String(raw.userId || ""),
      admin: Boolean(raw.admin),
      recoveryWords: Array.isArray(raw.recoveryWords)
        ? raw.recoveryWords
            .map((word) => String(word || ""))
            .filter(Boolean)
            .slice(0, 16)
        : [],
      username: sanitizeUsername(raw.username),
      status: sanitizePresenceStatus(raw.status),
      activeRoom: isValidRoomId(raw.activeRoom)
        ? sanitizeRoomId(raw.activeRoom)
        : "",
      rooms,
      joinedRooms,
      usersByRoom,
      profilesByUser,
      messagesByRoom,
      unreadByRoom,
      roomKeysByRoom: sanitizeRoomKeys(raw.roomKeysByRoom),
      selectedAudioInputId: String(raw.selectedAudioInputId || ""),
      selectedAudioOutputId: String(raw.selectedAudioOutputId || ""),
      microphoneThreshold: Math.max(
        0,
        Math.min(100, Number(raw.microphoneThreshold) || 0),
      ),
      deleteMessagesOnLeave: Boolean(raw.deleteMessagesOnLeave),
      autoArchiveUploads: Boolean(raw.autoArchiveUploads),
      streamerMode: Boolean(raw.streamerMode),
      typingIndicatorsEnabled: raw.typingIndicatorsEnabled !== false,
      messageSoundEnabled:
        typeof raw.messageSoundEnabled === "boolean"
          ? raw.messageSoundEnabled
          : true,
      callSoundsEnabled: raw.callSoundsEnabled !== false,
      soundFlags: {
        join: raw.soundFlags?.join !== false,
        leave: raw.soundFlags?.leave !== false,
        mute: raw.soundFlags?.mute !== false,
        unmute: raw.soundFlags?.unmute !== false,
        cameraOn: raw.soundFlags?.cameraOn !== false,
        cameraOff: raw.soundFlags?.cameraOff !== false,
        screenOn: raw.soundFlags?.screenOn !== false,
        screenOff: raw.soundFlags?.screenOff !== false,
        message: raw.soundFlags?.message !== false,
      },
      themeMode: ["dark", "light", "adaptive"].includes(
        String(raw.themeMode || "").toLowerCase(),
      )
        ? String(raw.themeMode).toLowerCase()
        : "dark",
      appAccent: ["blue", "violet", "emerald", "rose", "amber"].includes(
        String(raw.appAccent || "").toLowerCase(),
      )
        ? String(raw.appAccent).toLowerCase()
        : "blue",
      messageStyle: ["bubble", "discord"].includes(
        String(raw.messageStyle || "").toLowerCase(),
      )
        ? String(raw.messageStyle).toLowerCase()
        : "bubble",
      androidNotificationsEnabled: raw.androidNotificationsEnabled !== false,
      serverClearsLocalMessages:
        typeof raw.serverClearsLocalMessages === "boolean"
          ? raw.serverClearsLocalMessages
          : false,
      autoReconnectEnabled: raw.autoReconnectEnabled !== false,
      reconnectMinDelayMs: Math.max(
        250,
        Math.min(
          60000,
          Number(raw.reconnectMinDelayMs) || RECONNECT_DEFAULTS.minDelayMs,
        ),
      ),
      reconnectMaxDelayMs: Math.max(
        1000,
        Math.min(
          120000,
          Number(raw.reconnectMaxDelayMs) || RECONNECT_DEFAULTS.maxDelayMs,
        ),
      ),
      callUserVolumes: sanitizeCallUserVolumes(raw.callUserVolumes),
      roomNotes: sanitizeRoomNotes(raw.roomNotes),
      localRoomNames: sanitizeLocalRoomNames(raw.localRoomNames),
      localRoomIcons: sanitizeLocalRoomIcons(raw.localRoomIcons),
      profile,
    };
  } catch {
    return {
      authToken: "",
      userId: "",
      admin: false,
      recoveryWords: [],
      username: "",
      status: "online",
      activeRoom: "",
      rooms: [],
      joinedRooms: [],
      usersByRoom: {},
      profilesByUser: {},
      messagesByRoom: {},
      unreadByRoom: {},
      roomKeysByRoom: {},
      selectedAudioInputId: "",
      selectedAudioOutputId: "",
      microphoneThreshold: 0,
      deleteMessagesOnLeave: false,
      autoArchiveUploads: false,
      streamerMode: false,
      typingIndicatorsEnabled: true,
      messageSoundEnabled: true,
      callSoundsEnabled: true,
      soundFlags: {
        join: true,
        leave: true,
        mute: true,
        unmute: true,
        cameraOn: true,
        cameraOff: true,
        screenOn: true,
        screenOff: true,
        message: true,
      },
      themeMode: "dark",
      appAccent: "blue",
      messageStyle: "bubble",
      androidNotificationsEnabled: true,
      serverClearsLocalMessages: false,
      autoReconnectEnabled: RECONNECT_DEFAULTS.enabled,
      reconnectMinDelayMs: RECONNECT_DEFAULTS.minDelayMs,
      reconnectMaxDelayMs: RECONNECT_DEFAULTS.maxDelayMs,
      callUserVolumes: {},
      roomNotes: {},
      localRoomNames: {},
      localRoomIcons: {},
      profile: loadPersistedProfile(),
    };
  }
}

function loadPersistedProfile() {
  try {
    return normalizeProfile(
      JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}"),
    );
  } catch {
    return normalizeProfile(null);
  }
}

function sanitizeCallUserVolumes(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next = {};
  for (const [name, value] of Object.entries(raw)) {
    const key = sanitizeUsername(name);
    if (!key) continue;
    next[key] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }
  return next;
}

function sanitizeRoomNotes(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next = {};
  for (const [roomId, note] of Object.entries(raw)) {
    const id = sanitizeRoomId(roomId);
    if (!isValidRoomId(id)) continue;
    next[id] = String(note || "")
      .trim()
      .slice(0, MAX_ROOM_NOTE_LENGTH);
  }
  return next;
}

function sanitizeLocalRoomNames(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next = {};
  for (const [roomId, name] of Object.entries(raw)) {
    const id = sanitizeRoomId(roomId);
    if (!isValidRoomId(id)) continue;
    const clean = String(name || "")
      .trim()
      .slice(0, MAX_LOCAL_ROOM_NAME_LENGTH);
    if (clean) next[id] = clean;
  }
  return next;
}

function sanitizeLocalRoomIcon(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return "";
  const url = sanitizeHttpUrl(raw);
  if (url) return url;
  return raw.slice(0, MAX_LOCAL_ROOM_ICON_LENGTH);
}

function sanitizeLocalRoomIcons(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next = {};
  for (const [roomId, icon] of Object.entries(raw)) {
    const id = sanitizeRoomId(roomId);
    if (!isValidRoomId(id)) continue;
    const clean = sanitizeLocalRoomIcon(icon);
    if (clean) next[id] = clean;
  }
  return next;
}

function stripAttachmentDataForStorage(arr) {
  return (arr || []).map((m) => {
    if (!m?.attachment) return m;
    return { ...m, attachment: { ...m.attachment } };
  });
}

function savePersisted(state) {
  try {
    const messagesByRoom = {};
    for (const [id, arr] of Object.entries(state.messagesByRoom || {}) as [
      string,
      any[],
    ][]) {
      messagesByRoom[id] = stripAttachmentDataForStorage(
        arr.slice(-MAX_HISTORY_PER_ROOM),
      );
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 4,
        authToken: String(state.authToken || ""),
        userId: String(state.userId || ""),
        admin: Boolean(state.admin),
        recoveryWords: Array.isArray(state.recoveryWords)
          ? state.recoveryWords.slice(0, 16)
          : [],
        username: sanitizeUsername(state.username),
        status: sanitizePresenceStatus(state.status),
        activeRoom: sanitizeRoomId(state.activeRoom),
        rooms: state.rooms,
        joinedRooms: [
          ...new Set(
            (state.joinedRooms || [])
              .map((roomId) => sanitizeRoomId(roomId))
              .filter((roomId) => isValidRoomId(roomId)),
          ),
        ],
        usersByRoom: Object.fromEntries(
          Object.entries(state.usersByRoom || {})
            .map(([roomId, users]) => [
              sanitizeRoomId(roomId),
              sanitizeRoomUsers(users),
            ])
            .filter(([roomId]) => isValidRoomId(roomId)),
        ),
        profilesByUser: Object.fromEntries(
          Object.entries(state.profilesByUser || {})
            .map(([username, profile]) => [
              sanitizeUsername(username),
              normalizeProfile(profile),
            ])
            .filter(([username]) => Boolean(username)),
        ),
        messagesByRoom,
        unreadByRoom: state.unreadByRoom,
        roomKeysByRoom: sanitizeRoomKeys(state.roomKeysByRoom),
        selectedAudioInputId: state.selectedAudioInputId,
        selectedAudioOutputId: state.selectedAudioOutputId,
        microphoneThreshold: state.microphoneThreshold,
        deleteMessagesOnLeave: state.deleteMessagesOnLeave,
        autoArchiveUploads: state.autoArchiveUploads,
        streamerMode: state.streamerMode,
        typingIndicatorsEnabled: state.typingIndicatorsEnabled,
        messageSoundEnabled: state.messageSoundEnabled,
        callSoundsEnabled: state.callSoundsEnabled,
        soundFlags: { ...state.soundFlags },
        themeMode: state.themeMode,
        appAccent: state.appAccent,
        messageStyle: state.messageStyle,
        androidNotificationsEnabled: state.androidNotificationsEnabled,
        serverClearsLocalMessages: state.serverClearsLocalMessages,
        autoReconnectEnabled: state.autoReconnectEnabled,
        reconnectMinDelayMs: state.reconnectMinDelayMs,
        reconnectMaxDelayMs: state.reconnectMaxDelayMs,
        callUserVolumes: sanitizeCallUserVolumes(state.callUserVolumes),
        roomNotes: sanitizeRoomNotes(state.roomNotes),
        localRoomNames: sanitizeLocalRoomNames(state.localRoomNames),
        localRoomIcons: sanitizeLocalRoomIcons(state.localRoomIcons),
      }),
    );
  } catch {
    /* storage full — attachment bytes alone can exceed quota */
  }
  savePersistedProfile(state.profile);
}

function savePersistedProfile(profile) {
  try {
    localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify(normalizeProfile(profile)),
    );
  } catch {
    /* browser storage can be smaller than the protocol image limits */
  }
}

function parseVoiceLabel(text) {
  const match = /^\[voice:(\d+:\d{2})\]$/i.exec(String(text || "").trim());
  return match ? match[1] : "";
}

function extractUsername(label) {
  const parts = String(label || "Unknown").split(" ");
  return parts[parts.length - 1] || "Unknown";
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function messagePreviewLabel(message) {
  if (!message || message.deleted) return "";
  if (message.kind === "image") return "Photo";
  if (message.kind === "video") return "Video";
  if (message.kind === "audio" || message.kind === "voice")
    return "Voice message";
  if (message.kind === "file")
    return message.attachment?.filename || "File attachment";
  return String(message.text || "").trim();
}

function latestVisibleRoomMessage(messages) {
  for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
    if (messages[i] && !messages[i].deleted) return messages[i];
  }
  return null;
}

function sameAttachmentPayload(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    String(left.id || "") === String(right.id || "") &&
    String(left.url || "") === String(right.url || "") &&
    String(left.filename || "") === String(right.filename || "") &&
    String(left.mimeType || "") === String(right.mimeType || "") &&
    Number(left.size) === Number(right.size)
  );
}

function sameEncryptedPayload(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    Number(left.v) === Number(right.v) &&
    String(left.alg || "") === String(right.alg || "") &&
    String(left.iv || "") === String(right.iv || "") &&
    String(left.ciphertext || "") === String(right.ciphertext || "")
  );
}

function isDuplicateRecentMessage(messages, candidate) {
  const oldestAllowed =
    Number(candidate?.timestamp || Date.now()) - DUPLICATE_MESSAGE_WINDOW_MS;
  for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.deleted) continue;
    if (Number(message.timestamp || 0) < oldestAllowed) break;
    if (String(message.username || "") !== String(candidate.username || ""))
      continue;
    if (String(message.text || "") !== String(candidate.text || "")) continue;
    if (
      String(message.replyToMessageId || "") !==
      String(candidate.replyToMessageId || "")
    )
      continue;
    if (!sameEncryptedPayload(message.encrypted, candidate.encrypted)) continue;
    if (!sameAttachmentPayload(message.attachment, candidate.attachment))
      continue;
    return true;
  }
  return false;
}

const _emojiSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

// Identifies messages that are 1–3 pure emoji graphemes (Discord-style jumbo).
// Falls back to a code-point-based heuristic when Intl.Segmenter is missing.
const EMOJI_CHAR_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
function isOnlyEmoji(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;

  let graphemes;
  if (_emojiSegmenter) {
    graphemes = [..._emojiSegmenter.segment(trimmed)].map((s) => s.segment);
  } else {
    graphemes = Array.from(trimmed);
  }
  graphemes = graphemes.filter((g) => g.trim().length > 0);
  if (graphemes.length === 0 || graphemes.length > 3) return false;
  return graphemes.every((g) => EMOJI_CHAR_REGEX.test(g));
}

function normalizeMessage(message, fallbackRoomId) {
  const voiceDuration = parseVoiceLabel(message.text);
  const attachment =
    message.attachment && typeof message.attachment === "object"
      ? {
          id: String(message.attachment.id || "").trim(),
          url: sanitizeHttpUrl(message.attachment.url),
          filename: String(message.attachment.filename || "file"),
          mimeType: String(
            message.attachment.mimeType || "application/octet-stream",
          ),
          size: Number(message.attachment.size) || 0,
          dataB64: String(message.attachment.dataB64 || ""),
        }
      : null;
  const encrypted =
    message.encrypted && typeof message.encrypted === "object"
      ? {
          v: Number(message.encrypted.v) || 0,
          alg: String(message.encrypted.alg || ""),
          iv: String(message.encrypted.iv || ""),
          ciphertext: String(message.encrypted.ciphertext || ""),
        }
      : null;

  let kind = "text";
  if (message.deleted) kind = "deleted";
  else if (voiceDuration) kind = "voice";
  else if (attachment) {
    if ((attachment.mimeType || "").startsWith("audio/")) kind = "audio";
    else if ((attachment.mimeType || "").startsWith("image/")) kind = "image";
    else if ((attachment.mimeType || "").startsWith("video/")) kind = "video";
    else kind = "file";
  }

  const rawText = message.text || "";
  const jumboEmoji =
    !attachment && !voiceDuration && !message.deleted && isOnlyEmoji(rawText);

  const preview =
    message.preview && typeof message.preview === "object"
      ? {
          url: sanitizeHttpUrl(message.preview.url),
          title: String(message.preview.title || "").slice(0, 300),
          description: String(message.preview.description || "").slice(0, 500),
          image: sanitizeHttpUrl(message.preview.image),
          siteName: String(message.preview.siteName || "").slice(0, 80),
        }
      : null;

  return {
    messageId: message.messageId,
    roomId: message.roomId || fallbackRoomId || "",
    user: message.user || message.username || "Unknown",
    username: message.username || extractUsername(message.user),
    text: voiceDuration ? "Voice message" : rawText,
    rawText,
    timestamp: message.timestamp || Date.now(),
    system: Boolean(message.system),
    deleted: Boolean(message.deleted),
    reactions: Array.isArray(message.reactions) ? message.reactions : [],
    replyToMessageId: String(message.replyToMessageId || ""),
    attachment,
    encrypted,
    preview,
    kind,
    voiceDuration,
    jumboEmoji,
    locked: Boolean(message.locked),
    editedAt: Number(message.editedAt) || 0,
    mentioned: Boolean(message.mentioned),
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function zipSafeFilename(name) {
  const clean = String(name || "file")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "_")
    .replace(/^\.+$/, "file")
    .slice(0, 120);
  return clean || "file";
}

async function archiveFileAsZip(file: File) {
  const filename = zipSafeFilename(file.name || "file");
  const zipName = filename.toLowerCase().endsWith(".zip")
    ? filename
    : `${filename}.zip`;
  const data = new Uint8Array(await file.arrayBuffer());
  const zipped = zipSync({ [filename]: data }, { level: 6 });
  const zipBytes = new Uint8Array(zipped.byteLength);
  zipBytes.set(zipped);
  return new File([zipBytes], zipName, {
    type: "application/zip",
    lastModified: Date.now(),
  });
}

function base64ToBlob(b64, mimeType) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function mimeFromProfileFile(file) {
  const fromType = normalizeProfileMime(file?.type);
  if (fromType) return fromType;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png") || name.endsWith(".apng")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  return "";
}

function imageDimensions(file): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unsupported image."));
    };
    img.src = url;
  });
}

function microphoneLevelFromSamples(samples) {
  if (!samples?.length) return 0;
  let peak = 0;
  let sum = 0;
  for (const sample of samples) {
    const centered = Math.abs((sample - 128) / 128);
    peak = Math.max(peak, centered);
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  const blended = Math.max(rms * 4.5, peak * 1.8);
  return Math.min(100, Math.round(Math.pow(blended, 0.72) * 100));
}

function smoothLevel(previous, next) {
  const attack = 0.38;
  const release = 0.13;
  const factor = next > previous ? attack : release;
  return previous + (next - previous) * factor;
}

function buildWaveform(seed) {
  return Array.from({ length: 28 }, (_, index) => {
    const offset = (index * 17 + String(seed).length * 13) % 24;
    return 8 + offset;
  });
}

let singleton;

export function useMessenger() {
  if (singleton) return singleton;

  const persisted = loadPersisted();
  const importedInvite = parseInviteLink();
  if (importedInvite) {
    persisted.roomKeysByRoom[importedInvite.roomId] = importedInvite.roomKey;
    persisted.activeRoom = importedInvite.roomId;
    if (
      !persisted.rooms.some((room) => room.roomId === importedInvite.roomId)
    ) {
      persisted.rooms.unshift({
        roomId: importedInvite.roomId,
        lastPreview: "",
        lastTimestamp: 0,
        lastSender: "",
      });
    }
    clearInviteLinkFromUrl();
  }
  let toastTimer = null;

  const state = reactive({
    ws: null,
    connected: false,
    identified: false,
    uuid: null,
    heartbeatInterval: 3000,
    heartbeatTimer: null,
    manualClose: false,
    reconnectTimer: null,
    reconnectAttempts: 0,

    authToken: persisted.authToken,
    userId: persisted.userId,
    admin: persisted.admin,
    authLoading: false,
    authMode: "login",
    recoveryWords: persisted.recoveryWords,

    username: persisted.username,
    status: persisted.status,
    profile: persisted.profile,
    activeRoom: persisted.activeRoom,
    rooms: persisted.rooms,
    roomKeysByRoom: persisted.roomKeysByRoom,

    joinedRooms: persisted.joinedRooms,
    pendingJoinRooms: [],
    messagesByRoom: persisted.messagesByRoom,
    usersByRoom: persisted.usersByRoom,
    profilesByUser: { ...persisted.profilesByUser },
    statusesByUser: {},
    clientPlatformsByUser: {},
    callClientsByRoom: {},
    unreadByRoom: persisted.unreadByRoom,

    messageInput: "",
    voiceEnabled: false,
    systemBanner: "",
    lastError: "",
    searchTerm: "",

    composing: false,
    composeInput: "",
    toastMessage: "",

    settingsOpen: false,
    replyingTo: null,
    editingMessage: null,

    audioDevices: [],
    selectedAudioInputId: persisted.selectedAudioInputId,
    selectedAudioOutputId: persisted.selectedAudioOutputId,
    microphoneThreshold: persisted.microphoneThreshold,
    deleteMessagesOnLeave: persisted.deleteMessagesOnLeave,
    autoArchiveUploads: persisted.autoArchiveUploads,
    streamerMode: persisted.streamerMode,
    typingIndicatorsEnabled: persisted.typingIndicatorsEnabled,
    messageSoundEnabled: persisted.messageSoundEnabled,
    callSoundsEnabled: persisted.callSoundsEnabled,
    soundFlags: { ...persisted.soundFlags },
    themeMode: persisted.themeMode,
    appAccent: persisted.appAccent,
    messageStyle: persisted.messageStyle,
    androidNotificationsEnabled: persisted.androidNotificationsEnabled,
    serverClearsLocalMessages: persisted.serverClearsLocalMessages,
    autoReconnectEnabled: persisted.autoReconnectEnabled,
    reconnectMinDelayMs: persisted.reconnectMinDelayMs,
    reconnectMaxDelayMs: Math.max(
      persisted.reconnectMinDelayMs,
      persisted.reconnectMaxDelayMs,
    ),
    callUserVolumes: persisted.callUserVolumes,
    roomNotes: persisted.roomNotes,
    localRoomNames: persisted.localRoomNames,
    localRoomIcons: persisted.localRoomIcons,
    audioDevicesLoading: false,
    audioDevicesPermission: "unknown",
    micTestActive: false,
    micTestLoading: false,
    micTestLevel: 0,

    recording: null, // { recorder, stream, startedAt, roomId } while recording voice memo
    recordingElapsed: 0,

    inCall: false, // currently mid-voice-call
    callRoom: "", // which room the call is in
    callStream: null, // raw microphone MediaStream
    cameraStream: null,
    screenStream: null,
    callElapsed: 0, // seconds
    callMuted: false, // local mic mute applied to the outbound call gate
    callCameraEnabled: false,
    callScreenEnabled: false,
    localCallMedia: { ...EMPTY_CALL_MEDIA },
    remoteCallMediaByUser: {},
    remoteCallStreamsByUser: {},

    voiceMembersByRoom: {}, // { roomId: [username, ...] } — who is currently in voice
    speakingByRoom: {}, // { roomId: { username: lastChunkTimestamp } } — recent speakers
    typingByRoom: {}, // { roomId: { username: lastTypingTimestamp } }
    callAnalyser: null,
    callAnalyserData: null,

    adminLoading: false,
    adminOverview: null,
  });

  // Sync call sounds flag from persisted state
  setCallSoundsActive(state.callSoundsEnabled);
  for (const [key, val] of Object.entries(state.soundFlags))
    setSoundFlag(key, Boolean(val));

  // Non-reactive registry of Blob-URLs keyed by messageId so repeated renders
  // reuse the same URL and we can free them when messages are evicted.
  const attachmentUrlCache = new Map();
  let micTestStream = null;
  let micTestAudio = null;
  let micTestFrame = 0;
  let micTestAnalyser = null;
  let micTestAnalyserData = null;
  let micTestSmoothedLevel = 0;
  let notificationAudioContext = null;
  let callManager: WebRtcCallManager | null = null;
  let callOutboundStream: MediaStream | null = null;
  let callGateTimer: ReturnType<typeof setInterval> | null = null;
  let callGateOpenUntil = 0;
  const localClientId = getPersistentClientId();
  const typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let typingActiveRoomId = "";
  let typingLastSentAt = 0;
  function currentLocalPlatform() {
    return detectClientPlatform();
  }
  function attachmentUrlFor(message) {
    return sanitizeHttpUrl(message?.attachment?.url) || null;
  }

  const roomLabel = computed(() => state.activeRoom);
  const roomTitle = computed(() =>
    state.activeRoom ? displayRoomName(state.activeRoom) : "No conversation",
  );
  const callsAvailable = computed(() => relayCallsConfigured());
  const callsUnavailableReason = computed(() =>
    callsAvailable.value ? "" : relayCallsRequirementMessage(),
  );
  const screenShareUnavailableReason = computed(() => {
    if (isAndroidWebViewRuntime())
      return "Screen sharing is not supported by Android WebView.";
    if (!navigator.mediaDevices?.getDisplayMedia)
      return "Screen sharing is not available in this browser.";
    return "";
  });
  const screenShareAvailable = computed(
    () => !screenShareUnavailableReason.value,
  );

  const connectionLabel = computed(() => {
    if (state.connected && state.identified)
      return presenceStatusLabel(state.status).toLowerCase();
    if (state.connected) return "authenticating";
    return "offline";
  });

  const onlineCount = computed(
    () => (state.usersByRoom[state.activeRoom] || []).length,
  );

  const sortedMessages = computed(() => {
    const arr = state.messagesByRoom[state.activeRoom] || [];
    return [...arr].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  });

  const canSend = computed(
    () => state.messageInput.trim().length > 0 && !!state.activeRoom,
  );

  const conversations = computed(() => {
    const query = state.searchTerm.trim().toLowerCase();
    return state.rooms
      .slice()
      .map((r) => {
        const latest = latestVisibleRoomMessage(
          state.messagesByRoom[r.roomId] || [],
        );
        const preview = messagePreviewLabel(latest) || r.lastPreview || "";
        const timestamp = Number(latest?.timestamp || r.lastTimestamp || 0);
        return {
          roomId: r.roomId,
          name: displayRoomName(r.roomId),
          accent: accentFor(r.roomId),
          preview: preview || "No messages yet",
          timestampLabel: formatSidebarTime(timestamp),
          timestamp,
          active: r.roomId === state.activeRoom,
          unread: state.unreadByRoom[r.roomId] || 0,
          joined: state.joinedRooms.includes(r.roomId),
        };
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .filter(
        (r) =>
          !query ||
          r.roomId.toLowerCase().includes(query) ||
          r.name.toLowerCase().includes(query) ||
          r.preview.toLowerCase().includes(query),
      );
  });

  const activeConversation = computed(() => {
    if (!state.activeRoom) return null;
    const found = conversations.value.find((c) => c.active);
    if (found) return found;
    return {
      roomId: state.activeRoom,
      name: displayRoomName(state.activeRoom),
      accent: accentFor(state.activeRoom),
      active: true,
      preview: "",
      timestampLabel: "",
      unread: 0,
      joined: state.joinedRooms.includes(state.activeRoom),
    };
  });

  const memberRoster = computed(() => {
    const roomId = sanitizeRoomId(state.activeRoom);
    return [
      ...new Set(
        (state.usersByRoom[roomId] || []).map(sanitizeUsername).filter(Boolean),
      ),
    ];
  });
  const typingUsers = computed(() => {
    const roomId = sanitizeRoomId(state.activeRoom);
    const roomTyping = state.typingByRoom[roomId] || {};
    return Object.entries(roomTyping)
      .filter(([, at]) => Date.now() - Number(at || 0) <= TYPING_REMOTE_TTL_MS)
      .map(([username]) => username)
      .filter((username) => username !== sanitizeUsername(state.username))
      .sort();
  });
  const myProfile = computed(() => normalizeProfile(state.profile));
  const myStatus = computed(() => sanitizePresenceStatus(state.status));

  function persist() {
    savePersisted(state);
  }

  async function apiRequest(path, options: any = {}) {
    const headers = {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(state.authToken
        ? { authorization: `Bearer ${state.authToken}` }
        : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(apiUrl(path), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed (${response.status})`);
    }
    return data;
  }

  function applyAuthenticatedPayload(data) {
    if (!data?.user) throw new Error("Malformed account response.");
    const preservedSettings = {
      serverClearsLocalMessages: state.serverClearsLocalMessages,
      deleteMessagesOnLeave: state.deleteMessagesOnLeave,
      autoArchiveUploads: state.autoArchiveUploads,
      autoReconnectEnabled: state.autoReconnectEnabled,
      reconnectMinDelayMs: state.reconnectMinDelayMs,
      reconnectMaxDelayMs: state.reconnectMaxDelayMs,
      typingIndicatorsEnabled: state.typingIndicatorsEnabled,
      messageSoundEnabled: state.messageSoundEnabled,
      callSoundsEnabled: state.callSoundsEnabled,
      androidNotificationsEnabled: state.androidNotificationsEnabled,
      selectedAudioInputId: state.selectedAudioInputId,
      selectedAudioOutputId: state.selectedAudioOutputId,
      microphoneThreshold: state.microphoneThreshold,
      appAccent: state.appAccent,
      themeMode: state.themeMode,
      messageStyle: state.messageStyle,
      soundFlags: { ...state.soundFlags },
      callUserVolumes: { ...state.callUserVolumes },
      roomNotes: { ...state.roomNotes },
      localRoomNames: { ...state.localRoomNames },
      localRoomIcons: { ...state.localRoomIcons },
    };
    state.authToken = String(data.token || state.authToken || "");
    state.userId = String(data.user.id || "");
    state.username = sanitizeUsername(data.user.username);
    state.admin = Boolean(data.user.admin);
    state.profile = normalizeProfile(data.user.profile);
    state.status = sanitizePresenceStatus(data.user.status);
    Object.assign(state, preservedSettings);
    if (Array.isArray(data.recoveryWords)) {
      state.recoveryWords = data.recoveryWords
        .map((word) => String(word || ""))
        .filter(Boolean)
        .slice(0, 16);
    }
    persist();
  }

  function recoveryText() {
    return [
      "QxProtocol account recovery words",
      `Username: ${state.username}`,
      "",
      ...(state.recoveryWords || []),
    ].join("\n");
  }

  function downloadRecoveryWords() {
    if (!state.recoveryWords?.length) {
      state.lastError =
        "Recovery words are only available on this browser after account creation or recovery.";
      showToast(state.lastError);
      return false;
    }
    const blob = new Blob([recoveryText()], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qxp-recovery-${state.username || "account"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  async function registerAccount(username, password) {
    const validation = validateUsername(username);
    if (validation) {
      state.lastError = validation;
      return false;
    }
    state.authLoading = true;
    try {
      const data = await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: sanitizeUsername(username),
          password,
        }),
      });
      applyAuthenticatedPayload(data);
      downloadRecoveryWords();
      connect();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Registration failed.";
      return false;
    } finally {
      state.authLoading = false;
    }
  }

  async function loginAccount(username, password) {
    const validation = validateUsername(username);
    if (validation) {
      state.lastError = validation;
      return false;
    }
    state.authLoading = true;
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: sanitizeUsername(username),
          password,
        }),
      });
      applyAuthenticatedPayload(data);
      connect();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Login failed.";
      return false;
    } finally {
      state.authLoading = false;
    }
  }

  async function recoverAccount(username, recoveryWords, newPassword) {
    const validation = validateUsername(username);
    if (validation) {
      state.lastError = validation;
      return false;
    }
    state.authLoading = true;
    try {
      const data = await apiRequest("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({
          username: sanitizeUsername(username),
          recoveryWords: String(recoveryWords || ""),
          newPassword,
        }),
      });
      applyAuthenticatedPayload(data);
      connect();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Recovery failed.";
      return false;
    } finally {
      state.authLoading = false;
    }
  }

  async function refreshSession() {
    if (!state.authToken) return false;
    try {
      const data = await apiRequest("/api/auth/me");
      applyAuthenticatedPayload(data);
      return true;
    } catch {
      logoutLocal();
      return false;
    }
  }

  async function loadAdminOverview() {
    if (!state.admin) return null;
    state.adminLoading = true;
    try {
      const data = await apiRequest("/api/admin/overview");
      state.adminOverview = data;
      return data;
    } catch (error) {
      state.lastError = error?.message || "Admin overview failed.";
      showToast(state.lastError);
      return null;
    } finally {
      state.adminLoading = false;
    }
  }

  async function setAdminFeature(key, enabled) {
    if (!state.admin) return false;
    try {
      const data = await apiRequest("/api/admin/features", {
        method: "POST",
        body: JSON.stringify({ key, enabled: Boolean(enabled) }),
      });
      if (state.adminOverview) state.adminOverview.features = data.features;
      return true;
    } catch (error) {
      state.lastError = error?.message || "Feature update failed.";
      showToast(state.lastError);
      return false;
    }
  }

  async function setAdminUserDisabled(userId, disabled) {
    if (!state.admin) return false;
    try {
      await apiRequest(
        `/api/admin/users/${encodeURIComponent(userId)}/disabled`,
        {
          method: "POST",
          body: JSON.stringify({ disabled: Boolean(disabled) }),
        },
      );
      await loadAdminOverview();
      return true;
    } catch (error) {
      state.lastError = error?.message || "User update failed.";
      showToast(state.lastError);
      return false;
    }
  }

  async function setAdminUserBanned(userId, banned) {
    if (!state.admin) return false;
    try {
      await apiRequest(
        `/api/admin/users/${encodeURIComponent(userId)}/banned`,
        {
          method: "POST",
          body: JSON.stringify({ banned: Boolean(banned) }),
        },
      );
      await loadAdminOverview();
      return true;
    } catch (error) {
      state.lastError = error?.message || "User update failed.";
      showToast(state.lastError);
      return false;
    }
  }

  function profileFor(username) {
    const key = sanitizeUsername(username);
    if (!key) return normalizeProfile(null);
    if (key === sanitizeUsername(state.username)) return myProfile.value;
    return normalizeProfile(state.profilesByUser[key]);
  }

  function statusFor(username) {
    const key = sanitizeUsername(username);
    if (!key) return "online";
    if (key === sanitizeUsername(state.username)) return myStatus.value;
    return sanitizePresenceStatus(state.statusesByUser[key]);
  }

  function roomKeyFor(roomId) {
    const id = sanitizeRoomId(roomId);
    return id ? String(state.roomKeysByRoom[id] || "") : "";
  }

  function hasRoomKey(roomId) {
    return !!roomKeyFor(roomId);
  }

  function ensureRoomKey(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) throw new Error("Invalid room ID.");
    const current = roomKeyFor(id);
    if (current) return current;
    if (!cryptoAvailable())
      throw new Error("Web Crypto is unavailable in this browser.");
    const next = generateRoomKey();
    state.roomKeysByRoom[id] = next;
    persist();
    return next;
  }

  function importRoomKey(roomId, roomKey) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) throw new Error("Invalid room ID.");
    const normalized = normalizeRoomKey(roomKey);
    state.roomKeysByRoom[id] = normalized;
    touchRoom(id);
    persist();
    return normalized;
  }

  function roomAccessToken(roomId) {
    const id = sanitizeRoomId(roomId);
    const key = roomKeyFor(id);
    if (!id || !key) return "";
    return `${id}${key}`;
  }

  async function copyRoomInvite(roomId, { createIfMissing = true } = {}) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) throw new Error("Invalid room ID.");
    const key = roomKeyFor(id) || (createIfMissing ? ensureRoomKey(id) : "");
    if (!key) throw new Error("No room key available.");
    const token = roomAccessToken(id);
    await copyTextToClipboard(token);
    return token;
  }

  function encryptedPlaceholderMessage(message, roomId, reason = "") {
    const hint = reason ? ` (${reason})` : "";
    return normalizeMessage(
      {
        ...message,
        roomId,
        text: E2EE_MESSAGE_PLACEHOLDER,
        attachment: null,
        preview: null,
        locked: true,
        system: false,
      },
      roomId,
    );
  }

  async function hydrateIncomingMessage(message, fallbackRoomId) {
    const roomId = sanitizeRoomId(message?.roomId || fallbackRoomId || "");
    if (!message?.encrypted) return normalizeMessage(message, roomId);
    const roomKey = roomKeyFor(roomId);
    if (!roomKey) {
      return encryptedPlaceholderMessage(
        message,
        roomId,
        "room token required",
      );
    }
    try {
      const decrypted = await decryptRoomPayload(
        roomKey,
        roomId,
        message.encrypted,
      );
      return normalizeMessage(
        {
          ...message,
          text: String(decrypted?.text || ""),
          attachment:
            decrypted?.attachment && typeof decrypted.attachment === "object"
              ? {
                  id: String(decrypted.attachment.id || "").trim(),
                  url: sanitizeHttpUrl(decrypted.attachment.url),
                  filename: String(decrypted.attachment.filename || "file"),
                  mimeType: String(
                    decrypted.attachment.mimeType || "application/octet-stream",
                  ),
                  size: Number(decrypted.attachment.size) || 0,
                }
              : null,
          preview: message.preview || null,
          locked: false,
        },
        roomId,
      );
    } catch {
      return encryptedPlaceholderMessage(message, roomId, "wrong room key");
    }
  }

  async function buildEncryptedOutgoingMessage(roomId, payload) {
    const id = sanitizeRoomId(roomId);
    const roomKey = roomKeyFor(id);
    if (!roomKey) {
      throw new Error(
        "This room needs its room token key before you can send encrypted messages.",
      );
    }
    return encryptRoomPayload(roomKey, id, payload);
  }

  function displayRoomName(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return "";
    if (state.streamerMode) return "Hidden channel";
    const localName = state.localRoomNames[id];
    if (localName) return localName;
    return id;
  }

  function roomNote(roomId) {
    const id = sanitizeRoomId(roomId);
    return id ? String(state.roomNotes[id] || "") : "";
  }

  function roomIcon(roomId) {
    const id = sanitizeRoomId(roomId);
    return id ? sanitizeLocalRoomIcon(state.localRoomIcons[id]) : "";
  }

  function setRoomNote(roomId, note) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return;
    const clean = String(note || "")
      .trim()
      .slice(0, MAX_ROOM_NOTE_LENGTH);
    if (clean) {
      state.roomNotes[id] = clean;
    } else {
      delete state.roomNotes[id];
    }
    persist();
  }

  function setLocalRoomName(roomId, name) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return;
    const clean = String(name || "")
      .trim()
      .slice(0, MAX_LOCAL_ROOM_NAME_LENGTH);
    if (clean && clean !== id) {
      state.localRoomNames[id] = clean;
    } else {
      delete state.localRoomNames[id];
    }
    persist();
  }

  function clearLocalRoomName(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return;
    delete state.localRoomNames[id];
    persist();
  }

  function setLocalRoomIcon(roomId, icon) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return;
    const clean = sanitizeLocalRoomIcon(icon);
    if (clean) {
      state.localRoomIcons[id] = clean;
    } else {
      delete state.localRoomIcons[id];
    }
    persist();
  }

  function clearLocalRoomIcon(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return;
    delete state.localRoomIcons[id];
    persist();
  }

  async function setLocalRoomIconFromFile(roomId, file) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return false;
    if (!file) return false;
    state.lastError = "L’icône locale de room en fichier n’est plus supportée. Utilise une URL servie par le serveur.";
    return false;
  }

  function setDeleteMessagesOnLeave(value) {
    state.deleteMessagesOnLeave = Boolean(value);
    syncClientSettings();
    persist();
  }

  function setStreamerMode(value) {
    state.streamerMode = Boolean(value);
    persist();
  }

  function setMessageSoundEnabled(value) {
    state.messageSoundEnabled = Boolean(value);
    if (state.messageSoundEnabled) ensureNotificationAudio();
    persist();
  }

  function setTypingIndicatorsEnabled(value) {
    state.typingIndicatorsEnabled = Boolean(value);
    setTyping(false);
    persist();
  }

  function setCallSoundsEnabled(value) {
    state.callSoundsEnabled = Boolean(value);
    setCallSoundsActive(state.callSoundsEnabled);
    persist();
  }

  function setSoundEnabled(key: string, value: boolean) {
    if (!(key in state.soundFlags)) return;
    state.soundFlags[key] = Boolean(value);
    setSoundFlag(key, state.soundFlags[key]);
    persist();
  }

  function previewSound(key: string) {
    switch (key) {
      case "join":
        playJoinSound(true);
        break;
      case "leave":
        playLeaveSound(true);
        break;
      case "mute":
        playMuteSound(true);
        break;
      case "unmute":
        playUnmuteSound(true);
        break;
      case "cameraOn":
        playCameraOnSound(true);
        break;
      case "cameraOff":
        playCameraOffSound(true);
        break;
      case "screenOn":
        playScreenOnSound(true);
        break;
      case "screenOff":
        playScreenOffSound(true);
        break;
      case "message":
        playMessageNotificationSound();
        break;
    }
  }

  function setAndroidNotificationsEnabled(value) {
    state.androidNotificationsEnabled = Boolean(value);
    if (state.androidNotificationsEnabled) requestNotificationPermission();
    persist();
  }

  function setThemeMode(value) {
    const next = ["dark", "light", "adaptive"].includes(
      String(value || "").toLowerCase(),
    )
      ? String(value).toLowerCase()
      : "dark";
    state.themeMode = next;
    persist();
  }

  function setAppAccent(value) {
    const next = ["blue", "violet", "emerald", "rose", "amber"].includes(
      String(value || "").toLowerCase(),
    )
      ? String(value).toLowerCase()
      : "blue";
    state.appAccent = next;
    persist();
  }

  function setMessageStyle(value) {
    const next = ["bubble", "discord"].includes(
      String(value || "").toLowerCase(),
    )
      ? String(value).toLowerCase()
      : "bubble";
    state.messageStyle = next;
    persist();
  }

  function setAutoReconnectEnabled(value) {
    state.autoReconnectEnabled = Boolean(value);
    if (!state.autoReconnectEnabled) clearReconnectTimer();
    persist();
  }

  function setServerClearsLocalMessages(value) {
    state.serverClearsLocalMessages = Boolean(value);
    syncClientSettings();
    persist();
  }

  function setAutoArchiveUploads(value) {
    state.autoArchiveUploads = Boolean(value);
    persist();
  }

  function setReconnectDelays(minDelayMs, maxDelayMs) {
    const min = Math.max(
      250,
      Math.min(
        60000,
        Math.round(Number(minDelayMs) || RECONNECT_DEFAULTS.minDelayMs),
      ),
    );
    const max = Math.max(
      min,
      Math.min(
        120000,
        Math.round(Number(maxDelayMs) || RECONNECT_DEFAULTS.maxDelayMs),
      ),
    );
    state.reconnectMinDelayMs = min;
    state.reconnectMaxDelayMs = max;
    persist();
  }

  function setPresenceStatus(value) {
    const next = sanitizePresenceStatus(value);
    if (state.status === next) return;
    state.status = next;
    if (next === "invisible" && state.inCall) endCall();
    persist();
    syncClientSettings();
  }

  function setProfileText(payload: any = {}) {
    const { description, pronouns } = payload;
    state.profile = normalizeProfile({
      ...state.profile,
      ...(description !== undefined ? { description } : {}),
      ...(pronouns !== undefined ? { pronouns } : {}),
    });
    persist();
    syncClientSettings(true);
  }

  async function setProfileImageFromFile(kind, file) {
    const isBanner = kind === "banner";
    const limit = isBanner
      ? MAX_PROFILE_BANNER_BYTES
      : MAX_PROFILE_AVATAR_BYTES;
    if (!file) return false;
    if (file.size > limit) {
      state.lastError = `${isBanner ? "Banner" : "Profile image"} too large: ${formatSize(file.size)} > ${formatSize(limit)}`;
      showToast(state.lastError);
      return false;
    }

    const mimeType = mimeFromProfileFile(file);
    if (!mimeType) {
      state.lastError = "Profile images support PNG, APNG, GIF, JPEG and WEBP.";
      showToast(state.lastError);
      return false;
    }

    try {
      const { width, height } = await imageDimensions(file);
      if (!width || !height) throw new Error("Invalid image dimensions.");
      const dataB64 = await blobToBase64(file);
      const image = { mimeType, size: file.size, width, height, dataB64 };
      state.profile = normalizeProfile({ ...state.profile, [kind]: image });
      persist();
      syncClientSettings(true);
      return true;
    } catch (error) {
      state.lastError = error?.message || "Could not read profile image.";
      showToast(state.lastError);
      return false;
    }
  }

  function clearProfileImage(kind) {
    if (kind !== "avatar" && kind !== "banner") return;
    state.profile = normalizeProfile({ ...state.profile, [kind]: null });
    persist();
    syncClientSettings(true);
  }

  function callUserVolume(username) {
    const key = sanitizeUsername(username);
    if (!key) return 100;
    const value = Number(state.callUserVolumes[key]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
  }

  function setCallUserVolume(username, value) {
    const key = sanitizeUsername(username);
    if (!key) return;
    state.callUserVolumes[key] = Math.max(
      0,
      Math.min(100, Math.round(Number(value) || 0)),
    );
    persist();
  }

  function ensureNotificationAudio() {
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!notificationAudioContext) notificationAudioContext = new AudioCtx();
      if (notificationAudioContext.state === "suspended") {
        notificationAudioContext.resume().catch(() => {});
      }
      return notificationAudioContext;
    } catch {
      return null;
    }
  }

  function playMessageNotificationSound() {
    if (!state.messageSoundEnabled) return;
    const context = ensureNotificationAudio();
    if (!context) return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(740, now);
      oscillator.frequency.exponentialRampToValueAtTime(980, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch {
      /* notification audio is best-effort */
    }
  }

  function notificationPermission() {
    if (isTauriRuntime()) return "native";
    return typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission;
  }

  async function requestNotificationPermission() {
    if (isTauriRuntime()) {
      try {
        if (await isPermissionGranted()) return "granted";
        return await requestPermission();
      } catch {
        return "unsupported";
      }
    }
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission !== "default") return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }

  function showAndroidMessageNotification(message, roomId) {
    if (document.visibilityState === "visible" && roomId === state.activeRoom)
      return;
    if (!state.androidNotificationsEnabled) return;
    const title = `${message.username || "New message"} in ${displayRoomName(roomId) || "QxChat"}`;
    const body = messagePreviewLabel(message) || "New message";
    if (isTauriRuntime()) {
      isPermissionGranted()
        .then((granted) => {
          if (granted) {
            sendNotification({
              title,
              body,
              group: `qxchat-${roomId}`,
              autoCancel: true,
              silent: !state.messageSoundEnabled,
            });
          }
        })
        .catch(() => {});
      return;
    }
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(title, {
        body,
        tag: `qxchat-${roomId}`,
        silent: !state.messageSoundEnabled,
      });
      notification.onclick = () => {
        window.focus();
        selectConversation(roomId);
        notification.close();
      };
    } catch {
      /* Android notification support depends on the WebView/runtime build. */
    }
  }

  function audioConstraints() {
    return {
      audio: state.selectedAudioInputId
        ? { deviceId: { exact: state.selectedAudioInputId } }
        : true,
    };
  }

  function mediaErrorMessage(prefix, error) {
    const name = String(error?.name || "Error").trim();
    const message = String(error?.message || "").trim();
    return `${prefix}: ${name}${message ? ` - ${message}` : ""}`;
  }

  async function getPreferredAudioStream() {
    try {
      return await navigator.mediaDevices.getUserMedia(audioConstraints());
    } catch (error) {
      const selectedDeviceId = String(state.selectedAudioInputId || "").trim();
      const errorName = String(error?.name || "").trim();
      if (!selectedDeviceId || errorName !== "OverconstrainedError")
        throw error;

      state.selectedAudioInputId = "";
      persist();
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  async function refreshAudioDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      state.audioDevices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      state.audioDevices = [];
    }
  }

  async function unlockAudioDevices() {
    if (!navigator.mediaDevices?.getUserMedia) {
      state.lastError = "Audio devices are not available in this browser.";
      return false;
    }

    state.audioDevicesLoading = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      for (const track of stream.getTracks()) track.stop();
      state.audioDevicesPermission = "granted";
      await refreshAudioDevices();
      return true;
    } catch (error) {
      state.audioDevicesPermission = "denied";
      state.lastError = mediaErrorMessage(
        "Microphone permission is required to list audio devices",
        error,
      );
      await refreshAudioDevices();
      return false;
    } finally {
      state.audioDevicesLoading = false;
    }
  }

  function setAudioInput(deviceId) {
    state.selectedAudioInputId = String(deviceId || "");
    if (state.micTestActive) stopMicTest();
    persist();
  }

  function setAudioOutput(deviceId) {
    state.selectedAudioOutputId = String(deviceId || "");
    applyAudioOutput(micTestAudio);
    persist();
  }

  function setMicrophoneThreshold(value) {
    const next = Math.max(0, Math.min(100, Number(value) || 0));
    state.microphoneThreshold = next;
    updateCallAudioGate();
    persist();
  }

  async function applyAudioOutput(audio) {
    if (
      !audio ||
      !state.selectedAudioOutputId ||
      typeof audio.setSinkId !== "function"
    )
      return;
    try {
      await audio.setSinkId(state.selectedAudioOutputId);
    } catch {
      /* Output selection is browser/permission dependent. */
    }
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
  }

  function setupCallAudioPipeline(stream) {
    closeCallAnalyser();
    state.callAnalyser = null;
    state.callAnalyserData = null;
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return stream;
      const context = new AudioCtx();
      const monitorStream = new MediaStream(
        stream.getAudioTracks().map((track) => track.clone()),
      );
      const monitorSource = context.createMediaStreamSource(monitorStream);
      const outboundSource = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      const gate = context.createGain();
      const destination = context.createMediaStreamDestination();
      analyser.fftSize = 1024;
      gate.gain.value = Number(state.microphoneThreshold) > 0 ? 0 : 1;
      monitorSource.connect(analyser);
      outboundSource.connect(gate);
      gate.connect(destination);
      context.resume?.().catch?.(() => {});
      state.callAnalyser = { context, analyser, gate, monitorStream };
      state.callAnalyserData = new Uint8Array(analyser.fftSize);
      return destination.stream;
    } catch {
      state.callAnalyser = null;
      state.callAnalyserData = null;
      return stream;
    }
  }

  function closeCallAnalyser() {
    if (callGateTimer) {
      clearInterval(callGateTimer);
      callGateTimer = null;
    }
    callGateOpenUntil = 0;
    stopStreamTracks(state.callAnalyser?.monitorStream);
    const context = state.callAnalyser?.context;
    state.callAnalyser = null;
    state.callAnalyserData = null;
    if (context) context.close().catch(() => {});
  }

  function primeCallAudioGate() {
    if (state.callMuted) return;
    const threshold = Number(state.microphoneThreshold) || 0;
    if (threshold <= 0 || threshold >= 100) return;
    callGateOpenUntil = Date.now() + 450;
    setCallAudioGateOpen(true);
  }

  function isAboveMicrophoneThreshold() {
    const threshold = Number(state.microphoneThreshold) || 0;
    if (threshold >= 100) return false;
    if (
      threshold <= 0 ||
      !state.callAnalyser?.analyser ||
      !state.callAnalyserData
    )
      return true;
    state.callAnalyser.analyser.getByteTimeDomainData(state.callAnalyserData);
    return microphoneLevelFromSamples(state.callAnalyserData) > threshold;
  }

  function setCallAudioGateOpen(open) {
    const gate = state.callAnalyser?.gate;
    const context = state.callAnalyser?.context;
    if (gate && context) {
      const now = context.currentTime;
      gate.gain.cancelScheduledValues(now);
      gate.gain.setTargetAtTime(open ? 1 : 0, now, 0.025);
    }

    for (const track of callOutboundStream?.getAudioTracks?.() || []) {
      track.enabled = open;
    }
    for (const track of state.callStream?.getAudioTracks?.() || []) {
      track.enabled = open;
    }
  }

  function updateCallAudioGate() {
    if (!callOutboundStream) return;

    let open = !state.callMuted;
    const threshold = Number(state.microphoneThreshold) || 0;
    if (open && threshold >= 100) {
      open = false;
      callGateOpenUntil = 0;
    } else if (
      open &&
      threshold > 0 &&
      state.callAnalyser?.analyser &&
      state.callAnalyserData
    ) {
      const now = Date.now();
      if (isAboveMicrophoneThreshold()) callGateOpenUntil = now + 220;
      open = now <= callGateOpenUntil;
    } else if (!open) {
      callGateOpenUntil = 0;
    }

    setCallAudioGateOpen(open);
  }

  function startCallAudioGate() {
    if (callGateTimer) clearInterval(callGateTimer);
    const tick = () => {
      if (!state.inCall || !callOutboundStream) {
        if (callGateTimer) clearInterval(callGateTimer);
        callGateTimer = null;
        return;
      }
      updateCallAudioGate();
    };
    updateCallAudioGate();
    callGateTimer = setInterval(tick, 30);
  }

  function stopMicTest() {
    if (micTestFrame) {
      cancelAnimationFrame(micTestFrame);
      micTestFrame = 0;
    }
    if (micTestAudio) {
      micTestAudio.pause();
      micTestAudio.srcObject = null;
      micTestAudio = null;
    }
    if (micTestStream) {
      for (const track of micTestStream.getTracks()) track.stop();
      micTestStream = null;
    }
    const context = micTestAnalyser?.context;
    micTestAnalyser = null;
    micTestAnalyserData = null;
    if (context) context.close().catch(() => {});
    state.micTestActive = false;
    state.micTestLoading = false;
    state.micTestLevel = 0;
    micTestSmoothedLevel = 0;
  }

  async function startMicTest() {
    if (state.micTestActive || state.micTestLoading) {
      stopMicTest();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      state.lastError = "Audio devices are not available in this browser.";
      return;
    }

    state.micTestLoading = true;
    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(audioConstraints());
      state.audioDevicesPermission = "granted";
      await refreshAudioDevices();
      micTestStream = stream;

      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const context = new AudioCtx();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);
        micTestAnalyser = { context, analyser };
        micTestAnalyserData = new Uint8Array(analyser.fftSize);
      }

      micTestAudio = new Audio();
      micTestAudio.srcObject = stream;
      micTestAudio.volume = 0.75;
      await applyAudioOutput(micTestAudio);
      micTestAudio.play().catch(() => {});

      state.micTestActive = true;
      const tick = () => {
        if (
          !state.micTestActive ||
          !micTestAnalyser?.analyser ||
          !micTestAnalyserData
        )
          return;
        micTestAnalyser.analyser.getByteTimeDomainData(micTestAnalyserData);
        const nextLevel = microphoneLevelFromSamples(micTestAnalyserData);
        micTestSmoothedLevel = smoothLevel(micTestSmoothedLevel, nextLevel);
        state.micTestLevel = Math.round(micTestSmoothedLevel);
        micTestFrame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      state.audioDevicesPermission = "denied";
      state.lastError = "Microphone permission is required to test audio.";
      stopMicTest();
    } finally {
      state.micTestLoading = false;
    }
  }

  function touchRoom(roomId, message = null) {
    const id = sanitizeRoomId(roomId);
    if (!id) return;
    const existing = state.rooms.find((r) => r.roomId === id);
    const latest = latestVisibleRoomMessage(state.messagesByRoom[id] || []);
    const preview = messagePreviewLabel(latest || message);
    const sender = latest?.username || message?.username || "";
    const ts = Number(latest?.timestamp || message?.timestamp || 0);

    if (existing) {
      existing.lastPreview = preview;
      existing.lastTimestamp = ts || existing.lastTimestamp || 0;
      existing.lastSender = sender;
    } else {
      state.rooms.push({
        roomId: id,
        lastPreview: preview,
        lastTimestamp: ts,
        lastSender: sender,
      });
    }
    persist();
  }

  function clearRoomMessages(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return;
    for (const message of state.messagesByRoom[id] || []) {
      try {
        const url = attachmentUrlCache.get(message.messageId);
        if (url) URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      attachmentUrlCache.delete(message.messageId);
    }
    delete state.messagesByRoom[id];
    delete state.unreadByRoom[id];
    const room = state.rooms.find((r) => r.roomId === id);
    if (room) {
      room.lastPreview = "";
      room.lastSender = "";
      room.lastTimestamp = 0;
    }
    persist();
  }

  function removeRoom(roomId) {
    const id = sanitizeRoomId(roomId);
    state.rooms = state.rooms.filter((r) => r.roomId !== id);
    delete state.messagesByRoom[id];
    delete state.usersByRoom[id];
    delete state.voiceMembersByRoom[id];
    delete state.callClientsByRoom[id];
    delete state.typingByRoom[id];
    delete state.unreadByRoom[id];
    delete state.localRoomNames[id];
    delete state.localRoomIcons[id];
    state.joinedRooms = state.joinedRooms.filter((r) => r !== id);
    state.pendingJoinRooms = state.pendingJoinRooms.filter((r) => r !== id);
    if (state.activeRoom === id) state.activeRoom = "";
    persist();
  }

  function markUserTyping(roomId, username, typing) {
    const id = sanitizeRoomId(roomId);
    const user = sanitizeUsername(username);
    if (!id || !user) return;
    if (!state.typingByRoom[id]) state.typingByRoom[id] = {};

    const timerKey = `${id}:${user}`;
    const prevTimer = typingExpiryTimers.get(timerKey);
    if (prevTimer) {
      clearTimeout(prevTimer);
      typingExpiryTimers.delete(timerKey);
    }

    if (!typing) {
      delete state.typingByRoom[id][user];
      if (!Object.keys(state.typingByRoom[id]).length)
        delete state.typingByRoom[id];
      return;
    }

    state.typingByRoom[id][user] = Date.now();
    const timer = setTimeout(() => {
      if (!state.typingByRoom[id]) return;
      delete state.typingByRoom[id][user];
      if (!Object.keys(state.typingByRoom[id]).length)
        delete state.typingByRoom[id];
      typingExpiryTimers.delete(timerKey);
    }, TYPING_REMOTE_TTL_MS);
    typingExpiryTimers.set(timerKey, timer);
  }

  function setTyping(active) {
    const roomId = sanitizeRoomId(state.activeRoom);
    const canBroadcast = Boolean(
      state.typingIndicatorsEnabled &&
      state.connected &&
      state.identified &&
      roomId &&
      state.joinedRooms.includes(roomId),
    );

    if (!active || !canBroadcast || !String(state.messageInput || "").trim()) {
      if (typingIdleTimer) {
        clearTimeout(typingIdleTimer);
        typingIdleTimer = null;
      }
      if (typingActiveRoomId)
        send({ op: 31, d: { gameId: typingActiveRoomId, typing: false } });
      typingActiveRoomId = "";
      typingLastSentAt = 0;
      return;
    }

    if (typingActiveRoomId && typingActiveRoomId !== roomId) {
      send({ op: 31, d: { gameId: typingActiveRoomId, typing: false } });
      typingActiveRoomId = "";
      typingLastSentAt = 0;
    }

    const now = Date.now();
    if (!typingActiveRoomId || now - typingLastSentAt >= TYPING_HEARTBEAT_MS) {
      send({ op: 31, d: { gameId: roomId, typing: true } });
      typingActiveRoomId = roomId;
      typingLastSentAt = now;
    }

    if (typingIdleTimer) clearTimeout(typingIdleTimer);
    typingIdleTimer = setTimeout(() => setTyping(false), TYPING_IDLE_MS);
  }

  function clearHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    state.heartbeatTimer = setInterval(() => {
      send({ op: 1, d: {} });
    }, state.heartbeatInterval);
  }

  function scrollToBottom() {
    nextTick(() => {
      const feed = document.querySelector(".feed");
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
  }

  function teardownConnection(message) {
    clearHeartbeat();
    state.connected = false;
    state.identified = false;
    state.uuid = null;
    state.joinedRooms = [];
    state.pendingJoinRooms = [];
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.statusesByUser = {};
    state.typingByRoom = {};
    state.ws = null;
    if (typingIdleTimer) {
      clearTimeout(typingIdleTimer);
      typingIdleTimer = null;
    }
    for (const timer of typingExpiryTimers.values()) clearTimeout(timer);
    typingExpiryTimers.clear();
    typingActiveRoomId = "";
    typingLastSentAt = 0;
    if (message) state.systemBanner = message;
  }

  function send(payload) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify(payload));
  }

  function syncClientSettings(includeProfile = false) {
    if (!state.connected || !state.identified) return;
    const d: any = {
      deleteMessagesOnLeave: state.deleteMessagesOnLeave,
      serverClearsLocalMessages: state.serverClearsLocalMessages,
      status: sanitizePresenceStatus(state.status),
      clientId: localClientId,
      platform: currentLocalPlatform(),
    };
    if (includeProfile) d.profile = normalizeProfile(state.profile);
    send({ op: 8, d });
  }

  function requestJoin(roomId) {
    const id = sanitizeRoomId(roomId);
    const validation = validateRoomId(id);
    if (validation) {
      state.lastError = validation;
      return;
    }
    if (!state.identified) return;
    if (state.joinedRooms.includes(id)) return;
    if (state.pendingJoinRooms.includes(id)) return;
    state.pendingJoinRooms.push(id);
    send({ op: 3, d: { gameId: id } });
  }

  function fetchHistory(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return;
    send({ op: 18, d: { gameId: id } });
  }

  function selectConversation(roomId) {
    const id = sanitizeRoomId(roomId);
    const validation = validateRoomId(id);
    if (validation) {
      state.lastError = validation;
      showToast(validation);
      return;
    }
    if (state.activeRoom && state.activeRoom !== id) setTyping(false);
    state.activeRoom = id;
    state.unreadByRoom[id] = 0;
    if (state.editingMessage?.roomId !== id) cancelEditMessage();
    touchRoom(id);
    persist();
    if (state.connected && state.identified) {
      if (
        !state.joinedRooms.includes(id) &&
        !state.pendingJoinRooms.includes(id)
      ) {
        requestJoin(id);
      } else {
        scrollToBottom();
      }
    }
  }

  function leaveRoom(roomId) {
    const id = sanitizeRoomId(roomId || state.activeRoom);
    if (!id || !isValidRoomId(id)) return;

    if (
      !state.connected ||
      !state.identified ||
      !state.joinedRooms.includes(id)
    ) {
      removeRoom(id);
      return;
    }

    if (state.inCall && state.callRoom === id) endCall();
    setTyping(false);
    state.joinedRooms = state.joinedRooms.filter((r) => r !== id);
    state.pendingJoinRooms = state.pendingJoinRooms.filter((r) => r !== id);
    if (state.deleteMessagesOnLeave || state.serverClearsLocalMessages) {
      removeRoom(id);
    } else {
      delete state.usersByRoom[id];
      delete state.voiceMembersByRoom[id];
      delete state.callClientsByRoom[id];
      delete state.typingByRoom[id];
      if (state.activeRoom === id) state.activeRoom = "";
      persist();
    }
    send({ op: 4, d: { gameId: id } });
  }

  function startCompose() {
    state.composing = true;
    state.composeInput = "";
  }

  function cancelCompose() {
    state.composing = false;
    state.composeInput = "";
  }

  function submitCompose() {
    const raw = String(state.composeInput || "").trim();
    let id = "";
    try {
      if (/^[0-9a-f]{64}$/i.test(raw)) {
        const parsed = parseRoomAccessToken(raw);
        id = parsed.roomId;
        importRoomKey(parsed.roomId, parsed.roomKey);
      } else {
        id = sanitizeRoomId(raw);
        const validation = validateRoomId(id);
        if (validation) {
          state.lastError = validation;
          showToast(validation);
          return;
        }
      }
    } catch (error) {
      state.lastError = error?.message || "Invalid room token.";
      showToast(state.lastError);
      return;
    }
    state.composing = false;
    state.composeInput = "";
    selectConversation(id);
  }

  function showToast(message) {
    state.toastMessage = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (state.toastMessage === message) state.toastMessage = "";
      toastTimer = null;
    }, 2400);
  }

  async function createRandomRoom() {
    let id = "";
    try {
      const token = generateRoomAccessToken();
      id = token.roomId;
      importRoomKey(token.roomId, token.roomKey);
    } catch (error) {
      state.lastError = error.message;
      showToast("Could not generate a secure room.");
      return;
    }

    state.composing = false;
    state.composeInput = "";
    selectConversation(id);
    try {
      await copyRoomInvite(id);
      showToast("Room token copied.");
    } catch {
      showToast("Room opened. Token copy failed.");
    }
  }

  function connect() {
    persist();
    if (state.connected || state.ws) return;
    const username = sanitizeUsername(state.username);
    if (!state.authToken || !username) {
      state.lastError = "Account login required.";
      return;
    }
    state.lastError = "";
    state.manualClose = false;
    clearReconnectTimer();
    try {
      state.ws = new WebSocket(inferWebSocketUrl());
    } catch (error) {
      state.lastError = `Connection failed: ${error.message}`;
      state.ws = null;
      scheduleReconnect();
      return;
    }
    state.ws.addEventListener("open", () => {
      state.connected = true;
      state.reconnectAttempts = 0;
      state.systemBanner = "";
      send({
        op: 2,
        d: {
          username,
          token: state.authToken,
          isVoiceChat: state.voiceEnabled,
          deleteMessagesOnLeave: state.deleteMessagesOnLeave,
          status: sanitizePresenceStatus(state.status),
          profile: normalizeProfile(state.profile),
          clientId: localClientId,
          platform: currentLocalPlatform(),
          v: "QxpClient",
          isMobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
          isSecure: window.isSecureContext,
        },
      });
    });
    state.ws.addEventListener("message", ({ data }) => {
      try {
        handleMessage(JSON.parse(data));
      } catch {
        const raw = typeof data === "string" ? data.trim() : "";
        state.lastError = raw || "Malformed payload.";
      }
    });
    state.ws.addEventListener("close", () => {
      const shouldReconnect = !state.manualClose;
      teardownConnection(shouldReconnect ? "Connection lost" : "");
      if (shouldReconnect) scheduleReconnect();
    });
    state.ws.addEventListener("error", () => {
      state.lastError = "WebSocket error.";
    });
  }

  function clearReconnectTimer() {
    if (!state.reconnectTimer) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (
      !state.autoReconnectEnabled ||
      state.manualClose ||
      !state.authToken ||
      !sanitizeUsername(state.username)
    )
      return;
    if (state.reconnectTimer || state.ws || state.connected) return;
    const minDelay = Math.max(
      250,
      Number(state.reconnectMinDelayMs) || RECONNECT_DEFAULTS.minDelayMs,
    );
    const maxDelay = Math.max(
      minDelay,
      Number(state.reconnectMaxDelayMs) || RECONNECT_DEFAULTS.maxDelayMs,
    );
    const attempt = Math.max(0, Number(state.reconnectAttempts) || 0);
    const delay = Math.min(maxDelay, minDelay * 2 ** Math.min(attempt, 6));
    state.reconnectAttempts = attempt + 1;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (!state.connected && !state.ws && !state.manualClose) connect();
    }, delay);
  }

  function reconnectNow() {
    if (!state.autoReconnectEnabled || state.manualClose) return;
    if (state.connected || state.ws) return;
    clearReconnectTimer();
    connect();
  }

  function installRealtimeLifecycleHandlers() {
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reconnectNow();
    });
  }

  function disconnect() {
    state.manualClose = true;
    clearReconnectTimer();
    if (state.ws && state.ws.readyState < WebSocket.CLOSING) state.ws.close();
    teardownConnection("");
  }

  function sendChat() {
    const text = state.messageInput.trim();
    const roomId = state.activeRoom;
    if (!text || !roomId) return;
    if (state.editingMessage) {
      editCurrentMessage(text);
      return;
    }
    if (
      state.connected &&
      state.identified &&
      state.joinedRooms.includes(roomId)
    ) {
      buildEncryptedOutgoingMessage(roomId, {
        text: text.slice(0, MESSAGE_LIMIT),
        attachment: null,
      })
        .then((encrypted) => {
          const d: any = { text: "", gameId: roomId, encrypted };
          if (state.replyingTo?.messageId)
            d.replyToMessageId = state.replyingTo.messageId;
          send({ op: 7, d });
          state.messageInput = "";
          state.replyingTo = null;
          setTyping(false);
        })
        .catch((error) => {
          state.lastError = error?.message || "Message encryption failed.";
          showToast(state.lastError);
        });
    } else {
      state.lastError = "Not joined to this room yet.";
    }
  }

  async function sendAttachment(file, caption = "") {
    const roomId = state.activeRoom;
    if (!file || !roomId) return;
    if (!state.connected || !state.identified) {
      state.lastError = "Not connected.";
      return;
    }
    if (!state.joinedRooms.includes(roomId)) {
      state.lastError = "Not joined to this room yet.";
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      state.lastError = `File too large: ${file.name} (${formatSize(file.size)} > ${formatSize(MAX_ATTACHMENT_BYTES)})`;
      return;
    }

    try {
      const shouldArchive =
        state.autoArchiveUploads &&
        !String(caption || "").startsWith("[voice:");
      const uploadFile = shouldArchive ? await archiveFileAsZip(file) : file;
      if (uploadFile.size > MAX_ATTACHMENT_BYTES) {
        state.lastError = `File too large after zip archive: ${uploadFile.name} (${formatSize(uploadFile.size)} > ${formatSize(MAX_ATTACHMENT_BYTES)})`;
        return;
      }
      const dataB64 = await blobToBase64(uploadFile);
      const encrypted = await buildEncryptedOutgoingMessage(roomId, {
        text: caption ? String(caption).trim().slice(0, MESSAGE_LIMIT) : "",
        attachment: {
          filename: String(uploadFile.name || "file").slice(0, 128),
          mimeType: uploadFile.type || "application/octet-stream",
          size: uploadFile.size,
          dataB64,
        },
      });
      send({
        op: 7,
        d: {
          text: "",
          gameId: roomId,
          ...(state.replyingTo?.messageId
            ? { replyToMessageId: state.replyingTo.messageId }
            : {}),
          encrypted,
        },
      });
      state.replyingTo = null;
    } catch (err) {
      state.lastError = `Upload failed: ${err.message || err}`;
    }
  }

  // Voice memo: hold-to-record, release-to-send attachment.
  // Reuses the in-call mic stream when a call is active so the same mic
  // can serve both the call and the memo without a second getUserMedia.
  async function startRecordingVoiceMemo() {
    if (state.recording) return;
    const roomId = state.activeRoom;
    if (!roomId || !state.joinedRooms.includes(roomId)) {
      state.lastError = "Join a room first.";
      return;
    }
    try {
      const reusingCallStream = !!state.callStream;
      const stream = reusingCallStream
        ? state.callStream
        : await navigator.mediaDevices.getUserMedia(audioConstraints());
      refreshAudioDevices();
      state.audioDevicesPermission = "granted";
      const mimeType = pickAudioMime();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      recorder.onerror = () => {
        state.lastError = "Recording error.";
      };
      recorder.start();
      state.recording = {
        recorder,
        stream,
        roomId,
        chunks,
        startedAt: Date.now(),
        mimeType,
        ownsStream: !reusingCallStream,
      };
      tickRecording();
    } catch (err) {
      state.lastError = "Mic access denied.";
    }
  }

  function tickRecording() {
    if (!state.recording) return;
    state.recordingElapsed = Math.floor(
      (Date.now() - state.recording.startedAt) / 1000,
    );
    setTimeout(tickRecording, 250);
  }

  async function stopRecordingVoiceMemo(cancel = false) {
    const rec = state.recording;
    if (!rec) return;
    state.recording = null;
    state.recordingElapsed = 0;
    try {
      await new Promise<void>((resolve) => {
        rec.recorder.onstop = resolve;
        try {
          rec.recorder.stop();
        } catch {
          resolve();
        }
      });
    } catch {
      /* ignore */
    }
    // Only keep a shared stream alive while the call still owns it.
    if (rec.ownsStream || rec.stream !== state.callStream)
      stopStreamTracks(rec.stream);
    if (cancel) return;
    if (!rec.chunks.length) return;

    const blob = new Blob(rec.chunks, { type: rec.mimeType || "audio/webm" });
    if (blob.size < 200) return;
    const ext = (rec.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `voice-${Date.now()}.${ext}`, {
      type: blob.type,
    });
    await sendAttachment(
      file,
      `[voice:${formatDuration(Math.floor(blob.size / 6000))}]`,
    );
  }

  function pickAudioMime() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c))
        return c;
    }
    return "";
  }

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.max(0, seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function currentCallMedia(): CallMediaState {
    return {
      audio: state.inCall && !state.callMuted,
      camera: Boolean(state.callCameraEnabled),
      screen: Boolean(state.callScreenEnabled),
    };
  }

  function publishCallState(isVoiceChat = state.inCall) {
    const media = isVoiceChat ? currentCallMedia() : { ...EMPTY_CALL_MEDIA };
    state.localCallMedia = media;
    callManager?.setLocalMedia(media);
    const platform = currentLocalPlatform();
    send({
      op: 98,
      d: { isVoiceChat, media, clientId: localClientId, platform },
    });
    send({
      op: 110,
      d: {
        gameId: state.callRoom || state.activeRoom,
        isVoiceChat,
        media,
        clientId: localClientId,
        platform,
      },
    });
  }

  function rememberClientPlatform(username, platform) {
    const key = sanitizeUsername(username);
    const normalized = sanitizePlatform(platform);
    if (!key || !normalized) return;
    const platforms = new Set(state.clientPlatformsByUser[key] || []);
    platforms.add(normalized);
    state.clientPlatformsByUser[key] = [...platforms];
  }

  function normalizeRoomUsers(players) {
    const users = new Set<string>();
    for (const player of Array.isArray(players) ? players : []) {
      const user = sanitizeUsername(
        typeof player === "string"
          ? player
          : player?.user || player?.username || player?.name,
      );
      if (!user) continue;
      users.add(user);
      if (typeof player === "object" && player?.platform)
        rememberClientPlatform(user, player.platform);
    }
    return [...users];
  }

  function platformsForUser(username) {
    const key = sanitizeUsername(username);
    const platforms = new Set(state.clientPlatformsByUser[key] || []);
    if (key === sanitizeUsername(state.username))
      platforms.add(currentLocalPlatform());
    return [...platforms].map(sanitizePlatform).filter(Boolean).sort();
  }

  function mutualRoomsWith(username) {
    const target = sanitizeUsername(username);
    const me = sanitizeUsername(state.username);
    if (!target || !me) return [];
    const matches = [];
    for (const room of state.rooms) {
      const roomId = sanitizeRoomId(room?.roomId);
      if (!roomId || !isValidRoomId(roomId)) continue;
      const users = new Set(
        (state.usersByRoom[roomId] || []).map(sanitizeUsername).filter(Boolean),
      );
      if (users.has(me) && users.has(target)) {
        matches.push({
          roomId,
          name: displayRoomName(roomId),
          icon: roomIcon(roomId),
        });
      }
    }
    return matches;
  }

  function connectKnownCallPeers(roomId) {
    if (!callManager) return;
    const me = sanitizeUsername(state.username);
    const callClients = state.callClientsByRoom[roomId] || {};
    for (const user of state.voiceMembersByRoom[roomId] || []) {
      if (!user || user === me) continue;
      const clients = callClients[user] || [""];
      for (const clientId of clients.length ? clients : [""])
        callManager.connectPeer(user, clientId);
    }
  }

  function updateRemoteMedia(username, media) {
    const key = sanitizeUsername(username);
    if (!key) return;
    state.remoteCallMediaByUser[key] = normalizeCallMedia({
      ...(state.remoteCallMediaByUser[key] || EMPTY_CALL_MEDIA),
      ...(media || {}),
    });
  }

  function storeRemoteCallMedia(username: string, remote: RemoteCallMedia) {
    const key = sanitizeUsername(username);
    if (!key) return;
    state.remoteCallStreamsByUser[key] = remote.stream;
    const existing = state.remoteCallMediaByUser[key] || EMPTY_CALL_MEDIA;
    const inferred = normalizeCallMedia(remote.media || EMPTY_CALL_MEDIA);
    state.remoteCallMediaByUser[key] = normalizeCallMedia({
      ...existing,
      audio: Boolean(remote.media?.audio),
      camera:
        existing.screen && !existing.camera && inferred.camera
          ? false
          : (inferred.camera ?? existing.camera),
      screen: existing.screen,
    });
  }

  function removeRemoteCallMedia(username) {
    const key = sanitizeUsername(username);
    if (!key) return;
    delete state.remoteCallStreamsByUser[key];
    delete state.remoteCallMediaByUser[key];
  }

  function remoteCallStream(username) {
    return state.remoteCallStreamsByUser[sanitizeUsername(username)] || null;
  }

  function localPreviewStream(kind = "") {
    if (kind === "camera") return state.cameraStream || null;
    if (kind === "screen") return state.screenStream || null;
    return state.callStream || null;
  }

  function remoteVideoStream(username) {
    const stream = remoteCallStream(username);
    if (
      !stream
        ?.getVideoTracks()
        .some((track) => track.readyState === "live" && !track.muted)
    )
      return null;
    return stream;
  }

  // Calls use WebRTC media and the WebSocket only as a typed signaling relay.
  async function startCall() {
    if (state.inCall) return;
    if (sanitizePresenceStatus(state.status) === "invisible") {
      state.lastError = "Switch out of invisible mode before joining a call.";
      showToast(state.lastError);
      return;
    }
    if (!relayCallsConfigured()) {
      const message = relayCallsRequirementMessage();
      state.lastError = message;
      showToast(message);
      return;
    }
    const roomId = state.activeRoom;
    if (!roomId || !state.joinedRooms.includes(roomId)) {
      state.lastError = "Join a room first.";
      return;
    }
    try {
      const stream = await getPreferredAudioStream();
      const outboundStream = setupCallAudioPipeline(stream);
      callOutboundStream = outboundStream;
      refreshAudioDevices();
      state.audioDevicesPermission = "granted";
      state.callStream = stream;
      state.callRoom = roomId;
      state.inCall = true;
      state.callMuted = false;
      state.voiceEnabled = true;
      state.callCameraEnabled = false;
      state.callScreenEnabled = false;
      state.localCallMedia = currentCallMedia();
      const platform = currentLocalPlatform();
      callManager = new WebRtcCallManager({
        roomId,
        username: sanitizeUsername(state.username),
        clientId: localClientId,
        platform,
        localStream: outboundStream,
        sendSignal: (payload: CallSignalPayload) =>
          send({ op: 111, d: payload }),
        onRemoteMedia: storeRemoteCallMedia,
        onRemoteLeft: removeRemoteCallMedia,
      });
      // Register self as voice member locally so our tile shows up immediately.
      const me = sanitizeUsername(state.username);
      if (me) {
        const members = new Set(state.voiceMembersByRoom[roomId] || []);
        members.add(me);
        state.voiceMembersByRoom[roomId] = [...members];
        if (!state.callClientsByRoom[roomId])
          state.callClientsByRoom[roomId] = {};
        state.callClientsByRoom[roomId][me] = [localClientId];
        rememberClientPlatform(me, platform);
      }
      publishCallState(true);
      connectKnownCallPeers(roomId);
      primeCallAudioGate();
      startCallAudioGate();
      tickCall(Date.now());
      playJoinSound();
    } catch (error) {
      state.lastError = mediaErrorMessage("Mic access denied", error);
      endCall();
    }
  }

  function toggleMute() {
    if (!state.callStream && !callOutboundStream) return;
    state.callMuted = !state.callMuted;
    updateCallAudioGate();
    publishCallState(true);
    if (state.callMuted) playMuteSound();
    else playUnmuteSound();
  }

  async function toggleCamera() {
    if (!state.inCall || !callManager) return;
    if (state.callCameraEnabled) {
      callManager.removeLocalTrack("camera");
      stopStreamTracks(state.cameraStream);
      state.cameraStream = null;
      state.callCameraEnabled = false;
      publishCallState(true);
      playCameraOffSound();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      stopStreamTracks(state.cameraStream);
      state.cameraStream = stream;
      state.callCameraEnabled = true;
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("Camera has no video track.");
      callManager.setLocalTrack("camera", track, stream);
      playCameraOnSound();
      track.onended = () => {
        callManager?.removeLocalTrack("camera");
        state.callCameraEnabled = false;
        stopStreamTracks(stream);
        if (state.cameraStream === stream) state.cameraStream = null;
        publishCallState(true);
        playCameraOffSound();
      };
      for (const extraTrack of stream.getVideoTracks().slice(1)) {
        extraTrack.stop();
      }
      publishCallState(true);
    } catch {
      state.lastError = "Camera access denied.";
    }
  }

  async function toggleScreenShare() {
    if (!state.inCall || !callManager) return;
    if (state.callScreenEnabled) {
      callManager.removeLocalTrack("screen");
      stopStreamTracks(state.screenStream);
      state.screenStream = null;
      state.callScreenEnabled = false;
      publishCallState(true);
      playScreenOffSound();
      return;
    }

    try {
      if (
        !screenShareAvailable.value ||
        !navigator.mediaDevices?.getDisplayMedia
      ) {
        const message =
          screenShareUnavailableReason.value ||
          "Screen sharing is not available in this browser.";
        state.lastError = message;
        showToast(message);
        return;
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      stopStreamTracks(state.screenStream);
      state.screenStream = stream;
      state.callScreenEnabled = true;
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("Screen share has no video track.");
      callManager.setLocalTrack("screen", track, stream);
      playScreenOnSound();
      track.onended = () => {
        callManager?.removeLocalTrack("screen");
        state.callScreenEnabled = false;
        stopStreamTracks(stream);
        if (state.screenStream === stream) state.screenStream = null;
        publishCallState(true);
        playScreenOffSound();
      };
      publishCallState(true);
    } catch {
      state.lastError = "Screen sharing was cancelled.";
    }
  }

  function tickCall(startedAt) {
    if (!state.inCall) {
      state.callElapsed = 0;
      return;
    }
    state.callElapsed = Math.floor((Date.now() - startedAt) / 1000);
    setTimeout(() => tickCall(startedAt), 500);
  }

  function endCall() {
    const roomId = state.callRoom;
    const wasInCall = state.inCall;
    callManager?.close();
    callManager = null;
    state.remoteCallStreamsByUser = {};
    state.remoteCallMediaByUser = {};
    if (state.cameraStream) {
      for (const t of state.cameraStream.getTracks()) t.stop();
      state.cameraStream = null;
    }
    if (state.screenStream) {
      for (const t of state.screenStream.getTracks()) t.stop();
      state.screenStream = null;
    }
    const rawCallStream = state.callStream;
    const outboundStream = callOutboundStream;
    const memoStream =
      state.recording && !state.recording.ownsStream
        ? state.recording.stream
        : null;
    if (
      outboundStream &&
      outboundStream !== rawCallStream &&
      outboundStream !== memoStream
    ) {
      stopStreamTracks(outboundStream);
    }
    callOutboundStream = null;
    if (rawCallStream) {
      // If a memo is also recording off the same stream, let it finish first.
      if (rawCallStream !== memoStream) stopStreamTracks(rawCallStream);
      state.callStream = null;
    }
    if (wasInCall) {
      publishCallState(false);
      playLeaveSound();
    }
    state.inCall = false;
    state.voiceEnabled = false;
    state.callRoom = "";
    state.callElapsed = 0;
    state.callMuted = false;
    state.callCameraEnabled = false;
    state.callScreenEnabled = false;
    state.localCallMedia = { ...EMPTY_CALL_MEDIA };

    // Remove self from voice members locally.
    const me = sanitizeUsername(state.username);
    if (me && roomId) {
      const members = (state.voiceMembersByRoom[roomId] || []).filter(
        (u) => u !== me,
      );
      state.voiceMembersByRoom[roomId] = members;
      delete state.callClientsByRoom[roomId]?.[me];
    }
  }

  function handleCallState(d) {
    const roomId = sanitizeRoomId(d?.gameId);
    const user = sanitizeUsername(d?.user);
    if (!roomId || !user) return;
    const clientId = sanitizeClientId(d?.clientId || d?.fromClientId);
    const me = sanitizeUsername(state.username);
    if (d?.platform) rememberClientPlatform(user, d.platform);
    if (!state.callClientsByRoom[roomId]) state.callClientsByRoom[roomId] = {};

    const members = new Set(state.voiceMembersByRoom[roomId] || []);
    const wasKnownMember = members.has(user);
    if (d.isVoiceChat === true) {
      members.add(user);
      if (clientId) {
        const clients = new Set(state.callClientsByRoom[roomId][user] || []);
        clients.add(clientId);
        state.callClientsByRoom[roomId][user] = [...clients];
      }
      updateRemoteMedia(user, d.media || { audio: true });
      if (state.inCall && state.callRoom === roomId && user !== me) {
        callManager?.connectPeer(user, clientId);
        if (!wasKnownMember) publishCallState(true);
      }
    } else {
      const clients = new Set(state.callClientsByRoom[roomId][user] || []);
      if (clientId) clients.delete(clientId);
      if (clientId && clients.size) {
        state.callClientsByRoom[roomId][user] = [...clients];
      } else {
        delete state.callClientsByRoom[roomId][user];
        if (
          user !== me ||
          clientId === localClientId ||
          !state.inCall ||
          state.callRoom !== roomId
        )
          members.delete(user);
        callManager?.removePeer(user, clientId);
        if (user !== me) removeRemoteCallMedia(user);
      }
    }
    state.voiceMembersByRoom[roomId] = [...members];
  }

  function handleCallSignal(d) {
    if (!state.inCall || !callManager) return;
    const from = sanitizeUsername(d?.from);
    const fromClientId = sanitizeClientId(d?.fromClientId);
    if (
      from &&
      from === sanitizeUsername(state.username) &&
      (!fromClientId || fromClientId === localClientId)
    )
      return;
    if (d?.toClientId && sanitizeClientId(d.toClientId) !== localClientId)
      return;
    if (d?.fromPlatform) rememberClientPlatform(from, d.fromPlatform);
    callManager.handleSignal({
      gameId: sanitizeRoomId(d?.gameId),
      to: sanitizeUsername(d?.to),
      from,
      toClientId: sanitizeClientId(d?.toClientId),
      fromClientId,
      fromPlatform: sanitizePlatform(d?.fromPlatform),
      type: d?.type,
      sdp: typeof d?.sdp === "string" ? d.sdp : undefined,
      candidate: d?.candidate,
    });
  }

  function handleIncomingCallChunk(d, fromUser) {
    // Backward compatibility for old clients still sending op 99 chunks.
    if (!d?.chunk) return;
    const roomId = sanitizeRoomId(d.gameId || state.activeRoom);
    if (fromUser && roomId) {
      if (!state.speakingByRoom[roomId]) state.speakingByRoom[roomId] = {};
      state.speakingByRoom[roomId][fromUser] = Date.now();
      const members = state.voiceMembersByRoom[roomId] || [];
      if (!members.includes(fromUser))
        state.voiceMembersByRoom[roomId] = [...members, fromUser];
    }
  }

  function handleVoiceState(d) {
    const roomId = sanitizeRoomId(d?.gameId);
    if (!roomId) return;
    const user = sanitizeUsername(d?.user);
    if (!user || d?.ok) return; // our own op 98 ack has {ok} but no user — skip
    if (d?.media) {
      handleCallState(d);
      return;
    }
    const members = new Set(state.voiceMembersByRoom[roomId] || []);
    if (d.isVoiceChat === true) members.add(user);
    else members.delete(user);
    state.voiceMembersByRoom[roomId] = [...members];
  }

  // Keep op 98 as a manual toggle for backward compat (affects voice eligibility).
  function toggleVoice() {
    if (state.inCall) {
      endCall();
    } else {
      startCall();
    }
  }

  async function changeUsername(newName) {
    const clean = sanitizeUsername(newName);
    const validation = validateUsername(clean);
    if (validation) {
      state.lastError = validation;
      return false;
    }

    const previous = sanitizeUsername(state.username);
    if (clean === previous) return true;

    try {
      const data = await apiRequest("/api/auth/username", {
        method: "POST",
        body: JSON.stringify({ username: clean }),
      });

      if (data?.user) {
        const next = sanitizeUsername(data.user.username);
        state.username = next;
        state.userId = String(data.user.id || state.userId || "");
        state.admin = Boolean(data.user.admin);

        if (previous && next && previous !== next) {
          for (const roomId of Object.keys(state.usersByRoom)) {
            state.usersByRoom[roomId] = (state.usersByRoom[roomId] || []).map(
              (user) =>
                sanitizeUsername(user) === previous
                  ? next
                  : sanitizeUsername(user),
            );
          }

          for (const roomId of Object.keys(state.voiceMembersByRoom)) {
            state.voiceMembersByRoom[roomId] = (
              state.voiceMembersByRoom[roomId] || []
            ).map((user) =>
              sanitizeUsername(user) === previous
                ? next
                : sanitizeUsername(user),
            );
          }

          for (const roomId of Object.keys(state.callClientsByRoom)) {
            const byUser = state.callClientsByRoom[roomId] || {};
            if (byUser[previous]) {
              byUser[next] = byUser[previous];
              delete byUser[previous];
            }
          }

          if (state.profilesByUser[previous]) {
            state.profilesByUser[next] = state.profilesByUser[previous];
            delete state.profilesByUser[previous];
          }
          if (state.statusesByUser[previous]) {
            state.statusesByUser[next] = state.statusesByUser[previous];
            delete state.statusesByUser[previous];
          }
          if (state.clientPlatformsByUser[previous]) {
            state.clientPlatformsByUser[next] =
              state.clientPlatformsByUser[previous];
            delete state.clientPlatformsByUser[previous];
          }
          if (state.remoteCallMediaByUser[previous]) {
            state.remoteCallMediaByUser[next] =
              state.remoteCallMediaByUser[previous];
            delete state.remoteCallMediaByUser[previous];
          }
          if (state.remoteCallStreamsByUser[previous]) {
            state.remoteCallStreamsByUser[next] =
              state.remoteCallStreamsByUser[previous];
            delete state.remoteCallStreamsByUser[previous];
          }
        }
      }

      persist();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Username change failed.";
      showToast(state.lastError);
      return false;
    }
  }

  function clearAllData() {
    if (state.inCall) endCall();
    if (state.recording) stopRecordingVoiceMemo(true);
    disconnect();
    for (const url of attachmentUrlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    attachmentUrlCache.clear();
    state.rooms = [];
    state.messagesByRoom = {};
    state.unreadByRoom = {};
    state.roomKeysByRoom = {};
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.statusesByUser = {};
    state.localRoomIcons = {};
    state.profile = normalizeProfile(null);
    state.status = "online";
    state.activeRoom = "";
    state.joinedRooms = [];
    state.pendingJoinRooms = [];
    persist();
  }

  function toggleReaction(message, emoji) {
    if (state.connected && state.identified && message?.messageId) {
      send({
        op: 19,
        d: {
          messageId: message.messageId,
          reaction: emoji,
          gameId: message.roomId || state.activeRoom,
        },
      });
    }
  }

  function deleteMessage(message) {
    if (!state.connected || !state.identified || !message?.messageId) return;
    const gameId = message.roomId || state.activeRoom;
    if (!gameId) return;
    if (state.editingMessage?.messageId === message.messageId)
      cancelEditMessage();
    send({ op: 21, d: { messageId: message.messageId, gameId } });
  }

  function canEditMessage(message) {
    return Boolean(
      message &&
      isOwnMessage(message) &&
      !message.deleted &&
      !message.locked &&
      !message.system &&
      !message.attachment &&
      message.kind === "text",
    );
  }

  function startEditMessage(message) {
    if (!canEditMessage(message)) return;
    const roomId = sanitizeRoomId(message.roomId || state.activeRoom);
    if (!roomId || !message.messageId) return;
    state.replyingTo = null;
    state.editingMessage = {
      messageId: message.messageId,
      roomId,
      text: message.rawText || message.text || "",
    };
    state.messageInput = message.rawText || message.text || "";
    nextTick(() => {
      const input = document.querySelector(
        ".composer__input textarea",
      ) as HTMLTextAreaElement | null;
      input?.focus();
      try {
        input?.setSelectionRange(input.value.length, input.value.length);
      } catch {
        /* selection is best effort */
      }
    });
  }

  function cancelEditMessage() {
    state.editingMessage = null;
    state.messageInput = "";
  }

  function editCurrentMessage(text) {
    const draft = state.editingMessage;
    if (!draft?.messageId) return;
    const roomId = sanitizeRoomId(draft.roomId || state.activeRoom);
    const nextText = String(text || "")
      .trim()
      .slice(0, MESSAGE_LIMIT);
    if (!roomId || !nextText) return;
    if (
      !state.connected ||
      !state.identified ||
      !state.joinedRooms.includes(roomId)
    ) {
      state.lastError = "Not joined to this room yet.";
      showToast(state.lastError);
      return;
    }

    buildEncryptedOutgoingMessage(roomId, { text: nextText, attachment: null })
      .then((encrypted) => {
        send({
          op: 29,
          d: {
            messageId: draft.messageId,
            gameId: roomId,
            text: "",
            encrypted,
          },
        });
        state.messageInput = "";
        state.editingMessage = null;
      })
      .catch((error) => {
        state.lastError = error?.message || "Message edit failed.";
        showToast(state.lastError);
      });
  }

  function logoutLocal() {
    if (state.inCall) endCall();
    if (state.recording) stopRecordingVoiceMemo(true);
    disconnect();
    state.authToken = "";
    state.userId = "";
    state.admin = false;
    state.username = "";
    state.uuid = null;
    state.recoveryWords = [];
    state.profile = normalizeProfile(null);
    state.status = "online";
    persist();
  }

  async function logoutAccount() {
    try {
      if (state.authToken) {
        await apiRequest("/api/auth/logout", { method: "POST" });
      }
    } catch {
      /* local logout still wins */
    }
    logoutLocal();
  }

  async function deleteAccount(password) {
    if (!state.authToken) throw new Error("Not authenticated.");
    await apiRequest("/api/auth/delete", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    logoutLocal();
  }

  function findMessageById(roomId, messageId) {
    const id = sanitizeRoomId(roomId || state.activeRoom);
    const target = String(messageId || "");
    if (!id || !target) return null;
    return (
      (state.messagesByRoom[id] || []).find(
        (message) => message.messageId === target,
      ) || null
    );
  }

  function startReply(message) {
    if (!message?.messageId || message.deleted) return;
    state.editingMessage = null;
    state.replyingTo = {
      messageId: message.messageId,
      roomId: message.roomId || state.activeRoom,
      username: message.username || "",
      text:
        message.kind === "image"
          ? "Photo"
          : message.kind === "video"
            ? "Video"
            : message.kind === "file"
              ? "File attachment"
              : message.text || "",
    };
  }

  function cancelReply() {
    state.replyingTo = null;
  }

  function applyPreview(payload) {
    const messageId = payload?.messageId;
    const targetRoom = sanitizeRoomId(payload?.gameId || "");
    const preview = payload?.preview;
    if (!messageId || !preview || typeof preview !== "object") return;
    const rooms = targetRoom ? [targetRoom] : Object.keys(state.messagesByRoom);
    for (const id of rooms) {
      const arr = state.messagesByRoom[id];
      if (!arr) continue;
      const index = arr.findIndex((m) => m.messageId === messageId);
      if (index === -1) continue;
      if (arr[index].deleted) return;
      arr[index] = normalizeMessage({ ...arr[index], preview }, id);
      persist();
      return;
    }
  }

  function requestEncryptedLinkPreview(message) {
    if (
      !message?.encrypted ||
      message.preview ||
      message.deleted ||
      message.locked
    )
      return;
    if (
      !state.connected ||
      !state.identified ||
      !state.ws ||
      state.ws.readyState !== WebSocket.OPEN
    )
      return;

    const roomId = sanitizeRoomId(message.roomId || state.activeRoom);
    const messageId = String(message.messageId || "");
    if (!roomId || !messageId || !state.joinedRooms.includes(roomId)) return;

    const url = findFirstLinkPreviewUrl(message.rawText || message.text || "");
    if (!url) return;

    const key = `${roomId}:${messageId}:${url}`;
    if (pendingLinkPreviewRequests.has(key)) return;
    pendingLinkPreviewRequests.add(key);

    send({
      op: 28,
      d: {
        gameId: roomId,
        messageId,
        url,
      },
    });
  }

  function applyDeletion(payload) {
    const messageId = payload?.messageId;
    if (!messageId) return;
    if (state.editingMessage?.messageId === messageId) cancelEditMessage();
    const targetRoom = sanitizeRoomId(payload?.gameId || "");
    const rooms = targetRoom ? [targetRoom] : Object.keys(state.messagesByRoom);
    for (const id of rooms) {
      const arr = state.messagesByRoom[id];
      if (!arr) continue;
      const index = arr.findIndex((m) => m.messageId === messageId);
      if (index === -1) continue;
      // Drop any associated Blob URL so it can be GC'd.
      try {
        attachmentUrlCache.get(messageId) &&
          URL.revokeObjectURL(attachmentUrlCache.get(messageId));
      } catch {
        /* ignore */
      }
      attachmentUrlCache.delete(messageId);
      arr[index] = normalizeMessage(
        {
          ...arr[index],
          text: "",
          attachment: null,
          preview: null,
          reactions: [],
          editedAt: 0,
          deleted: true,
        },
        id,
      );
      persist();
      return;
    }
  }

  function pushMessageToRoom(roomId, normalized) {
    const id = sanitizeRoomId(roomId);
    if (!id) return false;
    if (!state.messagesByRoom[id]) state.messagesByRoom[id] = [];
    const arr = state.messagesByRoom[id];
    const index = arr.findIndex((m) => m.messageId === normalized.messageId);
    if (index === -1) {
      if (isDuplicateRecentMessage(arr, normalized)) return false;
      arr.push(normalized);
      if (arr.length > MAX_HISTORY_PER_ROOM)
        arr.splice(0, arr.length - MAX_HISTORY_PER_ROOM);
      return true;
    } else {
      arr[index] = normalized;
      return false;
    }
  }

  async function upsertMessage(message) {
    const roomId = sanitizeRoomId(message.roomId || state.activeRoom);
    const normalized = await hydrateIncomingMessage(message, roomId);
    const me = sanitizeUsername(state.username);
    if (me && !isOwnMessage(normalized)) {
      normalized.mentioned = new RegExp(
        `(^|[^a-z0-9_.])@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9_.])`,
        "i",
      ).test(String(normalized.text || ""));
    }
    const added = pushMessageToRoom(roomId, normalized);
    touchRoom(roomId, normalized);

    const mine = isOwnMessage(normalized);
    if (added && !mine) playMessageNotificationSound();
    if (added && !mine) showAndroidMessageNotification(normalized, roomId);
    if (!mine && roomId !== state.activeRoom) {
      state.unreadByRoom[roomId] = (state.unreadByRoom[roomId] || 0) + 1;
    }

    if (roomId === state.activeRoom) scrollToBottom();
    requestEncryptedLinkPreview(normalized);
    persist();
  }

  function applyReactions(payload) {
    const messageId = payload?.messageId;
    const targetRoom = sanitizeRoomId(payload?.roomId || "");
    const rooms = targetRoom ? [targetRoom] : Object.keys(state.messagesByRoom);
    for (const id of rooms) {
      const arr = state.messagesByRoom[id];
      if (!arr) continue;
      const index = arr.findIndex((m) => m.messageId === messageId);
      if (index !== -1) {
        arr[index] = normalizeMessage(
          { ...arr[index], reactions: payload.reactions || [] },
          id,
        );
        persist();
        return;
      }
    }
  }

  function handleMessage(message) {
    const { op, d } = message;
    switch (op) {
      case 0:
        if (d?.error) state.lastError = d.error;
        break;
      case 1:
        /* heartbeat ack — ignored */
        break;
      case 2:
        if (d?.error) {
          state.lastError = d.error;
          break;
        }
        state.uuid = d.uuid;
        state.userId = String(d.uuid || state.userId || "");
        if (d?.username) state.username = sanitizeUsername(d.username);
        state.admin = Boolean(d?.admin || state.admin);
        state.identified = true;
        const persistedJoinedRooms = [
          ...new Set(
            (state.joinedRooms || [])
              .map((r) => sanitizeRoomId(r))
              .filter((r) => isValidRoomId(r)),
          ),
        ];
        const allKnownRooms = [
          ...new Set([
            ...persistedJoinedRooms,
            ...(state.rooms || [])
              .map((r) => sanitizeRoomId(r.roomId))
              .filter((r) => isValidRoomId(r)),
          ]),
        ];
        state.joinedRooms = [];
        state.pendingJoinRooms = [];
        state.usersByRoom = {};
        state.voiceMembersByRoom = {};
        state.callClientsByRoom = {};
        state.typingByRoom = {};
        if (d?.profile) state.profile = normalizeProfile(d.profile);
        if (d?.status) state.status = sanitizePresenceStatus(d.status);
        state.systemBanner = "";
        for (const roomId of allKnownRooms) touchRoom(roomId);
        for (const roomId of allKnownRooms) requestJoin(roomId);
        if (
          state.activeRoom &&
          !persistedJoinedRooms.includes(state.activeRoom)
        )
          touchRoom(state.activeRoom);
        allKnownRooms.forEach((roomId, index) => {
          if (index === 0) requestJoin(roomId);
          else setTimeout(() => requestJoin(roomId), index * 30);
        });
        break;
      case 3:
        handleJoinOp(d);
        break;
      case 4:
        handleLeaveOp(d);
        break;
      case 7:
        if (d?.error) {
          state.lastError = d.error;
        } else if (d?.messageId && typeof d?.timestamp === "number") {
          // Full broadcast frame ({messageId, text, username, timestamp, ...}).
          upsertMessage(d).catch(() => {
            state.lastError = "Could not process encrypted message.";
          });
        }
        // else: {messageId, ok: true} sender-ack — ignored, we already got the broadcast.
        break;
      case 10:
        if (d?.heartbeat_interval) {
          state.heartbeatInterval = d.heartbeat_interval;
          startHeartbeat();
        }
        break;
      case 18:
        handleHistoryOp(d).catch(() => {
          state.lastError = "Could not decrypt room history.";
        });
        break;
      case 20:
        applyReactions(d);
        break;
      case 22:
        applyDeletion(d);
        break;
      case 23:
        applyPreview(d);
        break;
      case 24:
        state.lastError = d?.reason
          ? `Blacklisted: ${d.reason}`
          : "Blacklisted.";
        disconnect();
        break;
      case 25:
        applyRoomMessagesDeleted(d);
        break;
      case 26:
        applyProfileUpdate(d);
        break;
      case 27:
        applyPresenceStatus(d);
        break;
      case 28:
        if (d?.error) state.lastError = d.error;
        break;
      case 29:
        if (d?.error) {
          state.lastError = d.error;
          showToast(d.error);
        }
        break;
      case 30:
        if (d?.messageId && typeof d?.timestamp === "number") {
          upsertMessage(d).catch(() => {
            state.lastError = "Could not process edited message.";
          });
        }
        break;
      case 31:
        if (d?.gameId && d?.username) {
          markUserTyping(d.gameId, d.username, Boolean(d.typing));
        }
        break;
      case 13:
        {
          const key = sanitizeUsername(d?.username || d?.user);
          if (key) {
            if (d?.platform) rememberClientPlatform(key, d.platform);
            else if (typeof d?.isMobile === "boolean")
              rememberClientPlatform(key, d.isMobile ? "mobile" : "desktop");
            if (d?.profile)
              state.profilesByUser[key] = normalizeProfile(d.profile);
            if (d?.status)
              state.statusesByUser[key] = sanitizePresenceStatus(d.status);
          }
        }
        break;
      case 87:
        state.systemBanner = d?.msg || state.systemBanner;
        break;
      case 98:
        handleVoiceState(d);
        break;
      case 99:
        handleIncomingCallChunk(d, message.u);
        break;
      case 110:
        handleCallState(d);
        break;
      case 111:
        handleCallSignal(d);
        break;
      default:
        break;
    }
  }

  function handleJoinOp(d) {
    const roomId = applyRoomSnapshot(d, d?.gameId);
    if (!roomId) return;

    state.pendingJoinRooms = state.pendingJoinRooms.filter((r) => r !== roomId);

    if (d?.error) {
      state.joinedRooms = state.joinedRooms.filter((r) => r !== roomId);
      if (
        d.error === "Join the room first" ||
        d.error === "Not joined to this room yet."
      ) {
        delete state.usersByRoom[roomId];
        delete state.voiceMembersByRoom[roomId];
        delete state.callClientsByRoom[roomId];
        delete state.typingByRoom[roomId];
      }
      persist();
      return;
    }

    if (d?.ok && !d?.system) {
      if (!state.joinedRooms.includes(roomId)) state.joinedRooms.push(roomId);
      touchRoom(roomId);
      fetchHistory(roomId);
      persist();
    }
  }

  function applyProfiles(profiles) {
    for (const [username, profile] of Object.entries(profiles || {})) {
      const key = sanitizeUsername(username);
      if (key) state.profilesByUser[key] = normalizeProfile(profile);
    }
  }

  function applyStatuses(statuses) {
    for (const [username, status] of Object.entries(statuses || {})) {
      const key = sanitizeUsername(username);
      if (key) state.statusesByUser[key] = sanitizePresenceStatus(status);
    }
  }

  function applyPlatformsMap(platformsMap) {
    if (!platformsMap || typeof platformsMap !== "object") return;
    for (const [username, platforms] of Object.entries(platformsMap)) {
      const key = sanitizeUsername(username);
      if (!key) continue;
      for (const platform of Array.isArray(platforms)
        ? platforms
        : [platforms]) {
        rememberClientPlatform(key, platform);
      }
    }
  }

  function applyCallPlayersSnapshot(roomId, callPlayers) {
    if (!roomId || !Array.isArray(callPlayers)) return;
    const members = new Set<string>();
    state.callClientsByRoom[roomId] = {};
    for (const player of callPlayers) {
      const user = sanitizeUsername(player?.user || player?.username || player);
      if (!user) continue;
      members.add(user);
      const clientId = sanitizeClientId(player?.clientId);
      if (clientId) {
        const clients = new Set(state.callClientsByRoom[roomId][user] || []);
        clients.add(clientId);
        state.callClientsByRoom[roomId][user] = [...clients];
      }
      if (player?.platform) rememberClientPlatform(user, player.platform);
      updateRemoteMedia(user, player?.media);
    }
    state.voiceMembersByRoom[roomId] = [...members];
  }

  function applyRoomSnapshot(d, fallbackRoomId = "") {
    const roomId = sanitizeRoomId(
      d?.gameId || fallbackRoomId || state.activeRoom,
    );
    if (!roomId) return "";

    if (Array.isArray(d?.players)) {
      state.usersByRoom[roomId] = normalizeRoomUsers(d.players);
    }
    if (d?.profiles && typeof d.profiles === "object") {
      applyProfiles(d.profiles);
    }
    if (d?.statuses && typeof d.statuses === "object") {
      applyStatuses(d.statuses);
    }
    applyPlatformsMap(d?.platforms);
    if (Array.isArray(d?.voicePlayers)) {
      state.voiceMembersByRoom[roomId] = normalizeRoomUsers(d.voicePlayers);
    }
    applyCallPlayersSnapshot(roomId, d?.callPlayers);

    return roomId;
  }

  function applyProfileUpdate(d) {
    applyRoomSnapshot(d, d?.gameId);
    const key = sanitizeUsername(d?.user);
    if (!key) return;
    const profile = normalizeProfile(d?.profile);
    if (key === sanitizeUsername(state.username)) state.profile = profile;
    state.profilesByUser[key] = profile;
  }

  function applyIncrementalRoomUserState(
    roomId,
    username,
    options: {
      visible?: boolean;
      removeVoice?: boolean;
      removeCalls?: boolean;
      removeMedia?: boolean;
      preserveSelf?: boolean;
    } = {},
  ) {
    const id = sanitizeRoomId(roomId);
    const user = sanitizeUsername(username);
    if (!id || !user) return;

    const {
      visible = true,
      removeVoice = false,
      removeCalls = false,
      removeMedia = false,
      preserveSelf = false,
    } = options;

    const me = sanitizeUsername(state.username);
    const current = new Set(state.usersByRoom[id] || []);
    if (visible || (preserveSelf && user === me)) current.add(user);
    else current.delete(user);
    state.usersByRoom[id] = [...current];

    if (removeVoice) {
      state.voiceMembersByRoom[id] = (
        state.voiceMembersByRoom[id] || []
      ).filter((member) => member !== user);
    }
    if (removeCalls) {
      delete state.callClientsByRoom[id]?.[user];
    }
    if (removeMedia) {
      removeRemoteCallMedia(user);
    }
  }

  function applyPresenceStatus(d) {
    const roomId = applyRoomSnapshot(d, d?.gameId);
    const key = sanitizeUsername(d?.user);
    const me = sanitizeUsername(state.username);

    if (!key) return;
    const status = sanitizePresenceStatus(d?.status);
    const visible = d?.visible !== false;

    state.statusesByUser[key] = status;
    if (d?.profile) state.profilesByUser[key] = normalizeProfile(d.profile);
    if (d?.platform) rememberClientPlatform(key, d.platform);
    if (key === me) state.status = status;

    if (!roomId) return;
    if (!Array.isArray(d?.players)) {
      applyIncrementalRoomUserState(roomId, key, {
        visible,
        preserveSelf: true,
        removeVoice: !visible && key !== me && !Array.isArray(d?.voicePlayers),
        removeMedia: !visible && key !== me && !Array.isArray(d?.voicePlayers),
      });
    }
  }

  function handleLeaveOp(d) {
    const roomId = applyRoomSnapshot(d, d?.gameId);
    if (!roomId) return;

    if (d?.ok) {
      state.joinedRooms = state.joinedRooms.filter((r) => r !== roomId);
      state.pendingJoinRooms = state.pendingJoinRooms.filter(
        (r) => r !== roomId,
      );
      if (state.deleteMessagesOnLeave || state.serverClearsLocalMessages) {
        removeRoom(roomId);
        return;
      }
      delete state.usersByRoom[roomId];
      delete state.voiceMembersByRoom[roomId];
      delete state.callClientsByRoom[roomId];
      delete state.typingByRoom[roomId];
      applyDeletedMessageIds(roomId, d.deletedMessageIds);
      if (roomId === state.activeRoom) state.activeRoom = "";
      persist();
    } else if (d?.left) {
      const left = sanitizeUsername(d.left);
      if (!Array.isArray(d?.players)) {
        applyIncrementalRoomUserState(roomId, left, {
          visible: false,
          removeVoice: !Array.isArray(d?.voicePlayers),
          removeCalls: !Array.isArray(d?.callPlayers),
        });
      }
    }
  }

  function applyDeletedMessageIds(roomId, messageIds) {
    const id = sanitizeRoomId(roomId);
    if (!id || !Array.isArray(messageIds)) return;
    const deleted = new Set(
      (messageIds || [])
        .map((messageId) => String(messageId || ""))
        .filter(Boolean),
    );
    if (!deleted.size) return;
    state.messagesByRoom[id] = (state.messagesByRoom[id] || []).filter(
      (message) => !deleted.has(String(message?.messageId || "")),
    );
    const room = state.rooms.find((entry) => entry.roomId === id);
    if (room) {
      const latest = latestVisibleRoomMessage(state.messagesByRoom[id] || []);
      room.lastPreview = messagePreviewLabel(latest) || "";
      room.lastSender = latest?.username || "";
      room.lastTimestamp = Number(latest?.timestamp || 0);
    }
  }

  function applyRoomMessagesDeleted(d) {
    const roomId = sanitizeRoomId(d?.gameId);
    if (!roomId) return;
    applyDeletedMessageIds(roomId, d.messageIds);
    persist();
  }

  async function handleHistoryOp(d) {
    if (!d?.ok) return;
    const roomId = sanitizeRoomId(d.roomId);
    if (!roomId) return;
    if (
      !state.joinedRooms.includes(roomId) &&
      !state.pendingJoinRooms.includes(roomId) &&
      roomId !== state.activeRoom
    )
      return;
    const serverMessages = Array.isArray(d.messages)
      ? await Promise.all(
          d.messages.map((m) => hydrateIncomingMessage(m, roomId)),
        )
      : [];
    const localMessages = state.messagesByRoom[roomId] || [];
    const serverMessageIds = new Set(
      serverMessages
        .map((message) => String(message?.messageId || ""))
        .filter(Boolean),
    );
    const keptLocalMessages = state.serverClearsLocalMessages
      ? []
      : localMessages.filter((message) => {
          const messageId = String(message?.messageId || "");
          return !messageId || !serverMessageIds.has(messageId);
        });
    const messages = mergeRoomHistory(
      keptLocalMessages,
      serverMessages,
      roomId,
    );
    state.messagesByRoom[roomId] = messages;
    const last = messages[messages.length - 1];
    touchRoom(roomId, last || localMessages[localMessages.length - 1] || null);
    for (const message of serverMessages) requestEncryptedLinkPreview(message);
    if (roomId === state.activeRoom) scrollToBottom();
    persist();
  }

  function mergeRoomHistory(localMessages, serverMessages, roomId) {
    const byId = new Map();
    for (const message of localMessages || []) {
      const normalized = normalizeMessage(message, roomId);
      if (normalized.messageId) byId.set(normalized.messageId, normalized);
    }
    for (const message of serverMessages || []) {
      const normalized = normalizeMessage(message, roomId);
      if (normalized.messageId) byId.set(normalized.messageId, normalized);
    }
    return [...byId.values()]
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
      .slice(-MAX_HISTORY_PER_ROOM);
  }

  function isOwnMessage(message) {
    const me = sanitizeUsername(state.username);
    return !!me && me === message.username;
  }

  function exportData() {
    const payload = {
      version: 4,
      exportedAt: new Date().toISOString(),
      username: state.username,
      status: sanitizePresenceStatus(state.status),
      profile: normalizeProfile(state.profile),
      activeRoom: state.activeRoom,
      rooms: state.rooms,
      messagesByRoom: state.messagesByRoom,
      unreadByRoom: state.unreadByRoom,
      roomKeysByRoom: sanitizeRoomKeys(state.roomKeysByRoom),
      deleteMessagesOnLeave: state.deleteMessagesOnLeave,
      autoArchiveUploads: state.autoArchiveUploads,
      streamerMode: state.streamerMode,
      typingIndicatorsEnabled: state.typingIndicatorsEnabled,
      messageSoundEnabled: state.messageSoundEnabled,

      callSoundsEnabled: state.callSoundsEnabled,
      soundFlags: { ...state.soundFlags },
      themeMode: state.themeMode,
      appAccent: state.appAccent,
      messageStyle: state.messageStyle,
      androidNotificationsEnabled: state.androidNotificationsEnabled,
      serverClearsLocalMessages: state.serverClearsLocalMessages,
      autoReconnectEnabled: state.autoReconnectEnabled,
      reconnectMinDelayMs: state.reconnectMinDelayMs,
      reconnectMaxDelayMs: state.reconnectMaxDelayMs,
      callUserVolumes: sanitizeCallUserVolumes(state.callUserVolumes),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `qxprotocol-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    state.settingsOpen = false;
    state.systemBanner = "Backup exported.";
    setTimeout(() => {
      if (state.systemBanner === "Backup exported.") state.systemBanner = "";
    }, 2000);
  }

  function importData(file) {
    state.settingsOpen = false;
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      state.lastError = "Couldn't read file.";
    };
    reader.onload = (e) => {
      try {
        const data = JSON.parse(String(e.target.result));
        if (!data || typeof data !== "object") throw new Error("Not an object");
        const usedToBeConnected = state.connected;
        if (usedToBeConnected) disconnect();

        if (typeof data.username === "string")
          state.username = sanitizeUsername(data.username);
        state.status = sanitizePresenceStatus(data.status);
        state.profile = normalizeProfile(data.profile);

        if (Array.isArray(data.rooms)) {
          state.rooms = data.rooms
            .filter((r) => r && typeof r.roomId === "string")
            .slice(0, MAX_ROOMS_SHOWN)
            .map((r) => ({
              roomId: sanitizeRoomId(r.roomId),
              lastPreview: String(r.lastPreview || ""),
              lastTimestamp: Number(r.lastTimestamp) || 0,
              lastSender: String(r.lastSender || ""),
            }))
            .filter((r) => isValidRoomId(r.roomId));
        }

        if (data.messagesByRoom && typeof data.messagesByRoom === "object") {
          const next = {};
          for (const [id, arr] of Object.entries(data.messagesByRoom)) {
            if (!Array.isArray(arr)) continue;
            const roomId = sanitizeRoomId(id);
            if (!isValidRoomId(roomId)) continue;
            next[roomId] = arr
              .slice(-MAX_HISTORY_PER_ROOM)
              .map((m) => normalizeMessage(m, id));
          }
          state.messagesByRoom = next;
        }

        if (data.unreadByRoom && typeof data.unreadByRoom === "object") {
          const next = {};
          for (const [id, n] of Object.entries(data.unreadByRoom)) {
            const v = Number(n);
            const roomId = sanitizeRoomId(id);
            if (Number.isFinite(v) && v > 0 && isValidRoomId(roomId))
              next[roomId] = v;
          }
          state.unreadByRoom = next;
        }

        state.roomKeysByRoom = sanitizeRoomKeys(data.roomKeysByRoom);

        if (typeof data.activeRoom === "string") {
          state.activeRoom = isValidRoomId(data.activeRoom)
            ? sanitizeRoomId(data.activeRoom)
            : "";
        }
        if (typeof data.deleteMessagesOnLeave === "boolean")
          state.deleteMessagesOnLeave = data.deleteMessagesOnLeave;
        if (typeof data.streamerMode === "boolean")
          state.streamerMode = data.streamerMode;
        if (typeof data.messageSoundEnabled === "boolean")
          state.messageSoundEnabled = data.messageSoundEnabled;
        if (typeof data.typingIndicatorsEnabled === "boolean")
          state.typingIndicatorsEnabled = data.typingIndicatorsEnabled;
        if (typeof data.themeMode === "string") setThemeMode(data.themeMode);
        if (typeof data.callSoundsEnabled === "boolean")
          setCallSoundsEnabled(data.callSoundsEnabled);
        if (data.soundFlags && typeof data.soundFlags === "object") {
          for (const key of Object.keys(state.soundFlags)) {
            if (typeof data.soundFlags[key] === "boolean")
              setSoundEnabled(key, data.soundFlags[key]);
          }
        }
        if (typeof data.appAccent === "string") setAppAccent(data.appAccent);
        if (typeof data.messageStyle === "string")
          setMessageStyle(data.messageStyle);
        if (typeof data.androidNotificationsEnabled === "boolean")
          state.androidNotificationsEnabled = data.androidNotificationsEnabled;
        if (typeof data.autoArchiveUploads === "boolean")
          state.autoArchiveUploads = data.autoArchiveUploads;
        if (typeof data.autoReconnectEnabled === "boolean")
          state.autoReconnectEnabled = data.autoReconnectEnabled;
        if (typeof data.serverClearsLocalMessages === "boolean")
          state.serverClearsLocalMessages = data.serverClearsLocalMessages;
        else state.serverClearsLocalMessages = true;
        setReconnectDelays(data.reconnectMinDelayMs, data.reconnectMaxDelayMs);
        state.callUserVolumes = sanitizeCallUserVolumes(data.callUserVolumes);

        persist();
        state.lastError = "";
        state.systemBanner = "Backup imported.";
        setTimeout(() => {
          if (state.systemBanner === "Backup imported.")
            state.systemBanner = "";
        }, 2000);

        if (usedToBeConnected) connect();
      } catch (err) {
        state.lastError = `Import failed: ${err.message}`;
      }
    };
    reader.readAsText(file);
  }

  function logout() {
    localStorage.clear();
    document.cookie = "";
    window.location.reload();
  }

  installRealtimeLifecycleHandlers();

  singleton = {
    QUICK_REACTIONS,
    MESSAGE_LIMIT,
    MAX_PROFILE_DESCRIPTION_LENGTH,
    MAX_PROFILE_PRONOUNS_LENGTH,
    PRESENCE_STATUSES,
    state,
    roomTitle,
    roomLabel,
    connectionLabel,
    callsAvailable,
    callsUnavailableReason,
    screenShareAvailable,
    screenShareUnavailableReason,
    onlineCount,
    canSend,
    sortedMessages,
    conversations,
    activeConversation,
    memberRoster,
    typingUsers,
    myProfile,
    myStatus,
    accentFor,
    formatTime,
    formatDay,
    formatSize,
    formatDuration,
    buildWaveform,
    attachmentUrlFor,
    displayRoomName,
    validateUsername,
    validateRoomId,
    isValidRoomId,
    hasRoomKey,
    roomAccessToken,
    profileFor,
    statusFor,
    presenceStatusLabel,
    profileImageSrc,
    platformsForUser,
    mutualRoomsWith,
    platformLabel,
    platformIcon,
    showToast,

    persist,
    registerAccount,
    loginAccount,
    recoverAccount,
    refreshSession,
    logoutAccount,
    deleteAccount,
    downloadRecoveryWords,
    loadAdminOverview,
    setAdminFeature,
    setAdminUserDisabled,
    setAdminUserBanned,
    refreshAudioDevices,
    unlockAudioDevices,
    startMicTest,
    stopMicTest,
    setAudioInput,
    setAudioOutput,
    setMicrophoneThreshold,
    setDeleteMessagesOnLeave,
    setStreamerMode,
    setMessageSoundEnabled,
    setTypingIndicatorsEnabled,
    setCallSoundsEnabled,
    setSoundEnabled,
    previewSound,
    setAndroidNotificationsEnabled,
    setThemeMode,
    setAppAccent,
    setMessageStyle,
    setAutoReconnectEnabled,
    setServerClearsLocalMessages,
    setAutoArchiveUploads,
    setReconnectDelays,
    requestNotificationPermission,
    notificationPermission,
    setPresenceStatus,
    setProfileText,
    setProfileImageFromFile,
    clearProfileImage,
    callUserVolume,
    setCallUserVolume,
    applyAudioOutput,
    connect,
    disconnect,
    selectConversation,
    leaveRoom,
    sendChat,
    setTyping,
    sendAttachment,
    startRecordingVoiceMemo,
    stopRecordingVoiceMemo,
    startCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    toggleVoice,
    localPreviewStream,
    remoteCallStream,
    remoteVideoStream,
    toggleReaction,
    deleteMessage,
    canEditMessage,
    startEditMessage,
    cancelEditMessage,
    findMessageById,
    startReply,
    cancelReply,
    fetchHistory,
    isOwnMessage,
    startCompose,
    cancelCompose,
    submitCompose,
    createRandomRoom,
    copyRoomInvite,
    removeRoom,
    touchRoom,
    exportData,
    importData,
    changeUsername,
    roomNote,
    setRoomNote,
    setLocalRoomName,
    clearLocalRoomName,
    roomIcon,
    setLocalRoomIcon,
    setLocalRoomIconFromFile,
    clearLocalRoomIcon,
    clearAllData,
    logout,
  };

  return singleton;
}
