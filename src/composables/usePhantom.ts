import { reactive } from "vue";
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
import { setPhantomMessageHandler } from "./phantomBridge";

const te = new TextEncoder();

const PREKEY_STORAGE_KEY = "qxphantom-prekey-v1";
const ROSTER_POLL_MIN_MS = 5 * 60 * 1000;
const ROSTER_POLL_MAX_MS = 12 * 60 * 1000;

export interface PhantomMessengerCtx {
  state: any;
  apiRequest: (path: string, options?: any) => Promise<any>;
  send: (payload: any) => void;
  roomKeyFor: (roomId: string) => string;
  ensureRoomKey: (roomId: string) => string;
  importRoomKey: (roomId: string, roomKey: string) => string;
  hasRoomKey: (roomId: string) => boolean;
  generateRoomAccessToken: () => { roomId: string; roomKey: string; token: string };
  requestJoin: (roomId: string) => void;
  mutualRoomsWith: (username: string) => Array<{ roomId: string; name: string; icon: string }>;
  showToast?: (msg: string, opts?: any) => void;
}

interface StoredPrekey {
  mlkemPublicKeyHex: string;
  mlkemSecretKeyHex: string;
  mldsaSecretKeyHex: string;
  ecdsaPublicJwk: any;
  ecdsaPrivateJwk: any;
  bundle: PrekeyBundle | null;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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

function loadPrekey(): StoredPrekey | null {
  try {
    const raw = localStorage.getItem(PREKEY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPrekey) : null;
  } catch {
    return null;
  }
}

function savePrekey(prekey: StoredPrekey): void {
  try {
    localStorage.setItem(PREKEY_STORAGE_KEY, JSON.stringify(prekey));
  } catch {
    /* ignore */
  }
}

export function usePhantom(ctx: PhantomMessengerCtx) {
  const state = reactive({
    ready: false,
    prekey: null as StoredPrekey | null,
    friendsByUser: {} as Record<string, any>,
    pendingIncoming: [] as any[],
    pendingOutgoing: [] as any[],
    ghostCodes: [] as { url: string; createdAt: number }[],
    acceptUnknown: "off" as "off" | "filter" | "all",
    blockList: [] as string[],
    schedulerRunning: false,
    lastError: "",
  });

  // ── Fetch anonyme (aucun header d'authentification — S6/INV13) ──────────────
  async function anonymousFetch(path: string, options: any = {}) {
    const headers = {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(apiUrl(path), { ...options, headers });
    return response.json().catch(() => ({}));
  }

  // ── Secret maître (dérivé des mots de récupération) ─────────────────────────
  async function deriveMasterSecret(): Promise<Uint8Array | null> {
    const words = ctx.state?.recoveryWords;
    if (!Array.isArray(words) || !words.length) return null;
    const phrase = words.join(" ");
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
  async function ensurePrekey(): Promise<StoredPrekey | null> {
    if (state.prekey) return state.prekey;
    const stored = loadPrekey();
    if (stored?.mlkemSecretKeyHex && stored?.mldsaSecretKeyHex) {
      state.prekey = stored;
      state.ready = true;
      return stored;
    }

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

    // Publie via op 36 (l'acquittement arrive via le pont WS).
    ctx.send({ op: 36, d: { ...bundle, requestId: globalThis.crypto.randomUUID() } });
    savePrekey(prekey);
    state.prekey = prekey;
    state.ready = true;
    return prekey;
  }

  async function fetchPrekey(username: string): Promise<PrekeyBundle | null> {
    try {
      const data = await anonymousFetch(`/api/phantom/prekey/${encodeURIComponent(username)}`);
      return data && typeof data === "object" && data.mlkem768Pk ? (data as PrekeyBundle) : null;
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
    const roomKeys = ctx.state?.roomKeysByRoom || {};
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
      const blocked =
        state.blockList.includes(inner.sender.prekeyFp) ||
        state.blockList.includes(JSON.stringify(inner.sender.contextualPub));
      if (blocked) return; // destruction silencieuse avant tout rendu UI

      if (inner.kind === "intro") {
        if (state.acceptUnknown === "off") return;
        state.pendingIncoming.push({ id: globalThis.crypto.randomUUID(), ...inner });
      } else if (inner.kind === "welcome") {
        await handleWelcome(inner);
      }
    } catch {
      /* silencieux */
    }
  }

  async function handleWelcome(inner: PhantomInner): Promise<void> {
    if (!inner.welcome) return;
    try {
      ctx.importRoomKey(inner.welcome.roomId, inner.welcome.roomKey);
      ctx.requestJoin(inner.welcome.roomId);
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

  async function pollNow(): Promise<void> {
    const slots = await mySlots();
    if (!slots.length) return;
    try {
      const data = await anonymousFetch("/api/phantom/poll", {
        method: "POST",
        body: JSON.stringify({ slots, want: 8 }),
      });
      for (const frame of data?.frames || []) {
        if (frame) await handleFrame(frame);
      }
    } catch {
      /* silencieux */
    }
  }

  // ── Dépôt (gating) ──────────────────────────────────────────────────────────
  async function obtainQuotaToken(): Promise<{ quotaToken: any; nullifier: string } | null> {
    try {
      const challenge = await anonymousFetch("/api/auth/challenge?target=phantom");
      const quotaToken = challenge?.quotaToken;
      if (!quotaToken?.ticket || typeof quotaToken?.epoch !== "number") return null;
      const action = `phantom_deposit:${epochDay(Date.now())}`;
      const nullifier = await computeNullifier(quotaToken.ticket, quotaToken.epoch, action);
      return { quotaToken, nullifier };
    } catch {
      return null;
    }
  }

  async function depositEnvelope(
    outer: PhantomOuter,
    gate: { mode: string; token: string },
  ): Promise<boolean> {
    const quota = await obtainQuotaToken();
    if (!quota) return false;
    const data = await anonymousFetch("/api/phantom/deposit", {
      method: "POST",
      body: JSON.stringify({
        envelope: outer,
        gate: {
          mode: gate.mode,
          token: gate.token,
          nullifier: quota.nullifier,
          quotaToken: quota.quotaToken,
        },
      }),
    });
    return data?.ok === true;
  }

  // ── Envoi d'une demande (rendez-vous) ───────────────────────────────────────
  async function sealIntro(
    targetBundle: PrekeyBundle,
    roomId: string | null,
    introText: string,
  ): Promise<{ outer: PhantomOuter; slotId: string; recipientFp: string } | null> {
    const prekey = state.prekey;
    if (!prekey) return null;
    const recipientFp = await fp(targetBundle.mlkem768Pk);
    const day = epochDay(Date.now());
    const roomKey = roomId ? ctx.roomKeyFor(roomId) : "";
    const slotId = roomKey
      ? await slotContextual(recipientFp, roomKey, day)
      : await slotGlobal(recipientFp, day);

    const master = await deriveMasterSecret();
    if (!master) return null;
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

  async function sendIntroByContext(username: string, roomId: string, introText: string): Promise<boolean> {
    const prekey = await ensurePrekey();
    if (!prekey) return false;
    const target = await fetchPrekey(username);
    if (!target) {
      state.lastError = "Prekey not found.";
      return false;
    }
    const sealed = await sealIntro(target, roomId, introText);
    if (!sealed) return false;
    // NB (M4) : le jeton de porte (cap/pass/ghost) est fourni par l'appelant ;
    // l'acquisition réelle du CAPTCHA / Privacy Pass est un jalon dédié.
    return depositEnvelope(sealed.outer, { mode: "cap", token: "" });
  }

  async function sendIntroByUsername(username: string, introText: string): Promise<boolean> {
    return sendIntroByContext(username, "", introText);
  }

  // ── Acceptation / refus ─────────────────────────────────────────────────────
  async function acceptIncoming(id: string): Promise<boolean> {
    const index = state.pendingIncoming.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const incoming = state.pendingIncoming[index];

    // Vérifie la signature ML-DSA contre la bundle publique de l'émetteur.
    const senderBundle = await fetchPrekey(incoming.sender.displayName);
    if (!senderBundle) return false;
    const valid = await verifyInner(
      incoming as PhantomInner,
      incoming.sender.contextualPub,
      senderBundle.mldsa65Pk,
    );
    if (!valid) return false;

    const { roomId, roomKey } = ctx.generateRoomAccessToken();
    ctx.importRoomKey(roomId, roomKey);
    ctx.requestJoin(roomId);

    const prekey = state.prekey;
    if (!prekey) return false;
    const master = await deriveMasterSecret();
    if (!master) return false;
    const day = epochDay(Date.now());
    // Réponse scellée dans LE MÊME slot (contextuel ou global) que la demande.
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
      slotId: "",
      recipientFp: incoming.sender.prekeyFp,
      senderHint: randomHex64(),
      bucket: pickBucket(JSON.stringify(inner).length),
    });

    state.pendingIncoming.splice(index, 1);
    state.friendsByUser[incoming.sender.displayName] = {
      peerFp: incoming.sender.prekeyFp,
      peerDisplayName: incoming.sender.displayName,
      roomId,
      hint: "",
      state: "friends",
      createdAt: Date.now(),
    };
    await syncRoster();
    return depositEnvelope(outer, { mode: "cap", token: "" });
  }

  function ignoreIncoming(id: string): void {
    const index = state.pendingIncoming.findIndex((item) => item.id === id);
    if (index >= 0) state.pendingIncoming.splice(index, 1);
  }

  // ── Ghost codes ─────────────────────────────────────────────────────────────
  function createGhostLink(): void {
    ctx.send({ op: 38, d: { requestId: globalThis.crypto.randomUUID() } });
  }

  // ── Blocage opaque ──────────────────────────────────────────────────────────
  async function blockUser(hint: string): Promise<void> {
    if (!state.blockList.includes(hint)) {
      state.blockList.push(hint);
      ctx.send({ op: 39, d: { add: [hint], remove: [], requestId: globalThis.crypto.randomUUID() } });
    }
  }

  async function unblockUser(hint: string): Promise<void> {
    state.blockList = state.blockList.filter((h) => h !== hint);
    ctx.send({ op: 39, d: { add: [], remove: [hint], requestId: globalThis.crypto.randomUUID() } });
  }

  function setAcceptUnknown(mode: "off" | "filter" | "all"): void {
    state.acceptUnknown = mode;
    syncRoster();
  }

  // ── Roster blob (multi-device, chiffré côté client) ─────────────────────────
  async function rosterKey(): Promise<CryptoKey | null> {
    const master = await deriveMasterSecret();
    if (!master) return null;
    const bytes = await hkdfSha256(master, new Uint8Array(0), "qxphantom:roster", 32);
    return globalThis.crypto.subtle.importKey(
      "raw",
      bytes as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
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
      const raw = b64ToBytes(data.blob);
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
        for (const friend of roster.friends) {
          if (friend?.peerDisplayName) state.friendsByUser[friend.peerDisplayName] = friend;
        }
      }
      if (Array.isArray(roster.blocks)) state.blockList = roster.blocks;
      if (roster.settings?.acceptUnknown) state.acceptUnknown = roster.settings.acceptUnknown;
    } catch {
      /* silencieux */
    }
  }

  // ── Scheduler (poll cadencé + jitter) ───────────────────────────────────────
  let schedulerTimer: any = null;

  function startScheduler(): void {
    if (state.schedulerRunning) return;
    state.schedulerRunning = true;
    const tick = () => {
      pollNow();
      const jitter = ROSTER_POLL_MIN_MS + Math.random() * (ROSTER_POLL_MAX_MS - ROSTER_POLL_MIN_MS);
      schedulerTimer = setTimeout(tick, jitter);
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

  // ── Pont WS (réponses aux ops 36/37/38/39) ─────────────────────────────────
  setPhantomMessageHandler((op, d) => {
    if (d?.error) {
      state.lastError = String(d.error);
      if (ctx.showToast) ctx.showToast(state.lastError, { error: true });
      return;
    }
    if (op === 38 && d?.url) {
      state.ghostCodes.push({ url: d.url, createdAt: Date.now() });
    } else if (op === 39 && Array.isArray(d?.filter)) {
      state.blockList = d.filter;
    }
  });

  return {
    state,
    ensurePrekey,
    fetchPrekey,
    mySlots,
    pollNow,
    startScheduler,
    stopScheduler,
    sendIntroByContext,
    sendIntroByUsername,
    acceptIncoming,
    ignoreIncoming,
    createGhostLink,
    blockUser,
    unblockUser,
    setAcceptUnknown,
    syncRoster,
    loadRoster,
  };
}
