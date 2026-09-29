import { reactive, watch } from "vue";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import {
  CLOUDSYNC_EPOCH_TTL_MS,
  CLOUDSYNC_REKEY_MARGIN_MS,
  deriveEcdh,
  deriveEpochKey,
  deriveMasterSecretFromWords,
  deriveSyncAuthKey,
  deriveSyncMaster,
  deriveSyncRoot,
  deriveWrapKey,
  generateEphKeyPair,
  mergeMessages,
  mergeParams,
  mergeTrusted,
  mergeVersionVectors,
  maxRatchets,
  openData,
  randomNonceB64,
  sealChunked,
  sealData,
  signHello,
  transcriptHash,
  unwrapRoomKey,
  verifyHello,
  wrapRoomKey,
  type SyncCollections,
  type SyncDataOuter,
  type SyncHelloSigned,
  type SyncInner,
} from "@/crypto/cloudsync";
import { bytesToHex, hexToBytes, hkdfSha256, canonicalJson } from "@/crypto/phantom";
import {
  decodeBase64Url,
  encodeBase64Url,
  generateDeviceId,
  generateDeviceSigningKeyPair,
} from "@/crypto/e2ee";
import {
  generateSlhDsaKeyPair,
  SLHDSA_PK_BYTES,
  SLHDSA_SK_BYTES,
} from "@/crypto/slhdsa";
import { useCustomTheme, setCustomTheme, sanitizeCustomThemeValue } from "@/composables/useCustomTheme";
import { normalizeMessage } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";

const SETTINGS_KEY = "qxcloudsync-settings-v1";
// v2: v1 sessions were derived with a non-canonical transcript
// (JSON.stringify, unstable key order via the server) and are invalid.
const SESSIONS_KEY = "qxcloudsync-sessions-v2";
const te = new TextEncoder();
const td = new TextDecoder();

// Canonical serialization (sorted keys): the server re-serializes JSON with
// sorted keys (serde), so JSON.stringify differs between both peers and
// would produce different derived keys. Anything entering a shared hash
// (transcript) MUST go through here.
function canonicalBytes(value: unknown): Uint8Array {
  return te.encode(canonicalJson(value));
}

export interface CloudSyncCtx {
  state: Record<string, unknown>;
  send: (payload: Record<string, unknown>) => void;
  persist?: () => void;
  importRoomKey?: (roomId: string, roomKey: string) => void;
  requestJoin?: (roomId: string, options?: Record<string, unknown>) => void;
  leaveRoom?: (roomId: string) => void;
  showToast?: (msg: string, opts?: { error?: boolean }) => void;
  /** Client-lock AES-GCM key, available only while unlocked. */
  getActiveLockKey?: () => CryptoKey | null;
}

export interface RoomKeyConflict {
  roomId: string;
  remoteBy: string;
  remoteWrapped: string;
  remoteIv: string;
  at: number;
}

export interface SyncPeerCard {
  id: string;
  platform: string;
  epoch: number;
  paired: boolean;
  lastSeen: number;
}

interface PendingHandshake {
  syncId: string;
  peerWs: string;
  ephPriv: CryptoKey;
  ephPub: JsonWebKey;
  mlkemSk: Uint8Array;
  mlkemPkHex: string;
  helloSelf?: SyncHelloSigned;
  acceptSelf?: SyncHelloSigned;
  peerHello?: SyncHelloSigned;
  ss1?: Uint8Array;
  createdAt: number;
}

interface PeerSession {
  peerId: string;
  peerWs: string;
  platform: string;
  syncId: string;
  master: Uint8Array;
  epochKey: Uint8Array;
  epoch: number;
  expiresAt: number;
  sendN: number;
  seenN: Set<string>;
  // Anti-replay window: high-water per (syncId, epoch) + bounded set. Without
  // this, seenN grows unbounded and a restart (empty set) reopens the window.
  recvWindowId: string;
  recvHighWater: number;
  peerPub: JsonWebKey;
  lastSeen: number;
  // Last verified INBOUND contact (opened message or completed handshake).
  // lastSeen is also refreshed on send (display), so it cannot be used
  // to detect a dead route: a push into the void would mark the peer
  // "fresh" and forever forbid the broadcast fallback.
  lastInboundAt: number;
}

// Syncable param groups (the language lives in useI18n and travels as a
// dedicated collection via the "general" group).
export const PARAM_GROUPS = {
  appearance: ["themeMode", "appAccent", "messageStyle"],
  sounds: ["messageSoundEnabled", "callSoundsEnabled"],
  behavior: [
    "typingIndicatorsEnabled",
    "groupMembersByRole",
    "streamerMode",
    "spotlightSearchEnabled",
    "notificationPrivacy",
    "androidNotificationsEnabled",
    "status",
    // Dotted key: customStatus lives in state.profile, handled as a
    // special case in build/apply (no direct read/write).
    "profile.customStatus",
  ],
  // Logical group only (the language lives in useI18n, not in the
  // messenger): excluded from enabledParamKeys(), handled as a dedicated collection.
  general: ["locale"],
} as const;

export type ParamGroup = keyof typeof PARAM_GROUPS;

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSettings(s: unknown) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ── IndexedDB: full history beyond the 500/room localStorage cap ─────
const IDB_NAME = "qxcloudsync-v1";
const IDB_STORE = "messages";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: "roomId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(roomId: string): Promise<unknown[]> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const rq = tx.objectStore(IDB_STORE).get(roomId);
      rq.onsuccess = () => resolve(Array.isArray(rq.result?.items) ? rq.result.items : []);
      rq.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function idbPut(roomId: string, items: unknown[]): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ roomId, items: items.slice(-2000), at: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

// Local platform normalized into 3 categories (same logic as the
// messenger: Tauri → desktop, mobile UA → mobile, otherwise web).
export type SyncPlatform = "mobile" | "web" | "desktop";

export function localPlatform(): SyncPlatform {
  try {
    if (typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
      const ua = String(navigator.userAgent || "").toLowerCase();
      if (ua.includes("android") || /iphone|ipad|ipod/.test(ua)) return "mobile";
      return "desktop";
    }
    const ua = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "").toLowerCase();
    if (ua.includes("android") || /iphone|ipad|ipod/.test(ua) || ua.includes("mobile")) return "mobile";
    return "web";
  } catch {
    return "web";
  }
}

export function normalizePlatform(raw: unknown): SyncPlatform {
  const v = String(raw || "").toLowerCase();
  if (v === "mobile" || v === "android" || v === "ios") return "mobile";
  if (v === "desktop") return "desktop";
  return "web";
}

export type CloudSync = ReturnType<typeof useCloudSync>;

async function idbDelete(roomId: string): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(roomId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

export function useCloudSync(ctx: CloudSyncCtx) {
  const persisted = loadSettings() || {};
  const state = reactive({
    enabled: persisted.enabled === true,
    domains: {
      rooms: persisted.domains?.rooms !== false,
      messages: persisted.domains?.messages !== false,
      params: persisted.domains?.params !== false,
      friendKeys: persisted.domains?.friendKeys !== false,
    },
    paramGroups: {
      appearance: persisted.paramGroups?.appearance !== false,
      sounds: persisted.paramGroups?.sounds !== false,
      behavior: persisted.paramGroups?.behavior !== false,
      general: persisted.paramGroups?.general !== false,
    },
    peers: [] as SyncPeerCard[],
    vv: (persisted.vv || {}) as Record<string, number>,
    lastSyncAt: 0,
    lastError: "",
    lastHandshakeAt: 0,
    lastThemeAt: (persisted.lastThemeAt || 0) as number,
    lastLocaleAt: (persisted.lastLocaleAt || 0) as number,
    lastPinsAt: (persisted.lastPinsAt || 0) as number,
    lastCustomStatusAt: (persisted.lastCustomStatusAt || 0) as number,
    // Tombstones (roomId → deletedAt) + applied deletions: 30d.
    tombstones: ((persisted.tombstones || {}) as Record<string, number>),
    appliedDeletes: ((persisted.appliedDeletes || {}) as Record<string, number>),
    // Synced leaves (roomId → leftAt) + applied leaves: 30d.
    leftRooms: ((persisted.leftRooms || {}) as Record<string, number>),
    appliedLeft: ((persisted.appliedLeft || {}) as Record<string, number>),
    phase: "idle" as "idle" | "hello-sent" | "paired",
    diag: { sent: 0, received: 0, applied: 0, failed: 0 },
    conflicts: [] as RoomKeyConflict[],
    pairingBusy: false,
  });

  let authKey: CryptoKey | null = null;
  let syncRoot: Uint8Array | null = null;
  const pending = new Map<string, PendingHandshake>();
  const sessions = new Map<string, PeerSession>();
  let rekeyTimer: ReturnType<typeof setInterval> | null = null;
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  let restoredOnce = false;
  const AUTO_SYNC_MS = 90_000;
  // Past this silence, the server routing address (peerWs = peer's ws client_id)
  // is assumed stale (reconnect, tab reload, waking phone): we broadcast, which
  // the server relays to all account sessions. On receipt, the peer reframes our
  // peerWs via fromClientId and its ack reframes theirs — self-healing in one round trip.
  const STALE_ROUTE_MS = 3 * 60_000;
  // Anti-storm guards: re-handshake / rekey resend, max 1/min/peer.
  const lastRehandshakeAt = new Map<string, number>();
  const lastRekeyResendAt = new Map<string, number>();
  // Max epoch jump absorbed without re-handshake (missed rekey).
  const MAX_EPOCH_JUMP = 10;
  // ── Mesh relay (server ≥ op 62/63 + enriched op 60 acks) ─────────────
  // Each op 60 frame leaves with a requestId tracked here: the server ack
  // ({ ok, delivered, dropped, peers, peerCount }) detects a dead unicast
  // route immediately instead of waiting for STALE_ROUTE_MS.
  interface InflightFrame {
    to: string;
    encrypted: unknown;
    at: number;
  }
  const inflight = new Map<string, InflightFrame>();
  const INFLIGHT_TTL_MS = 120_000;
  // Anti-storm cooldowns: broadcast fallback 1/30s/peer, same-route retry
  // 1/10s/peer, proactive hello (directory/presence) 1/30s global.
  const lastAutoFallbackAt = new Map<string, number>();
  const lastAckRetryAt = new Map<string, number>();
  let lastProactiveHelloAt = 0;
  const AUTO_FALLBACK_MS = 30_000;
  const ACK_RETRY_MS = 10_000;
  const PROACTIVE_HELLO_MS = 30_000;
  // Op 62 directory: in-flight requestIds (stale responses ignored).
  const pendingPeersReq = new Set<string>();
  // Relay capabilities: true from the first op 60 ack carrying `delivered`
  // (new server). RAM-only: an old server never enables fetchPeers
  // (no "Unknown operation" toast), an upgraded server enables it at the
  // first ack.
  let relayMeshCaps = false;

  function routeFor(sess: PeerSession): string {
    if (!sess.peerWs) return "";
    if (Date.now() - (sess.lastInboundAt || 0) > STALE_ROUTE_MS) return "";
    return sess.peerWs;
  }

  function persistSettings() {
    saveSettings({
      enabled: state.enabled,
      domains: { ...state.domains },
      paramGroups: { ...state.paramGroups },
      vv: state.vv,
      lastThemeAt: state.lastThemeAt,
      lastLocaleAt: state.lastLocaleAt,
      lastPinsAt: state.lastPinsAt,
      lastCustomStatusAt: state.lastCustomStatusAt,
      tombstones: { ...state.tombstones },
      appliedDeletes: { ...state.appliedDeletes },
      leftRooms: { ...state.leftRooms },
      appliedLeft: { ...state.appliedLeft },
    });
  }

  const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;

  function pruneTombstones(): void {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    let changed = false;
    for (const [roomId, at] of Object.entries(state.tombstones)) {
      if (!at || at < cutoff) {
        delete state.tombstones[roomId];
        changed = true;
      }
    }
    for (const [roomId, at] of Object.entries(state.appliedDeletes)) {
      if (!at || at < cutoff) {
        delete state.appliedDeletes[roomId];
        changed = true;
      }
    }
    for (const [roomId, at] of Object.entries(state.leftRooms)) {
      if (!at || at < cutoff) {
        delete state.leftRooms[roomId];
        changed = true;
      }
    }
    for (const [roomId, at] of Object.entries(state.appliedLeft)) {
      if (!at || at < cutoff) {
        delete state.appliedLeft[roomId];
        changed = true;
      }
    }
    if (changed) persistSettings();
  }

  function isRoomDeleted(roomId: string): boolean {
    const at = state.tombstones[roomId];
    return !!at && at > Date.now() - TOMBSTONE_TTL_MS;
  }

  // Records a local deletion (UI delete / op 58 event): the room will be
  // neither reimported nor rebroadcast for 30d, and the tombstone goes to
  // peers on the next push.
  function markRoomDeleted(roomId: string): void {
    const id = String(roomId || "");
    if (!id) return;
    const now = Date.now();
    state.tombstones[id] = Math.max(state.tombstones[id] || 0, now);
    state.appliedDeletes[id] = Math.max(state.appliedDeletes[id] || 0, now);
    delete state.leftRooms[id];
    delete state.appliedLeft[id];
    pruneTombstones();
    persistSettings();
  }

  // Records a local leave (via notifyRoomLeft): peers will leave in turn
  // (their own op 4). An explicit rejoin clears the mark.
  function markRoomLeft(roomId: string): void {
    const id = String(roomId || "");
    if (!id || isRoomDeleted(id)) return;
    state.leftRooms[id] = state.leftRooms[id] || Date.now();
    pruneTombstones();
    persistSettings();
  }

  function clearRoomLeft(roomId: string): void {
    const id = String(roomId || "");
    if (!id) return;
    if (id in state.leftRooms || id in state.appliedLeft) {
      delete state.leftRooms[id];
      delete state.appliedLeft[id];
      persistSettings();
    }
  }

  function isRoomLeft(roomId: string): boolean {
    const at = state.leftRooms[String(roomId || "")];
    return !!at && at > Date.now() - TOMBSTONE_TTL_MS;
  }

  function syncPeerCards() {
    state.peers = [...sessions.values()].map((s) => ({
      id: s.peerId,
      platform: s.platform,
      epoch: s.epoch,
      paired: true,
      lastSeen: s.lastSeen,
    }));
    if (state.peers.length) {
      state.phase = "paired";
    } else if (state.phase === "paired") {
      state.phase = "idle";
    }
  }

  function setError(msg: string) {
    state.lastError = msg;
    ctx.showToast?.(msg, { error: true });
  }

  function suspended(): string | null {
    if (!state.enabled) return "disabled";
    const s = ctx.state as Record<string, unknown>;
    if (s.clientLockLocked) return "locked";
    if (s.opsecRamOnlyEnabled) return "ram-only";
    if (s.opsecDecoyActive || s.opsecDecoySetupActive) return "decoy";
    return null;
  }

  async function ensureRoot(): Promise<boolean> {
    try {
      const words = ctx.state.recoveryWords as string[] | undefined;
      if (!Array.isArray(words) || words.length < 12) {
        setError("12 recovery words required on this device.");
        return false;
      }
      const master = await deriveMasterSecretFromWords(words);
      syncRoot = await deriveSyncRoot(master);
      master.fill(0);
      authKey = await deriveSyncAuthKey(syncRoot);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync root failed.");
      return false;
    }
  }

  function device(): { id: string; pub: JsonWebKey | null; priv: JsonWebKey | null } {
    const s = ctx.state as Record<string, unknown>;
    return {
      id: String(s.deviceId || ""),
      pub: (s.deviceSigningPublicKey as JsonWebKey | null) || null,
      priv: (s.deviceSigningPrivateKey as JsonWebKey | null) || null,
    };
  }

  // The device identity is only created lazily by the messenger (on the
  // first encrypted message). Pairing generates it if needed.
  async function ensureLocalIdentity(): Promise<{ id: string; pub: JsonWebKey; priv: JsonWebKey } | null> {
    try {
      const s = ctx.state as Record<string, unknown>;
      if (!s.deviceId) s.deviceId = generateDeviceId();
      if (!s.deviceSigningPublicKey || !s.deviceSigningPrivateKey) {
        const keys = await generateDeviceSigningKeyPair();
        s.deviceSigningPublicKey = keys.publicKey;
        s.deviceSigningPrivateKey = keys.privateKey;
      }
      ctx.persist?.();
      const d = device();
      if (!d.id || !d.pub || !d.priv) return null;
      return { id: d.id, pub: d.pub, priv: d.priv };
    } catch {
      return null;
    }
  }

  function sendTo(peerWs: string, encrypted: unknown): string {
    const requestId = globalThis.crypto.randomUUID();
    // Track BEFORE send: a (mock or loopback) transport may deliver the ack
    // synchronously inside ctx.send(), and the ack must find its frame.
    // Leak bound: acks or the sweep remove entries past the TTL.
    inflight.set(requestId, { to: peerWs || "", encrypted, at: Date.now() });
    if (inflight.size > 500) {
      const oldest = [...inflight.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [id] of oldest.slice(0, inflight.size - 500)) inflight.delete(id);
    }
    ctx.send({
      op: 60,
      d: { toClientId: peerWs || "", encrypted, requestId },
    });
    return requestId;
  }

  function sweepInflight(): void {
    const cutoff = Date.now() - INFLIGHT_TTL_MS;
    for (const [id, f] of inflight) {
      if (f.at < cutoff) inflight.delete(id);
    }
  }

  // Device SLH-DSA (FIPS 205) identity: long-term pair. At rest it follows
  // the same rule as all persisted state: sealed under a lock envelope
  // when client lock is active, otherwise plaintext namespaced (same
  // model as the PHANTOM prekey). The public key is announced in hellos.
  const SLH_DEVICE_KEY = "qxcloudsync-device-v1";

  interface LockEnvelope {
    v: 1;
    enc: "lock";
    iv: string;
    ct: string;
  }

  function isLockEnvelope(value: unknown): value is LockEnvelope {
    return (
      !!value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).v === 1 &&
      (value as Record<string, unknown>).enc === "lock" &&
      typeof (value as Record<string, unknown>).iv === "string" &&
      typeof (value as Record<string, unknown>).ct === "string"
    );
  }

  function lockEnabled(): boolean {
    return Boolean((ctx.state as Record<string, unknown>).clientLockEnabled);
  }

  function lockKey(): CryptoKey | null {
    try {
      return ctx.getActiveLockKey?.() ?? null;
    } catch {
      return null;
    }
  }

  function readJsonKey(key: string): unknown {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJsonKey(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  function removeKey(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  async function lockSeal(obj: unknown): Promise<LockEnvelope> {
    const key = lockKey();
    if (!key) throw new Error("Lock key unavailable.");
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        te.encode(JSON.stringify(obj)) as BufferSource,
      ),
    );
    return { v: 1, enc: "lock", iv: encodeBase64Url(iv), ct: encodeBase64Url(ct) };
  }

  async function lockOpen<T>(env: LockEnvelope): Promise<T> {
    const key = lockKey();
    if (!key) throw new Error("Lock key unavailable.");
    const pt = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decodeBase64Url(env.iv) as BufferSource },
        key,
        decodeBase64Url(env.ct) as BufferSource,
      ),
    );
    return JSON.parse(td.decode(pt)) as T;
  }

  let slhCache: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;

  function slhFromB64(obj: { pub?: unknown; sec?: unknown }): {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  } | null {
    try {
      const publicKey = decodeBase64Url(String(obj.pub || ""));
      const secretKey = decodeBase64Url(String(obj.sec || ""));
      if (publicKey.length !== SLHDSA_PK_BYTES || secretKey.length !== SLHDSA_SK_BYTES) return null;
      return { publicKey, secretKey };
    } catch {
      return null;
    }
  }

  function slhToB64(k: { publicKey: Uint8Array; secretKey: Uint8Array }): { pub: string; sec: string } {
    return { pub: encodeBase64Url(k.publicKey), sec: encodeBase64Url(k.secretKey) };
  }

  async function ensureSlhDevice(): Promise<{
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  } | null> {
    if (slhCache) return slhCache;
    const raw = readJsonKey(SLH_DEVICE_KEY) as { pub?: unknown; sec?: unknown } | LockEnvelope | null;
    if (isLockEnvelope(raw)) {
      const key = lockKey();
      if (!key) {
        // Locked: fail closed. Lock disabled without key: orphan blob.
        if (!lockEnabled()) removeKey(SLH_DEVICE_KEY);
        return null;
      }
      try {
        const pt = await lockOpen<{ pub?: unknown; sec?: unknown }>(raw);
        const k = slhFromB64(pt);
        if (!k) return null;
        slhCache = k;
        if (!lockEnabled()) writeJsonKey(SLH_DEVICE_KEY, slhToB64(k));
        return k;
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === "object") {
      const k = slhFromB64(raw as { pub?: unknown; sec?: unknown });
      if (k) {
        slhCache = k;
        // Immediate upgrade: lock is active, seal it.
        if (lockEnabled() && lockKey()) {
          try {
            writeJsonKey(SLH_DEVICE_KEY, await lockSeal(slhToB64(k)));
          } catch {
            /* keep the plaintext shape */
          }
        }
        return k;
      }
    }
    let kp: { publicKey: Uint8Array; secretKey: Uint8Array };
    try {
      kp = generateSlhDsaKeyPair();
    } catch {
      return null;
    }
    slhCache = kp;
    try {
      if (lockEnabled() && lockKey()) writeJsonKey(SLH_DEVICE_KEY, await lockSeal(slhToB64(kp)));
      else writeJsonKey(SLH_DEVICE_KEY, slhToB64(kp));
    } catch {
      /* RAM-only as a last resort */
    }
    return kp;
  }

  // ── Persisted sessions ───────────────────────────────────────────────────
  // Without this, every browser restart would break pairing (RAM-only master).
  // At-rest envelope: lock (AES-GCM with the client-lock key) when the lock is
  // active, otherwise sync (AES-GCM with a key derived from syncRoot). Never
  // rewrite toward a weaker envelope: when in doubt, touch nothing.
  interface SessionItem {
    peerId: string;
    platform?: string;
    syncId: string;
    master: string;
    epoch: number;
    expiresAt: number;
    sendN: number;
    peerPub: JsonWebKey;
  }

  async function persistKey(): Promise<CryptoKey | null> {
    if (!syncRoot) return null;
    const bytes = await hkdfSha256(syncRoot, new Uint8Array(0), "qxcloudsync:persist:v1", 32);
    return globalThis.crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  function sessionItems(): SessionItem[] {
    return [...sessions.values()].map((s) => ({
      peerId: s.peerId,
      platform: s.platform,
      syncId: s.syncId,
      master: encodeBase64Url(s.master),
      epoch: s.epoch,
      expiresAt: s.expiresAt,
      sendN: s.sendN,
      peerPub: s.peerPub,
    }));
  }

  async function saveSessions(): Promise<void> {
    try {
      if (suspended() === "locked") return; // locked at rest: untouchable.
      if (lockEnabled()) {
        const key = lockKey();
        if (!key) return; // no key → no downgrade to sync/pass.
        writeJsonKey(SESSIONS_KEY, await lockSeal(sessionItems()));
        return;
      }
      const key = await persistKey();
      if (!key) return;
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv as BufferSource },
          key,
          te.encode(JSON.stringify(sessionItems())) as BufferSource,
        ),
      );
      writeJsonKey(SESSIONS_KEY, { iv: encodeBase64Url(iv), ct: encodeBase64Url(ct) });
    } catch {
      /* ignore */
    }
  }

  async function rebuildSessions(items: SessionItem[]): Promise<void> {
    for (const it of items) {
      if (!it.peerId || !it.master || !it.peerPub) continue;
      if (it.expiresAt && it.expiresAt < Date.now()) continue;
      try {
        const master = decodeBase64Url(it.master);
        if (master.length !== 32) continue;
        sessions.set(it.peerId, {
          peerId: it.peerId,
          peerWs: "",
          platform: normalizePlatform(it.platform),
          syncId: it.syncId || globalThis.crypto.randomUUID(),
          master,
          epochKey: await deriveEpochKey(master, it.epoch || 1),
          epoch: it.epoch || 1,
          expiresAt: it.expiresAt || Date.now() + CLOUDSYNC_EPOCH_TTL_MS,
          sendN: it.sendN || 1,
          seenN: new Set(),
          recvWindowId: "",
          recvHighWater: 0,
          peerPub: it.peerPub,
          lastSeen: 0,
          lastInboundAt: 0,
        });
      } catch {
        /* unreadable entry: ignored */
      }
    }
    if (sessions.size) {
      state.phase = "paired";
      syncPeerCards();
    }
  }

  async function loadLegacySessionItems(raw: unknown): Promise<SessionItem[] | null> {
    try {
      if (!(await ensureRoot())) return null;
      const key = await persistKey();
      if (!key) return null;
      const { iv, ct } = raw as { iv: string; ct: string };
      const pt = new Uint8Array(
        await globalThis.crypto.subtle.decrypt(
          { name: "AES-GCM", iv: decodeBase64Url(iv) as BufferSource },
          key,
          decodeBase64Url(ct) as BufferSource,
        ),
      );
      const items = JSON.parse(td.decode(pt)) as SessionItem[];
      return Array.isArray(items) ? items : null;
    } catch {
      return null;
    }
  }

  // Only latch "already attempted" when final (no blob, or words present).
  // If the words are missing, retry when they arrive. Lock envelopes are
  // restored by onLockEvent (lock key required).
  async function tryRestore(): Promise<void> {
    if (restoredOnce || sessions.size) return;
    const raw = readJsonKey(SESSIONS_KEY);
    if (!raw) {
      restoredOnce = true;
      return;
    }
    if (isLockEnvelope(raw)) {
      const key = lockKey();
      if (!key) {
        // Locked: onLockEvent will handle it. Lock disabled without key:
        // orphan blob, self-healing.
        if (!lockEnabled()) {
          removeKey(SESSIONS_KEY);
          restoredOnce = true;
        }
        return;
      }
      try {
        const items = await lockOpen<SessionItem[]>(raw);
        restoredOnce = true;
        await rebuildSessions(Array.isArray(items) ? items : []);
        return;
      } catch {
        return;
      }
    }
    const words = ctx.state.recoveryWords as string[] | undefined;
    if (!Array.isArray(words) || words.length < 12) return; // retry later.
    restoredOnce = true;
    const items = await loadLegacySessionItems(raw);
    if (!items) {
      // Corrupt blob or different words: drop it, will re-pair.
      removeKey(SESSIONS_KEY);
      return;
    }
    await rebuildSessions(items);
  }

  // Upgrade toward the lock envelope (called unlocked, lock active).
  async function migrateBlobsToLock(): Promise<void> {
    try {
      if (suspended() === "locked" || !lockEnabled() || !lockKey()) return;
      const rawSess = readJsonKey(SESSIONS_KEY);
      if (rawSess && !isLockEnvelope(rawSess)) {
        const items = await loadLegacySessionItems(rawSess);
        if (items) writeJsonKey(SESSIONS_KEY, await lockSeal(items));
        else removeKey(SESSIONS_KEY);
      }
      // SLH: ensureSlhDevice() already upgrades on read.
      await ensureSlhDevice();
    } catch {
      /* ignore */
    }
  }

  // ── Client lock: sealing secrets ────────────────────────────────
  // Locked: all sensitive RAM is wiped (masters, epoch keys, sync root,
  // SLH identity); at rest only AES-GCM envelopes remain (lock key or
  // syncRoot key). Unlocked: restore.
  function wipeSecretsFromRAM(): void {
    for (const s of sessions.values()) {
      try {
        s.master.fill(0);
        s.epochKey.fill(0);
      } catch {
        /* ignore */
      }
    }
    sessions.clear();
    pending.clear();
    if (syncRoot) {
      try {
        syncRoot.fill(0);
      } catch {
        /* ignore */
      }
    }
    syncRoot = null;
    authKey = null;
    slhCache = null;
    syncPeerCards();
    persistSettings();
  }

  async function onUnlocked(): Promise<void> {
    const lockOn = lockEnabled();
    const key = lockKey();
    // SLH identity.
    slhCache = null;
    const rawSlh = readJsonKey(SLH_DEVICE_KEY);
    if (isLockEnvelope(rawSlh)) {
      if (key) {
        try {
          const pt = await lockOpen<{ pub?: unknown; sec?: unknown }>(rawSlh);
          const k = slhFromB64(pt);
          if (k) {
            slhCache = k;
            if (!lockOn) writeJsonKey(SLH_DEVICE_KEY, slhToB64(k));
          }
        } catch {
          /* unreadable envelope: will re-pair the identity if needed */
        }
      } else if (!lockOn) {
        removeKey(SLH_DEVICE_KEY);
      }
    } else if (rawSlh && typeof rawSlh === "object" && lockOn && key) {
      const k = slhFromB64(rawSlh as { pub?: unknown; sec?: unknown });
      if (k) {
        slhCache = k;
        try {
          writeJsonKey(SLH_DEVICE_KEY, await lockSeal(slhToB64(k)));
        } catch {
          /* keep the plaintext shape */
        }
      }
    }
    // Sessions.
    const rawSess = readJsonKey(SESSIONS_KEY);
    if (isLockEnvelope(rawSess)) {
      if (key) {
        try {
          const items = await lockOpen<SessionItem[]>(rawSess);
          if (!lockOn) {
            // Lock disabled: step back down to the sync envelope if possible.
            const ok = await rewriteSessionsAsSync(Array.isArray(items) ? items : []);
            void ok;
          }
          await rebuildSessions(Array.isArray(items) ? items : []);
        } catch {
          /* unreadable: re-pair */
        }
      } else if (!lockOn) {
        removeKey(SESSIONS_KEY);
      }
    } else if (rawSess && lockOn && key) {
      const items = await loadLegacySessionItems(rawSess);
      if (items) {
        await rebuildSessions(items);
        await saveSessions();
      } else {
        removeKey(SESSIONS_KEY);
      }
    }
    syncPeerCards();
  }

  async function rewriteSessionsAsSync(items: SessionItem[]): Promise<boolean> {
    try {
      if (!(await ensureRoot())) return false;
      const key = await persistKey();
      if (!key) return false;
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv as BufferSource },
          key,
          te.encode(JSON.stringify(items)) as BufferSource,
        ),
      );
      writeJsonKey(SESSIONS_KEY, { iv: encodeBase64Url(iv), ct: encodeBase64Url(ct) });
      return true;
    } catch {
      return false;
    }
  }

  function onLockEvent(locked: boolean): void {
    if (locked) {
      if (dirtyTimer) {
        clearTimeout(dirtyTimer);
        dirtyTimer = null;
      }
      wipeSecretsFromRAM();
      return;
    }
    void onUnlocked()
      .then(() => scheduleAutoHello())
      .catch(() => {});
  }

  function trackSession(s: PeerSession): void {
    const prev = sessions.get(s.peerId);
    if (prev && prev !== s) {
      try {
        prev.master.fill(0);
        prev.epochKey.fill(0);
      } catch {
        /* ignore */
      }
    }
    sessions.set(s.peerId, s);
    syncPeerCards();
    void saveSessions();
  }

  function hasWordsQuiet(): boolean {
    const words = ctx.state.recoveryWords as string[] | undefined;
    return Array.isArray(words) && words.length >= 12;
  }

  // Sends a signed hello (HMAC proof of the 12 words + device signature +
  // platform). Used by the manual button and auto-pairing.
  async function sendHello(): Promise<boolean> {
    if (!(await ensureRoot())) return false;
    const d = await ensureLocalIdentity();
    if (!d) {
      setError("Device identity missing.");
      return false;
    }
    try {
      const eph = await generateEphKeyPair();
      const mlkem = ml_kem768.keygen();
      const slh = await ensureSlhDevice();
      if (!slh) {
        setError("Sync identity unavailable.");
        return false;
      }
      const syncId = globalThis.crypto.randomUUID();
      const hello = await signHello(
        {
          pv: 1, kind: "hello", syncId, epoch: 1,
          fromDeviceId: d.id, toDeviceId: "",
          ephPub: eph.publicJwk, mlkemPk: bytesToHex(mlkem.publicKey),
          ecdsaPub: d.pub, nonce: randomNonceB64(), platform: localPlatform(),
          slhdsaPk: encodeBase64Url(slh.publicKey),
        },
        authKey as CryptoKey, d.priv, slh.secretKey,
      );
      pending.set(syncId, {
        syncId, peerWs: "",
        ephPriv: eph.privateKey, ephPub: eph.publicJwk,
        mlkemSk: mlkem.secretKey, mlkemPkHex: bytesToHex(mlkem.publicKey),
        helloSelf: hello, createdAt: Date.now(),
      });
      // Leak bound: keep only recent handshakes (16 to absorb an
      // 8-device join: 7 concurrent accepts + margin).
      const all = [...pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (const [id] of all.slice(0, Math.max(0, all.length - 16))) pending.delete(id);
      state.phase = sessions.size ? "paired" : "hello-sent";
      state.lastHandshakeAt = Date.now();
      sendTo("", hello);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pairing hello failed.");
      return false;
    }
  }

  // ── Pairing: entering the 12 words on each device ─────────────────────────
  // The button stays a manual trigger ("search now"), but pairing is mostly
  // automatic (see scheduleAutoHello): no manual re-pair each time, trust is
  // proven by HMAC + signatures.
  async function startPairing(): Promise<void> {
    if (state.pairingBusy) return;
    if (suspended() && suspended() !== "disabled") {
      setError("Sync suspended (lock / OPSEC).");
      return;
    }
    state.pairingBusy = true;
    try {
      await sendHello();
    } finally {
      state.pairingBusy = false;
    }
  }

  let lastAutoHello = 0;
  let bootHelloTimer: ReturnType<typeof setTimeout> | null = null;
  let themeWatchInstalled = false;
  // Loop guard + event debounce: every local mutation that persists
  // (message, room, setting…) notifies via notifyLocalChange, coalesced into
  // a push 2.5s after the last change. Applying a remote snapshot never
  // re-notifies (applying).
  let applying = false;
  let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  const DIRTY_DEBOUNCE_MS = 2500;
  // The custom theme does not go through messenger.persist(): it is observed
  // directly (sync flush so the anti-echo guard stays reliable).
  let suppressThemeWatch = false;

  function sanitizeCustomTheme(
    value: unknown,
  ): { accent: string; tint: string } | null | undefined {
    return sanitizeCustomThemeValue(value);
  }

  function notifyLocalChange(): void {
    if (applying || !state.enabled || !sessions.size || suspended()) return;
    if (dirtyTimer) clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      if (applying || !sessions.size || suspended()) return;
      void pushSnapshot().catch(() => {});
    }, DIRTY_DEBOUNCE_MS);
  }

  // Auto-pairing: signed announcement at boot (2–6s jitter) then a quiet
  // reminder every 15 min max while still peerless. Known peers are restored
  // via tryRestore, so no routine gesture needed.
  function scheduleAutoHello(): void {
    if (bootHelloTimer) clearTimeout(bootHelloTimer);
    bootHelloTimer = setTimeout(() => {
      void (async () => {
        if (!state.enabled || suspended() || sessions.size || !hasWordsQuiet()) return;
        if (Date.now() - lastAutoHello < 5 * 60_000) return;
        lastAutoHello = Date.now();
        await sendHello().catch(() => {});
      })();
    }, 2000 + Math.random() * 4000);
  }

  async function handleHelloUnsigned(signed: SyncHelloSigned, fromWs: string): Promise<void> {
    if (!state.enabled || suspended()) return;
    if (!(await ensureRoot())) return;
    const d = await ensureLocalIdentity();
    if (!d) return;
    const ok = await verifyHello(signed, authKey as CryptoKey);
    if (!ok) return; // wrong HMAC = different 12 words → silence.
    if (signed.fromDeviceId === d.id) return; // our own broadcast.
    // Unicast hygiene: a hello/accept/confirm/rekey addressed to another
    // device (third-party broadcast catch-up) does not concern us.
    const destId = String((signed as unknown as Record<string, unknown>).toDeviceId || "");
    if (destId && destId !== d.id) return;

    if (signed.kind === "hello") {
      // Live session (recent inbound contact): already paired, ignore
      // redundant hellos (double-click on Pair, etc.). Stale or unknown
      // session: the peer is attempting a re-pairing (lost state, divergence)
      // and we answer — the handshake replaces the old session via trackSession.
      const existing = sessions.get(signed.fromDeviceId);
      if (existing && Date.now() - (existing.lastInboundAt || 0) <= STALE_ROUTE_MS) return;
      // "Pair" race from both sides: the smallest deviceId wins, the other
      // answers. Our own attempt is KEPT (never deleted here): deleting it
      // would also destroy the initiator state needed to complete legs
      // where we are the designated answerer, which deadlocks mutual
      // handshakes at 3+ devices (each side's accept references a hello
      // the other side already dropped). Unanswered own hellos are swept
      // after 120 s; each pair completes exactly once via the larger id.
      const ownRecent = [...pending.values()].find(
        (p) => !p.peerHello && Date.now() - p.createdAt < 60_000,
      );
      if (ownRecent && d.id < signed.fromDeviceId) return;
      const eph = await generateEphKeyPair();
      const mlkemB = ml_kem768.keygen();
      const slh = await ensureSlhDevice();
      if (!slh) return;
      const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(signed.mlkemPk));
      const accept = await signHello(
        {
          pv: 1, kind: "accept", syncId: signed.syncId, epoch: signed.epoch,
          fromDeviceId: d.id, toDeviceId: signed.fromDeviceId,
          ephPub: eph.publicJwk, mlkemPk: bytesToHex(mlkemB.publicKey),
          ecdsaPub: d.pub, nonce: randomNonceB64(), mlkemCt: bytesToHex(cipherText),
          platform: localPlatform(), slhdsaPk: encodeBase64Url(slh.publicKey),
        },
        authKey as CryptoKey, d.priv, slh.secretKey,
      );
      pending.set(signed.syncId, {
        syncId: signed.syncId, peerWs: fromWs,
        ephPriv: eph.privateKey, ephPub: eph.publicJwk,
        mlkemSk: mlkemB.secretKey, mlkemPkHex: bytesToHex(mlkemB.publicKey),
        acceptSelf: accept, peerHello: signed,
        ss1: new Uint8Array(sharedSecret), createdAt: Date.now(),
      });
      state.lastHandshakeAt = Date.now();
      sendTo(fromWs, accept);
    } else if (signed.kind === "accept") {
      // Transcript = helloA || accept (identical on both sides).
      const hs = pending.get(signed.syncId);
      if (!hs || !hs.helloSelf) return;
      const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(signed.mlkemPk));
      const ss2 = new Uint8Array(sharedSecret);
      const ss1 = ml_kem768.decapsulate(hexToBytes(signed.mlkemCt as string), hs.mlkemSk);
      const ecdh = await deriveEcdh(hs.ephPriv, signed.ephPub);
      const t = await transcriptHash([
        canonicalBytes(hs.helloSelf),
        canonicalBytes(signed),
      ]);
      const master = await deriveSyncMaster({
        ecdh, ss1: new Uint8Array(ss1), ss2,
        syncRoot: syncRoot as Uint8Array, transcript: t,
      });
      ecdh.fill(0);
      const epoch = signed.epoch || 1;
      trackSession({
        peerId: signed.fromDeviceId, peerWs: fromWs,
        platform: normalizePlatform((signed as unknown as Record<string, unknown>).platform),
        syncId: signed.syncId,
        master, epochKey: await deriveEpochKey(master, epoch), epoch,
        expiresAt: Date.now() + CLOUDSYNC_EPOCH_TTL_MS,
        sendN: 1, seenN: new Set(), recvWindowId: "", recvHighWater: 0,
        peerPub: signed.ecdsaPub, lastSeen: Date.now(), lastInboundAt: Date.now(),
      });
      const slhSelf = await ensureSlhDevice();
      if (!slhSelf) return;
      const confirm = await signHello(
        {
          pv: 1, kind: "confirm", syncId: signed.syncId, epoch,
          fromDeviceId: d.id, toDeviceId: signed.fromDeviceId,
          ephPub: hs.ephPub, mlkemPk: hs.mlkemPkHex, ecdsaPub: d.pub,
          nonce: randomNonceB64(), mlkemCt: bytesToHex(cipherText),
          platform: localPlatform(), slhdsaPk: encodeBase64Url(slhSelf.publicKey),
        },
        authKey as CryptoKey, d.priv, slhSelf.secretKey,
      );
      sendTo(fromWs, confirm);
      pending.delete(signed.syncId);
      await pushSnapshot(signed.fromDeviceId);
    } else if (signed.kind === "confirm") {
      // Transcript = helloA || acceptA (its own accept).
      const hs = pending.get(signed.syncId);
      if (!hs || !hs.peerHello || !hs.ss1 || !hs.acceptSelf) return;
      const ss2 = ml_kem768.decapsulate(hexToBytes(signed.mlkemCt as string), hs.mlkemSk);
      const ecdh = await deriveEcdh(hs.ephPriv, signed.ephPub);
      const t = await transcriptHash([
        canonicalBytes(hs.peerHello),
        canonicalBytes(hs.acceptSelf),
      ]);
      const master = await deriveSyncMaster({
        ecdh, ss1: hs.ss1, ss2: new Uint8Array(ss2),
        syncRoot: syncRoot as Uint8Array, transcript: t,
      });
      ecdh.fill(0);
      const epoch = signed.epoch || 1;
      trackSession({
        peerId: signed.fromDeviceId, peerWs: fromWs,
        platform: normalizePlatform((signed as unknown as Record<string, unknown>).platform),
        syncId: signed.syncId,
        master, epochKey: await deriveEpochKey(master, epoch), epoch,
        expiresAt: Date.now() + CLOUDSYNC_EPOCH_TTL_MS,
        sendN: 1, seenN: new Set(), recvWindowId: "", recvHighWater: 0,
        peerPub: signed.ecdsaPub, lastSeen: Date.now(), lastInboundAt: Date.now(),
      });
      pending.delete(signed.syncId);
      await pushSnapshot(signed.fromDeviceId);
    } else if (signed.kind === "rekey") {
      const sess = sessions.get(signed.fromDeviceId);
      if (!sess || signed.epoch !== sess.epoch + 1) return;
      if (signed.syncId !== sess.syncId) return;
      sess.epochKey = await deriveEpochKey(sess.master, signed.epoch);
      sess.epoch = signed.epoch;
      sess.expiresAt = Date.now() + CLOUDSYNC_EPOCH_TTL_MS;
      sess.lastSeen = Date.now();
      sess.lastInboundAt = Date.now();
      sess.platform = normalizePlatform((signed as unknown as Record<string, unknown>).platform) || sess.platform;
      if (fromWs) sess.peerWs = fromWs;
      syncPeerCards();
      await saveSessions();
    }
  }

  // Sends (or resends) a signed rekey for the given epoch without mutating
  // the session: local advancement stays with the caller (scheduler).
  // Returns true if the rekey was sent (never advance without sending).
  async function sendRekeyMessage(sess: PeerSession, epoch: number): Promise<boolean> {
    const d2 = device();
    if (!d2.priv || !authKey) return false;
    const slh = await ensureSlhDevice();
    if (!slh) return false;
    const rekey = await signHello(
      {
        pv: 1, kind: "rekey", syncId: sess.syncId, epoch,
        fromDeviceId: d2.id, toDeviceId: sess.peerId, ephPub: {} as JsonWebKey,
        mlkemPk: "", ecdsaPub: d2.pub as JsonWebKey, nonce: randomNonceB64(),
        platform: localPlatform(), slhdsaPk: encodeBase64Url(slh.publicKey),
      },
      authKey as CryptoKey, d2.priv as JsonWebKey, slh.secretKey,
    );
    sendTo(routeFor(sess), rekey);
    return true;
  }

  // The peer talks with an unknown syncId (re-pair elsewhere, different
  // restored session): restart a handshake, storm-free.
  function maybeRehandshake(peerId: string): void {
    const now = Date.now();
    if (now - (lastRehandshakeAt.get(peerId) || 0) < 60_000) return;
    lastRehandshakeAt.set(peerId, now);
    if (!state.enabled || suspended() || !hasWordsQuiet()) return;
    void sendHello().catch(() => {});
  }

  // The peer lags in epoch (our rekey was lost in a stale peerWs): resend
  // the current rekey instead of leaving it stranded.
  function maybeResendRekey(sess: PeerSession): void {
    const now = Date.now();
    if (now - (lastRekeyResendAt.get(sess.peerId) || 0) < 60_000) return;
    lastRekeyResendAt.set(sess.peerId, now);
    if (!state.enabled || suspended()) return;
    void sendRekeyMessage(sess, sess.epoch).catch(() => {});
  }

  // ── Snapshot deepMerge ─────────────────────────────────────────────────────
  function enabledParamKeys(): string[] {
    const out: string[] = [];
    for (const [group, keys] of Object.entries(PARAM_GROUPS)) {
      if (group === "general") continue; // dedicated collection, not messenger.
      if (state.paramGroups[group as ParamGroup]) out.push(...keys);
    }
    return out;
  }

  async function buildCollections(): Promise<SyncCollections> {
    const s = ctx.state as Record<string, unknown>;
    const collections: SyncCollections = {};
    if (state.domains.rooms) {
      pruneTombstones();
      const rooms = (s.rooms as Array<{ roomId: string; title?: string }> | undefined) || [];
      const roomKeys = (s.roomKeysByRoom as Record<string, string> | undefined) || {};
      const usersByRoom = (s.usersByRoom as Record<string, string[]> | undefined) || {};
      // Note: each peer has its own epochKey; plaintext roomKeys here are
      // re-wrapped per peer in pushSnapshot before sending.
      collections.rooms = rooms
        .filter((r) => roomKeys[r.roomId] && !isRoomDeleted(r.roomId))
        .map((r) => ({
          roomId: r.roomId,
          roomKeyWrapped: roomKeys[r.roomId],
          roomKeyIv: "raw",
          title: r.title,
          updatedAt: Date.now(),
          by: device().id,
          members: Array.isArray(usersByRoom[r.roomId])
            ? usersByRoom[r.roomId].slice(0, 200).map((u) => String(u).slice(0, 32))
            : undefined,
        }));
      const pins = (s.pinnedRooms as string[] | undefined) || [];
      state.lastPinsAt = Date.now();
      collections.pinned = {
        rooms: [...new Set(pins.map((r) => String(r)).filter(Boolean))].slice(0, 5),
        updatedAt: state.lastPinsAt,
        by: device().id,
      };
      const tombEntries = Object.entries(state.tombstones)
        .filter(([, at]) => at && at > Date.now() - TOMBSTONE_TTL_MS)
        .map(([roomId, at]) => ({ roomId, deletedAt: at, by: device().id }));
      if (tombEntries.length) collections.deleted = tombEntries;
      const leftEntries = Object.entries(state.leftRooms)
        .filter(([roomId, at]) => at && at > Date.now() - TOMBSTONE_TTL_MS && !isRoomDeleted(roomId))
        .map(([roomId, at]) => ({ roomId, leftAt: at, by: device().id }));
      if (leftEntries.length) collections.left = leftEntries;
      const notes = (s.roomNotes as Record<string, string>) || {};
      if (Object.keys(notes).length) {
        collections.notes = Object.fromEntries(
          Object.entries(notes).map(([k, v]) => [k, { value: v, updatedAt: Date.now(), by: device().id }]),
        );
      }
      collections.ratchets = { ...((s.roomRatchetsByRoom as Record<string, number>) || {}) };
    }
    if (state.domains.messages) {
      const messagesByRoom = (s.messagesByRoom as Record<string, Array<Record<string, unknown>>> | undefined) || {};
      const msgEntries: NonNullable<SyncCollections["messages"]> = [];
      for (const [roomId, list] of Object.entries(messagesByRoom)) {
        if (isRoomDeleted(roomId)) continue;
        const cached = (await idbGet(roomId)) as Array<Record<string, unknown>>;
        const merged = [...cached, ...list].slice(-2000);
        for (const m of merged.slice(-500)) {
          if (!m.messageId) continue;
          msgEntries.push({
            messageId: String(m.messageId), roomId,
            text: typeof m.text === "string" ? (m.text as string).slice(0, 2000) : undefined,
            timestamp: Number(m.timestamp || 0), editedAt: m.editedAt ? Number(m.editedAt) : undefined,
            deleted: Boolean(m.deleted) || undefined,
            encrypted: m.encrypted, from: typeof m.username === "string" ? (m.username as string) : undefined,
            system: Boolean(m.system) || undefined,
            systemKind: typeof m.systemKind === "string" && m.systemKind ? String(m.systemKind).slice(0, 32) : undefined,
          });
        }
      }
      collections.messages = msgEntries;
    }
    if (state.domains.params) {
      const params: NonNullable<SyncCollections["params"]> = {};
      for (const k of enabledParamKeys()) {
        if (k === "profile.customStatus") continue;
        if (s[k] !== undefined) params[k] = { value: s[k], updatedAt: Date.now(), by: device().id };
      }
      if (state.paramGroups.behavior) {
        const cs = String(
          (s.profile as Record<string, unknown> | undefined)?.customStatus || "",
        ).slice(0, 60);
        params["profile.customStatus"] = { value: cs, updatedAt: Date.now(), by: device().id };
      }
      collections.params = params;
    }
    if (state.domains.friendKeys) {
      const trustedByRoom = (s.trustedSenderKeysByRoom as Record<string, Record<string, JsonWebKey>>) || {};
      collections.trusted = Object.entries(trustedByRoom).flatMap(([roomId, byDev]) =>
        Object.entries(byDev).map(([dev, key]) => ({ roomId, deviceId: dev, key })));
    }
    if (state.domains.params && state.paramGroups.appearance) {
      try {
        const ct = useCustomTheme();
        const theme = ct.theme
          ? { accent: String(ct.theme.accent || ""), tint: String(ct.theme.tint || "") }
          : null;
        state.lastThemeAt = Date.now();
        collections.customTheme = {
          theme, enabled: ct.enabled !== false,
          updatedAt: state.lastThemeAt, by: device().id,
        };
      } catch {
        /* ignore */
      }
    }
    if (state.domains.params && state.paramGroups.general) {
      try {
        const { locale, availableLocales } = useI18n();
        const value = String(locale.value || "en");
        if (availableLocales.includes(value)) {
          state.lastLocaleAt = Date.now();
          collections.locale = { value, updatedAt: state.lastLocaleAt, by: device().id };
        }
      } catch {
        /* ignore */
      }
    }
    return collections;
  }

  // Wraps the collection's plaintext roomKeys with the peer's wrapKey.
  async function wrapRoomsFor(
    rooms: NonNullable<SyncCollections["rooms"]>,
    sess: PeerSession,
  ): Promise<NonNullable<SyncCollections["rooms"]>> {
    const wrapKey = await deriveWrapKey(sess.epochKey);
    const out: NonNullable<SyncCollections["rooms"]> = [];
    for (const r of rooms) {
      if (r.roomKeyIv !== "raw") {
        out.push(r);
        continue;
      }
      try {
        const w = await wrapRoomKey(r.roomKeyWrapped, wrapKey);
        out.push({ ...r, roomKeyWrapped: w.data, roomKeyIv: w.iv });
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  async function pushSnapshot(peerId?: string): Promise<void> {
    if (suspended()) return;
    const d = device();
    if (!d.priv) return;
    const targets = peerId ? [...sessions.values()].filter((s) => s.peerId === peerId) : [...sessions.values()];
    if (!targets.length) return;
    try {
      const collections = await buildCollections();
      state.vv[d.id] = (state.vv[d.id] || 0) + 1;
      persistSettings();
      for (const sess of targets) {
        const perPeer: SyncCollections = { ...collections };
        if (perPeer.rooms) perPeer.rooms = await wrapRoomsFor(perPeer.rooms, sess);
        const inner: SyncInner = { kind: "snapshot", vv: { ...state.vv }, collections: perPeer };
        const outs = await sealChunked(
          inner, sess.epochKey,
          { syncId: sess.syncId, epoch: sess.epoch, from: d.id, to: sess.peerId, startN: sess.sendN },
          d.priv,
        );
        sess.sendN += outs.length;
        state.diag.sent += outs.length;
        for (const o of outs) sendTo(routeFor(sess), o);
        sess.lastSeen = Date.now();
      }
      state.lastSyncAt = Date.now();
      syncPeerCards();
      await saveSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync push failed.");
    }
  }

  async function applyInner(inner: SyncInner, from: string): Promise<void> {
    applying = true;
    try {
    const s = ctx.state as Record<string, unknown>;
    state.vv = mergeVersionVectors(state.vv, inner.vv || {});
    const c = inner.collections;
    if (!c) return;
    const sess = sessions.get(from);
    if (c.ratchets) {
      s.roomRatchetsByRoom = maxRatchets((s.roomRatchetsByRoom as Record<string, number>) || {}, c.ratchets);
    }
    if (c.params && state.domains.params) {
      const allowed = new Set(enabledParamKeys());
      const merged = mergeParams(
        Object.fromEntries(
          Object.keys(c.params)
            .filter((k) => allowed.has(k) && k !== "profile.customStatus")
            .map((k) => [k, { value: (s as Record<string, unknown>)[k], updatedAt: 0, by: "" }]),
        ),
        Object.fromEntries(
          Object.entries(c.params).filter(([k]) => allowed.has(k) && k !== "profile.customStatus"),
        ),
      );
      for (const [k, v] of Object.entries(merged)) {
        if (k === "status" && !["online", "invisible", "dnd"].includes(String(v.value))) continue;
        (s as Record<string, unknown>)[k] = v.value;
      }
      const pcs = c.params["profile.customStatus"];
      if (pcs && state.paramGroups.behavior && typeof pcs.updatedAt === "number") {
        if (pcs.updatedAt > state.lastCustomStatusAt && typeof pcs.value === "string") {
          const cur = (s.profile as Record<string, unknown>) || {};
          s.profile = { ...cur, customStatus: pcs.value.slice(0, 60) };
          state.lastCustomStatusAt = pcs.updatedAt;
        }
      }
    }
    if (c.notes && state.domains.rooms && s.roomNotes) {
      const cur = s.roomNotes as Record<string, string>;
      for (const [k, v] of Object.entries(c.notes)) {
        if (!cur[k]) cur[k] = v.value;
      }
    }
    if (c.trusted && state.domains.friendKeys) {
      const curTrusted = (s.trustedSenderKeysByRoom as Record<string, Record<string, JsonWebKey>>) || {};
      const { merged, conflicts } = mergeTrusted(
        Object.entries(curTrusted).flatMap(([roomId, byDev]) =>
          Object.entries(byDev).map(([dev, key]) => ({ roomId, deviceId: dev, key }))),
        c.trusted,
      );
      if (conflicts.length) setError(`Sender-key conflict: ${conflicts[0]} (kept local).`);
      const next: Record<string, Record<string, JsonWebKey>> = {};
      for (const t of merged) {
        next[t.roomId] = next[t.roomId] || {};
        next[t.roomId][t.deviceId] = t.key;
      }
      s.trustedSenderKeysByRoom = next;
    }
    if (c.deleted && state.domains.rooms) {
      for (const e of c.deleted) {
        const roomId = String(e.roomId || "");
        if (!roomId || !(e.deletedAt > (state.appliedDeletes[roomId] || 0))) continue;
        state.appliedDeletes[roomId] = e.deletedAt;
        state.tombstones[roomId] = Math.max(state.tombstones[roomId] || 0, e.deletedAt);
        await dropRoomLocal(roomId);
      }
      pruneTombstones();
    }
    if (c.left && state.domains.rooms) {
      for (const e of c.left) {
        const roomId = String(e.roomId || "");
        if (!roomId || isRoomDeleted(roomId)) continue;
        if (!(e.leftAt > (state.appliedLeft[roomId] || 0))) continue;
        state.appliedLeft[roomId] = e.leftAt;
        const joined = ((s.joinedRooms as string[]) || []).includes(roomId);
        if (joined) {
          // Also leave here (clean server op 4); the local leaveRoom
          // re-marks without changing the stamp, so no ping-pong.
          ctx.leaveRoom?.(roomId);
        }
      }
      pruneTombstones();
    }
    if (c.pinned && state.domains.rooms) {
      if (c.pinned.updatedAt > state.lastPinsAt) {
        const clean = [...new Set(
          (Array.isArray(c.pinned.rooms) ? c.pinned.rooms : [])
            .map((r) => String(r || ""))
            .filter((r) => r && !isRoomDeleted(r)),
        )].slice(0, 5);
        (s.pinnedRooms as string[]) = clean;
        state.lastPinsAt = c.pinned.updatedAt;
      }
    }
    if (c.rooms && state.domains.rooms && sess) {
      const wrapKey = await deriveWrapKey(sess.epochKey);
      const localKeys = ((s.roomKeysByRoom as Record<string, string>) || {});
      for (const r of c.rooms) {
        if (isRoomDeleted(r.roomId)) continue;
        const local = localKeys[r.roomId];
        if (!local) {
          // New room: unwrap + import + join + title + members.
          // Except when left here (left tombstone): keep the key without joining.
          if (isRoomLeft(r.roomId)) continue;
          try {
            const raw = await unwrapRoomKey(r.roomKeyWrapped, r.roomKeyIv, wrapKey);
            ctx.importRoomKey?.(r.roomId, raw);
            applyRoomTitle(r.roomId, r.title);
            if (Array.isArray(r.members) && r.members.length) {
              const usersByRoom = (s.usersByRoom as Record<string, string[]>) || {};
              if (!usersByRoom[r.roomId]) {
                usersByRoom[r.roomId] = r.members.slice(0, 200).map((u) => String(u).slice(0, 32));
                s.usersByRoom = usersByRoom;
              }
            }
            if (!(s.joinedRooms as string[] || []).includes(r.roomId)) {
              ctx.requestJoin?.(r.roomId, { clearLeftMark: false });
            }
          } catch {
            /* unreadable envelope: silence */
          }
          continue;
        }
        // Both sides have a key: unwrap the remote one and compare in plaintext.
        // "Decline + ask" policy: never auto-overwrite.
        try {
          const remoteRaw = await unwrapRoomKey(r.roomKeyWrapped, r.roomKeyIv, wrapKey);
          if (remoteRaw !== local) {
            if (!state.conflicts.some((x) => x.roomId === r.roomId)) {
              state.conflicts.push({
                roomId: r.roomId, remoteBy: r.by,
                remoteWrapped: r.roomKeyWrapped, remoteIv: r.roomKeyIv, at: Date.now(),
              });
            }
            setError(`Room key conflict (${r.roomId.slice(0, 8)}…) — manual choice required.`);
          } else {
            applyRoomTitle(r.roomId, r.title);
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (c.customTheme && state.domains.params && state.paramGroups.appearance) {
      const remote = c.customTheme;
      if (remote.updatedAt > state.lastThemeAt) {
        const clean = sanitizeCustomTheme(remote.theme);
        if (clean !== undefined) {
          suppressThemeWatch = true;
          try {
            const ramOnly = Boolean((ctx.state as Record<string, unknown>).opsecRamOnlyEnabled);
            setCustomTheme(clean, !ramOnly, false);
          } finally {
            suppressThemeWatch = false;
          }
          state.lastThemeAt = remote.updatedAt;
        }
      }
    }
    if (c.locale && state.domains.params && state.paramGroups.general) {
      if (c.locale.updatedAt > state.lastLocaleAt) {
        try {
          const { locale, availableLocales } = useI18n();
          const value = String(c.locale.value || "");
          if (availableLocales.includes(value) && locale.value !== value) {
            locale.value = value; // persists itself on its own key.
          }
          state.lastLocaleAt = c.locale.updatedAt;
        } catch {
          /* ignore */
        }
      }
    }
    if (c.messages && state.domains.messages) {
      const byRoom = new Map<string, NonNullable<typeof c.messages>>();
      for (const m of c.messages) {
        if (isRoomDeleted(m.roomId)) continue;
        if (!byRoom.has(m.roomId)) byRoom.set(m.roomId, []);
        byRoom.get(m.roomId)?.push(m);
      }
      const messagesByRoom = s.messagesByRoom as Record<string, Array<Record<string, unknown>>>;
      for (const [roomId, incoming] of byRoom) {
        const cached = (await idbGet(roomId)) as Array<Record<string, unknown>>;
        // Index of full local objects (RAM fresher than the cache).
        const fullById = new Map<string, Record<string, unknown>>();
        for (const m of [...cached, ...(messagesByRoom[roomId] || [])]) {
          const id = String((m as Record<string, unknown>)?.messageId || "");
          if (id) fullById.set(id, m as Record<string, unknown>);
        }
        const views: Array<{
          messageId: string; roomId: string; text?: string; timestamp: number;
          editedAt?: number; deleted?: boolean; encrypted?: unknown; from?: string;
          system?: boolean; systemKind?: string;
        }> = [];
        for (const [id, m] of fullById) {
          views.push({
            messageId: id, roomId, text: String(m.text || ""),
            timestamp: Number(m.timestamp || 0),
            editedAt: m.editedAt ? Number(m.editedAt) : undefined,
            deleted: Boolean(m.deleted) || undefined, encrypted: m.encrypted,
            system: Boolean(m.system) || undefined,
            systemKind: typeof m.systemKind === "string" && m.systemKind ? String(m.systemKind) : undefined,
          });
        }
        const winners = mergeMessages(views, incoming);
        // Storage: only NORMALIZED messages (full shape with reactions: [],
        // etc.). A partial stored as-is crashes rendering (MessageBubble).
        // This also heals old partial caches.
        const out: Record<string, unknown>[] = [];
        for (const w of winners) {
          const local = fullById.get(w.messageId);
          if (local && Array.isArray(local.reactions)) {
            const localTs = Number(
              (local.editedAt as number | undefined) || local.timestamp || 0,
            );
            const winTs = w.editedAt || w.timestamp;
            if (localTs >= winTs) {
              out.push(local);
              continue;
            }
          }
          out.push(normalizeMessage(
            {
              messageId: w.messageId, roomId,
              text: w.text, timestamp: w.timestamp || Date.now(),
              editedAt: w.editedAt, deleted: w.deleted,
              username: w.from, encrypted: w.encrypted as never,
              system: w.system, systemKind: w.systemKind,
            },
            roomId,
          ) as unknown as Record<string, unknown>);
        }
        out.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
        await idbPut(roomId, out);
        messagesByRoom[roomId] = out.slice(-500);
      }
    }
    state.lastSyncAt = Date.now();
    ctx.persist?.();
    persistSettings();
    } finally {
      applying = false;
    }
  }

  function applyRoomTitle(roomId: string, title?: string): void {
    if (!title) return;
    const s = ctx.state as Record<string, unknown>;
    const rooms = s.rooms as Array<{ roomId: string; title?: string }> | undefined;
    const entry = rooms?.find((r) => r.roomId === roomId);
    if (entry && !entry.title) entry.title = title;
  }

  // Full local deletion of a room (received tombstone or op 58 event handled
  // messenger-side): lists, messages, keys, pins, IndexedDB.
  async function dropRoomLocal(roomId: string): Promise<void> {
    const s = ctx.state as Record<string, unknown>;
    const id = String(roomId || "");
    if (!id) return;
    s.rooms = ((s.rooms as Array<{ roomId: string }>) || []).filter((r) => r.roomId !== id);
    for (const mapKey of [
      "messagesByRoom", "usersByRoom", "roomKeysByRoom", "roomRatchetsByRoom",
      "trustedSenderKeysByRoom", "unreadByRoom",
    ]) {
      const m = s[mapKey] as Record<string, unknown> | undefined;
      if (m && typeof m === "object") delete m[id];
    }
    s.joinedRooms = ((s.joinedRooms as string[]) || []).filter((r) => r !== id);
    s.pinnedRooms = ((s.pinnedRooms as string[]) || []).filter((r) => r !== id);
    if (s.activeRoom === id) s.activeRoom = "";
    state.conflicts = state.conflicts.filter((c) => c.roomId !== id);
    await idbDelete(id);
  }

  // ── Op 61 receive ────────────────────────────────────────────────────────
  async function handleSyncMessage(d: Record<string, unknown>): Promise<void> {
    const fromWs = String(d.fromClientId || "");
    const enc = d.encrypted as Record<string, unknown> | undefined;
    if (!enc || typeof enc !== "object") return;
    const kind = String(enc.kind || "");
    if (kind === "hello" || kind === "accept" || kind === "confirm" || kind === "rekey") {
      await handleHelloUnsigned(enc as unknown as SyncHelloSigned, fromWs);
      return;
    }
    const outer = enc as unknown as SyncDataOuter;
    const sess = sessions.get(outer.from);
    if (!sess) return;
    // §9.3: only envelopes addressed to this device are processed —
    // catch-up broadcasts from another pair are ignored BEFORE anything
    // (no epoch fast-forward, no third-party peerWs reframing).
    if (outer.to !== device().id) return;
    if (outer.epoch !== sess.epoch || outer.syncId !== sess.syncId) {
      // Envelope addressed to another peer (third-party catch-up broadcast):
      // not for us, ignore without reacting.
      if (outer.to !== device().id) return;
      if (outer.syncId !== sess.syncId) {
        maybeRehandshake(outer.from);
        return;
      }
      const epoch = Number(outer.epoch);
      if (!Number.isSafeInteger(epoch) || epoch <= 0) return;
      if (epoch > sess.epoch) {
        // Missed rekey on our side: advance locally (bounded), then the
        // openData below authenticates — only the master holder can produce
        // a valid envelope, so adoption is safe.
        if (epoch - sess.epoch > MAX_EPOCH_JUMP) {
          maybeRehandshake(outer.from);
          return;
        }
        sess.epochKey = await deriveEpochKey(sess.master, epoch);
        sess.epoch = epoch;
        sess.expiresAt = Date.now() + CLOUDSYNC_EPOCH_TTL_MS;
        syncPeerCards();
        await saveSessions();
      } else {
        // Peer behind (our rekey was lost, typically stale peerWs): resend
        // the current rekey instead of the hard drop that used to freeze
        // the pair for good.
        maybeResendRekey(sess);
        return;
      }
    }
    if (!Number.isSafeInteger(outer.n) || (outer.n as number) <= 0) return;
    // Anti-replay window per (syncId, epoch): the send counter restarts at
    // 1 on every handshake, hence the reframing at each window. Beyond a
    // lag of 5000, reject (normal reordering absorbed by the set).
    const winId = `${outer.syncId}:${outer.epoch}`;
    if (sess.recvWindowId !== winId) {
      sess.recvWindowId = winId;
      sess.recvHighWater = 0;
      sess.seenN.clear();
    }
    if ((outer.n as number) <= sess.recvHighWater - 5000) return;
    const key = `${outer.syncId}:${outer.epoch}:${outer.n}`;
    if (sess.seenN.has(key)) return;
    try {
      const inner = await openData(outer, sess.epochKey, sess.peerPub);
      sess.seenN.add(key);
      if ((outer.n as number) > sess.recvHighWater) sess.recvHighWater = outer.n as number;
      if (sess.seenN.size > 6000) {
        for (const k of sess.seenN) {
          const kn = Number(k.slice(k.lastIndexOf(":") + 1));
          if (Number.isSafeInteger(kn) && kn < sess.recvHighWater - 5000) sess.seenN.delete(k);
        }
      }
      sess.lastSeen = Date.now();
      sess.lastInboundAt = Date.now();
      // Route learned only from verified INBOUND traffic (openData
      // succeeded): fromWs is an unauthenticated server hint; freezing it
      // earlier would open an intra-account route hijack.
      if (fromWs) sess.peerWs = fromWs;
      state.diag.received += 1;
      if (inner.kind === "revoke") {
        try {
          sess.master.fill(0);
          sess.epochKey.fill(0);
        } catch {
          /* ignore */
        }
        sessions.delete(outer.from);
        syncPeerCards();
        await saveSessions();
        return;
      }
      if (inner.kind === "ack") return;
      await applyInner(inner, outer.from);
      state.diag.applied += 1;
      syncPeerCards();
      const dev = device();
      if (dev.priv) {
        const ack = await sealData(
          { kind: "ack", vv: { ...state.vv }, ackN: outer.n }, sess.epochKey,
          { syncId: sess.syncId, epoch: sess.epoch, n: sess.sendN, from: dev.id, to: sess.peerId }, dev.priv,
        );
        sess.sendN += 1;
        sendTo(sess.peerWs, ack);
      }
    } catch {
      // Unreadable envelope: counted (diagnostics) but silent, since the
      // blind server allows no NACK.
      state.diag.failed += 1;
    }
  }

  // ── Op 60 ack: relay delivery report ───────────────────────────
  // { ok, delivered, dropped, peers, peerCount, requestId } — or { error }.
  // A unicast with delivered == 0 = dead route: resend ONCE via broadcast
  // (30s/peer cooldown) then reread the directory, instead of pushing into
  // the void until the STALE_ROUTE_MS fallback.
  async function handleSyncAck(d: Record<string, unknown>): Promise<void> {
    if (!state.enabled || suspended()) return;
    const err = String(d.error || "");
    if (err) {
      // Relay errors made visible (before: no case 60, so invisible).
      // Rate limit: quiet diagnostic, no looping toast.
      state.lastError = err;
      state.diag.failed += 1;
      if (err !== "Rate limit exceeded") setError(err);
      return;
    }
    if (d.ok !== true) return;
    // Old server (ack { ok, requestId } without report): nothing to infer,
    // especially not delivered == 0 → otherwise every unicast would trigger
    // a redundant broadcast + a nonexistent directory.
    if (!("delivered" in d)) return;
    relayMeshCaps = true;
    const reqId = String(d.requestId || "");
    const frame = reqId ? inflight.get(reqId) : undefined;
    if (reqId) inflight.delete(reqId);
    if (!frame) return;
    const delivered = Number(d.delivered || 0);
    const dropped = Number(d.dropped || 0);
    const to = frame.to;
    if (!to) return; // broadcast: nothing to repair, fan-out did its job.
    const sess = [...sessions.values()].find((s) => s.peerWs === to);
    if (delivered === 0) {
      // Dead unicast route (peer disconnected, tab reloaded…).
      if (sess) sess.lastInboundAt = 0; // force broadcast from the next push.
      const now = Date.now();
      if (now - (lastAutoFallbackAt.get(to) || 0) >= AUTO_FALLBACK_MS) {
        lastAutoFallbackAt.set(to, now);
        sendTo("", frame.encrypted); // single broadcast catch-up.
        void fetchPeers().catch(() => {});
      }
      return;
    }
    if (dropped > 0 && sess) {
      // Congested peer queue: ONE same-route retry, no broadcast
      // (pointless: the peer is connected, its queue is just full).
      const now = Date.now();
      if (now - (lastAckRetryAt.get(to) || 0) >= ACK_RETRY_MS) {
        lastAckRetryAt.set(to, now);
        sendTo(to, frame.encrypted);
      }
    }
  }

  // ── Op 62 directory: relearn the mesh ──────────────────────────────
  function fetchPeers(): Promise<void> {
    if (!state.enabled || suspended() || !hasWordsQuiet()) return Promise.resolve();
    if (!relayMeshCaps) return Promise.resolve(); // old server: unknown op 62.
    const requestId = globalThis.crypto.randomUUID();
    pendingPeersReq.add(requestId);
    ctx.send({ op: 62, d: { requestId } });
    return Promise.resolve();
  }

  // Proactive hello to a sessionless peer (directory/presence): a single
  // broadcast is enough (all siblings receive it, only the holder of the
  // words answers). Global 30s guard + existing Pair race logic.
  function proactiveHello(): void {
    if (!state.enabled || suspended() || !hasWordsQuiet()) return;
    const now = Date.now();
    if (now - lastProactiveHelloAt < PROACTIVE_HELLO_MS) return;
    lastProactiveHelloAt = now;
    void sendHello().catch(() => {});
  }

  // Reconciles the directory/presence with our sessions: any listed clientId
  // without a live session (and without a recent handshake) triggers a hello.
  function reconcileMeshPeers(listed: Array<{ clientId: string }>, selfWs: string): void {
    if (!state.enabled || suspended() || !hasWordsQuiet()) return;
    const knownWs = new Set<string>();
    for (const s of sessions.values()) {
      if (s.peerWs) knownWs.add(s.peerWs);
    }
    for (const p of pending.values()) {
      if (p.peerWs) knownWs.add(p.peerWs);
    }
    const missing = listed
      .map((p) => String(p?.clientId || ""))
      .filter((id) => id && id !== selfWs && !knownWs.has(id));
    if (missing.length) proactiveHello();
  }

  async function handlePeersDirectory(d: Record<string, unknown>): Promise<void> {
    if (!state.enabled || suspended()) return;
    if (d.ok !== true) return;
    const reqId = String(d.requestId || "");
    if (reqId) {
      if (!pendingPeersReq.has(reqId)) return; // stale response.
      pendingPeersReq.delete(reqId);
    }
    const peers = Array.isArray(d.peers) ? d.peers as Array<{ clientId: string }> : [];
    reconcileMeshPeers(peers, String(d.self || ""));
  }

  // ── Op 63 presence: join/update/leave ─────────────────────────────────────
  async function handlePresenceEvent(d: Record<string, unknown>): Promise<void> {
    if (!state.enabled || suspended()) return;
    const event = String(d.event || "");
    const clientId = String(d.clientId || "");
    if (!clientId) return;
    if (event === "leave") {
      // The peer left: mark the leg stale right away (next push goes out
      // via broadcast through routeFor) instead of pushing into the void.
      let touched = false;
      for (const s of sessions.values()) {
        if (s.peerWs === clientId) {
          s.lastInboundAt = 0;
          touched = true;
        }
      }
      if (touched) {
        syncPeerCards();
        notifyLocalChange(); // catch-up push (broadcast) within 2.5s.
      }
      return;
    }
    if (event === "join") {
      const known = [...sessions.values()].some((s) => s.peerWs === clientId)
        || [...pending.values()].some((p) => p.peerWs === clientId);
      if (!known) proactiveHello();
      return;
    }
    if (event === "update") {
      const platform = normalizePlatform(d.platform);
      let touched = false;
      for (const s of sessions.values()) {
        if (s.peerWs === clientId && s.platform !== platform) {
          s.platform = platform;
          touched = true;
        }
      }
      if (touched) {
        syncPeerCards();
        await saveSessions();
      }
    }
  }

  // ── 7d auto-rotation + 90s auto-sync ───────────────────────────────────────
  function startRekeyScheduler() {
    stopRekeyScheduler();
    void tryRestore().then(() => {
      syncPeerCards();
      scheduleAutoHello();
      // Mesh: reread the directory at boot to handshake peers already
      // online (fetchPeers → reconcile → proactive hello if missing).
      void fetchPeers().catch(() => {});
    });
    try {
      if (!themeWatchInstalled) {
        themeWatchInstalled = true;
        const ct = useCustomTheme();
        watch(
          () => [ct.theme?.accent, ct.theme?.tint, ct.enabled],
          () => {
            if (suppressThemeWatch) return;
            notifyLocalChange();
          },
          { flush: "sync" },
        );
        const i18n = useI18n();
        watch(
          () => i18n.locale.value,
          () => {
            // Anti-echo guard: during applyInner, applying is true and the
            // notify is ignored (the i18n setter persists itself to disk).
            notifyLocalChange();
          },
          { flush: "sync" },
        );
      }
    } catch {
      /* non-Vue context: no realtime observation */
    }
    if (bootHelloTimer) clearTimeout(bootHelloTimer);
    autoSyncTimer = setInterval(() => {
      void (async () => {
        if (!state.enabled || suspended()) return;
        // Sweep orphan handshakes (> 2 min) and op 60 frames without an
        // ack (> 2 min: the relay will no longer answer).
        const now = Date.now();
        for (const [id, p] of pending) {
          if (now - p.createdAt > 120_000) pending.delete(id);
        }
        sweepInflight();
        if (pendingPeersReq.size > 20) pendingPeersReq.clear();
        // Upgrade: the lock was just enabled, seal the blobs.
        await migrateBlobsToLock().catch(() => {});
        // Words arrived after boot? Restore known peers.
        if (!sessions.size && hasWordsQuiet()) {
          await tryRestore().catch(() => {});
          syncPeerCards();
        }
        // Still isolated (lost boot hello, aborted handshake)? Re-beacon
        // every 5 min max: without this, a failed join stayed silent until
        // the Pair button or unlock.
        if (!sessions.size && !pending.size && hasWordsQuiet()
          && Date.now() - lastAutoHello > 5 * 60_000) {
          lastAutoHello = Date.now();
          await sendHello().catch(() => {});
          syncPeerCards();
        }
        if (!sessions.size) return;
        await pushSnapshot().catch(() => {});
      })();
    }, AUTO_SYNC_MS);
    rekeyTimer = setInterval(() => {
      void (async () => {
        if (!state.enabled || !sessions.size || suspended()) return;
        const dev = device();
        if (!dev.priv || !authKey) {
          if (!(await ensureRoot())) return;
        }
        const d2 = device();
        if (!d2.priv) return;
        for (const sess of sessions.values()) {
          if (Date.now() < sess.expiresAt - CLOUDSYNC_REKEY_MARGIN_MS) continue;
          const next = sess.epoch + 1;
          const sent = await sendRekeyMessage(sess, next).catch(() => false);
          if (!sent) continue;
          sess.epochKey = await deriveEpochKey(sess.master, next);
          sess.epoch = next;
          sess.expiresAt = Date.now() + CLOUDSYNC_EPOCH_TTL_MS;
        }
        syncPeerCards();
        await saveSessions();
      })();
    }, 60_000);
  }

  function stopRekeyScheduler() {
    if (rekeyTimer) clearInterval(rekeyTimer);
    rekeyTimer = null;
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = null;
    if (bootHelloTimer) clearTimeout(bootHelloTimer);
    bootHelloTimer = null;
  }

  // ── Manual roomKey conflicts ───────────────────────────────────────────────
  async function resolveConflict(roomId: string, choice: "local" | "remote"): Promise<void> {
    const i = state.conflicts.findIndex((c) => c.roomId === roomId);
    if (i < 0) return;
    const [cf] = state.conflicts.splice(i, 1);
    if (choice === "remote") {
      const sess = [...sessions.values()][0];
      if (!sess) {
        setError("No paired device for remote key.");
        return;
      }
      try {
        const wrapKey = await deriveWrapKey(sess.epochKey);
        const raw = await unwrapRoomKey(cf.remoteWrapped, cf.remoteIv, wrapKey);
        ctx.importRoomKey?.(roomId, raw);
        if (!((ctx.state.joinedRooms as string[]) || []).includes(roomId)) ctx.requestJoin?.(roomId);
        ctx.persist?.();
      } catch {
        setError("Remote key unreadable.");
      }
    }
    // "local": keep it, and the next snapshot will impose it on the peer via LWW.
    await pushSnapshot().catch(() => {});
  }

  function setEnabled(on: boolean) {
    state.enabled = on;
    persistSettings();
    if (!on) revoke(false);
    else void tryRestore().then(() => syncPeerCards());
  }

  function setDomain(key: keyof typeof state.domains, on: boolean) {
    state.domains[key] = on;
    persistSettings();
  }

  function setParamGroup(key: ParamGroup, on: boolean) {
    state.paramGroups[key] = on;
    persistSettings();
  }

  // Remove a single peer (targeted revoke + local wipe of its session).
  async function unpairPeer(peerId: string): Promise<void> {
    const sess = sessions.get(peerId);
    if (!sess) return;
    const dev = device();
    if (dev.priv) {
      try {
        const outer = await sealData(
          { kind: "revoke", vv: { ...state.vv }, reason: "unpair" }, sess.epochKey,
          { syncId: sess.syncId, epoch: sess.epoch, n: sess.sendN, from: dev.id, to: sess.peerId },
          dev.priv,
        );
        sendTo(routeFor(sess), outer);
      } catch {
        /* ignore */
      }
    }
    sess.master.fill(0);
    sessions.delete(peerId);
    state.conflicts = state.conflicts.filter((c) => c.remoteBy !== peerId);
    syncPeerCards();
    await saveSessions();
  }

  function revoke(announce = true) {
    if (announce && sessions.size) {
      const dev = device();
      for (const sess of sessions.values()) {
        if (dev.priv) {
          void sealData(
            { kind: "revoke", vv: { ...state.vv }, reason: "user" }, sess.epochKey,
            { syncId: sess.syncId, epoch: sess.epoch, n: sess.sendN, from: dev.id, to: sess.peerId },
            dev.priv,
          ).then((outer) => sendTo(routeFor(sess), outer)).catch(() => {});
        }
        sess.master.fill(0);
      }
    }
    sessions.clear();
    pending.clear();
    try {
      localStorage.removeItem(SESSIONS_KEY);
    } catch {
      /* ignore */
    }
    syncPeerCards();
    persistSettings();
  }

  pruneTombstones();

  return {
    state,
    startPairing,
    pushSnapshot,
    notifyLocalChange,
    isApplying: () => applying,
    isRoomDeleted,
    isRoomLeft,
    markRoomDeleted,
    markRoomLeft,
    clearRoomLeft,
    handleSyncMessage,
    handleSyncAck,
    handlePeersDirectory,
    handlePresenceEvent,
    fetchPeers,
    startRekeyScheduler,
    stopRekeyScheduler,
    setEnabled,
    setDomain,
    setParamGroup,
    resolveConflict,
    unpairPeer,
    onLockEvent,
    revoke,
  };
}
