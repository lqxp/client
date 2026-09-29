import { decodeBase64Url, encodeBase64Url } from "./e2ee";
import { canonicalJson, hkdfSha256, bytesToHex, hexToBytes } from "./phantom";
import { signSlhDsa, verifySlhDsa } from "./slhdsa";

// ── QxCloudSync : primitives pures (aucun I/O, aucun stockage) ───────────────
// Relais pur op 60→61 : le serveur ne voit qu'un objet opaque ≤64 KiB.
// Racine de confiance : masterSecret dérivé des 12 mots recovery (saisis sur
// chaque device, jamais transmis). Décisions figées : relais pur uniquement,
// pairing par saisie des 12 mots, epoch 7j, conflit roomKey = refus + choix
// manuel, historique complet via IndexedDB côté composable.

export const CLOUDP_SYNC_PV = 1;
export const CLOUDSYNC_OP_SEND = 60;
export const CLOUDSYNC_OP_RECV = 61;
export const CLOUDSYNC_MAX_BYTES = 64 * 1024;
export const CLOUDSYNC_CHUNK_BYTES = 48 * 1024;
export const CLOUDSYNC_EPOCH_TTL_MS = 7 * 24 * 3600 * 1000;
export const CLOUDSYNC_REKEY_MARGIN_MS = Math.floor(CLOUDSYNC_EPOCH_TTL_MS / 10);

const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export interface SyncEphKeyPair {
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export interface SyncHelloUnsigned {
  pv: number;
  kind: "hello" | "accept" | "confirm" | "rekey";
  syncId: string;
  epoch: number;
  fromDeviceId: string;
  toDeviceId: string;
  ephPub: JsonWebKey;
  mlkemPk: string;
  ecdsaPub: JsonWebKey;
  nonce: string;
  mlkemCt?: string;
  // Plateforme normalisée ("mobile" | "web" | "desktop"), signée avec le hello.
  platform?: string;
  // Clé publique SLH-DSA-SHA2-128f du device (FIPS 205), b64url 32 o.
  slhdsaPk: string;
}

export type SyncHelloSigned = SyncHelloUnsigned & {
  auth: string;
  sigEcdsa: string;
  // Signature hybride post-quantique du même canonique (FIPS 205).
  sigSlh: string;
};

export interface SyncDataOuter {
  pv: number;
  kind: "data" | "ack" | "revoke";
  syncId: string;
  epoch: number;
  n: number;
  from: string;
  to: string;
  iv: string;
  ct: string;
  sig: string;
}

export interface SyncInner {
  kind: "snapshot" | "delta" | "ack" | "revoke";
  vv: Record<string, number>;
  collections?: SyncCollections;
  ackN?: number;
  reason?: string;
}

export interface SyncRoomEntry {
  roomId: string;
  roomKeyWrapped: string;
  roomKeyIv: string;
  title?: string;
  lastRead?: number;
  updatedAt: number;
  by: string;
  // Membres (usernames, plafonnés) : appliqués uniquement aux rooms importées.
  members?: string[];
}

export interface SyncMsgEntry {
  messageId: string;
  roomId: string;
  text?: string;
  timestamp: number;
  editedAt?: number;
  deleted?: boolean;
  encrypted?: unknown;
  from?: string;
}

export interface SyncCollections {
  rooms?: SyncRoomEntry[];
  messages?: SyncMsgEntry[];
  params?: Record<string, { value: unknown; updatedAt: number; by: string }>;
  ratchets?: Record<string, number>;
  trusted?: Array<{ roomId: string; deviceId: string; key: JsonWebKey }>;
  notes?: Record<string, { value: string; updatedAt: number; by: string }>;
  // Custom theme (couleur d'accent + teinte) : persisté dans le persisted
  // state officiel du messenger, LWW par updatedAt.
  customTheme?: {
    theme: { accent: string; tint: string } | null;
    enabled: boolean;
    updatedAt: number;
    by: string;
  };
  // Langue de l'interface (i18n) : LWW par updatedAt, validée côté réception.
  locale?: { value: string; updatedAt: number; by: string };
  // Pins (roomIds, ≤5) : LWW sur la liste entière.
  pinned?: { rooms: string[]; updatedAt: number; by: string };
  // Tombstones de rooms supprimées (30 j) : empêchent la résurrection par un
  // vieux snapshot. Appliquées une fois par deletedAt croissant.
  deleted?: Array<{ roomId: string; deletedAt: number; by: string }>;
}

export interface RoomKeyConflict {
  roomId: string;
  localWrapped: string;
  remoteWrapped: string;
  remoteBy: string;
  at: number;
}

// ── Dérivations ─────────────────────────────────────────────────────────────

export async function deriveMasterSecretFromWords(words: string[]): Promise<Uint8Array> {
  const phrase = words.map((w) => String(w || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (phrase.split(" ").length < 12) throw new Error("Twelve recovery words required.");
  const material = await subtle.importKey("raw", te.encode(phrase) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const seed = new Uint8Array(
    await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: te.encode("qxphantom:master") as BufferSource, iterations: 100_000 },
      material,
      256,
    ),
  );
  return hkdfSha256(seed, new Uint8Array(0), "qxp-master", 32);
}

export async function deriveSyncRoot(masterSecret: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(masterSecret, new Uint8Array(0), "qxcloudsync:root:v1", 32);
}

export async function deriveSyncAuthKey(syncRoot: Uint8Array): Promise<CryptoKey> {
  const bytes = await hkdfSha256(syncRoot, new Uint8Array(0), "qxcloudsync:auth:v1", 32);
  return subtle.importKey("raw", bytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function deriveSyncMaster(input: {
  ecdh: Uint8Array;
  ss1: Uint8Array;
  ss2: Uint8Array;
  syncRoot: Uint8Array;
  transcript: Uint8Array;
}): Promise<Uint8Array> {
  const total = new Uint8Array(input.ecdh.length + input.ss1.length + input.ss2.length + input.syncRoot.length);
  let o = 0;
  for (const part of [input.ecdh, input.ss1, input.ss2, input.syncRoot]) {
    total.set(part, o);
    o += part.length;
  }
  return hkdfSha256(total, input.transcript.slice(0, 32), "qxcloudsync:master:v1", 32);
}

export async function deriveEpochKey(syncMaster: Uint8Array, epochId: number): Promise<Uint8Array> {
  const salt = new Uint8Array(8);
  new DataView(salt.buffer).setBigUint64(0, BigInt(epochId), false);
  return hkdfSha256(syncMaster, salt, "qxcloudsync:epoch:v1", 32);
}

export async function deriveWrapKey(epochKey: Uint8Array): Promise<CryptoKey> {
  const bytes = await hkdfSha256(epochKey, new Uint8Array(0), "qxcloudsync:roomkey-wrap:v1", 32);
  return subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function importEpochAesKey(epochKey: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", epochKey as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// ── Éphémère P-256 ──────────────────────────────────────────────────────────

export async function generateEphKeyPair(): Promise<SyncEphKeyPair> {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicJwk = await subtle.exportKey("jwk", kp.publicKey);
  return { publicJwk, privateKey: kp.privateKey };
}

async function importEcdhPub(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export async function deriveEcdh(priv: CryptoKey, pubJwk: JsonWebKey): Promise<Uint8Array> {
  const pub = await importEcdhPub(pubJwk);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return new Uint8Array(bits);
}

// ── Hello : HMAC (preuve des 12 mots) + ECDSA device ────────────────────────

export function canonicalHelloBytes(h: SyncHelloUnsigned): Uint8Array {
  return te.encode(canonicalJson(h));
}

async function importEcdsaSignKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function importEcdsaVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function signHello(
  hello: SyncHelloUnsigned,
  authKey: CryptoKey,
  devicePrivJwk: JsonWebKey,
  slhSecretKey: Uint8Array,
): Promise<SyncHelloSigned> {
  const canonical = canonicalHelloBytes(hello);
  const mac = new Uint8Array(await subtle.sign("HMAC", authKey, canonical as BufferSource));
  const priv = await importEcdsaSignKey(devicePrivJwk);
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, canonical as BufferSource));
  return {
    ...hello,
    auth: encodeBase64Url(mac),
    sigEcdsa: encodeBase64Url(sig),
    sigSlh: encodeBase64Url(signSlhDsa(canonical, slhSecretKey)),
  };
}

export async function verifyHello(
  signed: SyncHelloSigned,
  authKey: CryptoKey,
): Promise<boolean> {
  // Reconstruction par exclusion (pas de whitelist) : tout champ signé —
  // y compris platform et slhdsaPk — est couvert par le HMAC et les signatures.
  const { auth, sigEcdsa, sigSlh, ...unsigned } = signed as unknown as Record<string, unknown>;
  void auth;
  const canonical = te.encode(canonicalJson(unsigned));
  const macOk = await subtle.verify("HMAC", authKey, decodeBase64Url(signed.auth) as BufferSource, canonical as BufferSource).catch(() => false);
  if (!macOk) return false;
  let ecdsaOk = false;
  try {
    const pub = await importEcdsaVerifyKey(signed.ecdsaPub);
    ecdsaOk = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, pub,
      decodeBase64Url(sigEcdsa as string) as BufferSource, canonical as BufferSource,
    );
  } catch {
    ecdsaOk = false;
  }
  if (!ecdsaOk) return false;
  // FIPS 205 obligatoire : un hello sans SLH-DSA valide est rejeté (fail closed).
  try {
    if (typeof signed.slhdsaPk !== "string" || typeof sigSlh !== "string") return false;
    return verifySlhDsa(
      decodeBase64Url(sigSlh as string),
      canonical,
      decodeBase64Url(signed.slhdsaPk),
    );
  } catch {
    return false;
  }
}

export function transcriptHash(parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return subtle.digest("SHA-256", buf as BufferSource).then((d) => new Uint8Array(d));
}

// ── Enveloppes data (AES-GCM epoch + signature ECDSA device) ────────────────

function canonicalDataBytes(o: Omit<SyncDataOuter, "sig">): Uint8Array {
  return te.encode(canonicalJson(o));
}

export async function sealData(
  inner: SyncInner,
  epochKey: Uint8Array,
  meta: { syncId: string; epoch: number; n: number; from: string; to: string },
  devicePrivJwk: JsonWebKey,
): Promise<SyncDataOuter> {
  const key = await importEpochAesKey(epochKey);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = te.encode(JSON.stringify(inner));
  const aad = te.encode(`${meta.syncId}:${meta.epoch}:${meta.n}:${meta.from}:${meta.to}`);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource }, key, plaintext as BufferSource),
  );
  const unsigned = {
    pv: CLOUDP_SYNC_PV, kind: inner.kind === "ack" || inner.kind === "revoke" ? inner.kind : ("data" as const),
    syncId: meta.syncId, epoch: meta.epoch, n: meta.n, from: meta.from, to: meta.to,
    iv: encodeBase64Url(iv), ct: encodeBase64Url(ct),
  };
  const priv = await importEcdsaSignKey(devicePrivJwk);
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, canonicalDataBytes(unsigned) as BufferSource));
  return { ...unsigned, sig: encodeBase64Url(sig) };
}

export async function openData(
  outer: SyncDataOuter,
  epochKey: Uint8Array,
  senderPubJwk: JsonWebKey,
): Promise<SyncInner> {
  const { sig, ...unsigned } = outer;
  const pub = await importEcdsaVerifyKey(senderPubJwk);
  const sigOk = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, pub,
    decodeBase64Url(sig) as BufferSource, canonicalDataBytes(unsigned as Omit<SyncDataOuter, "sig">) as BufferSource,
  );
  if (!sigOk) throw new Error("Bad sync envelope signature.");
  const key = await importEpochAesKey(epochKey);
  const aad = te.encode(`${outer.syncId}:${outer.epoch}:${outer.n}:${outer.from}:${outer.to}`);
  const pt = new Uint8Array(
    await subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(outer.iv) as BufferSource, additionalData: aad as BufferSource },
      key, decodeBase64Url(outer.ct) as BufferSource,
    ),
  );
  return JSON.parse(new TextDecoder().decode(pt)) as SyncInner;
}

// ── Wrap roomKey ────────────────────────────────────────────────────────────

export async function wrapRoomKey(roomKeyHex: string, wrapKey: CryptoKey): Promise<{ iv: string; data: string }> {
  const raw = hexToBytes(roomKeyHex);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, wrapKey, raw as BufferSource));
  return { iv: encodeBase64Url(iv), data: encodeBase64Url(ct) };
}

export async function unwrapRoomKey(wrapped: string, ivB64: string, wrapKey: CryptoKey): Promise<string> {
  const pt = new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(ivB64) as BufferSource }, wrapKey, decodeBase64Url(wrapped) as BufferSource),
  );
  return bytesToHex(pt);
}

// ── Chunking (relais ≤64 KiB) ───────────────────────────────────────────────
// Stratégie : sous-snapshots valides fusionnables via deepMerge, découpés par
// taille JSON mesurée (marge sous le cap : base64 + signatures + enveloppe).
const PART_BUDGET = 44_000;

function partSize(p: SyncInner): number {
  return JSON.stringify(p).length;
}

export function splitCollectionsForRelay(inner: SyncInner): SyncInner[] {
  const c = inner.collections;
  if (!c) return [inner];
  const parts: SyncInner[] = [];
  const head: SyncCollections = {};
  if (c.rooms?.length) head.rooms = c.rooms;
  if (c.params && Object.keys(c.params).length) head.params = c.params;
  if (c.ratchets && Object.keys(c.ratchets).length) head.ratchets = c.ratchets;
  if (c.trusted?.length) head.trusted = c.trusted;
  if (c.notes && Object.keys(c.notes).length) head.notes = c.notes;
  if (c.customTheme) head.customTheme = c.customTheme;
  if (c.locale) head.locale = c.locale;
  if (c.pinned) head.pinned = c.pinned;
  if (c.deleted?.length) head.deleted = c.deleted;
  if (Object.keys(head).length) {
    parts.push({ kind: inner.kind, vv: inner.vv, collections: head });
  }
  const msgs = c.messages || [];
  let batch: NonNullable<SyncCollections["messages"]> = [];
  const flush = () => {
    if (batch.length) {
      parts.push({ kind: inner.kind, vv: inner.vv, collections: { messages: batch } });
      batch = [];
    }
  };
  for (const m of msgs) {
    batch.push(m);
    if (partSize({ kind: inner.kind, vv: inner.vv, collections: { messages: batch } }) > PART_BUDGET) {
      batch.pop();
      flush();
      batch.push(m);
      // Un message seul dépasse le budget (pièce jointe inline ?) : on le
      // transporte sans son enveloppe chiffrée d'origine, jamais droppé.
      if (partSize({ kind: inner.kind, vv: inner.vv, collections: { messages: batch } }) > PART_BUDGET) {
        batch[batch.length - 1] = { ...m, encrypted: undefined };
      }
    }
  }
  flush();
  return parts.length ? parts : [inner];
}

export async function sealChunked(
  inner: SyncInner,
  epochKey: Uint8Array,
  meta: { syncId: string; epoch: number; from: string; to: string; startN: number },
  devicePrivJwk: JsonWebKey,
): Promise<SyncDataOuter[]> {
  const parts = splitCollectionsForRelay(inner);
  const outs: SyncDataOuter[] = [];
  let n = meta.startN;
  for (const part of parts) {
    const sealed = await sealData(part, epochKey, { syncId: meta.syncId, epoch: meta.epoch, n, from: meta.from, to: meta.to }, devicePrivJwk);
    if (JSON.stringify(sealed).length > CLOUDSYNC_MAX_BYTES) {
      throw new Error("Sync part exceeds relay cap; reduce batch.");
    }
    outs.push(sealed);
    n += 1;
  }
  return outs;
}

// ── DeepMerge ───────────────────────────────────────────────────────────────
// Règles : union + LWW (_ts/updatedAt, tie-break deviceId). Conflit roomKey :
// REFUS + demande manuelle (jamais d'écrasement auto).

export function maxRatchets(local: Record<string, number>, remote: Record<string, number>): Record<string, number> {
  const out = { ...local };
  for (const [k, v] of Object.entries(remote)) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
}

export function mergeParams(
  local: NonNullable<SyncCollections["params"]>,
  remote: NonNullable<SyncCollections["params"]>,
): NonNullable<SyncCollections["params"]> {
  const out = { ...local };
  for (const [k, v] of Object.entries(remote)) {
    if (k === "__chunk") continue;
    const cur = out[k];
    if (!cur || v.updatedAt > cur.updatedAt || (v.updatedAt === cur.updatedAt && String(v.by) > String(cur.by))) {
      out[k] = v;
    }
  }
  return out;
}

export function mergeMessages(
  local: SyncMsgEntry[],
  remote: SyncMsgEntry[],
): SyncMsgEntry[] {
  const byId = new Map<string, SyncMsgEntry>();
  for (const m of local) byId.set(m.messageId, m);
  for (const m of remote) {
    const cur = byId.get(m.messageId);
    if (!cur) {
      byId.set(m.messageId, m);
      continue;
    }
    const curTs = cur.editedAt || cur.timestamp;
    const newTs = m.editedAt || m.timestamp;
    if (newTs > curTs) byId.set(m.messageId, m);
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export interface RoomKeyMergeResult {
  merged: SyncRoomEntry[];
  conflicts: RoomKeyConflict[];
}

export function mergeRoomEntries(
  local: SyncRoomEntry[],
  remote: SyncRoomEntry[],
  localById: Record<string, string>,
): RoomKeyMergeResult {
  const byId = new Map<string, SyncRoomEntry>();
  for (const r of local) byId.set(r.roomId, r);
  const conflicts: RoomKeyConflict[] = [];
  for (const r of remote) {
    const cur = byId.get(r.roomId);
    if (!cur) {
      byId.set(r.roomId, r);
      continue;
    }
    if (cur.roomKeyWrapped !== r.roomKeyWrapped) {
      // Politique "refuser + demander" : on garde le local, on signale.
      if (!localById[r.roomId] || localById[r.roomId] !== r.roomKeyWrapped) {
        conflicts.push({
          roomId: r.roomId, localWrapped: cur.roomKeyWrapped,
          remoteWrapped: r.roomKeyWrapped, remoteBy: r.by, at: Date.now(),
        });
      }
      // LWW pour les métadonnées non-clé (titre, lastRead).
      if (r.updatedAt > cur.updatedAt) {
        byId.set(r.roomId, { ...r, roomKeyWrapped: cur.roomKeyWrapped, roomKeyIv: cur.roomKeyIv });
      }
      continue;
    }
    if (r.updatedAt > cur.updatedAt || (r.updatedAt === cur.updatedAt && r.by > cur.by)) {
      byId.set(r.roomId, r);
    }
  }
  return { merged: [...byId.values()], conflicts };
}

export function mergeTrusted(
  local: NonNullable<SyncCollections["trusted"]>,
  remote: NonNullable<SyncCollections["trusted"]>,
): { merged: NonNullable<SyncCollections["trusted"]>; conflicts: string[] } {
  const key = (t: { roomId: string; deviceId: string }) => `${t.roomId}:${t.deviceId}`;
  const map = new Map(local.map((t) => [key(t), t]));
  const conflicts: string[] = [];
  for (const t of remote) {
    const cur = map.get(key(t));
    if (!cur) {
      map.set(key(t), t);
      continue;
    }
    // Comparaison canonique : l'ordre des clés JWK peut varier après un
    // aller-retour JSON (le serveur re-sérialise en clés triées).
    if (canonicalJson(cur.key) !== canonicalJson(t.key)) conflicts.push(key(t));
  }
  return { merged: [...map.values()], conflicts };
}

export function mergeVersionVectors(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
}

export function randomNonceB64(bytes = 32): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return encodeBase64Url(b);
}
