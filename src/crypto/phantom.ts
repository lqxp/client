import { p256 } from "@noble/curves/nist.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { decodeBase64Url, encodeBase64Url } from "./e2ee";
import {
  generateMlDsa65KeyPair,
  signMlDsa65,
  verifyMlDsa65,
  type MlDsaKeyPair,
} from "./mldsa";

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const EMPTY = new Uint8Array(0);

// Tailles FIPS 203/204 pour ML-KEM-768 et ML-DSA-65.
export const MLKEM768_PK_BYTES = 1184;
export const MLKEM768_SK_BYTES = 2400;
export const MLKEM768_CT_BYTES = 1088;
export const MLDSA65_PK_BYTES = 1952;
export const MLDSA65_SIG_BYTES = 3309;

export const VALID_BUCKETS = [4096, 16384, 65536] as const;
export type Bucket = (typeof VALID_BUCKETS)[number];

// ── Types ────────────────────────────────────────────────────────────────────

export interface MlKemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface PrekeyBundle {
  version: number;
  mlkem768Pk: string; // hex (1184 octets)
  ecdsaP256Pk: JsonWebKey;
  mldsa65Pk: string; // hex (1952 octets)
  sigEcdsa: string; // b64url (r‖s 64 octets)
  sigMldsa: string; // hex (3309 octets)
  blockFilter: string[]; // hex64
  updatedAt: number;
}

export interface PhantomInnerSender {
  contextualPub: JsonWebKey;
  prekeyFp: string; // hex64
  mlkem768Pk: string; // hex, pour sceller la réponse
  displayName: string;
}

export interface PhantomInner {
  kind: "intro" | "welcome";
  epochBucket: number;
  sender: PhantomInnerSender;
  hybridSig: { ecdsa: string; mldsa: string };
  intro?: string;
  welcome?: { roomId: string; roomKey: string };
}

export interface PhantomOuter {
  pv: number;
  slotId: string;
  recipientFp: string;
  senderHint: string;
  bucket: number;
  ct: string;
}

// ── Encodages & hachage ──────────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Invalid hex payload.");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", data as BufferSource));
  return bytesToHex(digest);
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  len = 32,
): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: te.encode(info) as BufferSource,
    },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

async function hkdfAesGcmKey(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const key = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: te.encode(info) as BufferSource,
    },
    key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Canonicalisation (contrat partagé avec le serveur) ───────────────────────
//
// Même règle que `services/phantom_crypto.rs::canonical_json` : tri récursif des
// clés d'objets, tableaux dans l'ordre, JSON compact.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

// ── Empreinte & slots ────────────────────────────────────────────────────────

/** `fp(hex) = SHA256(octets bruts)` — hex minuscule 64 chars. */
export async function fp(hex: string): Promise<string> {
  return sha256Hex(hexToBytes(hex));
}

export function epochDay(nowMs = Date.now()): number {
  return Math.floor(nowMs / 86_400_000);
}

/** `slot_global(dest) = SHA256(fp(dest) ‖ epoch_jour)` (concaténation ASCII). */
export async function slotGlobal(recipientFp: string, day: number): Promise<string> {
  return sha256Hex(te.encode(recipientFp + String(day)));
}

/** `slot_contextuel(dest) = SHA256(fp(dest) ‖ SHA256(roomKey) ‖ epoch_jour)`. */
export async function slotContextual(
  recipientFp: string,
  roomKeyHex: string,
  day: number,
): Promise<string> {
  const roomKeyHash = await sha256Hex(hexToBytes(roomKeyHex));
  return sha256Hex(te.encode(recipientFp + roomKeyHash + String(day)));
}

// ── Clés ECDSA P-256 ─────────────────────────────────────────────────────────

async function importEcdsaPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function importEcdsaPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

/** Signe en P-256 (Web Crypto renvoie `r‖s` brut, 64 octets). */
async function signEcdsaRaw(message: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      message as BufferSource,
    ),
  );
}

async function verifyEcdsaRaw(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: CryptoKey,
): Promise<boolean> {
  return subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature as BufferSource,
    message as BufferSource,
  );
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + bytesToHex(bytes));
}

function bigIntToBytes(value: bigint, len: number): Uint8Array {
  return hexToBytes(value.toString(16).padStart(len * 2, "0"));
}

const P256_ORDER = p256.Point.Fn.ORDER;

/**
 * Déduit une paire ECDSA P-256 contextuelle du secret maître et d'un roomId.
 * La clé privée ne quitte jamais le client ; seule la clé publique apparaît
 * dans la couche interne des enveloppes.
 */
export async function deriveContextualKeypair(
  masterSecret: Uint8Array,
  roomId: string,
): Promise<{ privateKey: CryptoKey; publicKey: JsonWebKey }> {
  const salt = await sha256Hex(te.encode(roomId));
  const seed = await hkdfSha256(masterSecret, hexToBytes(salt), "qxphantom:ctx:v1", 32);

  const d = (bytesToBigInt(seed) % (P256_ORDER - 1n)) + 1n;
  const dBytes = bigIntToBytes(d, 32);
  const pub = p256.getPublicKey(dBytes, false); // 65 octets non compressés
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);

  const privateJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: encodeBase64Url(dBytes),
    x: encodeBase64Url(x),
    y: encodeBase64Url(y),
    ext: true,
    key_ops: ["sign"],
  };
  const publicJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(x),
    y: encodeBase64Url(y),
    ext: true,
    key_ops: ["verify"],
  };

  const privateKey = await importEcdsaPrivateKey(privateJwk);
  return { privateKey, publicKey: publicJwk };
}

// ── ML-KEM-768 ───────────────────────────────────────────────────────────────

export function generateMlKem768KeyPair(): MlKemKeyPair {
  return ml_kem768.keygen();
}

// ── Bundle de prékey ─────────────────────────────────────────────────────────

/** Octets canoniques du bundle SANS les signatures. */
export function canonicalPrekeyBundleBytes(bundle: PrekeyBundle): Uint8Array {
  const unsigned: Record<string, unknown> = {
    version: bundle.version,
    mlkem768Pk: bundle.mlkem768Pk,
    ecdsaP256Pk: bundle.ecdsaP256Pk,
    mldsa65Pk: bundle.mldsa65Pk,
    blockFilter: bundle.blockFilter,
    updatedAt: bundle.updatedAt,
  };
  return te.encode(canonicalJson(unsigned));
}

export async function generatePrekeyBundle(input: {
  mlkemPublicKey: Uint8Array;
  ecdsaPublicJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
  mldsaKeyPair: MlDsaKeyPair;
  blockFilter?: string[];
  version?: number;
}): Promise<PrekeyBundle> {
  const bundle: Omit<PrekeyBundle, "sigEcdsa" | "sigMldsa"> = {
    version: input.version ?? 1,
    mlkem768Pk: bytesToHex(input.mlkemPublicKey),
    ecdsaP256Pk: input.ecdsaPublicJwk,
    mldsa65Pk: bytesToHex(input.mldsaKeyPair.publicKey),
    blockFilter: input.blockFilter ?? [],
    updatedAt: Date.now(),
  };

  const canonical = te.encode(
    canonicalJson({
      version: bundle.version,
      mlkem768Pk: bundle.mlkem768Pk,
      ecdsaP256Pk: bundle.ecdsaP256Pk,
      mldsa65Pk: bundle.mldsa65Pk,
      blockFilter: bundle.blockFilter,
      updatedAt: bundle.updatedAt,
    }),
  );

  const ecdsaPrivateKey = await importEcdsaPrivateKey(input.ecdsaPrivateJwk);
  const sigEcdsa = encodeBase64Url(await signEcdsaRaw(canonical, ecdsaPrivateKey));
  const sigMldsa = bytesToHex(signMlDsa65(canonical, input.mldsaKeyPair.secretKey));

  return { ...bundle, sigEcdsa, sigMldsa };
}

export async function verifyPrekeyBundle(bundle: PrekeyBundle): Promise<boolean> {
  const canonical = canonicalPrekeyBundleBytes(bundle);
  const ecdsaOk = await verifyEcdsaRaw(
    canonical,
    decodeBase64Url(bundle.sigEcdsa),
    await importEcdsaPublicKey(bundle.ecdsaP256Pk),
  );
  const mldsaOk = verifyMlDsa65(
    hexToBytes(bundle.sigMldsa),
    canonical,
    hexToBytes(bundle.mldsa65Pk),
  );
  return ecdsaOk && mldsaOk;
}

// ── Signature hybride de la couche interne ───────────────────────────────────

/** Octets canoniques de l'enveloppe interne SANS `hybridSig`. */
export function canonicalInnerBytes(inner: PhantomInner): Uint8Array {
  const unsigned: Record<string, unknown> = {
    kind: inner.kind,
    epochBucket: inner.epochBucket,
    sender: inner.sender,
  };
  if (inner.kind === "intro") unsigned.intro = inner.intro;
  if (inner.kind === "welcome") unsigned.welcome = inner.welcome;
  return te.encode(canonicalJson(unsigned));
}

/** Signe l'interne (ECDSA contextuel ‖ ML-DSA device) et le renvoie complet. */
export async function signInner(
  inner: Omit<PhantomInner, "hybridSig">,
  contextualEcdsaPrivateKey: CryptoKey,
  deviceMldsaSecretKey: Uint8Array,
): Promise<PhantomInner> {
  const canonical = canonicalInnerBytes(inner as PhantomInner);
  const hybridSig = {
    ecdsa: encodeBase64Url(await signEcdsaRaw(canonical, contextualEcdsaPrivateKey)),
    mldsa: bytesToHex(signMlDsa65(canonical, deviceMldsaSecretKey)),
  };
  return { ...inner, hybridSig };
}

export async function verifyInner(
  inner: PhantomInner,
  senderContextualPub: JsonWebKey,
  senderMldsaPubHex: string,
): Promise<boolean> {
  const canonical = canonicalInnerBytes(inner);
  const ecdsaOk = await verifyEcdsaRaw(
    canonical,
    decodeBase64Url(inner.hybridSig.ecdsa),
    await importEcdsaPublicKey(senderContextualPub),
  );
  const mldsaOk = verifyMlDsa65(
    hexToBytes(inner.hybridSig.mldsa),
    canonical,
    hexToBytes(senderMldsaPubHex),
  );
  return ecdsaOk && mldsaOk;
}

// ── Padding géométrique ──────────────────────────────────────────────────────

export function pickBucket(byteLength: number): Bucket {
  for (const bucket of VALID_BUCKETS) {
    if (byteLength + 4 <= bucket) return bucket;
  }
  throw new Error("Inner payload too large for PHANTOM buckets.");
}

function padToBucket(jsonBytes: Uint8Array, bucket: number): Uint8Array {
  if (jsonBytes.length + 4 > bucket) {
    throw new Error("Inner payload exceeds bucket.");
  }
  const out = new Uint8Array(bucket);
  new DataView(out.buffer).setUint32(0, jsonBytes.length, false);
  out.set(jsonBytes, 4);
  return out;
}

function unpadBucket(padded: Uint8Array): Uint8Array {
  const len = new DataView(
    padded.buffer,
    padded.byteOffset,
    padded.byteLength,
  ).getUint32(0, false);
  if (len + 4 > padded.length) throw new Error("Corrupt inner padding.");
  return padded.slice(4, 4 + len);
}

// ── Scellement / ouverture (double couche) ───────────────────────────────────

export async function sealEnvelope(
  inner: PhantomInner,
  recipientMlkemPkHex: string,
  meta: { slotId: string; recipientFp: string; senderHint: string; bucket: number },
): Promise<PhantomOuter> {
  const innerJson = te.encode(JSON.stringify(inner));
  const padded = padToBucket(innerJson, meta.bucket);

  const recipientPk = hexToBytes(recipientMlkemPkHex);
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipientPk);
  const key = await hkdfAesGcmKey(sharedSecret, EMPTY, "qxphantom:v1");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aead = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, key, padded as BufferSource),
  );

  return {
    pv: 1,
    slotId: meta.slotId,
    recipientFp: meta.recipientFp,
    senderHint: meta.senderHint,
    bucket: meta.bucket,
    ct: encodeBase64Url(concatBytes(cipherText, iv, aead)),
  };
}

export async function openEnvelope(
  outer: PhantomOuter,
  recipientMlkemSecretKeyHex: string,
): Promise<PhantomInner> {
  const raw = decodeBase64Url(outer.ct);
  if (raw.length < MLKEM768_CT_BYTES + 12 + 16) {
    throw new Error("Envelope ciphertext too short.");
  }
  const cipherText = raw.slice(0, MLKEM768_CT_BYTES);
  const iv = raw.slice(MLKEM768_CT_BYTES, MLKEM768_CT_BYTES + 12);
  const aead = raw.slice(MLKEM768_CT_BYTES + 12);

  const secretKey = hexToBytes(recipientMlkemSecretKeyHex);
  const sharedSecret = ml_kem768.decapsulate(cipherText, secretKey);
  const key = await hkdfAesGcmKey(sharedSecret, EMPTY, "qxphantom:v1");
  const padded = new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv }, key, aead as BufferSource),
  );

  const innerJson = unpadBucket(padded);
  return JSON.parse(td.decode(innerJson)) as PhantomInner;
}

export { generateMlDsa65KeyPair };
