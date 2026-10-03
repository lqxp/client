import { reactive, watch } from "vue";
import { apiUrl } from "@/config/runtime";
import {
  bytesToHex,
  deriveContextualKeypair,
  epochDay,
  fp,
  generateMlKem768KeyPair,
  generatePrekeyBundle,
  hkdfSha256,
  hexToBytes,
  openEnvelope,
  pickBucket,
  sealEnvelope,
  signInner,
  slotContextual,
  slotGlobal,
  verifyInner,
  type PhantomInner,
  type PhantomOuter,
  type PrekeyBundle,
} from "@/crypto/phantom";
import { generateMlDsa65KeyPair } from "@/crypto/mldsa";
import { generateDeviceSigningKeyPair } from "@/crypto/e2ee";
import { computeNullifier } from "@/crypto/rln";
import { solveVdf } from "@/crypto/vdf";
import { encapsulatePqcSecret } from "@/crypto/pqc";
import { setPhantomMessageHandler } from "./phantomBridge";

const te = new TextEncoder();

const LEGACY_PREKEY_KEY = "qxphantom-prekey-v1";
const LEGACY_SETTINGS_KEY = "qxphantom-settings-v1";
// Cadence de poll des enveloppes (dead-drops). HTTP anonyme volontaire : un
// push WS trahirait la corrélation compte↔slot (S6/INV13).
const PHANTOM_POLL_MIN_MS = 15 * 1000;
const PHANTOM_POLL_MAX_MS = 30 * 1000;
// Bornes du réglage utilisateur de l'intervalle de poll (3s → 40s).
const PHANTOM_POLL_USER_MIN_SEC = 3;
const PHANTOM_POLL_USER_MAX_SEC = 40;

export interface PhantomIncoming {
  sender: {
    contextualPub: JsonWebKey;
    prekeyFp: string;
    displayName: string;
    mlkem768Pk: string;
  };
  [key: string]: unknown;
}

export interface PhantomFriend {
  peerFp?: string;
  roomId?: string;
  peerDisplayName?: string;
}

export interface PhantomMessengerCtx {
  state: Record<string, unknown>;
  apiRequest: (path: string, options?: RequestInit) => Promise<Record<string, unknown>>;
  send: (payload: Record<string, unknown>) => void;
  roomKeyFor: (roomId: string) => string;
  ensureRoomKey: (roomId: string) => string;
  importRoomKey: (roomId: string, roomKey: string) => string;
  hasRoomKey: (roomId: string) => boolean;
  generateRoomAccessToken: () => {
    roomId: string;
    roomKey: string;
    token: string;
  };
  requestJoin: (roomId: string) => void;
  setLocalRoomTitle?: (roomId: string, name: string) => void;
  registerFriendRoom?: (roomId: string, peerDisplayName?: string) => void;
  unregisterFriendRoom?: (roomId: string) => void;
  mutualRoomsWith: (
    username: string,
  ) => Array<{ roomId: string; name: string; icon: string }>;
  showToast?: (msg: string, opts?: { badge?: string; error?: boolean }) => void;
  // Persists the current account snapshot (active payload + accounts vault).
  // Phantom state lives inside that snapshot, so every mutation must flush it.
  persistAccountSnapshot?: () => void;
}

export interface StoredPrekey {
  mlkemPublicKeyHex: string;
  mlkemSecretKeyHex: string;
  mldsaSecretKeyHex: string;
  ecdsaPublicJwk: JsonWebKey | null;
  ecdsaPrivateJwk: JsonWebKey | null;
  bundle: PrekeyBundle | null;
}

export interface PhantomPersistedSettings {
  acceptUnknown: "off" | "filter" | "all";
  blockList: string[];
  friendsCollapsed: boolean;
  pollIntervalSeconds: number | null;
  pollingEnabled: boolean;
}

export function defaultPhantomSettings(): PhantomPersistedSettings {
  return {
    acceptUnknown: "all",
    blockList: [],
    friendsCollapsed: false,
    pollIntervalSeconds: null,
    pollingEnabled: true,
  };
}

function sanitizeHex(value: unknown, maxLen: number): string {
  const text = String(value || "");
  return /^[0-9a-fA-F]*$/.test(text) ? text.slice(0, maxLen) : "";
}

function sanitizeJwk(value: unknown): JsonWebKey | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonWebKey)
    : null;
}

export function sanitizePhantomPrekey(raw: unknown): StoredPrekey | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const mlkemPublicKeyHex = sanitizeHex(input.mlkemPublicKeyHex, 8192);
  const mlkemSecretKeyHex = sanitizeHex(input.mlkemSecretKeyHex, 16384);
  const mldsaSecretKeyHex = sanitizeHex(input.mldsaSecretKeyHex, 16384);
  if (!mlkemPublicKeyHex || !mlkemSecretKeyHex || !mldsaSecretKeyHex) return null;
  if (!input.bundle || typeof input.bundle !== "object") return null;
  return {
    mlkemPublicKeyHex,
    mlkemSecretKeyHex,
    mldsaSecretKeyHex,
    ecdsaPublicJwk: sanitizeJwk(input.ecdsaPublicJwk),
    ecdsaPrivateJwk: sanitizeJwk(input.ecdsaPrivateJwk),
    bundle: input.bundle as PrekeyBundle,
  };
}

export function sanitizePhantomSettings(raw: unknown): PhantomPersistedSettings {
  const out = defaultPhantomSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const input = raw as Record<string, unknown>;
  if (input.acceptUnknown === "off" || input.acceptUnknown === "filter" || input.acceptUnknown === "all") {
    out.acceptUnknown = input.acceptUnknown;
  }
  if (Array.isArray(input.blockList)) {
    out.blockList = input.blockList
      .map((entry) => String(entry || "").slice(0, 256))
      .filter(Boolean)
      .slice(0, 1000);
  }
  if (typeof input.friendsCollapsed === "boolean") out.friendsCollapsed = input.friendsCollapsed;
  if (typeof input.pollIntervalSeconds === "number" && Number.isFinite(input.pollIntervalSeconds)) {
    const seconds = Math.floor(input.pollIntervalSeconds);
    if (seconds >= PHANTOM_POLL_USER_MIN_SEC && seconds <= PHANTOM_POLL_USER_MAX_SEC) {
      out.pollIntervalSeconds = seconds;
    }
  }
  if (typeof input.pollingEnabled === "boolean") out.pollingEnabled = input.pollingEnabled;
  return out;
}

export function isDefaultPhantomSettings(settings: PhantomPersistedSettings): boolean {
  return (
    settings.acceptUnknown === "all" &&
    settings.blockList.length === 0 &&
    settings.friendsCollapsed === false &&
    settings.pollIntervalSeconds === null &&
    settings.pollingEnabled === true
  );
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomHex64(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// Phantom state lives inside the per-account snapshot (messenger persisted
// payload): storage keys are gone, one JSON per account holds everything.
function accountScope(ctx: PhantomMessengerCtx): string {
  return String(ctx.state?.userId || "").trim();
}

function legacyScopedKey(base: string, ctx: PhantomMessengerCtx): string {
  const scope = accountScope(ctx);
  return scope ? `${base}:${scope}` : base;
}

function readLegacyJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function deleteLegacyKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Fallback migration: a snapshot without prekey adopts the old standalone
// key (per-account flavor first, then the historical global one). Adopted
// values are written back into the snapshot and the old keys deleted.
function readLegacyPrekey(ctx: PhantomMessengerCtx): StoredPrekey | null {
  const scoped = sanitizePhantomPrekey(readLegacyJson(legacyScopedKey(LEGACY_PREKEY_KEY, ctx)));
  if (scoped) return scoped;
  return sanitizePhantomPrekey(readLegacyJson(LEGACY_PREKEY_KEY));
}

function deleteLegacyPrekeyKeys(ctx: PhantomMessengerCtx): void {
  deleteLegacyKey(legacyScopedKey(LEGACY_PREKEY_KEY, ctx));
  deleteLegacyKey(LEGACY_PREKEY_KEY);
}

function readLegacySettings(ctx: PhantomMessengerCtx): PhantomPersistedSettings | null {
  const scopedRaw = readLegacyJson(legacyScopedKey(LEGACY_SETTINGS_KEY, ctx));
  if (scopedRaw && typeof scopedRaw === "object") return sanitizePhantomSettings(scopedRaw);
  const globalRaw = readLegacyJson(LEGACY_SETTINGS_KEY);
  if (globalRaw && typeof globalRaw === "object") return sanitizePhantomSettings(globalRaw);
  return null;
}

function deleteLegacySettingsKeys(ctx: PhantomMessengerCtx): void {
  deleteLegacyKey(legacyScopedKey(LEGACY_SETTINGS_KEY, ctx));
  deleteLegacyKey(LEGACY_SETTINGS_KEY);
}

export type Phantom = ReturnType<typeof usePhantom>;

export function usePhantom(ctx: PhantomMessengerCtx) {
  const state = reactive({
    ready: false,
    prekey: null as StoredPrekey | null,
    friendsByUser: {} as Record<string, any>,
    pendingIncoming: [] as PhantomIncoming[],
    pendingOutgoing: [] as PhantomIncoming[],
    acceptUnknown: "all" as "off" | "filter" | "all",
    blockList: [] as string[],
    friendsCollapsed: false,
    pollIntervalSeconds: null as number | null,
    pollingEnabled: true,
    schedulerRunning: false,
    lastError: "",
    // Observabilité du poll (sinon un poll qui échoue est totalement silencieux
    // et l'utilisateur croit que le temps réel est cassé).
    pollBusy: false,
    lastPollAt: 0,
    lastPollError: "",
  });

  // Settings live in the account snapshot; every mutation flushes it.
  function writeSnapshotSettings(settings: PhantomPersistedSettings): void {
    ctx.state.phantomSettings = sanitizePhantomSettings(settings);
    ctx.persistAccountSnapshot?.();
  }

  // Immediate local persistence (independent from the roster blob / network).
  function loadSettings(): void {
    const shaped = sanitizePhantomSettings(ctx.state?.phantomSettings);
    // Upgrade path: a snapshot that still carries defaults adopts the old
    // standalone settings once, then the old keys are deleted.
    const legacy = isDefaultPhantomSettings(shaped) ? readLegacySettings(ctx) : null;
    const final = legacy ?? shaped;
    state.acceptUnknown = final.acceptUnknown;
    state.blockList = [...final.blockList];
    state.friendsCollapsed = final.friendsCollapsed;
    state.pollIntervalSeconds = final.pollIntervalSeconds;
    state.pollingEnabled = final.pollingEnabled;
    if (legacy) {
      writeSnapshotSettings(final);
      deleteLegacySettingsKeys(ctx);
    }
  }

  function saveSettings(): void {
    writeSnapshotSettings({
      acceptUnknown: state.acceptUnknown,
      blockList: [...state.blockList],
      friendsCollapsed: state.friendsCollapsed,
      pollIntervalSeconds: state.pollIntervalSeconds,
      pollingEnabled: state.pollingEnabled,
    });
  }

  loadSettings();

  // Per-account isolation (account switcher): track the bound account and drop
  // the previous account's friend state, pendings and in-memory prekey as soon
  // as the user id changes, then reload settings from the new account's
  // snapshot. Without this the new account inherits the old friend list
  // (loadRoster only merges, and a fresh account has no roster blob at all).
  let boundAccountId = accountScope(ctx);
  let sessionEpoch = 0;

  function clearFriendState(): void {
    for (const key of Object.keys(state.friendsByUser)) delete state.friendsByUser[key];
    state.pendingIncoming.length = 0;
    state.pendingOutgoing.length = 0;
  }

  function handleAccountSwitch(nextId: string): void {
    if (nextId === boundAccountId) return;
    boundAccountId = nextId;
    sessionEpoch += 1;
    prekeyPublishPending = false;
    if (prekeyRetryTimer) {
      clearTimeout(prekeyRetryTimer);
      prekeyRetryTimer = null;
    }
    state.prekey = null;
    state.ready = false;
    state.lastError = "";
    state.lastPollError = "";
    clearFriendState();
    state.acceptUnknown = "all";
    state.blockList = [];
    state.friendsCollapsed = false;
    state.pollIntervalSeconds = null;
    state.pollingEnabled = true;
    loadSettings();
  }

  watch(
    () => accountScope(ctx),
    (nextId) => {
      handleAccountSwitch(String(nextId || ""));
    },
  );

  // Shows the error AND emits a toast (lastError also feeds the modal).
  function setError(message: string): void {
    state.lastError = message;
    if (ctx.showToast) ctx.showToast(message, { error: true });
  }

  // ── Fetch anonyme (aucun header d'authentification — S6/INV13) ──────────────
  async function anonymousFetch(path: string, options: RequestInit = {}) {
    const headers = {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(apiUrl(path), { ...options, headers });
    return response.json().catch(() => ({}));
  }

  // ── Master secret (derived from the recovery words) ──────────────────────
  async function deriveMasterSecret(candidate?: unknown): Promise<Uint8Array | null> {
    const words = candidate === undefined ? ctx.state?.recoveryWords : candidate;
    if (!Array.isArray(words) || !words.length) return null;
    const phrase = (words as unknown[]).map((w) => String(w || "").trim().toLowerCase()).filter(Boolean).join(" ");
    if (phrase.split(" ").length < 12) return null;
    const material = await globalThis.crypto.subtle.importKey(
      "raw",
      te.encode(phrase) as BufferSource,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const seed = new Uint8Array(
      await globalThis.crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: te.encode("qxphantom:master") as BufferSource,
          iterations: 100_000,
        },
        material,
        256,
      ),
    );
    return hkdfSha256(seed, new Uint8Array(0), "qxp-master", 32);
  }

  // ── Prékey ──────────────────────────────────────────────────────────────────
  // True while the last publish could not go out (socket not ready): the
  // scheduler tick and the retry loop below keep re-emitting the idempotent
  // op 36 until the server holds our bundle. Without this a dropped publish
  // leaves the account unreachable and every friend request fails with
  // "hasn't published a prekey yet".
  let prekeyPublishPending = false;
  let prekeyRetryTimer: ReturnType<typeof setTimeout> | null = null;

  function socketReadyForPublish(): boolean {
    try {
      const connected = Boolean(ctx.state?.connected);
      const identified = Boolean(ctx.state?.identified);
      return connected && identified;
    } catch {
      return false;
    }
  }

  function publishPrekey(prekey: StoredPrekey): boolean {
    if (!prekey?.bundle) return false;
    if (!socketReadyForPublish()) return false;
    // Publie via op 36 (idempotent — UPSERT serveur). Réémis à chaque
    // `ensurePrekey` pour réparer les cas où l'op 36 a été lâché faute de WS
    // prêt lors du premier essai.
    try {
      ctx.send({
        op: 36,
        d: { ...prekey.bundle, requestId: globalThis.crypto.randomUUID() },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Bounded retry while the socket is down; a reconnect flips `identified`
   * and re-triggers `ensurePrekey` through the InboxView watcher anyway. */
  function schedulePrekeyRetry(attemptsLeft = 10): void {
    if (prekeyRetryTimer || attemptsLeft <= 0) return;
    prekeyRetryTimer = setTimeout(() => {
      prekeyRetryTimer = null;
      if (!prekeyPublishPending || !state.prekey) return;
      if (publishPrekey(state.prekey)) {
        prekeyPublishPending = false;
        return;
      }
      schedulePrekeyRetry(attemptsLeft - 1);
    }, 3000);
  }

  function trackPrekeyPublish(published: boolean): void {
    prekeyPublishPending = !published;
    if (prekeyPublishPending) schedulePrekeyRetry();
  }

  function writeSnapshotPrekey(prekey: StoredPrekey | null): void {
    ctx.state.phantomPrekey = prekey ? sanitizePhantomPrekey(prekey) : null;
    ctx.persistAccountSnapshot?.();
  }

  async function ensurePrekey(): Promise<StoredPrekey | null> {
    if (state.prekey) {
      trackPrekeyPublish(publishPrekey(state.prekey));
      return state.prekey;
    }

    // Snapshot first: each account owns its prekey inside its persisted
    // payload, so switching accounts can never reuse another one's identity.
    const fromSnapshot = sanitizePhantomPrekey(ctx.state?.phantomPrekey);
    if (fromSnapshot) {
      state.prekey = fromSnapshot;
      state.ready = true;
      trackPrekeyPublish(publishPrekey(fromSnapshot));
      return fromSnapshot;
    }

    // Fallback migration: adopt the old standalone key once, flush it into
    // the snapshot, then delete the old keys.
    const legacy = readLegacyPrekey(ctx);
    if (legacy) {
      state.prekey = legacy;
      state.ready = true;
      writeSnapshotPrekey(legacy);
      deleteLegacyPrekeyKeys(ctx);
      trackPrekeyPublish(publishPrekey(legacy));
      return legacy;
    }
    // No usable prekey anywhere (a stored one without bundle can never be
    // published): generate fresh, otherwise op 36 silently no-ops forever
    // and nobody can send us a friend request.
    try {
      const mlkem = generateMlKem768KeyPair();
      const mldsa = generateMlDsa65KeyPair();
      const ecdsa = await generateDeviceSigningKeyPair();
      const bundle = await generatePrekeyBundle({
        mlkemPublicKey: mlkem.publicKey,
        ecdsaPublicJwk: ecdsa.publicKey,
        ecdsaPrivateJwk: ecdsa.privateKey,
        mldsaKeyPair: mldsa,
        blockFilter: state.blockList,
      });

      const prekey: StoredPrekey = {
        mlkemPublicKeyHex: bytesToHex(mlkem.publicKey),
        mlkemSecretKeyHex: bytesToHex(mlkem.secretKey),
        mldsaSecretKeyHex: bytesToHex(mldsa.secretKey),
        ecdsaPublicJwk: ecdsa.publicKey,
        ecdsaPrivateJwk: ecdsa.privateKey,
        bundle,
      };

      trackPrekeyPublish(publishPrekey(prekey));
      writeSnapshotPrekey(prekey);
      state.prekey = prekey;
      state.ready = true;
      return prekey;
    } catch {
      setError("Could not generate the encryption prekey. Friend requests are unavailable.");
      return null;
    }
  }

  async function fetchPrekey(username: string): Promise<PrekeyBundle | null> {
    try {
      const data = await anonymousFetch(
        `/api/phantom/prekey/${encodeURIComponent(username)}`,
      );
      return data && typeof data === "object" && data.mlkem768Pk
        ? (data as PrekeyBundle)
        : null;
    } catch {
      return null;
    }
  }

  // ── Slots & polling ─────────────────────────────────────────────────────────
  async function mySlots(): Promise<string[]> {
    const prekey = state.prekey;
    if (!prekey) return [];
    const myFp = await fp(prekey.mlkemPublicKeyHex);
    const day = epochDay(Date.now());
    const slots: string[] = [await slotGlobal(myFp, day)];
    const roomKeys = (ctx.state?.roomKeysByRoom || {}) as Record<string, string>;
    for (const roomId of Object.keys(roomKeys)) {
      const roomKey = roomKeys[roomId];
      if (roomKey) slots.push(await slotContextual(myFp, roomKey, day));
    }
    return [...new Set(slots)];
  }

  async function handleFrame(outer: PhantomOuter): Promise<void> {
    const prekey = state.prekey;
    if (!prekey) return;
    try {
      const inner = await openEnvelope(outer, prekey.mlkemSecretKeyHex);
      if (inner.epochBucket !== epochDay(Date.now())) return; // rejet silencieux (anti-replay)
      const blocked = state.blockList.includes(inner.sender.prekeyFp);
      if (blocked) return; // destruction silencieuse avant tout rendu UI

      if (inner.kind === "intro") {
        if (state.acceptUnknown === "off") return;
        // Le dead-drop re-délivre les enveloppes : sans garde, une même
        // demande réapparaît à chaque poll et chaque acceptation créerait une
        // room supplémentaire. Un seul pending (et pas de doublon si déjà ami)
        // par empreinte de prékey émetteur.
        const senderFp = inner.sender?.prekeyFp;
        const alreadyFriend = Object.values(state.friendsByUser).some(
          (friend: PhantomFriend) => friend?.peerFp === senderFp,
        );
        if (alreadyFriend) return;
        const alreadyPending = state.pendingIncoming.some(
          (item: PhantomIncoming) => item.sender?.prekeyFp === senderFp,
        );
        if (alreadyPending) return;
        state.pendingIncoming.push({
          id: globalThis.crypto.randomUUID(),
          ...(inner as unknown as PhantomIncoming),
        });
      } else if (inner.kind === "welcome") {
        await handleWelcome(inner);
      }
    } catch {
      /* silencieux */
    }
  }

  async function handleWelcome(inner: PhantomInner): Promise<void> {
    if (!inner.welcome) return;
    // Re-délivraison du dead-drop : si ce welcome a déjà été traité (même
    // room, même émetteur déjà ami), on n'importe/joint pas une seconde fois.
    const existing = state.friendsByUser[inner.sender?.displayName];
    if (
      existing &&
      existing.state === "friends" &&
      existing.roomId === inner.welcome.roomId
    ) {
      return;
    }
    try {
      ctx.importRoomKey(inner.welcome.roomId, inner.welcome.roomKey);
      ctx.requestJoin(inner.welcome.roomId);
      ctx.setLocalRoomTitle?.(inner.welcome.roomId, inner.sender.displayName);
      ctx.registerFriendRoom?.(inner.welcome.roomId, inner.sender.displayName);
      state.friendsByUser[inner.sender.displayName] = {
        peerFp: inner.sender.prekeyFp,
        peerDisplayName: inner.sender.displayName,
        roomId: inner.welcome.roomId,
        hint: "",
        state: "friends",
        createdAt: Date.now(),
      };
      await syncRoster();
    } catch {
      /* silencieux */
    }
  }

  async function pollNow(): Promise<boolean> {
    // Un seul vol à la fois : deux polls concurrents se partageraient le même
    // dépilement côté serveur et feraient croire à un poll manqué.
    if (pollInFlight) return pollInFlight;
    pollInFlight = (async () => {
      const epoch = sessionEpoch;
      state.pollBusy = true;
      state.lastPollAt = Date.now();
      try {
        const slots = await mySlots();
        if (!slots.length) {
          state.lastPollError = "No local prekey available.";
          return false;
        }
        const data = await anonymousFetch("/api/phantom/poll", {
          method: "POST",
          body: JSON.stringify({ slots, want: 8 }),
        });
        state.lastPollError = "";
        // Account switched mid-poll: drop frames fetched for the old account
        // instead of mixing them into the new account's pendings.
        if (epoch !== sessionEpoch) return false;
        for (const frame of data?.frames || []) {
          if (frame) await handleFrame(frame);
        }
        return true;
      } catch (error) {
        state.lastPollError =
          error instanceof Error && error.message
            ? error.message
            : "Friend poll failed.";
        return false;
      } finally {
        state.pollBusy = false;
      }
    })();
    try {
      return await pollInFlight;
    } finally {
      pollInFlight = null;
    }
  }

  // ── Dépôt (gating) ──────────────────────────────────────────────────────────
  async function obtainQuotaToken(): Promise<{
    quotaToken: string | null;
    nullifier: string;
  } | null> {
    try {
      const challenge = await anonymousFetch(
        "/api/auth/challenge?target=phantom",
      );
      const quotaToken = challenge?.quotaToken;
      if (!quotaToken?.ticket || typeof quotaToken?.epoch !== "number") {
        setError("Anonymous quota token unavailable.");
        return null;
      }
      const action = `phantom_deposit:${epochDay(Date.now())}`;
      const nullifier = await computeNullifier(
        quotaToken.ticket,
        quotaToken.epoch,
        action,
      );
      return { quotaToken, nullifier };
    } catch {
      setError("Anonymous quota token failed.");
      return null;
    }
  }

  // Résout le CAPTCHA (VDF + PQC) et frappe un jeton `cap` à usage unique.
  async function obtainCapToken(scope = "phantom"): Promise<string | null> {
    try {
      const challenge = await anonymousFetch(
        `/api/auth/cap/challenge?scope=${encodeURIComponent(scope)}`,
      );
      if (
        !challenge?.challengeId ||
        !challenge?.vdf?.x ||
        !challenge?.quotaToken?.ticket ||
        !challenge?.pqcKey
      ) {
        setError("Anti-spam challenge unavailable.");
        return null;
      }
      const vdfProof = await solveVdf(
        challenge.vdf.x,
        challenge.vdf.t,
        challenge.vdf.modulus,
      );
      const nullifier = await computeNullifier(
        challenge.quotaToken.ticket,
        challenge.quotaToken.epoch,
        scope,
      );
      const pqcRes = await encapsulatePqcSecret(challenge.pqcKey);
      const data = await anonymousFetch("/api/auth/cap/redeem", {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          scope,
          challenge,
          vdfProof,
          nullifier,
          pqcCiphertext: pqcRes.ciphertext,
        }),
      });
      if (!data?.capToken) {
        setError("Anti-spam challenge rejected.");
        return null;
      }
      return data.capToken;
    } catch {
      setError("Anti-spam challenge failed.");
      return null;
    }
  }

  async function depositEnvelope(
    outer: PhantomOuter,
    gate: { mode: string; token: string } = { mode: "cap", token: "" },
  ): Promise<boolean> {
    const quota = await obtainQuotaToken();
    if (!quota) return false;

    let token: string | null = gate.token;
    if (gate.mode === "cap" && !token) {
      token = await obtainCapToken("phantom");
      if (!token) return false;
    }

    const data = await anonymousFetch("/api/phantom/deposit", {
      method: "POST",
      body: JSON.stringify({
        envelope: outer,
        gate: {
          mode: gate.mode,
          token,
          nullifier: quota.nullifier,
          quotaToken: quota.quotaToken,
        },
      }),
    });
    if (data?.ok === true) return true;
    setError("Deposit rejected by the server.");
    return false;
  }

  // ── Envoi d'une demande (rendez-vous) ───────────────────────────────────────
  async function sealIntro(
    targetBundle: PrekeyBundle,
    roomId: string | null,
    introText: string,
  ): Promise<{
    outer: PhantomOuter;
    slotId: string;
    recipientFp: string;
  } | null> {
    const prekey = state.prekey;
    if (!prekey) {
      setError("No local prekey available.");
      return null;
    }
    const recipientFp = await fp(targetBundle.mlkem768Pk);
    const day = epochDay(Date.now());
    const roomKey = roomId ? ctx.roomKeyFor(roomId) : "";
    const slotId = roomKey
      ? await slotContextual(recipientFp, roomKey, day)
      : await slotGlobal(recipientFp, day);

    const master = await deriveMasterSecret();
    if (!master) {
      setError("Recovery words unavailable — cannot seal the request.");
      return null;
    }
    const contextual = await deriveContextualKeypair(master, roomId || "");
    const inner = await signInner(
      {
        kind: "intro",
        epochBucket: day,
        sender: {
          contextualPub: contextual.publicKey,
          prekeyFp: await fp(prekey.mlkemPublicKeyHex),
          mlkem768Pk: prekey.mlkemPublicKeyHex,
          displayName: String(ctx.state?.username || ""),
        },
        intro: introText,
      },
      contextual.privateKey,
      hexToBytes(prekey.mldsaSecretKeyHex),
    );

    const outer = await sealEnvelope(inner, targetBundle.mlkem768Pk, {
      slotId,
      recipientFp,
      senderHint: randomHex64(),
      bucket: pickBucket(JSON.stringify(inner).length),
    });
    return { outer, slotId, recipientFp };
  }

  async function sendIntroByContext(
    username: string,
    roomId: string,
    introText: string,
  ): Promise<boolean> {
    const prekey = await ensurePrekey();
    if (!prekey) return false;
    if (!socketReadyForPublish()) {
      setError("Not connected — reconnect and try sending the request again.");
      return false;
    }
    const target = await fetchPrekey(username);
    if (!target) {
      setError(
        "This user hasn't published a prekey yet (are they using the app?).",
      );
      return false;
    }
    const sealed = await sealIntro(target, roomId, introText);
    if (!sealed) return false;
    // Le jeton `cap` est résolu automatiquement par depositEnvelope.
    return depositEnvelope(sealed.outer);
  }

  async function sendIntroByUsername(
    username: string,
    introText: string,
  ): Promise<boolean> {
    return sendIntroByContext(username, "", introText);
  }

  // ── Acceptation / refus ─────────────────────────────────────────────────────
  async function acceptIncoming(id: string): Promise<boolean> {
    const index = state.pendingIncoming.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const incoming = state.pendingIncoming[index];

    // Gate d'acceptation — tout est vérifié AVANT de créer la moindre room :
    // 1) le compte doit être identifié (sinon requestJoin() no-op côté WS et
    //    le pair resterait dans une room vide) ;
    // 2) les recovery words doivent être disponibles (elles signent le
    //    welcome — sans elles l'acceptation ne peut jamais aboutir) ;
    // 3) la signature de l'émetteur doit être valide.
    if (!ctx.state?.identified) {
      setError(
        "Log in with a verified account before accepting friend requests.",
      );
      return false;
    }
    const master = await deriveMasterSecret();
    if (!master) {
      setError("Recovery words unavailable — verify your account first.");
      return false;
    }

    // Vérifie la signature ML-DSA contre la bundle publique de l'émetteur.
    const senderBundle = await fetchPrekey(incoming.sender.displayName);
    if (!senderBundle) {
      setError("Sender prekey unavailable.");
      return false;
    }
    const valid = await verifyInner(
      incoming as unknown as PhantomInner,
      incoming.sender.contextualPub,
      senderBundle.mldsa65Pk,
    );
    if (!valid) {
      setError("Invalid sender signature.");
      return false;
    }

    // Déjà ami avec cette empreinte (acceptation croisée en cours, ou
    // redélivrance) : purge la demande au lieu de créer une deuxième room.
    const alreadyFriend = Object.values(state.friendsByUser).some(
      (friend: PhantomFriend) => friend?.peerFp === incoming.sender?.prekeyFp,
    );
    if (alreadyFriend) {
      state.pendingIncoming.splice(index, 1);
      await syncRoster();
      return true;
    }

    // The prekey may never have been generated on this client (fresh login
    // whose first publish was dropped, older stored bundle, …): ensure it
    // before creating the room, or the peer could never answer the welcome.
    const prekey = await ensurePrekey();
    if (!prekey) {
      setError("No local prekey available.");
      return false;
    }

    const { roomId, roomKey } = ctx.generateRoomAccessToken();
    ctx.importRoomKey(roomId, roomKey);
    ctx.requestJoin(roomId);

    const day = epochDay(Date.now());
    const recipientFp = incoming.sender.prekeyFp;
    // Le destinataire (émetteur de l'intro) poll toujours son slot global ; on y
    // dépose donc la réponse welcome quel que soit le chemin d'origine (contexte
    // ou pseudo).
    const slotId = await slotGlobal(recipientFp, day);
    const contextual = await deriveContextualKeypair(master, roomId);
    const inner = await signInner(
      {
        kind: "welcome",
        epochBucket: day,
        sender: {
          contextualPub: contextual.publicKey,
          prekeyFp: await fp(prekey.mlkemPublicKeyHex),
          mlkem768Pk: prekey.mlkemPublicKeyHex,
          displayName: String(ctx.state?.username || ""),
        },
        welcome: { roomId, roomKey },
      },
      contextual.privateKey,
      hexToBytes(prekey.mldsaSecretKeyHex),
    );
    const outer = await sealEnvelope(inner, incoming.sender.mlkem768Pk, {
      slotId,
      recipientFp,
      senderHint: randomHex64(),
      bucket: pickBucket(JSON.stringify(inner).length),
    });

    // La room n'est validée qu'après la livraison du welcome : si le dépôt est
    // rejeté, on annule l'enregistrement local pour pouvoir réessayer, sans
    // laisser une room fantôme dont le pair ne connaîtra jamais la clé.
    const deposited = await depositEnvelope(outer);
    if (!deposited) {
      ctx.unregisterFriendRoom?.(roomId);
      delete state.friendsByUser[incoming.sender.displayName];
      await syncRoster();
      return false;
    }

    state.pendingIncoming.splice(index, 1);
    ctx.setLocalRoomTitle?.(roomId, incoming.sender.displayName);
    ctx.registerFriendRoom?.(roomId, incoming.sender.displayName);
    state.friendsByUser[incoming.sender.displayName] = {
      peerFp: incoming.sender.prekeyFp,
      peerDisplayName: incoming.sender.displayName,
      roomId,
      hint: "",
      state: "friends",
      createdAt: Date.now(),
    };
    await syncRoster();
    return true;
  }

  function ignoreIncoming(id: string): void {
    const index = state.pendingIncoming.findIndex((item) => item.id === id);
    if (index >= 0) state.pendingIncoming.splice(index, 1);
  }

  // ── Blocage opaque (barrière locale, garantie §6.2) ────────────────────────
  // La liste stocke des `prekeyFp` (empreinte ML-KEM de l'émetteur), vérifiés à
  // l'ouverture de chaque enveloppe.
  async function blockUser(prekeyFp: string): Promise<void> {
    if (prekeyFp && !state.blockList.includes(prekeyFp)) {
      state.blockList.push(prekeyFp);
      saveSettings();
    }
    removeFriendLocal(prekeyFp);
    await syncRoster();
  }

  function removeFriendLocal(prekeyFp: string): void {
    for (const [name, friend] of Object.entries(state.friendsByUser)) {
      if (friend?.peerFp === prekeyFp) {
        if (friend?.roomId) {
          ctx.unregisterFriendRoom?.(friend.roomId);
        }
        delete state.friendsByUser[name];
      }
    }
  }

  async function removeFriend(prekeyFp: string): Promise<void> {
    removeFriendLocal(prekeyFp);
    await syncRoster();
  }

  async function unblockUser(prekeyFp: string): Promise<void> {
    state.blockList = state.blockList.filter((entry) => entry !== prekeyFp);
    saveSettings();
    await syncRoster();
  }

  function setAcceptUnknown(mode: "off" | "filter" | "all"): void {
    state.acceptUnknown = mode;
    saveSettings();
    syncRoster();
  }

  function setFriendsCollapsed(value: boolean): void {
    state.friendsCollapsed = Boolean(value);
    saveSettings();
  }

  function setPollInterval(seconds: number | null): void {
    if (seconds == null) {
      state.pollIntervalSeconds = null;
    } else {
      const n = Number(seconds);
      if (
        !Number.isFinite(n) ||
        n < PHANTOM_POLL_USER_MIN_SEC ||
        n > PHANTOM_POLL_USER_MAX_SEC
      )
        return;
      state.pollIntervalSeconds = n;
    }
    saveSettings();
    restartScheduler();
  }

  function setPollingEnabled(enabled: boolean): void {
    state.pollingEnabled = Boolean(enabled);
    saveSettings();
    if (state.pollingEnabled) startScheduler();
    else stopScheduler();
  }

  // ── Roster blob (multi-device, client-side encrypted) ──────────────────────
  async function rosterKeyFor(candidate?: unknown): Promise<CryptoKey | null> {
    const master = await deriveMasterSecret(candidate);
    if (!master) return null;
    const bytes = await hkdfSha256(
      master,
      new Uint8Array(0),
      "qxphantom:roster",
      32,
    );
    return globalThis.crypto.subtle.importKey(
      "raw",
      bytes as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }

  async function rosterKey(): Promise<CryptoKey | null> {
    return rosterKeyFor(undefined);
  }

  // Crypto proof that candidate words belong to this account: trial-decrypt
  // the server-stored roster blob with the key they derive. The server is a
  // blind relay (it only holds the ciphertext + a password-hash verifier for
  // /api/auth/recover), so this local proof is the verification — any 12
  // words must never be accepted as "signed".
  // Returns "ok" (blob decrypts), "mismatch" (blob rejects the words) or
  // "unverifiable" (no blob stored yet, or unreachable server).
  async function verifyRecoveryWords(candidate: unknown): Promise<"ok" | "mismatch" | "unverifiable"> {
    let data: Record<string, unknown>;
    try {
      data = await ctx.apiRequest("/api/social/blob", {});
    } catch {
      return "unverifiable";
    }
    if (!data?.blob) return "unverifiable";
    let key: CryptoKey | null = null;
    try {
      key = await rosterKeyFor(candidate);
    } catch {
      return "mismatch";
    }
    if (!key) return "mismatch";
    try {
      const raw = b64ToBytes(String(data.blob || ""));
      const iv = raw.slice(0, 12);
      const ciphertext = raw.slice(12);
      const plaintext = new Uint8Array(
        await globalThis.crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext as BufferSource,
        ),
      );
      JSON.parse(new TextDecoder().decode(plaintext));
      return "ok";
    } catch {
      return "mismatch";
    }
  }

  async function syncRoster(): Promise<void> {
    try {
      const key = await rosterKey();
      if (!key) return;
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const plaintext = te.encode(
        JSON.stringify({
          friends: Object.values(state.friendsByUser),
          pendingOut: state.pendingOutgoing,
          blocks: state.blockList,
          settings: { acceptUnknown: state.acceptUnknown },
        }),
      );
      const ciphertext = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          plaintext as BufferSource,
        ),
      );
      const blob = bytesToB64(new Uint8Array([...iv, ...ciphertext]));
      const current = await ctx.apiRequest("/api/social/blob", {});
      const nextVer = Number(current?.ver || 0) + 1;
      await ctx.apiRequest("/api/social/blob", {
        method: "PUT",
        body: JSON.stringify({ ver: nextVer, blob }),
      });
    } catch {
      /* silencieux */
    }
  }

  async function loadRoster(): Promise<void> {
    try {
      const data = await ctx.apiRequest("/api/social/blob", {});
      if (!data?.blob) return;
      const key = await rosterKey();
      if (!key) return;
      const raw = b64ToBytes(String(data.blob || ""));
      const iv = raw.slice(0, 12);
      const ciphertext = raw.slice(12);
      const plaintext = new Uint8Array(
        await globalThis.crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext as BufferSource,
        ),
      );
      const roster = JSON.parse(new TextDecoder().decode(plaintext));
      if (Array.isArray(roster.friends)) {
        // Replace, never merge: entries removed on another device (or left
        // over from a previous account) must disappear from the sidebar
        // instead of sticking around.
        const seen = new Set<string>();
        for (const friend of roster.friends) {
          if (friend?.peerDisplayName) {
            seen.add(friend.peerDisplayName);
            state.friendsByUser[friend.peerDisplayName] = friend;
          }
        }
        for (const name of Object.keys(state.friendsByUser)) {
          if (!seen.has(name)) {
            const stale = state.friendsByUser[name];
            if (stale?.roomId) ctx.unregisterFriendRoom?.(stale.roomId);
            delete state.friendsByUser[name];
          }
        }
        for (const friend of roster.friends) {
          if (friend?.roomId) {
            ctx.setLocalRoomTitle?.(
              friend.roomId,
              friend.peerDisplayName || friend.roomId,
            );
            ctx.registerFriendRoom?.(friend.roomId, friend.peerDisplayName);
          }
        }
      }
      if (Array.isArray(roster.blocks)) state.blockList = roster.blocks;
      if (roster.settings?.acceptUnknown)
        state.acceptUnknown = roster.settings.acceptUnknown;
    } catch {
      /* silencieux */
    }
  }

  // ── Scheduler (poll cadencé + jitter) ───────────────────────────────────────
  let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  // Vol de poll partagé (voir pollNow) : évite deux dépilements concurrents.
  let pollInFlight: Promise<boolean> | null = null;

  // Délai avant le prochain poll : intervalle utilisateur explicite (3–40 s)
  // si défini, sinon jitter par défaut (15–30 s) pour la discrétion.
  function pollDelayMs(): number {
    const s = state.pollIntervalSeconds;
    if (
      typeof s === "number" &&
      s >= PHANTOM_POLL_USER_MIN_SEC &&
      s <= PHANTOM_POLL_USER_MAX_SEC
    ) {
      return s * 1000;
    }
    return (
      PHANTOM_POLL_MIN_MS +
      Math.random() * (PHANTOM_POLL_MAX_MS - PHANTOM_POLL_MIN_MS)
    );
  }

  function startScheduler(): void {
    if (state.schedulerRunning) return;
    if (!state.pollingEnabled) return;
    state.schedulerRunning = true;
    const tick = () => {
      if (!state.pollingEnabled) {
        state.schedulerRunning = false;
        schedulerTimer = null;
        return;
      }
      // A publish dropped while the socket was down heals here: op 36 is an
      // idempotent UPSERT, so re-emitting a pending bundle is always safe.
      if (prekeyPublishPending && state.prekey && publishPrekey(state.prekey)) {
        prekeyPublishPending = false;
      }
      if (!state.prekey) {
        // Prékey jamais établie (génération ratée plus tôt ?) : la re-tenter
        // ici plutôt que de laisser le scheduler tourner à vide — sinon les
        // demandes n'arrivent qu'après un refresh.
        ensurePrekey()
          .catch(() => {})
          .finally(() => {
            pollNow();
          });
      } else {
        pollNow();
      }
      schedulerTimer = setTimeout(tick, pollDelayMs());
    };
    tick();
  }

  function stopScheduler(): void {
    state.schedulerRunning = false;
    if (schedulerTimer) {
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
  }

  // Relance le scheduler si actif afin d'appliquer un nouvel intervalle.
  function restartScheduler(): void {
    if (!state.schedulerRunning) return;
    stopScheduler();
    startScheduler();
  }

  // ── Pont WS (réponses aux ops 36/37/38/39) ─────────────────────────────────
  setPhantomMessageHandler((op, d) => {
    if (d?.error) {
      setError(String(d.error));
      return;
    }
    if (op === 39 && Array.isArray(d?.filter)) {
      state.blockList = d.filter;
    }
  });

  return {
    state,
    ensurePrekey,
    handleAccountSwitch,
    fetchPrekey,
    mySlots,
    pollNow,
    startScheduler,
    stopScheduler,
    sendIntroByContext,
    sendIntroByUsername,
    acceptIncoming,
    ignoreIncoming,
    blockUser,
    unblockUser,
    removeFriend,
    setAcceptUnknown,
    setFriendsCollapsed,
    setPollInterval,
    setPollingEnabled,
    syncRoster,
    loadRoster,
    verifyRecoveryWords,
  };
}
