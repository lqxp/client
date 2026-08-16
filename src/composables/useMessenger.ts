import { computed, inject, nextTick, reactive } from "vue";
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
  webRtcSupported,
} from "@/calls/WebRtcCallManager";
import { apiUrl, appRuntimeConfig, turnServerList, selectedTurnServerId as runtimeDefaultTurnServerId } from "@/config/runtime";
import {
  canonicalDeviceSigningKey,
  cryptoAvailable,
  decryptRoomPayload,
  encryptRoomPayload,
  generateDeviceId,
  generateDeviceSigningKeyPair,
  generateRoomAccessToken,
  generateRoomKey,
  parseRoomAccessToken,
  normalizeRoomKey,
} from "@/crypto/e2ee";
import { solveVdf } from "@/crypto/vdf";
import { computeNullifier } from "@/crypto/rln";
import { encapsulatePqcSecret } from "@/crypto/pqc";
import {
  playCameraOffSound,
  playCameraOnSound,
  playDeafenSound,
  playJoinSound,
  playLeaveSound,
  playMuteSound,
  playScreenOffSound,
  playScreenOnSound,
  playUndeafenSound,
  playUnmuteSound,
  setCallSoundsActive,
  setSoundFlag,
} from "@/calls/callSounds";
import { useI18n } from "./useI18n";

const STORAGE_KEY = "qxprotocol-messenger-v7";
const PROFILE_STORAGE_KEY = "qxprotocol-profile-v1";
const OPSEC_DECOY_STORAGE_KEY = "qxprotocol-opsec-decoy-v1";
const CLIENT_ID_STORAGE_KEY = "qxprotocol-client-id-v1";
const SYSTEM_USERNAME = "system";
const SYSTEM_AVATAR_SVG_DARK = `<svg width="180px" height="180px" viewBox="-3.68 -3.68 23.36 23.36" xmlns="http://www.w3.org/2000/svg"><g transform="translate(16 0) scale(-1 1)"><g transform="translate(0 1)" fill="rgb(243,245,248)"><path d="M5.939 0C2.666 0 0.009 1.987 0.009 4.438c0 2.236 2.215 4.082 5.092 4.387L3.88 11.26l4.249-2.7C10.318 7.906 12 6.309 12 4.438 12 1.988 9.213 0 5.939 0Z"/><path d="M15.947 8.89c0-1.124-1.062-2.288-2.289-2.868-.344 1.95-1.924 3.745-4.417 4.447l-1.187.642c.454.34 1.01.611 1.634.788l3.638 1.971-1.303-1.776c2.217-.225 3.924-1.571 3.924-3.204Z"/></g></g></svg>`;

const SYSTEM_AVATAR_SVG_LIGHT = `<svg width="180px" height="180px" viewBox="-3.68 -3.68 23.36 23.36" xmlns="http://www.w3.org/2000/svg"><g transform="translate(16 0) scale(-1 1)"><g transform="translate(0 1)" fill="#1b1b1d"><path d="M5.939 0C2.666 0 0.009 1.987 0.009 4.438c0 2.236 2.215 4.082 5.092 4.387L3.88 11.26l4.249-2.7C10.318 7.906 12 6.309 12 4.438 12 1.988 9.213 0 5.939 0Z"/><path d="M15.947 8.89c0-1.124-1.062-2.288-2.289-2.868-.344 1.95-1.924 3.745-4.417 4.447l-1.187.642c.454.34 1.01.611 1.634.788l3.638 1.971-1.303-1.776c2.217-.225 3.924-1.571 3.924-3.204Z"/></g></g></svg>`;

function systemAvatarB64() {
  const isLight = typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
  return btoa(isLight ? SYSTEM_AVATAR_SVG_LIGHT : SYSTEM_AVATAR_SVG_DARK);
}
const CLIENT_LOCK_PBKDF2_ITERATIONS = 250000;
const CLIENT_LOCK_PIN_LENGTHS = [4, 6, 8];
const CLIENT_LOCK_AUTOLOCK_TIMEOUTS_MS = [60_000, 600_000, 1_800_000, 3_600_000, 7_200_000, 18_000_000];
const CLIENT_LOCK_DEFAULT_AUTOLOCK_TIMEOUT_MS = 600_000;
const CLIENT_LOCK_DB_NAME = "qxprotocol-client-lock";
const CLIENT_LOCK_DB_VERSION = 1;
const CLIENT_LOCK_STORE = "payloads";
const CLIENT_LOCK_PAYLOAD_KEY = "current";
const CLIENT_LOCK_MAX_FAILED_ATTEMPTS = 10;
const OPSEC_DURESS_ACTIONS = ["wipe", "decoy"];
const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "💀", "🧢"];
const MAX_ROOMS_SHOWN = 100;
const MAX_HISTORY_PER_ROOM = 500;
const ROOM_ID_MIN_LENGTH = 8;
const ROOM_ID_MAX_LENGTH = 64;
const MAX_ROOM_NOTE_LENGTH = 512;
const MAX_LOCAL_ROOM_NAME_LENGTH = 64;
const MESSAGE_LIMIT = 2000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_PROFILE_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_BANNER_BYTES = 15 * 1024 * 1024;
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
  "image/svg+xml",
]);
const PRESENCE_STATUSES = ["online", "invisible", "dnd"];
const THEME_MODES = ["dark", "light", "adaptive", "system"];
const RANDOM_ROOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const E2EE_MESSAGE_PLACEHOLDER = "Encrypted message";
const LINK_PREVIEW_URL_RE = /https?:\/\/[^\s<>"'`\\]+/i;
const pendingLinkPreviewRequests = new Set<string>();
const TYPING_IDLE_MS = 2800;
const TYPING_REMOTE_TTL_MS = 4500;
const TYPING_HEARTBEAT_MS = 4000;
const PUBLIC_PROFILE_LOOKUP_TTL_MS = 5 * 60 * 1000;
const PUBLIC_PROFILE_LOOKUP_MAX_USERS = 32;
export const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "bat", "c", "cfg", "conf", "cpp", "cs", "css", "csv", "env", "go", "h", "hpp", "html", "ini", "java", "js", "json", "jsx",
  "log", "lua", "md", "php", "properties", "py", "rb", "rs", "scss", "sh", "sql", "svelte", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml"
]);

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

function inferWebSocketUrl() {
  return appRuntimeConfig.wsUrl;
}

function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 32);
}

function isSystemUsername(value) {
  return sanitizeUsername(value) === SYSTEM_USERNAME;
}

function systemProfile() {
  return normalizeProfile({
    avatar: { dataB64: systemAvatarB64(), mimeType: "image/svg+xml", size: 651, width: 180, height: 180 },
    description: "Official QxChat system account.",
  });
}

function validateUsername(value) {
  const username = sanitizeUsername(value);
  if (username.length < 2 || username.length > 32)
    return "Username must be 2 to 32 characters.";
  if (!/^[a-z0-9_.]+$/.test(username))
    return "Username can only use a-z, 0-9, underscore and period.";
  if (username.includes(".."))
    return "Username cannot contain two consecutive periods.";
  if (username === SYSTEM_USERNAME)
    return "Username is reserved.";
  return "";
}

function sanitizePresenceStatus(value) {
  const status = String(value || "").trim();
  return PRESENCE_STATUSES.includes(status) ? status : "online";
}

function normalizeUserBadges(value) {
  const badges = Array.isArray(value) ? value : [];
  return [...new Set(badges.map((badge) => String(badge || "").trim().toLowerCase()).filter(Boolean))];
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

function isTextAttachmentByFilename(filename) {
  const ext = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  return TEXT_ATTACHMENT_EXTENSIONS.has(ext);
}

function isTextAttachmentFile(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  if (isTextAttachmentByFilename(file?.name)) return true;
  if (mimeType.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript", "application/x-javascript", "application/typescript", "application/x-sh", "application/x-shellscript"].includes(mimeType)) return true;
  return false;
}

function normalizeProfileImage(value: unknown, maxBytes: number) {
  if (!value || typeof value !== "object")
    return _normalizeProfileImageRaw(value, maxBytes);

  const v = value as Record<string, unknown>;

  // Format serveur Rust : { file: { url, id }, width, height }
  if (v.file && typeof v.file === "object") {
    const file = v.file as Record<string, unknown>;
    const merged = {
      url: file.url ?? v.url,
      id: file.id ?? v.id,
      mimeType: file.mimeType ?? v.mimeType ?? "",
      size: file.size ?? v.size ?? 0,
      width: v.width ?? file.width ?? 0,
      height: v.height ?? file.height ?? 0,
      dataB64: v.dataB64 ?? file.dataB64 ?? "",
    };
    return _normalizeProfileImageRaw(merged, maxBytes);
  }

  return _normalizeProfileImageRaw(v, maxBytes);
}

function _normalizeProfileImageRaw(
  value: unknown,
  maxBytes: number,
): {
  id?: string;
  url?: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  dataB64?: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const mimeType = normalizeProfileMime(String(v.mimeType || ""));
  const size = Math.max(0, Number(v.size) || 0);
  const width = Math.max(0, Math.round(Number(v.width) || 0));
  const height = Math.max(0, Math.round(Number(v.height) || 0));
  const dataB64 = String(v.dataB64 || "").trim();

  // Validation taille uniquement si on a les données binaires
  if (dataB64 && size > maxBytes) return null;
  if (dataB64 && dataB64.length > Math.ceil((maxBytes * 4) / 3) + 8)
    return null;

  const url = sanitizeHttpUrl(v.url);
  const id = String(v.id || "").trim();

  // URL distante : on accepte même sans size (le serveur ne le fournit pas toujours)
  if (url) {
    return {
      id: id || undefined,
      url,
      mimeType: mimeType || "image/jpeg",
      size,
      width,
      height,
    };
  }

  if (!dataB64) return null;
  if (!mimeType) return null;
  return { mimeType, size, width, height, dataB64 };
}

function normalizeProfile(profile: unknown): {
  avatar: ReturnType<typeof normalizeProfileImage>;
  banner: ReturnType<typeof normalizeProfileImage>;
  description: string;
  pronouns: string;
} {
  const source =
    profile && typeof profile === "object"
      ? (profile as Record<string, unknown>)
      : {};
  return {
    // ← Correction : bon maxBytes pour chaque type
    avatar: normalizeProfileImage(source.avatar, MAX_PROFILE_AVATAR_BYTES),
    banner: normalizeProfileImage(source.banner, MAX_PROFILE_BANNER_BYTES),
    description: sanitizeProfileText(
      String(source.description || ""),
      MAX_PROFILE_DESCRIPTION_LENGTH,
    ),
    pronouns: sanitizeProfileText(
      String(source.pronouns || ""),
      MAX_PROFILE_PRONOUNS_LENGTH,
    ),
  };
}
function mergeProfiles(base, incoming) {
  const left = normalizeProfile(base);
  const right = normalizeProfile(incoming);
  return normalizeProfile({
    avatar: right.avatar || left.avatar,
    banner: right.banner || left.banner,
    description: right.description || left.description,
    pronouns: right.pronouns || left.pronouns,
  });
}

function normalizeProfilePatch(profile: unknown) {
  const source =
    profile && typeof profile === "object"
      ? (profile as Record<string, unknown>)
      : {};
  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(source, "avatar")) {
    patch.avatar = normalizeProfileImage(source.avatar, MAX_PROFILE_AVATAR_BYTES);
  }
  if (Object.prototype.hasOwnProperty.call(source, "banner")) {
    patch.banner = normalizeProfileImage(source.banner, MAX_PROFILE_BANNER_BYTES);
  }
  if (Object.prototype.hasOwnProperty.call(source, "description")) {
    patch.description = sanitizeProfileText(
      String(source.description || ""),
      MAX_PROFILE_DESCRIPTION_LENGTH,
    );
  }
  if (Object.prototype.hasOwnProperty.call(source, "pronouns")) {
    patch.pronouns = sanitizeProfileText(
      String(source.pronouns || ""),
      MAX_PROFILE_PRONOUNS_LENGTH,
    );
  }
  return patch;
}

function normalizeProfileMime(value) {
  const mime = String(value || "")
    .trim()
    .toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/apng") return "image/png";
  return PROFILE_IMAGE_MIME_TYPES.has(mime) ? mime : "";
}

function profileImageSrc(
  image: unknown,
  kind: "avatar" | "banner" = "avatar",
): string {
  const maxBytes =
    kind === "banner" ? MAX_PROFILE_BANNER_BYTES : MAX_PROFILE_AVATAR_BYTES;
  const normalized = normalizeProfileImage(image, maxBytes);
  if (!normalized) return "";
  if ("url" in normalized && normalized.url) return normalized.url;
  return normalized.dataB64
    ? `data:${normalized.mimeType};base64,${normalized.dataB64}`
    : "";
}

function sanitizeHttpUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("blob:")) return raw;

  // Chemin relatif → URL absolue basée sur le serveur API
  if (raw.startsWith("/")) {
    try {
      return new URL(raw, apiUrl("")).toString();
    } catch {
      return "";
    }
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (
      !isTauriRuntime() &&
      typeof window !== "undefined" &&
      url.origin === window.location.origin
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return "";
  }
}

function cacheBustedRoomIconUrl(value: unknown): string {
  const clean = sanitizeHttpUrl(value);
  if (!clean) return "";
  try {
    const url = new URL(clean);
    url.searchParams.set("v", String(Date.now()));
    // En Tauri, ne jamais retourner de chemin relatif
    if (
      !isTauriRuntime() &&
      typeof window !== "undefined" &&
      url.origin === window.location.origin
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return clean;
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

function sanitizeClientLockAutolockTimeoutMs(value) {
  const timeoutMs = Math.round(Number(value) || 0);
  return CLIENT_LOCK_AUTOLOCK_TIMEOUTS_MS.includes(timeoutMs)
    ? timeoutMs
    : CLIENT_LOCK_DEFAULT_AUTOLOCK_TIMEOUT_MS;
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

function sanitizeRoomId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
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
  if (date.toDateString() === now.toDateString()) return t("thread.today");
  if (date.toDateString() === new Date(now.getTime() - oneDay).toDateString())
    return t("thread.yesterday");
  if (now.getTime() - date.getTime() < 7 * oneDay)
    return date.toLocaleDateString(locale.value, { weekday: "long" });
  return date.toLocaleDateString(locale.value, {
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

function sanitizeRoomRatchets(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const next = {};
  for (const [roomId, counter] of Object.entries(raw)) {
    const id = sanitizeRoomId(roomId);
    if (!isValidRoomId(id)) continue;
    next[id] = Math.max(0, Math.floor(Number(counter) || 0));
  }
  return next;
}

function parseInviteLink() {
  try {
    const hash = String(window.location.hash || "");
    const queryIndex = hash.indexOf("?");
    if (queryIndex === -1) return null;
    const params = new URLSearchParams(hash.slice(queryIndex + 1));
    // Unified token format (preferred)
    let token = String(params.get("token") || "").trim();
    // Backward compatibility: old room+key format
    if (!token) {
      const room = String(params.get("room") || "").trim();
      const key = String(params.get("key") || "").trim();
      if (room && key) {
        token = `${sanitizeRoomId(room)}${normalizeRoomKey(key)}`;
      }
    }
    if (!token) return null;
    const parsed = parseRoomAccessToken(token);
    return { roomId: parsed.roomId, roomKey: parsed.roomKey, token: parsed.token };
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

function defaultPersisted(overrides: Record<string, unknown> = {}) {
  return {
    authToken: "",
    sessionExpired: false,
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
    publicProfileFetchedAtByUser: {},
    badgesByUser: {},
    messagesByRoom: {},
    unreadByRoom: {},
    roomKeysByRoom: {},
    roomRatchetsByRoom: {},
    deviceId: "",
    deviceSigningPublicKey: null,
    deviceSigningPrivateKey: null,
    trustedSenderKeysByRoom: {},
    selectedAudioInputId: "",
    selectedAudioOutputId: "",
    selectedVideoInputId: "",
    microphoneThreshold: 0,
    deleteMessagesOnLeave: false,
    shareScreenAudio: true,
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
      deafen: true,
      undeafen: true,
      cameraOn: true,
      cameraOff: true,
      screenOn: true,
      screenOff: true,
      message: true,
    },
    themeMode: "system",
    appAccent: "blue",
    messageStyle: "bubble",
    spotlightSearchEnabled: true,
    androidNotificationsEnabled: true,
    serverClearsLocalMessages: false,
    autoReconnectEnabled: RECONNECT_DEFAULTS.enabled,
    reconnectMinDelayMs: RECONNECT_DEFAULTS.minDelayMs,
    reconnectMaxDelayMs: RECONNECT_DEFAULTS.maxDelayMs,
    callUserVolumes: {},
    roomNotes: {},
    selectedTurnServerId: runtimeDefaultTurnServerId(),
    customTurnServers: [],
    profile: loadPersistedProfile(),
    clientLockEnabled: false,
    clientLockSalt: "",
    clientLockIv: "",
    clientLockCiphertext: "",
    clientLockLocked: false,
    clientLockLoading: false,
    clientLockProgress: 0,
    clientLockPinLength: 6,
    clientLockAutolockEnabled: false,
    clientLockAutolockTimeoutMs: CLIENT_LOCK_DEFAULT_AUTOLOCK_TIMEOUT_MS,
    clientLockStorage: "",
    clientLockDisplayName: "",
    clientLockAvatar: null,
    clientLockThemeMode: "system",
    clientLockFailedAttempts: 0,
    clientLockMaxFailedAttempts: CLIENT_LOCK_MAX_FAILED_ATTEMPTS,
    opsecRamOnlyEnabled: false,
    opsecDuressEnabled: false,
    opsecDuressSalt: "",
    opsecDuressHash: "",
    opsecDuressAction: "wipe",
    opsecHideLockIdentity: true,
    opsecDecoySetupActive: false,
    opsecDecoyConfigured: false,
    opsecDecoyActive: false,
    ...overrides,
  };
}

function localDataLockedPayload(raw) {
  return raw && raw.version === 5 && raw.locked === true && (typeof raw.ciphertext === "string" || raw.storage === "indexeddb");
}

function openClientLockDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CLIENT_LOCK_DB_NAME, CLIENT_LOCK_DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CLIENT_LOCK_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open client lock storage."));
  });
}

async function putClientLockPayload(payload) {
  const db = await openClientLockDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CLIENT_LOCK_STORE, "readwrite");
      tx.objectStore(CLIENT_LOCK_STORE).put(payload, CLIENT_LOCK_PAYLOAD_KEY);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error || new Error("Could not write client lock storage."));
    });
  } finally {
    db.close();
  }
}

async function getClientLockPayload() {
  const db = await openClientLockDb();
  try {
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(CLIENT_LOCK_STORE, "readonly");
      const request = tx.objectStore(CLIENT_LOCK_STORE).get(CLIENT_LOCK_PAYLOAD_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read client lock storage."));
    });
    return result;
  } finally {
    db.close();
  }
}

async function deleteClientLockPayload() {
  const db = await openClientLockDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CLIENT_LOCK_STORE, "readwrite");
      tx.objectStore(CLIENT_LOCK_STORE).delete(CLIENT_LOCK_PAYLOAD_KEY);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error || new Error("Could not clear client lock storage."));
    });
  } finally {
    db.close();
  }
}

function loadPersisted() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (localDataLockedPayload(raw)) {
      return defaultPersisted({
        clientLockEnabled: true,
        clientLockSalt: String(raw.salt || ""),
        clientLockIv: String(raw.iv || ""),
        clientLockCiphertext: String(raw.ciphertext || ""),
        clientLockLocked: true,
        clientLockStorage: String(raw.storage || ""),
        clientLockDisplayName: sanitizeUsername(raw.displayName || raw.username || ""),
        clientLockAvatar: normalizeProfileImage(raw.avatar, MAX_PROFILE_AVATAR_BYTES),
        clientLockThemeMode: THEME_MODES.includes(String(raw.themeMode || "").toLowerCase()) ? String(raw.themeMode).toLowerCase() : "system",
        clientLockPinLength: CLIENT_LOCK_PIN_LENGTHS.includes(Number(raw.pinLength)) ? Number(raw.pinLength) : 6,
        clientLockAutolockEnabled: raw.autolockEnabled === true,
        clientLockAutolockTimeoutMs: sanitizeClientLockAutolockTimeoutMs(raw.autolockTimeoutMs),
        opsecDuressEnabled: raw.opsecDuressEnabled === true,
        opsecDuressSalt: String(raw.opsecDuressSalt || ""),
        opsecDuressHash: String(raw.opsecDuressHash || ""),
        opsecDuressAction: OPSEC_DURESS_ACTIONS.includes(String(raw.opsecDuressAction || "")) ? String(raw.opsecDuressAction) : "wipe",
        opsecHideLockIdentity: raw.opsecHideLockIdentity === undefined ? true : raw.opsecHideLockIdentity === true,
      });
    }
    const profile = loadPersistedProfile();
    const rooms = Array.isArray(raw.rooms)
      ? raw.rooms
        .filter(
          (r) => r && typeof r === "object" && typeof r.roomId === "string",
        )
        .slice(0, MAX_ROOMS_SHOWN)
        .map((r) => ({
          roomId: sanitizeRoomId(r.roomId),
          title: String(r.title || "")
            .trim()
            .slice(0, MAX_LOCAL_ROOM_NAME_LENGTH),
          lastPreview: String(r.lastPreview || ""),
          lastTimestamp: Number(r.lastTimestamp) || 0,
          lastSender: String(r.lastSender || ""),
          iconUrl: sanitizeHttpUrl(
            r.iconUrl || r.icon?.url || r.icon?.file?.url,
          ),
          members: sanitizeRoomUsers(r.members || []),
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

    const publicProfileFetchedAtByUser = {};
    if (raw.publicProfileFetchedAtByUser && typeof raw.publicProfileFetchedAtByUser === "object") {
      const now = Date.now();
      for (const [username, timestamp] of Object.entries(raw.publicProfileFetchedAtByUser)) {
        const key = sanitizeUsername(username);
        const value = Number(timestamp) || 0;
        if (key && value && now - value <= PUBLIC_PROFILE_LOOKUP_TTL_MS) publicProfileFetchedAtByUser[key] = value;
      }
    }

    const badgesByUser = {};
    if (raw.badgesByUser && typeof raw.badgesByUser === "object") {
      for (const [username, badges] of Object.entries(raw.badgesByUser)) {
        const key = sanitizeUsername(username);
        if (!key) continue;
        badgesByUser[key] = normalizeUserBadges(badges);
      }
    }

    const activeRoom = isValidRoomId(raw.activeRoom)
      ? sanitizeRoomId(raw.activeRoom)
      : "";
    if (activeRoom && !rooms.some((room) => room.roomId === activeRoom)) {
      rooms.unshift({
        roomId: activeRoom,
        title: "",
        lastPreview: "",
        lastTimestamp: 0,
        lastSender: "",
        iconUrl: "",
        members: [],
      });
    }

    return {
      authToken: String(raw.authToken || ""),
      sessionExpired: Boolean(raw.sessionExpired),
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
      activeRoom,
      rooms,
      joinedRooms,
      usersByRoom,
      profilesByUser,
      publicProfileFetchedAtByUser,
      badgesByUser,
      messagesByRoom,
      unreadByRoom,
      roomKeysByRoom: sanitizeRoomKeys(raw.roomKeysByRoom),
      roomRatchetsByRoom: sanitizeRoomRatchets(raw.roomRatchetsByRoom),
      deviceId: String(raw.deviceId || ""),
      deviceSigningPublicKey: raw.deviceSigningPublicKey || null,
      deviceSigningPrivateKey: raw.deviceSigningPrivateKey || null,
      trustedSenderKeysByRoom: raw.trustedSenderKeysByRoom && typeof raw.trustedSenderKeysByRoom === "object" ? raw.trustedSenderKeysByRoom : {},
      selectedAudioInputId: String(raw.selectedAudioInputId || ""),
      selectedAudioOutputId: String(raw.selectedAudioOutputId || ""),
      selectedVideoInputId: String(raw.selectedVideoInputId || ""),
      microphoneThreshold: Math.max(
        0,
        Math.min(100, Number(raw.microphoneThreshold) || 0),
      ),
      deleteMessagesOnLeave: Boolean(raw.deleteMessagesOnLeave),
      shareScreenAudio: raw.shareScreenAudio !== false,
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
        deafen: raw.soundFlags?.deafen !== false,
        undeafen: raw.soundFlags?.undeafen !== false,
        cameraOn: raw.soundFlags?.cameraOn !== false,
        cameraOff: raw.soundFlags?.cameraOff !== false,
        screenOn: raw.soundFlags?.screenOn !== false,
        screenOff: raw.soundFlags?.screenOff !== false,
        message: raw.soundFlags?.message !== false,
      },
      themeMode: THEME_MODES.includes(
        String(raw.themeMode || "").toLowerCase(),
      )
        ? String(raw.themeMode).toLowerCase()
        : "system",
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
      spotlightSearchEnabled: raw.spotlightSearchEnabled !== false,
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
      selectedTurnServerId: String(raw.selectedTurnServerId || runtimeDefaultTurnServerId()).trim(),
      customTurnServers: sanitizeCustomTurnServers(raw.customTurnServers),
      profile,
      clientLockEnabled: false,
      clientLockSalt: "",
      clientLockIv: "",
      clientLockCiphertext: "",
      clientLockLocked: false,
      clientLockStorage: "",
      clientLockDisplayName: "",
      clientLockAvatar: null,
      clientLockThemeMode: "system",
      clientLockFailedAttempts: 0,
      clientLockMaxFailedAttempts: CLIENT_LOCK_MAX_FAILED_ATTEMPTS,
      clientLockPinLength: CLIENT_LOCK_PIN_LENGTHS.includes(Number(raw.clientLockPinLength)) ? Number(raw.clientLockPinLength) : 6,
      clientLockAutolockEnabled: raw.clientLockAutolockEnabled === true,
      clientLockAutolockTimeoutMs: sanitizeClientLockAutolockTimeoutMs(raw.clientLockAutolockTimeoutMs),
      opsecRamOnlyEnabled: false,
      opsecDuressEnabled: raw.opsecDuressEnabled === true,
      opsecDuressSalt: String(raw.opsecDuressSalt || ""),
      opsecDuressHash: String(raw.opsecDuressHash || ""),
      opsecDuressAction: OPSEC_DURESS_ACTIONS.includes(String(raw.opsecDuressAction || "")) ? String(raw.opsecDuressAction) : "wipe",
    };
  } catch {
    return defaultPersisted();
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

function sanitizeCustomTurnServers(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = String(item.label || "").trim().slice(0, 64) || "Custom TURN";
    const urls = Array.isArray(item.urls)
      ? item.urls
        .map((u) => String(u || "").trim())
        .filter((u) => /^(turn|turns|stun):/i.test(u))
        .slice(0, 8)
      : [];
    if (!urls.length) continue;
    const username = String(item.username || "").trim().slice(0, 128);
    const credential = String(item.credential || "").trim().slice(0, 256);
    const id = `custom-${urls[0]}-${username}-${label}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, urls, username, credential, hint: item.hint || "" });
  }
  return out;
}

function stripAttachmentDataForStorage(arr) {
  return (arr || []).map((m) => {
    const message = normalizeMessage(m, m?.roomId || "");
    const attachment = message.attachment
      ? {
        id: String(message.attachment.id || "").trim(),
        url: sanitizeHttpUrl(message.attachment.url),
        filename: String(message.attachment.filename || "file"),
        mimeType: String(message.attachment.mimeType || "application/octet-stream"),
        size: Number(message.attachment.size) || 0,
      }
      : null;
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
    const encrypted =
      message.encrypted && typeof message.encrypted === "object"
        ? {
          v: Number(message.encrypted.v) || 0,
          alg: String(message.encrypted.alg || ""),
          iv: String(message.encrypted.iv || ""),
          salt: String(message.encrypted.salt || ""),
          n: Number(message.encrypted.n) || 0,
          senderDeviceId: String(message.encrypted.senderDeviceId || ""),
          senderSigningKey: message.encrypted.senderSigningKey || null,
          signature: String(message.encrypted.signature || ""),
          ciphertext: message.locked ? String(message.encrypted.ciphertext || "") : "",
        }
        : null;
    return {
      messageId: message.messageId,
      roomId: message.roomId,
      user: message.user,
      username: message.username,
      text: message.text,
      rawText: message.rawText,
      timestamp: message.timestamp,
      system: message.system,
      deleted: message.deleted,
      reactions: message.reactions,
      replyToMessageId: message.replyToMessageId,
      attachment,
      encrypted,
      preview,
      kind: message.kind,
      voiceDuration: message.voiceDuration,
      jumboEmoji: message.jumboEmoji,
      locked: message.locked,
      editedAt: message.editedAt,
      mentioned: message.mentioned,
    };
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validateClientLockPin(pin) {
  const clean = String(pin || "").trim();
  if (!CLIENT_LOCK_PIN_LENGTHS.includes(clean.length) || !/^\d+$/.test(clean)) {
    return "PIN must be 4, 6 or 8 digits.";
  }
  return "";
}

async function deriveClientLockKey(pin, saltBytes) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(pin || "")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: CLIENT_LOCK_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

let activeClientLockKey: CryptoKey | null = null;

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function buildPersistedPayload(state) {
  const messagesByRoom = {};
  for (const [id, arr] of Object.entries(state.messagesByRoom || {}) as [
    string,
    any[],
  ][]) {
    messagesByRoom[id] = stripAttachmentDataForStorage(
      arr.slice(-MAX_HISTORY_PER_ROOM),
    );
  }
  const payload = {
    version: 4,
    authToken: String(state.authToken || ""),
    sessionExpired: Boolean(state.sessionExpired),
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
    publicProfileFetchedAtByUser: Object.fromEntries(
      Object.entries(state.publicProfileFetchedAtByUser || {})
        .map(([username, timestamp]) => [sanitizeUsername(username), Number(timestamp) || 0])
        .filter(([username, timestamp]) => Boolean(username) && Boolean(timestamp)),
    ),
    messagesByRoom,
    unreadByRoom: state.unreadByRoom,
    roomKeysByRoom: sanitizeRoomKeys(state.roomKeysByRoom),
    roomRatchetsByRoom: sanitizeRoomRatchets(state.roomRatchetsByRoom),
    deviceId: state.deviceId,
    deviceSigningPublicKey: state.deviceSigningPublicKey || null,
    deviceSigningPrivateKey: state.deviceSigningPrivateKey || null,
    trustedSenderKeysByRoom: state.trustedSenderKeysByRoom,
    selectedAudioInputId: state.selectedAudioInputId,
    selectedAudioOutputId: state.selectedAudioOutputId,
    selectedVideoInputId: state.selectedVideoInputId,
    microphoneThreshold: state.microphoneThreshold,
    deleteMessagesOnLeave: state.deleteMessagesOnLeave,
    shareScreenAudio: state.shareScreenAudio,
    autoArchiveUploads: state.autoArchiveUploads,
    streamerMode: state.streamerMode,
    typingIndicatorsEnabled: state.typingIndicatorsEnabled,
    messageSoundEnabled: state.messageSoundEnabled,
    callSoundsEnabled: state.callSoundsEnabled,
    soundFlags: { ...state.soundFlags },
    themeMode: state.themeMode,
    appAccent: state.appAccent,
    messageStyle: state.messageStyle,
    spotlightSearchEnabled: state.spotlightSearchEnabled,
    androidNotificationsEnabled: state.androidNotificationsEnabled,
    serverClearsLocalMessages: state.serverClearsLocalMessages,
    autoReconnectEnabled: state.autoReconnectEnabled,
    reconnectMinDelayMs: state.reconnectMinDelayMs,
    reconnectMaxDelayMs: state.reconnectMaxDelayMs,
    callUserVolumes: sanitizeCallUserVolumes(state.callUserVolumes),
    roomNotes: sanitizeRoomNotes(state.roomNotes),
    selectedTurnServerId: state.selectedTurnServerId,
    customTurnServers: sanitizeCustomTurnServers(state.customTurnServers),
    profile: normalizeProfile(state.profile),
    clientLockPinLength: CLIENT_LOCK_PIN_LENGTHS.includes(Number(state.clientLockPinLength)) ? Number(state.clientLockPinLength) : 6,
    clientLockAutolockEnabled: state.clientLockAutolockEnabled === true,
    clientLockAutolockTimeoutMs: sanitizeClientLockAutolockTimeoutMs(state.clientLockAutolockTimeoutMs),
    opsecDuressEnabled: state.opsecDuressEnabled === true,
    opsecDuressSalt: String(state.opsecDuressSalt || ""),
    opsecDuressHash: String(state.opsecDuressHash || ""),
    opsecDuressAction: OPSEC_DURESS_ACTIONS.includes(String(state.opsecDuressAction || "")) ? String(state.opsecDuressAction) : "wipe",
    opsecHideLockIdentity: state.opsecHideLockIdentity !== false,
  };
  return payload;
}

async function encryptClientLockPayload(payload, key, salt, pinLength = 6) {
  const serialized = JSON.stringify(payload);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(serialized),
  );
  return {
    version: 5,
    locked: true,
    kdf: "PBKDF2-SHA256",
    iterations: CLIENT_LOCK_PBKDF2_ITERATIONS,
    pinLength,
    displayName: payload?.opsecHideLockIdentity !== false ? "" : sanitizeUsername(payload?.username || ""),
    avatar: payload?.opsecHideLockIdentity !== false ? null : normalizeProfileImage(payload?.profile?.avatar, MAX_PROFILE_AVATAR_BYTES),
    themeMode: THEME_MODES.includes(String(payload?.themeMode || "").toLowerCase()) ? String(payload.themeMode).toLowerCase() : "system",
    autolockEnabled: payload?.clientLockAutolockEnabled === true,
    autolockTimeoutMs: sanitizeClientLockAutolockTimeoutMs(payload?.clientLockAutolockTimeoutMs),
    opsecDuressEnabled: payload?.opsecDuressEnabled === true,
    opsecDuressSalt: String(payload?.opsecDuressSalt || ""),
    opsecDuressHash: String(payload?.opsecDuressHash || ""),
    opsecDuressAction: OPSEC_DURESS_ACTIONS.includes(String(payload?.opsecDuressAction || "")) ? String(payload.opsecDuressAction) : "wipe",
    opsecHideLockIdentity: payload?.opsecHideLockIdentity !== false,
    failedAttempts: 0,
    salt,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

function writePersistedPayload(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...payload, messagesByRoom: {}, unreadByRoom: {} }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }
}

function writePersistedPayloadStrict(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function writeDecoyPersistedPayload(payload) {
  try {
    localStorage.setItem(OPSEC_DECOY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    try {
      localStorage.setItem(
        OPSEC_DECOY_STORAGE_KEY,
        JSON.stringify({ ...payload, messagesByRoom: {}, unreadByRoom: {} }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }
}

function loadDecoyPersistedPayload() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPSEC_DECOY_STORAGE_KEY) || "{}");
    return raw && typeof raw === "object" && !localDataLockedPayload(raw) ? raw : null;
  } catch {
    return null;
  }
}

function decoyPersistedPayload(payload) {
  return {
    ...payload,
    clientLockEnabled: false,
    clientLockLocked: false,
    clientLockSalt: "",
    clientLockIv: "",
    clientLockCiphertext: "",
    clientLockStorage: "",
    clientLockDisplayName: "",
    clientLockAvatar: null,
    opsecDuressEnabled: false,
    opsecDuressSalt: "",
    opsecDuressHash: "",
    opsecDuressAction: "wipe",
    opsecRamOnlyEnabled: false,
  };
}

async function writeLockedPersistedPayload(lockedPayload) {
  try {
    writePersistedPayloadStrict(lockedPayload);
    await deleteClientLockPayload();
    return lockedPayload;
  } catch (error) {
    await putClientLockPayload(lockedPayload);
    const metadata = {
      ...lockedPayload,
      storage: "indexeddb",
      ciphertext: "",
    };
    writePersistedPayloadStrict(metadata);
    return metadata;
  }
}

async function savePersisted(state) {
  if (state.opsecRamOnlyEnabled) return;
  const payload = buildPersistedPayload(state);
  if (state.opsecDecoyActive || state.opsecDecoySetupActive) {
    writeDecoyPersistedPayload(decoyPersistedPayload(payload));
    return;
  }
  if (state.clientLockEnabled && activeClientLockKey && state.clientLockSalt) {
    const lockedPayload = await encryptClientLockPayload(
      payload,
      activeClientLockKey,
      state.clientLockSalt,
      state.clientLockPinLength,
    );
    await writeLockedPersistedPayload(lockedPayload);
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    return;
  }
  writePersistedPayload(payload);
  savePersistedProfile(state.profile);
}

function savePersistedProfile(profile) {
  if (singleton?.state?.opsecRamOnlyEnabled || singleton?.state?.opsecDecoyActive || singleton?.state?.opsecDecoySetupActive) return;
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

function isTransientPresenceSystemMessage(message) {
  return Boolean(message?.system) && String(message?.systemKind || "") === "presence";
}

function latestSidebarRoomMessage(messages) {
  for (let i = (messages?.length || 0) - 1; i >= 0; i -= 1) {
    const message = messages?.[i];
    if (!message || message.deleted || isTransientPresenceSystemMessage(message)) continue;
    return message;
  }
  return null;
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
        salt: String(message.encrypted.salt || ""),
        n: Number(message.encrypted.n) || 0,
        senderDeviceId: String(message.encrypted.senderDeviceId || ""),
        senderSigningKey: message.encrypted.senderSigningKey || null,
        signature: String(message.encrypted.signature || ""),
        ciphertext: String(message.encrypted.ciphertext || ""),
      }
      : null;

  let kind = "text";
  if (message.deleted) kind = "deleted";
  else if (attachment) {
    if (isTextAttachmentByFilename(attachment.filename)) kind = "file";
    else if ((attachment.mimeType || "").startsWith("audio/")) kind = "audio";
    else if ((attachment.mimeType || "").startsWith("image/")) kind = "image";
    else if ((attachment.mimeType || "").startsWith("video/")) kind = "video";
    else kind = "file";
  } else if (voiceDuration) kind = "voice";

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
    clientNonce: String(message.clientNonce || ""),
    user: message.system ? SYSTEM_USERNAME : (message.user || message.username || "Unknown"),
    username: message.system ? SYSTEM_USERNAME : (message.username || extractUsername(message.user)),
    text: voiceDuration ? "" : rawText,
    rawText,
    timestamp: message.timestamp || Date.now(),
    profile: normalizeProfile(message.profile),
    system: Boolean(message.system),
    systemKind: String(message.systemKind || ""),
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

function blobToBase64(blob, onProgress) {
  return new Promise((resolve, reject) => {
    if (onProgress) onProgress(0);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(pct);
      }
    };
    reader.onload = () => {
      if (onProgress) onProgress(100);
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
        iconUrl: "",
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
    sessionExpired: Boolean((persisted as any).sessionExpired),
    authLoading: false,
    authMode: "login",
    recoveryWords: persisted.recoveryWords,
    clientLockEnabled: persisted.clientLockEnabled,
    clientLockLocked: persisted.clientLockLocked,
    clientLockSalt: persisted.clientLockSalt,
    clientLockIv: persisted.clientLockIv,
    clientLockCiphertext: persisted.clientLockCiphertext,
    clientLockLoading: false,
    clientLockProgress: 0,
    clientLockPinLength: CLIENT_LOCK_PIN_LENGTHS.includes(Number((persisted as any).clientLockPinLength)) ? Number((persisted as any).clientLockPinLength) : 6,
    clientLockAutolockEnabled: (persisted as any).clientLockAutolockEnabled === true,
    clientLockAutolockTimeoutMs: sanitizeClientLockAutolockTimeoutMs((persisted as any).clientLockAutolockTimeoutMs),
    clientLockStorage: (persisted as any).clientLockStorage || "",
    clientLockDisplayName: String((persisted as any).clientLockDisplayName || ""),
    clientLockAvatar: normalizeProfileImage((persisted as any).clientLockAvatar, MAX_PROFILE_AVATAR_BYTES),
    clientLockThemeMode: THEME_MODES.includes(String((persisted as any).clientLockThemeMode || "").toLowerCase()) ? String((persisted as any).clientLockThemeMode).toLowerCase() : "system",
    clientLockFailedAttempts: Math.max(0, Number((persisted as any).clientLockFailedAttempts) || 0),
    clientLockMaxFailedAttempts: CLIENT_LOCK_MAX_FAILED_ATTEMPTS,
    opsecRamOnlyEnabled: (persisted as any).opsecRamOnlyEnabled === true,
    opsecDuressEnabled: (persisted as any).opsecDuressEnabled === true,
    opsecDuressSalt: String((persisted as any).opsecDuressSalt || ""),
    opsecDuressHash: String((persisted as any).opsecDuressHash || ""),
    opsecDuressAction: OPSEC_DURESS_ACTIONS.includes(String((persisted as any).opsecDuressAction || "")) ? String((persisted as any).opsecDuressAction) : "wipe",
    opsecHideLockIdentity: (persisted as any).opsecHideLockIdentity !== false,
    opsecDecoySetupActive: false,
    opsecDecoyConfigured: Boolean(loadDecoyPersistedPayload()),
    opsecDecoyActive: false,
    isBanned: false,
    banMessage: "",

    username: persisted.username,
    status: persisted.status,
    profile: persisted.profile,
    activeRoom: persisted.activeRoom,
    rooms: persisted.rooms,
    roomKeysByRoom: persisted.roomKeysByRoom,
    roomRatchetsByRoom: (persisted as any).roomRatchetsByRoom || {},
    deviceId: (persisted as any).deviceId || "",
    deviceSigningPublicKey: (persisted as any).deviceSigningPublicKey || null,
    deviceSigningPrivateKey: (persisted as any).deviceSigningPrivateKey || null,
    trustedSenderKeysByRoom: (persisted as any).trustedSenderKeysByRoom || {},

    joinedRooms: persisted.joinedRooms,
    pendingJoinRooms: [],
    messagesByRoom: persisted.messagesByRoom,
    usersByRoom: persisted.usersByRoom,
    profilesByUser: { ...persisted.profilesByUser },
    publicProfileFetchedAtByUser: { ...(persisted as any).publicProfileFetchedAtByUser },
    badgesByUser: { ...persisted.badgesByUser },
    statusesByUser: {},
    userIdsByUsername: {},
    clientPlatformsByUser: {},
    callClientsByRoom: {},
    unreadByRoom: persisted.unreadByRoom,

    messageInput: "",
    voiceEnabled: false,
    lastError: "",
    searchTerm: "",

    composing: false,
    composeInput: "",
    toastMessage: "",
    toastBadge: "",
    toastBadgeAvatarSrc: "",
    toastError: false,

    settingsOpen: false,
    replyingTo: null,
    editingMessage: null,

    audioDevices: [],
    selectedAudioInputId: persisted.selectedAudioInputId,
    selectedAudioOutputId: persisted.selectedAudioOutputId,
    selectedVideoInputId: persisted.selectedVideoInputId,
    microphoneThreshold: persisted.microphoneThreshold,
    deleteMessagesOnLeave: persisted.deleteMessagesOnLeave,
    shareScreenAudio: persisted.shareScreenAudio,
    autoArchiveUploads: persisted.autoArchiveUploads,
    streamerMode: persisted.streamerMode,
    typingIndicatorsEnabled: persisted.typingIndicatorsEnabled,
    messageSoundEnabled: persisted.messageSoundEnabled,
    callSoundsEnabled: persisted.callSoundsEnabled,
    soundFlags: { ...persisted.soundFlags },
    themeMode: persisted.themeMode,
    appAccent: persisted.appAccent,
    messageStyle: persisted.messageStyle,
    spotlightSearchEnabled: persisted.spotlightSearchEnabled,
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
    callDeafened: false, // local headset mute: silences call output locally
    callMutedBeforeDeafen: false, // mic state before deafening, restored on undeafen
    deafenedByUser: {}, // { username: true } — remote users who muted their headset
    callCameraEnabled: false,
    callScreenEnabled: false,
    localCallMedia: { ...EMPTY_CALL_MEDIA },
    remoteCallMediaByUser: {},
    remoteCallStreamsByUser: {},
    selectedTurnServerId: persisted.selectedTurnServerId,
    customTurnServers: persisted.customTurnServers,

    voiceMembersByRoom: {}, // { roomId: [username, ...] } — who is currently in voice
    speakingByRoom: {}, // { roomId: { username: lastChunkTimestamp } } — recent speakers
    typingByRoom: {}, // { roomId: { username: lastTypingTimestamp } }
    callAnalyser: null,
    callAnalyserData: null,
    callAnalyserOutData: null,

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
  let speakingSampler: ReturnType<typeof setInterval> | null = null;
  const DEAFEN_SOUND_WINDOW_MS = 1000;
  const remoteDeafenAt = new Map<string, number>();
  const remoteCallAnalysers = new Map<string, { context: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  const localClientId = getPersistentClientId();
  const typingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let clientLockAutolockTimer: ReturnType<typeof setTimeout> | null = null;
  let lastClientActivityAt = Date.now();
  let typingActiveRoomId = "";
  let typingLastSentAt = 0;
  function currentLocalPlatform() {
    return detectClientPlatform();
  }
  function attachmentUrlFor(message) {
    const remoteUrl = sanitizeHttpUrl(message?.attachment?.url);
    if (remoteUrl) return remoteUrl;

    const dataB64 = String(message?.attachment?.dataB64 || "").trim();
    const mimeType = String(
      message?.attachment?.mimeType || "application/octet-stream",
    ).trim();
    const messageId = String(message?.messageId || "").trim();
    if (!dataB64 || !mimeType || !messageId) return null;

    const cached = attachmentUrlCache.get(messageId);
    if (cached) return cached;

    try {
      const binary = atob(dataB64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
      const blobUrl = URL.createObjectURL(
        new Blob([bytes], { type: mimeType }),
      );
      attachmentUrlCache.set(messageId, blobUrl);
      return blobUrl;
    } catch {
      return null;
    }
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
        const latest = latestSidebarRoomMessage(
          state.messagesByRoom[r.roomId] || [],
        );
        const preview = messagePreviewLabel(latest) || r.lastPreview || "";
        const timestamp = Number(latest?.timestamp || r.lastTimestamp || 0);
        return {
          roomId: r.roomId,
          name: displayRoomName(r.roomId),
          accent: accentFor(r.roomId),
          icon: roomIcon(r.roomId),
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
      icon: roomIcon(state.activeRoom),
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

  function applyPersistedPayload(payload) {
    const normalized = defaultPersisted({
      ...payload,
      authToken: String(payload?.authToken || ""),
      userId: String(payload?.userId || ""),
      admin: Boolean(payload?.admin),
      recoveryWords: Array.isArray(payload?.recoveryWords) ? payload.recoveryWords : [],
      username: sanitizeUsername(payload?.username),
      status: sanitizePresenceStatus(payload?.status),
      activeRoom: isValidRoomId(payload?.activeRoom) ? sanitizeRoomId(payload.activeRoom) : "",
      rooms: Array.isArray(payload?.rooms) ? payload.rooms : [],
      joinedRooms: Array.isArray(payload?.joinedRooms) ? payload.joinedRooms : [],
      usersByRoom: payload?.usersByRoom && typeof payload.usersByRoom === "object" ? payload.usersByRoom : {},
      profilesByUser: payload?.profilesByUser && typeof payload.profilesByUser === "object" ? payload.profilesByUser : {},
      publicProfileFetchedAtByUser: payload?.publicProfileFetchedAtByUser && typeof payload.publicProfileFetchedAtByUser === "object" ? payload.publicProfileFetchedAtByUser : {},
      badgesByUser: payload?.badgesByUser && typeof payload.badgesByUser === "object" ? payload.badgesByUser : {},
      messagesByRoom: payload?.messagesByRoom && typeof payload.messagesByRoom === "object" ? payload.messagesByRoom : {},
      unreadByRoom: payload?.unreadByRoom && typeof payload.unreadByRoom === "object" ? payload.unreadByRoom : {},
      roomKeysByRoom: sanitizeRoomKeys(payload?.roomKeysByRoom),
      profile: normalizeProfile(payload?.profile),
      callUserVolumes: sanitizeCallUserVolumes(payload?.callUserVolumes),
      roomNotes: sanitizeRoomNotes(payload?.roomNotes),
      selectedTurnServerId: String(payload?.selectedTurnServerId || runtimeDefaultTurnServerId()).trim(),
      customTurnServers: sanitizeCustomTurnServers(payload?.customTurnServers),
      clientLockPinLength: CLIENT_LOCK_PIN_LENGTHS.includes(Number(payload?.clientLockPinLength)) ? Number(payload.clientLockPinLength) : 6,
      clientLockAutolockEnabled: payload?.clientLockAutolockEnabled === true,
      clientLockAutolockTimeoutMs: sanitizeClientLockAutolockTimeoutMs(payload?.clientLockAutolockTimeoutMs),
      opsecDuressEnabled: payload?.opsecDuressEnabled === true,
      opsecDuressSalt: String(payload?.opsecDuressSalt || ""),
      opsecDuressHash: String(payload?.opsecDuressHash || ""),
      opsecDuressAction: OPSEC_DURESS_ACTIONS.includes(String(payload?.opsecDuressAction || "")) ? String(payload.opsecDuressAction) : "wipe",
      opsecHideLockIdentity: payload?.opsecHideLockIdentity !== false,
    });
    state.authToken = normalized.authToken;
    state.userId = normalized.userId;
    state.admin = normalized.admin;
    state.recoveryWords = normalized.recoveryWords;
    state.username = normalized.username;
    state.status = normalized.status;
    state.profile = normalized.profile;
    state.activeRoom = normalized.activeRoom;
    state.rooms = normalized.rooms;
    state.joinedRooms = normalized.joinedRooms;
    state.usersByRoom = normalized.usersByRoom;
    state.profilesByUser = { ...normalized.profilesByUser };
    state.publicProfileFetchedAtByUser = { ...(normalized as any).publicProfileFetchedAtByUser };
    state.messagesByRoom = normalized.messagesByRoom;
    state.unreadByRoom = normalized.unreadByRoom;
    state.roomKeysByRoom = normalized.roomKeysByRoom;
    state.selectedAudioInputId = normalized.selectedAudioInputId;
    state.selectedAudioOutputId = normalized.selectedAudioOutputId;
    state.selectedVideoInputId = normalized.selectedVideoInputId;
    state.microphoneThreshold = normalized.microphoneThreshold;
    state.deleteMessagesOnLeave = normalized.deleteMessagesOnLeave;
    state.shareScreenAudio = normalized.shareScreenAudio;
    state.autoArchiveUploads = normalized.autoArchiveUploads;
    state.streamerMode = normalized.streamerMode;
    state.typingIndicatorsEnabled = normalized.typingIndicatorsEnabled;
    state.messageSoundEnabled = normalized.messageSoundEnabled;
    state.callSoundsEnabled = normalized.callSoundsEnabled;
    state.soundFlags = { ...normalized.soundFlags };
    state.themeMode = normalized.themeMode;
    state.appAccent = normalized.appAccent;
    state.messageStyle = normalized.messageStyle;
    state.androidNotificationsEnabled = normalized.androidNotificationsEnabled;
    state.serverClearsLocalMessages = normalized.serverClearsLocalMessages;
    state.autoReconnectEnabled = normalized.autoReconnectEnabled;
    state.reconnectMinDelayMs = normalized.reconnectMinDelayMs;
    state.reconnectMaxDelayMs = normalized.reconnectMaxDelayMs;
    state.callUserVolumes = normalized.callUserVolumes;
    state.roomNotes = normalized.roomNotes;
    state.selectedTurnServerId = normalized.selectedTurnServerId;
    state.customTurnServers = normalized.customTurnServers;
    state.clientLockPinLength = normalized.clientLockPinLength;
    state.clientLockAutolockEnabled = normalized.clientLockAutolockEnabled;
    state.clientLockAutolockTimeoutMs = normalized.clientLockAutolockTimeoutMs;
    state.opsecDuressEnabled = normalized.opsecDuressEnabled;
    state.opsecDuressSalt = normalized.opsecDuressSalt;
    state.opsecDuressHash = normalized.opsecDuressHash;
    state.opsecDuressAction = normalized.opsecDuressAction;
  }

  async function applyPersistedPayloadAfterUnlock(payload) {
    const messagesByRoom = payload?.messagesByRoom;
    const unreadByRoom = payload?.unreadByRoom;
    applyPersistedPayload({ ...payload, messagesByRoom: {}, unreadByRoom: {} });
    state.clientLockProgress = 75;
    await yieldToBrowser();
    state.messagesByRoom = messagesByRoom && typeof messagesByRoom === "object" ? messagesByRoom : {};
    state.unreadByRoom = unreadByRoom && typeof unreadByRoom === "object" ? unreadByRoom : {};
    state.clientLockProgress = 90;
    await yieldToBrowser();
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistPending = false;

  function persist() {
    if (state.clientLockLocked) return Promise.resolve();
    if (state.clientLockEnabled && activeClientLockKey) {
      // Debounce: batch rapid persist calls when client lock is enabled
      // to avoid re-encrypting the entire payload on every tiny state change.
      persistPending = true;
      if (persistTimer) return Promise.resolve();
      return new Promise((resolve) => {
        persistTimer = setTimeout(async () => {
          persistTimer = null;
          persistPending = false;
          try {
            await savePersisted(state);
          } catch { /* ignore */ }
          resolve(undefined);
        }, 800);
      });
    }
    return savePersisted(state);
  }

  function flushPersist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (persistPending) {
      persistPending = false;
      return savePersisted(state);
    }
    return Promise.resolve();
  }

  function clearClientLockAutolockTimer() {
    if (clientLockAutolockTimer) {
      clearTimeout(clientLockAutolockTimer);
      clientLockAutolockTimer = null;
    }
  }

  function shouldRunClientLockAutolock() {
    return Boolean(
      state.clientLockEnabled &&
      state.clientLockAutolockEnabled &&
      !state.clientLockLocked &&
      activeClientLockKey,
    );
  }

  function scheduleClientLockAutolock() {
    clearClientLockAutolockTimer();
    if (!shouldRunClientLockAutolock()) return;
    const timeoutMs = sanitizeClientLockAutolockTimeoutMs(state.clientLockAutolockTimeoutMs);
    const remainingMs = Math.max(0, timeoutMs - (Date.now() - lastClientActivityAt));
    clientLockAutolockTimer = setTimeout(async () => {
      if (!shouldRunClientLockAutolock()) return;
      if (Date.now() - lastClientActivityAt >= timeoutMs) {
        await lockClient();
        return;
      }
      scheduleClientLockAutolock();
    }, remainingMs);
  }

  function markClientActivity() {
    lastClientActivityAt = Date.now();
    scheduleClientLockAutolock();
  }

  function setClientLockAutolockEnabled(value) {
    state.clientLockAutolockEnabled = Boolean(value);
    markClientActivity();
    persist();
  }

  function setClientLockAutolockTimeoutMs(value) {
    state.clientLockAutolockTimeoutMs = sanitizeClientLockAutolockTimeoutMs(value);
    markClientActivity();
    persist();
  }

  async function enableClientLock(pin) {
    const validation = validateClientLockPin(pin);
    if (validation) {
      state.lastError = validation;
      showToast(validation);
      return false;
    }
    if (!crypto?.subtle) {
      state.lastError = "Client lock requires Web Crypto.";
      showToast(state.lastError);
      return false;
    }
    state.clientLockLoading = true;
    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      activeClientLockKey = await deriveClientLockKey(pin, saltBytes);
      state.clientLockSalt = bytesToBase64(saltBytes);
      state.clientLockEnabled = true;
      state.clientLockLocked = false;
      state.clientLockPinLength = String(pin).length;
      state.clientLockAutolockEnabled = false;
      state.clientLockAutolockTimeoutMs = sanitizeClientLockAutolockTimeoutMs(state.clientLockAutolockTimeoutMs);
      markClientActivity();
      await persist();
      showToast("Client lock enabled.");
      return true;
    } catch (error) {
      state.lastError = error?.message || "Could not enable client lock.";
      showToast(state.lastError);
      return false;
    } finally {
      state.clientLockLoading = false;
      state.clientLockProgress = 0;
    }
  }

  function persistClientLockFailedAttempts() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!localDataLockedPayload(raw)) return;
      raw.failedAttempts = state.clientLockFailedAttempts;
      if (state.opsecDecoySetupActive && !state.opsecDecoyActive) {
        state.opsecDecoySetupActive = false;
        state.opsecDecoyConfigured = Boolean(loadDecoyPersistedPayload());
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    } catch {
      /* ignore */
    }
  }

  async function hashOpsecPin(pin, saltB64 = "") {
    const salt = saltB64 ? base64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const bytes = new Uint8Array([
      ...salt,
      ...new TextEncoder().encode(String(pin || "")),
    ]);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { salt: bytesToBase64(salt), hash: bytesToBase64(new Uint8Array(digest)) };
  }

  async function matchesOpsecDuressPin(pin) {
    if (!state.opsecDuressEnabled || !state.opsecDuressSalt || !state.opsecDuressHash) return false;
    const result = await hashOpsecPin(pin, state.opsecDuressSalt);
    return result.hash === state.opsecDuressHash;
  }

  async function wipeBrowserPersistence() {
    const random = crypto.getRandomValues(new Uint8Array(4096));
    const noise = bytesToBase64(random);
    try {
      for (const key of Object.keys(localStorage)) localStorage.setItem(key, noise);
      localStorage.clear();
    } catch {
      /* ignore */
    }
    try {
      for (const key of Object.keys(sessionStorage)) sessionStorage.setItem(key, noise);
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    if (indexedDB?.databases) {
      try {
        const databases = await indexedDB.databases();
        await Promise.all(
          databases
            .map((db) => db.name)
            .filter(Boolean)
            .map((name) => new Promise((resolve) => {
              const request = indexedDB.deleteDatabase(name as string);
              request.onsuccess = request.onerror = request.onblocked = () => resolve(undefined);
            })),
        );
      } catch {
        await deleteClientLockPayload().catch(() => { });
      }
    } else {
      await deleteClientLockPayload().catch(() => { });
    }
  }

  async function startOpsecDecoySetup() {
    if (!state.clientLockEnabled || state.clientLockLocked || !activeClientLockKey || !state.clientLockSalt) {
      state.lastError = t("settings.opsec.requiresUnlockedLock");
      showToast(state.lastError);
      return false;
    }
    await persist();
    disconnect();
    state.opsecDecoySetupActive = true;
    state.opsecDecoyActive = false;
    state.authToken = "";
    state.userId = "";
    state.admin = false;
    state.username = "";
    state.uuid = null;
    state.recoveryWords = [];
    state.profile = normalizeProfile(null);
    state.status = "online";
    state.rooms = [];
    state.joinedRooms = [];
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.messagesByRoom = {};
    state.unreadByRoom = {};
    state.roomKeysByRoom = {};
    state.roomRatchetsByRoom = {};
    state.trustedSenderKeysByRoom = {};
    state.activeRoom = "";
    writeDecoyPersistedPayload(decoyPersistedPayload(buildPersistedPayload(state)));
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    state.settingsOpen = false;
    state.lastError = "";
    showToast("Decoy setup started. Register or log in to the decoy account, customize it, then refresh the app to return to the real lock screen.");
    return true;
  }

  async function activateDecoyProfile() {
    disconnect();
    activeClientLockKey = null;
    const decoyPayload = loadDecoyPersistedPayload();
    if (decoyPayload) {
      applyPersistedPayload(decoyPayload);
    } else {
      applyPersistedPayload(defaultPersisted());
    }
    state.clientLockLocked = false;
    state.clientLockEnabled = false;
    state.clientLockSalt = "";
    state.clientLockIv = "";
    state.clientLockCiphertext = "";
    state.clientLockStorage = "";
    state.clientLockDisplayName = "";
    state.clientLockAvatar = null;
    state.clientLockThemeMode = "system";
    state.clientLockFailedAttempts = 0;
    state.opsecDecoySetupActive = false;
    state.opsecDecoyConfigured = Boolean(decoyPayload);
    state.opsecDecoyActive = true;
    state.settingsOpen = false;
    state.lastError = "";
    if (state.authToken) connect();
  }

  async function handleDuressUnlock() {
    if (state.opsecDuressAction === "decoy") {
      await activateDecoyProfile();
      return;
    }
    await wipeBrowserPersistence();
    window.location.reload();
  }

  async function resetAfterClientLockFailures() {
    if (state.inCall) endCall();
    if (state.recording) stopRecordingVoiceMemo(true);
    disconnect();
    await deleteClientLockPayload();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    localStorage.removeItem(OPSEC_DECOY_STORAGE_KEY);
    activeClientLockKey = null;
    state.authToken = "";
    state.userId = "";
    state.username = "";
    state.recoveryWords = [];
    state.clientLockEnabled = false;
    state.clientLockLocked = false;
    state.clientLockSalt = "";
    state.clientLockIv = "";
    state.clientLockCiphertext = "";
    state.clientLockStorage = "";
    state.clientLockDisplayName = "";
    state.clientLockAvatar = null;
    state.clientLockThemeMode = "dark";
    state.clientLockFailedAttempts = 0;
    state.rooms = [];
    state.messagesByRoom = {};
    state.unreadByRoom = {};
    state.roomKeysByRoom = {};
    state.roomRatchetsByRoom = {};
    state.trustedSenderKeysByRoom = {};
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.badgesByUser = {};
    state.statusesByUser = {};
    state.userIdsByUsername = {};
    state.profile = normalizeProfile(null);
    state.status = "online";
    state.activeRoom = "";
    state.joinedRooms = [];
    state.pendingJoinRooms = [];
    state.lastError = "QxChat reset after too many invalid PIN attempts.";
    showToast(state.lastError);
  }

  async function unlockClientLock(pin) {
    const validation = validateClientLockPin(pin);
    if (validation) {
      state.lastError = validation;
      showToast(validation);
      return false;
    }
    if (await matchesOpsecDuressPin(pin)) {
      await handleDuressUnlock();
      return true;
    }
    state.clientLockLoading = true;
    state.clientLockProgress = 8;
    await yieldToBrowser();
    try {
      const storedLockPayload: any = state.clientLockCiphertext
        ? { iv: state.clientLockIv, ciphertext: state.clientLockCiphertext }
        : await getClientLockPayload();
      state.clientLockProgress = 18;
      await yieldToBrowser();
      const key = await deriveClientLockKey(pin, base64ToBytes(state.clientLockSalt));
      state.clientLockProgress = 42;
      await yieldToBrowser();
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(storedLockPayload?.iv) },
        key,
        base64ToBytes(storedLockPayload?.ciphertext),
      );
      state.clientLockProgress = 60;
      await yieldToBrowser();
      const payloadText = new TextDecoder().decode(decrypted);
      state.clientLockProgress = 68;
      await yieldToBrowser();
      const payload = JSON.parse(payloadText);
      const salt = state.clientLockSalt;
      activeClientLockKey = key;
      const lockThemeChoice = state.clientLockThemeMode;
      await applyPersistedPayloadAfterUnlock(payload);
      state.clientLockEnabled = true;
      state.clientLockLocked = false;
      // If the user toggled the theme on the lock screen, keep that choice
      // after the decrypted settings restore (which resets themeMode).
      if (lockThemeChoice && lockThemeChoice !== state.themeMode) {
        state.themeMode = lockThemeChoice;
        state.clientLockThemeMode = lockThemeChoice;
        await persist();
      }
      state.clientLockSalt = salt;
      state.clientLockIv = "";
      state.clientLockCiphertext = "";
      state.clientLockStorage = "";
      state.clientLockFailedAttempts = 0;
      state.clientLockPinLength = String(pin).length;
      state.clientLockProgress = 100;
      markClientActivity();
      persistClientLockFailedAttempts();
      await yieldToBrowser();
      connect();
      showToast(t("lock.unlockSuccess"));
      return true;
    } catch {
      state.clientLockFailedAttempts = Math.min(
        CLIENT_LOCK_MAX_FAILED_ATTEMPTS,
        Number(state.clientLockFailedAttempts || 0) + 1,
      );
      persistClientLockFailedAttempts();
      if (state.clientLockFailedAttempts >= CLIENT_LOCK_MAX_FAILED_ATTEMPTS) {
        await resetAfterClientLockFailures();
        return false;
      }
      state.lastError = "Invalid PIN.";
      showToast(state.lastError);
      return false;
    } finally {
      state.clientLockLoading = false;
    }
  }

  async function lockClient() {
    if (!state.clientLockEnabled || state.clientLockLocked || !activeClientLockKey) return false;
    clearClientLockAutolockTimer();
    await flushPersist();
    const lockedPayload = await encryptClientLockPayload(
      buildPersistedPayload(state),
      activeClientLockKey,
      state.clientLockSalt,
      state.clientLockPinLength,
    );
    const storedLockedPayload = await writeLockedPersistedPayload(lockedPayload);
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    disconnect();
    activeClientLockKey = null;
    state.authToken = "";
    state.userId = "";
    state.username = "";
    state.recoveryWords = [];
    state.profile = normalizeProfile(null);
    state.activeRoom = "";
    state.rooms = [];
    state.joinedRooms = [];
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.messagesByRoom = {};
    state.unreadByRoom = {};
    state.roomKeysByRoom = {};
    state.roomRatchetsByRoom = {};
    state.trustedSenderKeysByRoom = {};
    state.clientLockSalt = String(lockedPayload.salt || state.clientLockSalt || "");
    state.clientLockIv = String(storedLockedPayload.iv || "");
    state.clientLockCiphertext = String(storedLockedPayload.ciphertext || "");
    state.clientLockDisplayName = String(lockedPayload.displayName || "");
    state.clientLockAvatar = normalizeProfileImage(lockedPayload.avatar, MAX_PROFILE_AVATAR_BYTES);
    state.clientLockThemeMode = THEME_MODES.includes(String(lockedPayload.themeMode || "").toLowerCase()) ? String(lockedPayload.themeMode).toLowerCase() : "system";
    state.clientLockAutolockEnabled = lockedPayload.autolockEnabled === true;
    state.clientLockAutolockTimeoutMs = sanitizeClientLockAutolockTimeoutMs(lockedPayload.autolockTimeoutMs);
    state.opsecDuressEnabled = lockedPayload.opsecDuressEnabled === true;
    state.opsecDuressSalt = String(lockedPayload.opsecDuressSalt || "");
    state.opsecDuressHash = String(lockedPayload.opsecDuressHash || "");
    state.opsecDuressAction = OPSEC_DURESS_ACTIONS.includes(String(lockedPayload.opsecDuressAction || "")) ? String(lockedPayload.opsecDuressAction) : "wipe";
    state.opsecHideLockIdentity = (lockedPayload as any).opsecHideLockIdentity !== false;
    state.clientLockLocked = true;
    state.settingsOpen = false;
    showToast("QxChat locked.");
    return true;
  }

  async function verifyClientLockPin(pin) {
    const validation = validateClientLockPin(pin);
    if (validation) {
      state.lastError = validation;
      showToast(validation);
      return false;
    }
    if (!state.clientLockEnabled || state.clientLockLocked || !activeClientLockKey || !state.clientLockSalt) return false;
    try {
      const probe = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: probe },
        activeClientLockKey,
        new TextEncoder().encode("verify"),
      );
      const candidateKey = await deriveClientLockKey(pin, base64ToBytes(state.clientLockSalt));
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: probe },
        candidateKey,
        encrypted,
      );
      return true;
    } catch {
      state.lastError = t("lock.incorrectPin");
      showToast(state.lastError);
      return false;
    }
  }

  async function setOpsecDuressPin(pin) {
    if (!state.clientLockEnabled || state.clientLockLocked || !activeClientLockKey || !state.clientLockSalt) {
      state.lastError = t("settings.opsec.requiresUnlockedLock");
      showToast(state.lastError);
      return false;
    }
    const validation = validateClientLockPin(pin);
    if (validation) {
      state.lastError = validation;
      showToast(validation);
      return false;
    }
    if (!crypto?.subtle) {
      state.lastError = "OpSec requires Web Crypto.";
      showToast(state.lastError);
      return false;
    }
    const result = await hashOpsecPin(pin);
    state.opsecDuressSalt = result.salt;
    state.opsecDuressHash = result.hash;
    state.opsecDuressEnabled = true;
    await persist();
    showToast("Duress PIN enabled.");
    return true;
  }

  async function clearOpsecDuressPin() {
    state.opsecDuressEnabled = false;
    state.opsecDuressSalt = "";
    state.opsecDuressHash = "";
    await persist();
  }

  function setOpsecDuressAction(value) {
    state.opsecDuressAction = OPSEC_DURESS_ACTIONS.includes(String(value || "")) ? String(value) : "wipe";
    persist();
  }

  async function setOpsecHideLockIdentity(value) {
    state.opsecHideLockIdentity = Boolean(value);
    await persist();
    if (state.clientLockEnabled && !state.clientLockLocked && activeClientLockKey && state.clientLockSalt) {
      const lockedPayload = await encryptClientLockPayload(
        buildPersistedPayload(state),
        activeClientLockKey,
        state.clientLockSalt,
        state.clientLockPinLength,
      );
      await writeLockedPersistedPayload(lockedPayload);
    }
  }

  async function setOpsecRamOnlyEnabled(value) {
    state.opsecRamOnlyEnabled = Boolean(value);
    if (state.opsecRamOnlyEnabled) {
      await deleteClientLockPayload().catch(() => { });
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      localStorage.removeItem(OPSEC_DECOY_STORAGE_KEY);
    } else {
      await persist();
    }
  }

  async function disableClientLock() {
    if (!state.clientLockEnabled) return true;
    state.clientLockEnabled = false;
    state.clientLockLocked = false;
    state.clientLockSalt = "";
    state.clientLockIv = "";
    state.clientLockCiphertext = "";
    state.clientLockStorage = "";
    state.clientLockDisplayName = "";
    state.clientLockAvatar = null;
    state.clientLockThemeMode = "dark";
    state.clientLockAutolockEnabled = false;
    clearClientLockAutolockTimer();
    activeClientLockKey = null;
    await deleteClientLockPayload();
    await persist();
    showToast("Client lock disabled.");
    return true;
  }

  function installClientActivityListeners() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const eventName of events) {
      window.addEventListener(eventName, markClientActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        scheduleClientLockAutolock();
      } else {
        markClientActivity();
      }
    });
    markClientActivity();
  }

  installClientActivityListeners();

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

  async function apiFormRequest(path, form: FormData) {
    const headers = state.authToken
      ? { authorization: `Bearer ${state.authToken}` }
      : {};
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers,
      body: form,
    });
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
      selectedVideoInputId: state.selectedVideoInputId,
      microphoneThreshold: state.microphoneThreshold,
      appAccent: state.appAccent,
      themeMode: state.themeMode,
      messageStyle: state.messageStyle,
      soundFlags: { ...state.soundFlags },
      callUserVolumes: { ...state.callUserVolumes },
      roomNotes: { ...state.roomNotes },
    };
    state.authToken = String(data.token || state.authToken || "");
    state.userId = String(data.user.id || "");
    state.username = sanitizeUsername(data.user.username);
    state.admin = Boolean(data.user.admin);
    state.profile = mergeProfiles(state.profile, data.user.profile);
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

  function normalizeRecoveryWords(recoveryWords) {
    return String(recoveryWords || "")
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 16);
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
      state.lastError = t("settings.security.recoveryNote");
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
    const cleanUsername = sanitizeUsername(username);
    state.authLoading = true;
    try {
      const challengeData = await apiRequest(`/api/auth/challenge?action=register&target=${encodeURIComponent(cleanUsername)}`, {
        method: "GET",
      });
      if (!challengeData) {
        throw new Error("Unable to obtain security challenge.");
      }

      let vdfProof = null;
      let vdfChallenge = null;
      let nullifier = null;
      let quotaToken = null;

      if (challengeData.quotaToken?.ticket && challengeData.quotaToken?.epoch !== undefined) {
        quotaToken = challengeData.quotaToken;
        nullifier = await computeNullifier(quotaToken.ticket, quotaToken.epoch, "register");
      }

      if (challengeData.vdf?.x && challengeData.vdf?.modulus && challengeData.vdf?.t) {
        vdfChallenge = challengeData.vdf;
        vdfProof = await solveVdf(vdfChallenge.x, vdfChallenge.t, vdfChallenge.modulus);
      } else {
        throw new Error("Invalid VDF security challenge received from server.");
      }

      if (!challengeData.pqcKey?.keyId || !challengeData.pqcKey?.tHex || !challengeData.pqcKey?.rhoHex) {
        throw new Error("Post-quantum security challenge missing from server.");
      }

      let pqcCiphertext = null;
      try {
        const pqcRes = await encapsulatePqcSecret(challengeData.pqcKey);
        pqcCiphertext = pqcRes.ciphertext;
      } catch {
        throw new Error("Your browser does not support post-quantum lattice cryptography (Ring-LWE). Please update your browser.");
      }

      const data = await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: cleanUsername,
          password,
          vdfChallenge,
          vdfProof,
          quotaToken,
          nullifier,
          pqcCiphertext,
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
    const cleanUsername = sanitizeUsername(username);
    state.authLoading = true;
    try {
      let data = null;
      try {
        data = await apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: cleanUsername,
            password,
          }),
        });
      } catch (firstErr: any) {
        const msg = String(firstErr?.message || "").toLowerCase();
        if (msg.includes("security challenge") || msg.includes("challenge") || msg.includes("too many failed")) {
          const challengeData = await apiRequest(
            `/api/auth/challenge?action=login&target=${encodeURIComponent(cleanUsername)}`,
            { method: "GET" }
          );
          if (challengeData?.vdf?.x && challengeData?.vdf?.modulus && challengeData?.vdf?.t) {
            const vdfProof = await solveVdf(challengeData.vdf.x, challengeData.vdf.t, challengeData.vdf.modulus);
            let quotaToken = null;
            let nullifier = null;
            if (challengeData.quotaToken?.ticket && challengeData.quotaToken?.epoch !== undefined) {
              quotaToken = challengeData.quotaToken;
              nullifier = await computeNullifier(quotaToken.ticket, quotaToken.epoch, "login");
            }
            data = await apiRequest("/api/auth/login", {
              method: "POST",
              body: JSON.stringify({
                username: cleanUsername,
                password,
                vdfChallenge: challengeData.vdf,
                vdfProof,
                quotaToken,
                nullifier,
              }),
            });
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      applyAuthenticatedPayload(data);
      connect();
      return true;
    } catch (error: any) {
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
      state.recoveryWords = normalizeRecoveryWords(recoveryWords);
      persist();
      downloadRecoveryWords();
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
      state.sessionExpired = false;
      return true;
    } catch {
      disconnect();
      state.sessionExpired = true;
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

  async function deleteAdminUser(userId) {
    if (!state.admin) return false;
    try {
      await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/delete`, {
        method: "POST",
      });
      await loadAdminOverview();
      return true;
    } catch (error) {
      state.lastError = error?.message || "User delete failed.";
      showToast(state.lastError);
      return false;
    }
  }

  async function setAdminUserBadges(userId, badges) {
    if (!state.admin) return false;
    try {
      const normalizedBadges = normalizeUserBadges(badges);
      await apiRequest(
        `/api/admin/users/${encodeURIComponent(userId)}/badges`,
        {
          method: "POST",
          body: JSON.stringify({ badges: normalizedBadges }),
        },
      );
      await loadAdminOverview();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Badge update failed.";
      showToast(state.lastError);
      return false;
    }
  }

  function profileFor(username) {
    const key = sanitizeUsername(username);
    if (!key) return normalizeProfile(null);
    if (isSystemUsername(key)) return systemProfile();
    if (key === sanitizeUsername(state.username)) return myProfile.value;
    return normalizeProfile(state.profilesByUser[key]);
  }

  function badgesFor(username) {
    const key = sanitizeUsername(username);
    if (!key) return [];
    if (isSystemUsername(key)) return ["system"];
    return normalizeUserBadges(state.badgesByUser[key]);
  }

  function statusFor(username) {
    const key = sanitizeUsername(username);
    if (!key) return "online";
    if (isSystemUsername(key)) return "online";
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
    if (!state.roomKeysByRoom[id] || state.roomKeysByRoom[id] !== normalized) {
      throw new Error("Failed to store room key.");
    }
    return normalized;
  }

  function roomAccessToken(roomId) {
    const id = sanitizeRoomId(roomId);
    const key = roomKeyFor(id);
    if (!id || !key) return "";
    return `${id}${key}`;
  }

  function openImportedRoomToken(token) {
    const parsed = parseRoomAccessToken(token);
    importRoomKey(parsed.roomId, parsed.roomKey);
    selectConversation(parsed.roomId);
    if (state.connected && state.identified) requestJoin(parsed.roomId, { force: true });
    return parsed.roomId;
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
    const roomTrust = state.trustedSenderKeysByRoom[roomId] || {};
    const senderDeviceId = String(message.encrypted.senderDeviceId || "").trim();
    const trustedKey = senderDeviceId ? roomTrust[senderDeviceId] || null : null;
    try {
      const decrypted = await decryptRoomPayload(
        roomKey,
        roomId,
        message.encrypted,
        trustedKey,
      );
      if (senderDeviceId && !trustedKey && canonicalDeviceSigningKey(message.encrypted.senderSigningKey)) {
        state.trustedSenderKeysByRoom[roomId] = { ...roomTrust, [senderDeviceId]: message.encrypted.senderSigningKey };
        persist();
      }
      return normalizeMessage(
        {
          ...message,
          text: String(decrypted?.text || ""),
          clientNonce: String(decrypted?.clientNonce || message.clientNonce || ""),
          replyToMessageId: String(decrypted?.replyToMessageId || message.replyToMessageId || ""),
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
                dataB64: String(decrypted.attachment.dataB64 || ""),
              }
              : null,
          preview: message.preview || null,
          locked: false,
        },
        roomId,
      );
    } catch {
      return encryptedPlaceholderMessage(message, roomId, trustedKey ? "sender key mismatch" : "wrong room key");
    }
  }

  async function ensureDeviceSigner() {
    if (!state.deviceId) state.deviceId = generateDeviceId();
    if (!state.deviceSigningPublicKey || !state.deviceSigningPrivateKey) {
      const keys = await generateDeviceSigningKeyPair();
      state.deviceSigningPublicKey = keys.publicKey;
      state.deviceSigningPrivateKey = keys.privateKey;
    }
    persist();
    return {
      deviceId: state.deviceId,
      publicKey: state.deviceSigningPublicKey,
      privateKey: state.deviceSigningPrivateKey,
    };
  }

  async function buildEncryptedOutgoingMessage(roomId, payload) {
    const id = sanitizeRoomId(roomId);
    const roomKey = roomKeyFor(id);
    if (!roomKey) {
      throw new Error(
        "This room needs its room token key before you can send encrypted messages.",
      );
    }
    const nextCounter = Math.max(0, Math.floor(Number(state.roomRatchetsByRoom[id]) || 0)) + 1;
    const encrypted = await encryptRoomPayload(roomKey, id, payload, nextCounter, await ensureDeviceSigner());
    state.roomRatchetsByRoom[id] = nextCounter;
    persist();
    return encrypted;
  }

  function displayRoomName(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return "";
    if (state.streamerMode) return "Hidden channel";
    const room = state.rooms.find((entry) => entry.roomId === id);
    const persistedTitle = String(room?.title || "").trim();
    if (persistedTitle) return persistedTitle;
    return id;
  }

  function beautifyRoomName(name, maxLength = 12) {
    const text = String(name || "").trim();
    if (!text) return "";
    // Keep only the first meaningful segment (like a short git commit hash).
    const segment = text.split(/[-_.]+/)[0].trim() || text;
    if (segment.length <= maxLength) return segment;
    return segment.slice(0, maxLength);
  }

  function displayRoomNameBeautified(roomId) {
    const name = displayRoomName(roomId);
    if (!name || state.streamerMode) return name;
    const id = sanitizeRoomId(roomId);
    const room = state.rooms.find((entry) => entry.roomId === id);
    const title = String(room?.title || "").trim();
    const isCustom = Boolean(title && title !== id);
    return isCustom ? name : beautifyRoomName(name);
  }

  function roomNote(roomId) {
    const id = sanitizeRoomId(roomId);
    return id ? String(state.roomNotes[id] || "") : "";
  }

  function roomIcon(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return "";
    const room = state.rooms.find((entry) => entry.roomId === id);
    return sanitizeHttpUrl(room?.iconUrl);
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
    send({ op: 33, d: { gameId: id, title: clean } });
  }

  function clearLocalRoomName(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id) return;
    send({ op: 33, d: { gameId: id, title: "" } });
  }

  async function setLocalRoomIconFromFile(roomId, file) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return false;
    if (!file) return false;
    if (!String(file.type || "").startsWith("image/")) {
      state.lastError = "Room icon must be an image.";
      return false;
    }
    if (Number(file.size) > 5 * 1024 * 1024) {
      state.lastError = "Room icon must be under 5 MB.";
      return false;
    }

    try {
      const form = new FormData();
      form.append("file", file, String(file.name || "room-icon"));
      const payload = await apiFormRequest(`/api/rooms/${encodeURIComponent(id)}/icon`, form);
      const iconUrl = sanitizeHttpUrl(
        payload?.room?.icon?.url ||
        payload?.room?.icon?.file?.url ||
        payload?.icon?.url ||
        payload?.icon?.file?.url,
      );
      if (!iconUrl) {
        state.lastError = "Invalid room icon URL returned by server.";
        return false;
      }
      touchRoom(id);
      const room = state.rooms.find((entry) => entry.roomId === id);
      if (room) {
        room.iconUrl = cacheBustedRoomIconUrl(iconUrl);
      }
      persist();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Could not upload room icon.";
      showToast(state.lastError);
      return false;
    }
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

  function setShareScreenAudio(value) {
    state.shareScreenAudio = Boolean(value);
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
      case "deafen":
        playDeafenSound(true);
        break;
      case "undeafen":
        playUndeafenSound(true);
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
    const next = THEME_MODES.includes(
      String(value || "").toLowerCase(),
    )
      ? String(value).toLowerCase()
      : "system";
    state.themeMode = next;
    persist();
  }

  function setClientLockThemeMode(value) {
    const next = THEME_MODES.includes(
      String(value || "").toLowerCase(),
    )
      ? String(value).toLowerCase()
      : "system";
    state.clientLockThemeMode = next;
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

  function setSpotlightSearchEnabled(value) {
    state.spotlightSearchEnabled = Boolean(value);
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
    syncClientSettings(true, {
      description:
        description !== undefined
          ? sanitizeProfileText(description, MAX_PROFILE_DESCRIPTION_LENGTH)
          : state.profile.description,
      pronouns:
        pronouns !== undefined
          ? sanitizeProfileText(pronouns, MAX_PROFILE_PRONOUNS_LENGTH)
          : state.profile.pronouns,
    });
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
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file, String(file.name || kind));
      const payload = await apiFormRequest("/api/profile/image", form);
      const image = payload?.[kind];
      state.profile = normalizeProfile({ ...state.profile, [kind]: image });
      persist();
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
    syncClientSettings(true, { [kind]: null });
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
        notificationAudioContext.resume().catch(() => { });
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
        .catch(() => { });
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

  function videoConstraints() {
    return {
      video: state.selectedVideoInputId
        ? { deviceId: { exact: state.selectedVideoInputId } }
        : true,
      audio: false,
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

  function setVideoInput(deviceId) {
    state.selectedVideoInputId = String(deviceId || "");
    persist();
  }

  async function getPreferredVideoStream() {
    try {
      return await navigator.mediaDevices.getUserMedia(videoConstraints());
    } catch (error) {
      const selectedDeviceId = String(state.selectedVideoInputId || "").trim();
      const errorName = String(error?.name || "").trim();
      if (!selectedDeviceId || errorName !== "OverconstrainedError") throw error;

      state.selectedVideoInputId = "";
      persist();
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
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
      const outAnalyser = context.createAnalyser();
      const gate = context.createGain();
      const destination = context.createMediaStreamDestination();
      analyser.fftSize = 1024;
      outAnalyser.fftSize = 1024;
      gate.gain.value = Number(state.microphoneThreshold) > 0 ? 0 : 1;
      monitorSource.connect(analyser);
      outboundSource.connect(gate);
      gate.connect(destination);
      // Mirror the actual outbound (post-gate) audio so the speaker indicator
      // uses the same signal the other peers receive, not the raw mic.
      const outboundMonitor = context.createMediaStreamSource(destination.stream);
      outboundMonitor.connect(outAnalyser);
      context.resume?.().catch?.(() => { });
      state.callAnalyser = { context, analyser, outAnalyser, gate, monitorStream };
      state.callAnalyserData = new Uint8Array(analyser.fftSize);
      state.callAnalyserOutData = new Uint8Array(outAnalyser.fftSize);
      return destination.stream;
    } catch {
      state.callAnalyser = null;
      state.callAnalyserData = null;
      state.callAnalyserOutData = null;
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
    state.callAnalyserOutData = null;
    if (context) context.close().catch(() => { });
  }

  function attachRemoteCallAnalyser(username: string, stream: MediaStream) {
    const key = sanitizeUsername(username);
    if (!key) return;
    removeRemoteCallAnalyser(key);
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const context = new AudioCtx();
      const source = context.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      context.resume?.().catch?.(() => { });
      remoteCallAnalysers.set(key, {
        context,
        analyser,
        data: new Uint8Array(analyser.fftSize),
      });
    } catch {
      /* audio analysis is best-effort */
    }
  }

  function removeRemoteCallAnalyser(username: string) {
    const key = sanitizeUsername(username);
    const entry = remoteCallAnalysers.get(key);
    if (!entry) return;
    remoteCallAnalysers.delete(key);
    entry.context.close().catch(() => { });
  }

  function clearRemoteCallAnalysers() {
    for (const key of [...remoteCallAnalysers.keys()]) removeRemoteCallAnalyser(key);
  }

  function startSpeakingSampler() {
    if (speakingSampler) clearInterval(speakingSampler);
    const tick = () => {
      if (!state.inCall) {
        if (speakingSampler) clearInterval(speakingSampler);
        speakingSampler = null;
        return;
      }
      const roomId = state.callRoom || state.activeRoom;
      if (!roomId) return;
      // Use the configured mic threshold when set, otherwise a floor high
      // enough to ignore quiet room tone during a call.
      const threshold = Math.max(12, Number(state.microphoneThreshold) || 0);

      // Local microphone (via the outbound post-gate analyser, so the speaker
      // indicator sees the same signal other peers receive).
      if (!state.callMuted && state.callAnalyser?.outAnalyser && state.callAnalyserOutData) {
        state.callAnalyser.outAnalyser.getByteTimeDomainData(state.callAnalyserOutData);
        const level = microphoneLevelFromSamples(state.callAnalyserOutData);
        if (level >= threshold) {
          if (!state.speakingByRoom[roomId]) state.speakingByRoom[roomId] = {};
          state.speakingByRoom[roomId][sanitizeUsername(state.username)] = Date.now();
        }
      } else if (state.callMuted && state.speakingByRoom[roomId]) {
        // When muted, drop our own timestamp immediately so the ring clears.
        delete state.speakingByRoom[roomId][sanitizeUsername(state.username)];
      }

      // Remote streams.
      for (const [key, entry] of remoteCallAnalysers) {
        entry.analyser.getByteTimeDomainData(entry.data);
        const level = microphoneLevelFromSamples(entry.data);
        if (level >= threshold) {
          if (!state.speakingByRoom[roomId]) state.speakingByRoom[roomId] = {};
          state.speakingByRoom[roomId][key] = Date.now();
        }
      }
    };
    tick();
    speakingSampler = setInterval(tick, 60);
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
    if (context) context.close().catch(() => { });
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
      micTestAudio.play().catch(() => { });

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

  function touchRoom(roomId: string, message = null) {
    const id = sanitizeRoomId(roomId);
    if (!id) return;

    const latest = latestSidebarRoomMessage(state.messagesByRoom[id] || []);
    const sidebarMessage = latest || (isTransientPresenceSystemMessage(message) ? null : message);
    const preview = messagePreviewLabel(sidebarMessage);
    const sender = sidebarMessage?.username || "";
    const ts = Number(sidebarMessage?.timestamp || 0);

    const existing = state.rooms.find((r) => r.roomId === id);
    if (existing) {
      existing.lastPreview = preview || existing.lastPreview;
      existing.lastTimestamp = ts || existing.lastTimestamp;
      existing.lastSender = sender || existing.lastSender;
    } else {
      state.rooms.push({
        roomId: id,
        title: "",
        lastPreview: preview,
        lastTimestamp: ts,
        lastSender: sender,
        iconUrl: "",
        members: [],
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

  function clearLocalRoomMessages(roomId) {
    const id = sanitizeRoomId(roomId);
    if (!id || !isValidRoomId(id)) return;
    clearRoomMessages(id);
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
    // WebSocket dropped — clean up any live call state so we can
    // rebuild peer connections from scratch on reconnect.
    if (state.inCall) {
      if (speakingSampler) {
        clearInterval(speakingSampler);
        speakingSampler = null;
      }
      clearRemoteCallAnalysers();
      callManager?.close();
      callManager = null;
      state.remoteCallStreamsByUser = {};
      state.remoteCallMediaByUser = {};
      state.inCall = false;
      state.voiceEnabled = false;
      state.callRoom = "";
      state.callElapsed = 0;
      state.localCallMedia = { audio: false, camera: false, screen: false };
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
      if (outboundStream && outboundStream !== rawCallStream) stopStreamTracks(outboundStream);
      callOutboundStream = null;
      if (rawCallStream) stopStreamTracks(rawCallStream);
      state.callStream = null;
      closeCallAnalyser();
    }
    state.connected = false;
    state.identified = false;
    state.uuid = null;
    state.joinedRooms = [];
    state.pendingJoinRooms = [];
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.publicProfileFetchedAtByUser = {};
    state.badgesByUser = {};
    state.statusesByUser = {};
    state.userIdsByUsername = {};
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
    if (message) showToast(message);
  }

  function send(payload) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify(payload));
  }

  function syncClientSettings(includeProfile = false, profileOverride?: any) {
    if (!state.connected || !state.identified) return;
    const d: any = {
      deleteMessagesOnLeave: state.deleteMessagesOnLeave,
      serverClearsLocalMessages: state.serverClearsLocalMessages,
      status: sanitizePresenceStatus(state.status),
      clientId: localClientId,
      platform: currentLocalPlatform(),
    };
    if (includeProfile) {
      d.profile = profileOverride
        ? normalizeProfilePatch(profileOverride)
        : normalizeProfile(state.profile);
    }
    send({ op: 8, d });
  }

  function requestJoin(roomId, options: any = {}) {
    const id = sanitizeRoomId(roomId);
    const validation = validateRoomId(id);
    if (validation) {
      state.lastError = validation;
      return;
    }
    if (!state.identified) return;
    if (state.joinedRooms.includes(id)) return;
    if (state.pendingJoinRooms.includes(id)) {
      if (!options?.force) return;
      state.pendingJoinRooms = state.pendingJoinRooms.filter((roomId) => roomId !== id);
    }
    state.pendingJoinRooms.push(id);
    send({ op: 3, d: { gameId: id, silentJoin: options?.silentJoin === true } });
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
    if (!state.rooms.some((room) => room.roomId === id)) {
      state.rooms.unshift({
        roomId: id,
        title: "",
        lastPreview: "",
        lastTimestamp: 0,
        lastSender: "",
        iconUrl: "",
        members: [],
      });
    }
    persist();
    touchRoom(id);
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
      state.rooms = state.rooms.filter((room) => room.roomId !== id);
      delete state.usersByRoom[id];
      delete state.voiceMembersByRoom[id];
      delete state.callClientsByRoom[id];
      delete state.typingByRoom[id];
      delete state.unreadByRoom[id];
      if (state.activeRoom === id) state.activeRoom = "";
      persist();
    }
    send({ op: 4, d: { gameId: id } });
  }

  function leaveAllRooms(deleteMessages = false) {
    const roomIds = state.rooms
      .map((room) => room.roomId)
      .filter((id) => isValidRoomId(sanitizeRoomId(id)));

    for (const id of roomIds) {
      if (deleteMessages) {
        clearRoomMessages(id);
      }
      leaveRoom(id);
    }
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
    if (!raw) return;

    // Handle a full 96-char hex E2EE room token (roomId + roomKey)
    if (/^[0-9a-f]{96}$/i.test(raw)) {
      try {
        openImportedRoomToken(raw);
        state.composing = false;
        state.composeInput = "";
        return;
      } catch {
        // Fall through — try to treat it as a plain room ID.
      }
    }

    // Handle an invite URL with a unified token param
    if (/[?&]token=/i.test(raw)) {
      try {
        let tokenFromUrl = "";
        const hashIndex = raw.lastIndexOf("#");
        if (hashIndex !== -1) {
          const fragment = raw.slice(hashIndex + 1);
          const queryIndex = fragment.indexOf("?");
          if (queryIndex !== -1) {
            const params = new URLSearchParams(fragment.slice(queryIndex + 1));
            tokenFromUrl = String(params.get("token") || "").trim();
          }
        }
        if (!tokenFromUrl) {
          try {
            const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
            tokenFromUrl = String(url.searchParams.get("token") || "").trim();
          } catch { /* ignore */ }
        }
        if (/^[0-9a-f]{96}$/i.test(tokenFromUrl)) {
          openImportedRoomToken(tokenFromUrl);
          state.composing = false;
          state.composeInput = "";
          return;
        }
      } catch {
        // Fall through.
      }
    }

    // Plain room ID / room name
    const id = sanitizeRoomId(raw);
    const validation = validateRoomId(id);
    if (validation) {
      state.lastError = validation;
      showToast(validation);
      return;
    }
    state.composing = false;
    state.composeInput = "";
    selectConversation(id);
  }

  function showToast(message, options: { badge?: string; badgeAvatarSrc?: string; error?: boolean } = {}) {
    state.toastMessage = message;
    state.toastBadge = String(options?.badge || "");
    state.toastBadgeAvatarSrc = String(options?.badgeAvatarSrc || "");
    // Infer an error toast when the caller passed the current error state.
    const isError = options?.error === true || (typeof options?.error !== "boolean" && !!state.lastError && message === state.lastError);
    state.toastError = isError;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (state.toastMessage === message) {
        state.toastMessage = "";
        state.toastBadge = "";
        state.toastBadgeAvatarSrc = "";
        state.toastError = false;
      }
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
      state.lastError = t("lock.loginRequired");
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
        replyToMessageId: state.replyingTo?.messageId || "",
      })
        .then((encrypted) => {
          send({ op: 7, d: { gameId: roomId, encrypted } });
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

  async function sendAttachment(file, caption = "", onProgress?) {
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
    const type = String(file.type || "").toLowerCase();
    // if (!["image/png", "image/gif", "image/jpeg"].includes(type)) {
    //   state.lastError = "Only PNG, GIF, and JPEG images are allowed.";
    //   showToast(state.lastError);
    //   return;
    // }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      state.lastError = `File too large: ${file.name} (${formatSize(file.size)} > ${formatSize(MAX_ATTACHMENT_BYTES)})`;
      showToast(state.lastError);
      return;
    }

    try {
      const clientNonce = crypto.randomUUID();
      const uploadFile = file;
      const previewUrl = URL.createObjectURL(uploadFile);
      const dataB64 = await blobToBase64(uploadFile, onProgress);
      const encrypted = await buildEncryptedOutgoingMessage(roomId, {
        clientNonce,
        text: caption ? String(caption).trim().slice(0, MESSAGE_LIMIT) : "",
        attachment: {
          filename: String(uploadFile.name || "file").slice(0, 128),
          mimeType: uploadFile.type || "application/octet-stream",
          size: uploadFile.size,
          dataB64,
        },
        replyToMessageId: state.replyingTo?.messageId || "",
      });
      const optimisticMessage = normalizeMessage(
        {
          messageId: crypto.randomUUID(),
          roomId,
          clientNonce,
          user: state.username || "You",
          username: state.username || "You",
          text: caption ? String(caption).trim().slice(0, MESSAGE_LIMIT) : "",
          timestamp: Date.now(),
          replyToMessageId: state.replyingTo?.messageId || "",
          attachment: {
            id: "",
            url: previewUrl,
            filename: String(uploadFile.name || "file").slice(0, 128),
            mimeType: uploadFile.type || "application/octet-stream",
            size: uploadFile.size,
            dataB64: "",
          },
        },
        roomId,
      );
      pushMessageToRoom(roomId, optimisticMessage);
      touchRoom(roomId, optimisticMessage);
      if (roomId === state.activeRoom) scrollToBottom();

      send({ op: 7, d: { gameId: roomId, encrypted } });
      state.replyingTo = null;
      persist();
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
      d: {
        gameId: state.callRoom || state.activeRoom,
        isVoiceChat,
        media,
        clientId: localClientId,
        platform,
      },
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

  function rememberUserId(username, userId) {
    const key = sanitizeUsername(username);
    const id = String(userId || "").trim();
    if (!key || !id) return;
    const self = sanitizeUsername(state.username);
    const selfId = String(state.userId || state.uuid || "").trim();
    if (key !== self && selfId && id === selfId) return;
    state.userIdsByUsername[key] = id;
  }

  function userIdForUsername(username) {
    const key = sanitizeUsername(username);
    if (!key) return "";
    if (isSystemUsername(key)) return "qxchat-system";
    if (key === sanitizeUsername(state.username)) return String(state.userId || state.uuid || "").trim();
    return String(state.userIdsByUsername[key] || "").trim();
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
      if (typeof player === "object") {
        rememberUserId(user, player?.id || player?.userId || player?.uuid);
        if (player?.platform) rememberClientPlatform(user, player.platform);
      }
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
    if (remote.stream && remote.stream.getAudioTracks().length) {
      attachRemoteCallAnalyser(key, remote.stream);
    }
    const existing = state.remoteCallMediaByUser[key] || EMPTY_CALL_MEDIA;
    const inferred = normalizeCallMedia(remote.media || EMPTY_CALL_MEDIA);
    state.remoteCallMediaByUser[key] = normalizeCallMedia({
      ...existing,
      // The mute state broadcast over signaling (op 110 / d.media.audio) is
      // authoritative. A remote track briefly reports muted when it first
      // arrives (before the first RTP packet is decoded), so never let that
      // transient track state downgrade a known "not muted". Genuine mutes
      // still arrive via op 110 and via the track's onmute event.
      audio: existing.audio ? existing.audio : Boolean(remote.media?.audio),
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
    removeRemoteCallAnalyser(key);
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
  function resolveTurnServerForCall() {
    const all = [...turnServerList(), ...(state.customTurnServers || [])];
    const id = state.selectedTurnServerId;
    if (id) {
      const found = all.find((s) => s.id === id);
      if (found) return found;
    }
    return all[0];
  }

  async function startCall() {
    if (state.inCall) return;
    if (sanitizePresenceStatus(state.status) === "invisible") {
      state.lastError = "Switch out of invisible mode before joining a call.";
      showToast(state.lastError);
      return;
    }
    const turnServer = resolveTurnServerForCall();
    if (!relayCallsConfigured(state.selectedTurnServerId, turnServer)) {
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
      if (!webRtcSupported()) {
        stopStreamTracks(stream);
        state.lastError = relayCallsRequirementMessage();
        return;
      }
      const outboundStream = setupCallAudioPipeline(stream);
      callOutboundStream = outboundStream;
      refreshAudioDevices();
      state.audioDevicesPermission = "granted";
      state.callStream = stream;
      state.callRoom = roomId;
      state.inCall = true;
      state.callMuted = false;
      state.callDeafened = false;
      state.callMutedBeforeDeafen = false;
      state.deafenedByUser = {};
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
	        turnServerId: state.selectedTurnServerId,
	        turnServer,
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
      startSpeakingSampler();
      tickCall(Date.now());
      playJoinSound();
    } catch (error) {
      state.lastError = mediaErrorMessage("Mic access denied", error);
      endCall();
    }
  }

  function toggleMute() {
    if (!state.callStream && !callOutboundStream) return;
    if (state.callDeafened) return; // deafen overrides mic mute
    state.callMuted = !state.callMuted;
    updateCallAudioGate();
    publishCallState(true);
    if (state.callMuted) playMuteSound();
    else playUnmuteSound();
  }

  function broadcastDeafenState() {
    const roomId = state.callRoom || state.activeRoom;
    if (!roomId) return;
    const platform = currentLocalPlatform();
    send({
      op: 112,
      d: {
        gameId: roomId,
        isDeafened: state.callDeafened,
        clientId: localClientId,
        platform,
      },
    });
  }

  function toggleDeafen() {
    if (!state.inCall) return;
    const wasDeafened = state.callDeafened;
    if (wasDeafened) {
      // Undeafen: restore the mic state from before deafening.
      state.callDeafened = false;
      state.callMuted = state.callMutedBeforeDeafen;
    } else {
      // Deafen is a super mute: force-mute the mic (no longer emits audio)
      // and remember the previous mic state to restore it on undeafen.
      state.callMutedBeforeDeafen = state.callMuted;
      state.callMuted = true;
      state.callDeafened = true;
    }
    updateCallAudioGate();
    broadcastDeafenState();
    publishCallState(true);
    if (state.callDeafened) playDeafenSound();
    else playUndeafenSound();
  }

  function handleDeafenState(d) {
    const roomId = sanitizeRoomId(d?.gameId);
    const user = sanitizeUsername(d?.user);
    if (!roomId || !user) return;
    if (d?.platform) rememberClientPlatform(user, d.platform);
    if (user === sanitizeUsername(state.username)) {
      state.callDeafened = d?.isDeafened === true;
    } else {
      state.deafenedByUser[user] = d?.isDeafened === true;
      if (state.inCall && state.callRoom === roomId && !state.callDeafened) {
        remoteDeafenAt.set(user, Date.now());
        if (d?.isDeafened === true) playDeafenSound();
        else playUndeafenSound();
      }
    }
  }

  function setSelectedTurnServer(serverId: string) {
    state.selectedTurnServerId = String(serverId || "").trim();
    persist();
  }

  function addCustomTurnServer(server) {
    if (!server || typeof server !== "object") return false;
    const urls = Array.isArray(server.urls)
      ? server.urls.map((u) => String(u || "").trim()).filter((u) => /^(turn|turns|stun):/i.test(u))
      : [];
    if (!urls.length) return false;
    const label = String(server.label || "").trim().slice(0, 64) || "Custom TURN";
    const username = String(server.username || "").trim().slice(0, 128);
    const credential = String(server.credential || "").trim().slice(0, 256);
    const next = sanitizeCustomTurnServers([
      ...(state.customTurnServers || []),
      { label, urls, username, credential, hint: server.hint || "" },
    ]);
    state.customTurnServers = next;
    // Auto-select the newly added server so the user can use it immediately.
    if (next.length) state.selectedTurnServerId = next[next.length - 1].id;
    persist();
    return true;
  }

  function removeCustomTurnServer(serverId: string) {
    const id = String(serverId || "").trim();
    if (!id) return;
    const next = (state.customTurnServers || []).filter((s) => s.id !== id);
    state.customTurnServers = next;
    if (state.selectedTurnServerId === id) {
      state.selectedTurnServerId = runtimeDefaultTurnServerId();
    }
    persist();
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
      const stream = await getPreferredVideoStream();
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
        audio: state.shareScreenAudio,
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
    if (speakingSampler) {
      clearInterval(speakingSampler);
      speakingSampler = null;
    }
    clearRemoteCallAnalysers();
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
    state.callDeafened = false;
    state.callMutedBeforeDeafen = false;
    state.deafenedByUser = {};
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
    if (d?.error) {
      state.lastError = d.error;
      showToast(d.error);
      if (state.inCall) endCall();
      return;
    }
    const roomId = sanitizeRoomId(d?.gameId);
    const user = sanitizeUsername(d?.user);
    if (!roomId || !user) return;
    const clientId = sanitizeClientId(d?.clientId || d?.fromClientId);
    const me = sanitizeUsername(state.username);
    if (d?.platform) rememberClientPlatform(user, d.platform);
    if (!state.callClientsByRoom[roomId]) state.callClientsByRoom[roomId] = {};

    const members = new Set(state.voiceMembersByRoom[roomId] || []);
    const wasKnownMember = members.has(user);
    const prevMedia = state.remoteCallMediaByUser[user] || EMPTY_CALL_MEDIA;
    const hearRemote = user !== me && state.inCall && state.callRoom === roomId && !state.callDeafened;
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
      if (hearRemote && !wasKnownMember) playJoinSound();
    } else {
      const clients = new Set(state.callClientsByRoom[roomId][user] || []);
      if (clientId) clients.delete(clientId);
      if (clientId && clients.size) {
        state.callClientsByRoom[roomId][user] = [...clients];
      } else {
        delete state.callClientsByRoom[roomId][user];
        delete state.deafenedByUser[user];
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
      if (hearRemote && wasKnownMember && !members.has(user)) playLeaveSound();
    }
    state.voiceMembersByRoom[roomId] = [...members];

    if (hearRemote && wasKnownMember && d.media) {
      const nextMedia = normalizeCallMedia({
        ...prevMedia,
        ...d.media,
      });
      if (prevMedia.audio !== nextMedia.audio) {
        const deafenWindow = Date.now() - (remoteDeafenAt.get(user) || 0) < DEAFEN_SOUND_WINDOW_MS;
        if (deafenWindow) {
          remoteDeafenAt.delete(user);
        } else if (nextMedia.audio) {
          playUnmuteSound();
        } else {
          playMuteSound();
        }
      }
      if (prevMedia.camera !== nextMedia.camera) {
        if (nextMedia.camera) playCameraOnSound();
        else playCameraOffSound();
      }
      if (prevMedia.screen !== nextMedia.screen) {
        if (nextMedia.screen) playScreenOnSound();
        else playScreenOffSound();
      }
    }
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

  function handleVoiceState(d) {
    if (d?.error) {
      state.lastError = d.error;
      showToast(d.error);
      if (state.inCall) endCall();
      return;
    }
    const roomId = sanitizeRoomId(d?.gameId);
    if (!roomId) return;
    const user = sanitizeUsername(d?.user);
    if (!user || d?.ok) return; // our own op 98 ack has {ok} but no user — skip
    if (d?.media) {
      handleCallState(d);
      return;
    }
    const members = new Set(state.voiceMembersByRoom[roomId] || []);
    const wasKnownMember = members.has(user);
    const hearRemote = user !== sanitizeUsername(state.username) && state.inCall && state.callRoom === roomId && !state.callDeafened;
    if (d.isVoiceChat === true) {
      members.add(user);
      if (hearRemote && !wasKnownMember) playJoinSound();
    } else {
      members.delete(user);
      delete state.deafenedByUser[user];
      // Clean up WebRTC peer on disconnect (server broadcasts op 98 w/o media on leave).
      if (state.inCall && state.callRoom === roomId) {
        callManager?.removePeer(user, sanitizeClientId(d?.clientId));
        removeRemoteCallMedia(user);
        delete state.callClientsByRoom[roomId]?.[user];
      }
      if (hearRemote && wasKnownMember) playLeaveSound();
    }
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
          if (state.deafenedByUser[previous]) {
            state.deafenedByUser[next] = state.deafenedByUser[previous];
            delete state.deafenedByUser[previous];
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
    state.roomRatchetsByRoom = {};
    state.trustedSenderKeysByRoom = {};
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.badgesByUser = {};
    state.statusesByUser = {};
    state.userIdsByUsername = {};
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
    if (!message?.messageId) return;
    const gameId = sanitizeRoomId(message.roomId || state.activeRoom);
    if (!gameId) return;
    if (state.editingMessage?.messageId === message.messageId)
      cancelEditMessage();
    // Optimistic local delete first, so messages forgotten by the server
    // (no longer in server history) are still removed from the UI immediately.
    applyDeletedMessageIds(gameId, [message.messageId]);
    persist();
    if (state.connected && state.identified) {
      send({ op: 21, d: { messageId: message.messageId, gameId } });
    }
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
    state.sessionExpired = false;
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

  async function renewSession(password: string) {
    const username = sanitizeUsername(state.username);
    if (!username) {
      state.lastError = "Missing username.";
      return false;
    }
    state.authLoading = true;
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      applyAuthenticatedPayload(data);
      state.sessionExpired = false;
      connect();
      return true;
    } catch (error) {
      state.lastError = error?.message || "Session renewal failed.";
      return false;
    } finally {
      state.authLoading = false;
    }
  }

  function dismissSessionExpired() {
    logoutLocal();
    state.sessionExpired = false;
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
      arr.push(normalized);
      if (arr.length > MAX_HISTORY_PER_ROOM)
        arr.splice(0, arr.length - MAX_HISTORY_PER_ROOM);
      return true;
    } else {
      arr[index] = normalized;
      return false;
    }
  }

  function replaceOptimisticMessageByClientNonce(roomId, normalized) {
    const id = sanitizeRoomId(roomId);
    const clientNonce = String(normalized?.clientNonce || "").trim();
    if (!id || !clientNonce) return false;
    const arr = state.messagesByRoom[id];
    if (!Array.isArray(arr)) return false;
    const index = arr.findIndex(
      (message) =>
        String(message?.clientNonce || "").trim() === clientNonce &&
        String(message?.messageId || "") !== String(normalized?.messageId || ""),
    );
    if (index === -1) return false;
    const previousAttachmentUrl = String(arr[index]?.attachment?.url || "");
    if (previousAttachmentUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(previousAttachmentUrl);
      } catch {
        /* ignore blob URL cleanup failures */
      }
    }
    arr[index] = normalized;
    return true;
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
    const replacedOptimistic = isOwnMessage(normalized) &&
      replaceOptimisticMessageByClientNonce(roomId, normalized);
    const added = replacedOptimistic ? false : pushMessageToRoom(roomId, normalized);
    touchRoom(roomId, normalized);

    const mine = isOwnMessage(normalized);
    const isDnd = sanitizePresenceStatus(state.status) === "dnd";
    const isSilentSystem = Boolean(normalized.system);
    if (added && !mine && !isDnd && !isSilentSystem) playMessageNotificationSound();
    if (added && !mine && !isDnd && !isSilentSystem)
      showAndroidMessageNotification(normalized, roomId);
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
          if (String(d.error) === "Invalid account session") {
            state.sessionExpired = true;
            persist();
            disconnect();
          }
          break;
        }
        state.uuid = d.uuid || null;
        state.userId = String(d?.userId || d?.id || state.userId || "");
        if (d?.username) state.username = sanitizeUsername(d.username);
        state.admin = Boolean(d?.admin || state.admin);
        if (state.username) state.badgesByUser[state.username] = normalizeUserBadges(d?.badges);
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
            ...(isValidRoomId(state.activeRoom)
              ? [sanitizeRoomId(state.activeRoom)]
              : []),
          ]),
        ];
        if (
          isValidRoomId(state.activeRoom) &&
          !state.rooms.some((room) => room.roomId === state.activeRoom)
        ) {
          state.rooms.unshift({
            roomId: sanitizeRoomId(state.activeRoom),
            title: "",
            lastPreview: "",
            lastTimestamp: 0,
            lastSender: "",
            iconUrl: "",
            members: [],
          });
        }
        state.joinedRooms = [];
        state.pendingJoinRooms = [];
        state.usersByRoom = {};
        state.voiceMembersByRoom = {};
        state.callClientsByRoom = {};
        state.deafenedByUser = {};
        state.typingByRoom = {};
        if (d?.profile) state.profile = mergeProfiles(state.profile, d.profile);
        if (d?.status) state.status = sanitizePresenceStatus(d.status);
        for (const roomId of allKnownRooms) touchRoom(roomId);
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
          showToast(d.error, { error: true });
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
      case 32:
        if (d?.error) {
          state.lastError = d.error;
        } else {
          applyRoomSnapshot(d, d?.gameId, { preserveTokenTitle: true });
        }
        break;
      case 33:
        if (d?.error) {
          state.lastError = d.error;
        } else {
          applyRoomSnapshot(d, d?.gameId);
        }
        break;
      case 34:
        applyBadgeUpdate(d);
        break;
      case 35:
        applyPublicProfileLookup(d);
        break;
      case 13:
        break;
      case 87:
        if (d?.msg) showToast(d.msg);
        break;
      case 98:
        handleVoiceState(d);
        break;
      case 110:
        handleCallState(d);
        break;
      case 111:
        handleCallSignal(d);
        break;
      case 112:
        handleDeafenState(d);
        break;
      case 999:
        triggerBan(d?.message);
        break;
      default:
        break;
    }
  }

  function triggerBan(msg?: string) {
    if (state.isBanned) return;
    state.isBanned = true;
    state.banMessage = t("ban.message");
    if (state.inCall) endCall();
    if (state.recording) stopRecordingVoiceMemo(true);
    disconnect();
    activeClientLockKey = null;
    state.authToken = "";
    state.userId = "";
    state.admin = false;
    state.username = "";
    state.uuid = null;
    state.recoveryWords = [];
    state.profile = normalizeProfile(null);
    state.rooms = [];
    state.joinedRooms = [];
    state.pendingJoinRooms = [];
    state.messagesByRoom = {};
    state.usersByRoom = {};
    state.profilesByUser = {};
    state.roomKeysByRoom = {};
    state.roomRatchetsByRoom = {};
    state.trustedSenderKeysByRoom = {};
    state.unreadByRoom = {};
    state.activeRoom = "";
    state.settingsOpen = false;
    state.lastError = "";
    void wipeBrowserPersistence();
  }


  function handleJoinOp(d) {
    const roomId = applyRoomSnapshot(d, d?.gameId);
    if (!roomId) return;

    if (d?.system && d?.joined) {
      showTransientSystemRoomEvent(roomId, d.joined, "join");
    }

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

  function applyPublicProfileLookup(d) {
    if (d?.error) {
      state.lastError = d.error;
      return;
    }
    const now = Date.now();
    applyProfiles(d?.profiles);
    for (const [username, badges] of Object.entries(d?.badges || {})) {
      const key = sanitizeUsername(username);
      if (key) state.badgesByUser[key] = normalizeUserBadges(badges);
    }
    for (const user of Array.isArray(d?.users) ? d.users : []) {
      const key = sanitizeUsername(user?.username || user?.user);
      if (!key) continue;
      rememberUserId(key, user?.userId || user?.id || user?.uuid);
      if (user?.profile) state.profilesByUser[key] = normalizeProfile(user.profile);
      if (Array.isArray(user?.badges)) state.badgesByUser[key] = normalizeUserBadges(user.badges);
      state.publicProfileFetchedAtByUser[key] = now;
    }
    persist();
  }

  function requestPublicProfilesForUsers(users) {
    if (!state.connected || !state.identified) return;
    const now = Date.now();
    const payloadUsers = [];
    for (const raw of Array.isArray(users) ? users : []) {
      const username = sanitizeUsername(typeof raw === "string" ? raw : raw?.username || raw?.user);
      const userId = String(typeof raw === "object" ? raw?.userId || raw?.id || raw?.uuid || "" : "").trim();
      if (isSystemUsername(username)) continue;
      if (!username && !userId) continue;
      const hasAvatar = Boolean(username && state.profilesByUser[username]?.avatar);
      const hasBadges = Boolean(username && state.badgesByUser[username]);
      if (hasAvatar && hasBadges) continue;
      if (username && now - Number(state.publicProfileFetchedAtByUser[username] || 0) < PUBLIC_PROFILE_LOOKUP_TTL_MS) continue;
      payloadUsers.push({ username, userId });
      if (payloadUsers.length >= PUBLIC_PROFILE_LOOKUP_MAX_USERS) break;
    }
    if (payloadUsers.length) send({ op: 35, d: { users: payloadUsers } });
  }

  function applyStatuses(statuses) {
    for (const [username, status] of Object.entries(statuses || {})) {
      const key = sanitizeUsername(username);
      if (key) state.statusesByUser[key] = sanitizePresenceStatus(status);
    }
  }

  function applyPlayerBadges(players) {
    for (const player of Array.isArray(players) ? players : []) {
      const key = sanitizeUsername(player?.user || player?.username || player?.name);
      if (key && Array.isArray(player?.badges)) state.badgesByUser[key] = normalizeUserBadges(player.badges);
    }
  }

  function applyBadgeUpdate(d) {
    const key = sanitizeUsername(d?.user || d?.username);
    if (key && Array.isArray(d?.badges)) {
      state.badgesByUser[key] = normalizeUserBadges(d.badges);
    }
    applyPlayerBadges(d?.players);
    persist();
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

  function applyRoomSnapshot(d, fallbackRoomId = "", options: { preserveTokenTitle?: boolean } = {}) {
    const roomId = sanitizeRoomId(
      d?.room?.room_id ||
      d?.room?.roomId ||
      d?.gameId ||
      fallbackRoomId ||
      state.activeRoom,
    );
    if (!roomId) return "";

    const roomPayload = d?.room && typeof d.room === "object" ? d.room : null;
    const room = state.rooms.find((entry) => entry.roomId === roomId);
    const existingTitle = String(room?.title || "").trim();
    const hasTitle = roomPayload && Object.prototype.hasOwnProperty.call(roomPayload, "title");
    const incomingTitle = hasTitle
      ? String(roomPayload?.title || "")
        .trim()
        .slice(0, MAX_LOCAL_ROOM_NAME_LENGTH)
      : "";
    const nextTitle =
      hasTitle && !(options.preserveTokenTitle && existingTitle && incomingTitle === roomId)
        ? incomingTitle
        : existingTitle;
    const nextIconUrl = sanitizeHttpUrl(
      roomPayload?.icon?.file?.url ?? // format Rust RoomIcon { file: StoredFile { url } }
      roomPayload?.icon?.url ?? // format plat potentiel
      roomPayload?.iconUrl ?? // champ direct
      "",
    );
    const mergedIconUrl = nextIconUrl || sanitizeHttpUrl(room?.iconUrl);
    const nextMembers = normalizeRoomUsers(roomPayload?.members || []);

    if (room) {
      room.title = nextTitle;
      room.iconUrl = mergedIconUrl;
      room.members = nextMembers;
    } else if (roomPayload) {
      state.rooms.push({
        roomId,
        title: nextTitle,
        lastPreview: "",
        lastTimestamp: 0,
        lastSender: "",
        iconUrl: mergedIconUrl,
        members: nextMembers,
      });
    }

    if (Array.isArray(d?.players)) {
      state.usersByRoom[roomId] = normalizeRoomUsers(d.players);
    } else if (roomPayload) {
      state.usersByRoom[roomId] = nextMembers;
    }
    if (d?.profiles && typeof d.profiles === "object") {
      applyProfiles(d.profiles);
    }
    if (d?.statuses && typeof d.statuses === "object") {
      applyStatuses(d.statuses);
    }
    applyPlayerBadges(d?.players);
    applyPlatformsMap(d?.platforms);
    requestPublicProfilesForUsers([...(Array.isArray(d?.players) ? d.players : []), ...nextMembers]);
    if (Array.isArray(d?.voicePlayers)) {
      state.voiceMembersByRoom[roomId] = normalizeRoomUsers(d.voicePlayers);
    }
    applyCallPlayersSnapshot(roomId, d?.callPlayers);
    touchRoom(roomId);
    persist();
    return roomId;
  }

  function applyProfileUpdate(d) {
    applyRoomSnapshot(d, d?.gameId, { preserveTokenTitle: true });
    const key = sanitizeUsername(d?.user);
    if (!key) return;
    const profile = mergeProfiles(state.profilesByUser[key], d?.profile);
    if (key === sanitizeUsername(state.username))
      state.profile = mergeProfiles(state.profile, d?.profile);
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
      if (state.inCall && state.callRoom === id) {
        callManager?.removePeer(user, "");
        removeRemoteCallMedia(user);
      }
    }
    if (removeMedia) {
      removeRemoteCallMedia(user);
    }
  }

  function applyPresenceStatus(d) {
    const roomId = applyRoomSnapshot(d, d?.gameId, { preserveTokenTitle: true });
    const key = sanitizeUsername(d?.user);
    const me = sanitizeUsername(state.username);

    if (!key) return;
    const status = sanitizePresenceStatus(d?.status);
    const visible = d?.visible !== false;

    state.statusesByUser[key] = status;
    rememberUserId(key, d?.id || d?.userId || d?.uuid);
    if (d?.profile)
      state.profilesByUser[key] = mergeProfiles(
        state.profilesByUser[key],
        d.profile,
      );
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
      state.rooms = state.rooms.filter((room) => room.roomId !== roomId);
      delete state.usersByRoom[roomId];
      delete state.voiceMembersByRoom[roomId];
      delete state.callClientsByRoom[roomId];
      delete state.typingByRoom[roomId];
      delete state.unreadByRoom[roomId];
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
      const latest = latestSidebarRoomMessage(state.messagesByRoom[id] || []);
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
    if (d?.profiles && typeof d.profiles === "object") {
      applyProfiles(d.profiles);
    }
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
        if (message?.system) return false;
        const messageId = String(message?.messageId || "");
        return !messageId || !serverMessageIds.has(messageId);
      });
    const messages = mergeRoomHistory(
      keptLocalMessages,
      serverMessages,
      roomId,
    );
    state.messagesByRoom[roomId] = messages;
    requestPublicProfilesForUsers(messages);
    const last = messages[messages.length - 1];
    touchRoom(roomId, last || localMessages[localMessages.length - 1] || null);
    for (const message of serverMessages) requestEncryptedLinkPreview(message);
    if (roomId === state.activeRoom) scrollToBottom();
    persist();
  }

  function showTransientSystemRoomEvent(roomId, username, eventKind) {
    const id = sanitizeRoomId(roomId);
    const user = sanitizeUsername(username);
    if (!id || !user) return;
    const text = eventKind === "leave"
      ? t("thread.roomLeft", { user })
      : t("thread.roomJoined", { user });
    pushMessageToRoom(
      id,
      normalizeMessage(
        {
          messageId: `system-${eventKind}-${id}-${user}-${Date.now()}`,
          roomId: id,
          user: SYSTEM_USERNAME,
          username: SYSTEM_USERNAME,
          text,
          timestamp: Date.now(),
          system: true,
          systemKind: "presence",
          deleted: false,
          reactions: [],
          replyToMessageId: "",
          attachment: null,
          encrypted: null,
          preview: null,
          editedAt: 0,
        },
        id,
      ),
    );
    touchRoom(id);
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
    showToast("Backup exported.");
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
        state.profile = mergeProfiles(state.profile, data.profile);

        if (Array.isArray(data.rooms)) {
          const previousRooms = Object.fromEntries(
            state.rooms.map((room) => [
              room.roomId,
              {
                title: String(room.title || ""),
                iconUrl: sanitizeHttpUrl(room.iconUrl),
              },
            ]),
          );
          state.rooms = data.rooms
            .filter((r) => r && typeof r.roomId === "string")
            .slice(0, MAX_ROOMS_SHOWN)
            .map((r) => {
              const roomId = sanitizeRoomId(r.roomId);
              const previous = previousRooms[roomId] || {};
              const hasTitle = Object.prototype.hasOwnProperty.call(r, "title");
              const previousTitle = String(previous.title || "").trim();
              const incomingTitle = hasTitle
                ? String(r.title || "").trim().slice(0, MAX_LOCAL_ROOM_NAME_LENGTH)
                : "";
              return {
                roomId,
                title:
                  hasTitle && !(previousTitle && incomingTitle === roomId)
                    ? incomingTitle
                    : previousTitle,
                lastPreview: String(r.lastPreview || ""),
                lastTimestamp: Number(r.lastTimestamp) || 0,
                lastSender: String(r.lastSender || ""),
                iconUrl:
                  sanitizeHttpUrl(r.iconUrl) || previous.iconUrl || "",
              };
            })
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
        showToast("Backup imported.");

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
    turnServers: computed(() => [
      ...turnServerList(),
      ...(state.customTurnServers || []),
    ]),
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
    displayRoomNameBeautified,
    beautifyRoomName,
    validateUsername,
    isSystemUsername,
    validateRoomId,
    isValidRoomId,
    hasRoomKey,
    roomAccessToken,
    profileFor,
    badgesFor,
    statusFor,
    presenceStatusLabel,
    profileImageSrc,
    platformsForUser,
    userIdForUsername,
    mutualRoomsWith,
    platformLabel,
    platformIcon,
    showToast,

    persist,
    registerAccount,
    loginAccount,
    recoverAccount,
    refreshSession,
    renewSession,
    dismissSessionExpired,
    logoutAccount,
    deleteAccount,
    downloadRecoveryWords,
    enableClientLock,
    unlockClientLock,
    verifyClientLockPin,
    lockClient,
    disableClientLock,
    clientLockAutolockTimeoutsMs: CLIENT_LOCK_AUTOLOCK_TIMEOUTS_MS,
    setClientLockAutolockEnabled,
    setClientLockAutolockTimeoutMs,
    setOpsecDuressPin,
    clearOpsecDuressPin,
    setOpsecDuressAction,
    setOpsecHideLockIdentity,
    startOpsecDecoySetup,
    setOpsecRamOnlyEnabled,
    loadAdminOverview,
    setAdminFeature,
    setAdminUserDisabled,
    setAdminUserBanned,
    deleteAdminUser,
    setAdminUserBadges,
    refreshAudioDevices,
    unlockAudioDevices,
    startMicTest,
    stopMicTest,
    setAudioInput,
    setAudioOutput,
    setVideoInput,
    setMicrophoneThreshold,
    setDeleteMessagesOnLeave,
    setStreamerMode,
    setShareScreenAudio,
    setMessageSoundEnabled,
    setTypingIndicatorsEnabled,
    setCallSoundsEnabled,
    setSoundEnabled,
    previewSound,
    setAndroidNotificationsEnabled,
    setThemeMode,
    setClientLockThemeMode,
    setAppAccent,
    setMessageStyle,
    setSpotlightSearchEnabled,
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
    leaveAllRooms,
    sendChat,
    setTyping,
    sendAttachment,
    startRecordingVoiceMemo,
    stopRecordingVoiceMemo,
    startCall,
    endCall,
    toggleMute,
    toggleDeafen,
    setSelectedTurnServer,
    addCustomTurnServer,
    removeCustomTurnServer,
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
    clearLocalRoomMessages,
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
    setLocalRoomIconFromFile,
    clearAllData,
    logout,
    triggerBan
  };

  return singleton;
}
