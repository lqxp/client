const ROOM_ID_BYTES = 16;
const ROOM_KEY_BYTES = 32;
const IV_BYTES = 12;
const MESSAGE_SALT_BYTES = 32;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const DEVICE_ID_BYTES = 16;

export const E2EE_ENVELOPE_VERSION = 2;
export const E2EE_ALGORITHM = "QXDR-A256GCM-HKDFSHA256";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Invalid hex payload.");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function strictBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function encodeBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBase64Url(value: string) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return base64ToBytes(padded);
}

export function cryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

export function generateDeviceId() {
  if (!cryptoAvailable()) throw new Error("Web Crypto is unavailable.");
  const bytes = new Uint8Array(DEVICE_ID_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function generateDeviceSigningKeyPair() {
  if (!cryptoAvailable()) throw new Error("Web Crypto is unavailable.");
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKey = await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await globalThis.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return { publicKey, privateKey };
}

async function importDevicePrivateKey(privateKey: JsonWebKey) {
  return globalThis.crypto.subtle.importKey(
    "jwk",
    privateKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function importDevicePublicKey(publicKey: JsonWebKey) {
  return globalThis.crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

function signingPayload(envelope: any) {
  return TEXT_ENCODER.encode(JSON.stringify({
    v: envelope.v,
    alg: envelope.alg,
    roomId: envelope.roomId,
    n: envelope.n,
    salt: envelope.salt,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    senderDeviceId: envelope.senderDeviceId,
    senderSigningKey: envelope.senderSigningKey
  }));
}

export function canonicalDeviceSigningKey(value: any) {
  if (!value || typeof value !== "object") return "";
  return JSON.stringify({
    crv: String(value.crv || ""),
    ext: value.ext === true,
    key_ops: Array.isArray(value.key_ops) ? value.key_ops.map(String).sort() : [],
    kty: String(value.kty || ""),
    x: String(value.x || ""),
    y: String(value.y || ""),
  });
}

export function normalizeRoomKey(rawValue: string) {
  const bytes = hexToBytes(String(rawValue || "").trim());
  if (bytes.length !== ROOM_KEY_BYTES) {
    throw new Error("Invalid room key.");
  }
  return bytesToHex(bytes);
}

export function generateRoomKey() {
  if (!cryptoAvailable()) throw new Error("Web Crypto is unavailable.");
  const bytes = new Uint8Array(ROOM_KEY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function normalizeRoomAccessToken(rawValue: string) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!/^[0-9a-f]{96}$/.test(normalized)) {
    throw new Error("Invalid room token.");
  }
  return normalized;
}

export function generateRoomAccessToken() {
  if (!cryptoAvailable()) throw new Error("Web Crypto is unavailable.");
  const roomIdBytes = new Uint8Array(ROOM_ID_BYTES);
  const roomKeyBytes = new Uint8Array(ROOM_KEY_BYTES);
  globalThis.crypto.getRandomValues(roomIdBytes);
  globalThis.crypto.getRandomValues(roomKeyBytes);
  const roomId = bytesToHex(roomIdBytes);
  const roomKey = bytesToHex(roomKeyBytes);
  return {
    roomId,
    roomKey,
    token: `${roomId}${roomKey}`
  };
}

export function parseRoomAccessToken(rawValue: string) {
  const token = normalizeRoomAccessToken(rawValue);
  return {
    token,
    roomId: token.slice(0, ROOM_ID_BYTES * 2),
    roomKey: token.slice(ROOM_ID_BYTES * 2)
  };
}

async function deriveMessageKey(roomKey: string, roomId: string, salt: Uint8Array, counter: number) {
  if (!cryptoAvailable()) throw new Error("Web Crypto is unavailable.");
  const raw = hexToBytes(roomKey);
  if (raw.length !== ROOM_KEY_BYTES) throw new Error("Invalid room key.");
  const baseKey = await globalThis.crypto.subtle.importKey("raw", strictBuffer(raw), "HKDF", false, ["deriveKey"]);
  const info = TEXT_ENCODER.encode(`qxchat:e2ee:v2:${roomId}:${counter}`);
  return globalThis.crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: strictBuffer(salt), info: strictBuffer(info) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedEnvelope(value: any) {
  return Boolean(
    value
    && typeof value === "object"
    && Number(value.v) === E2EE_ENVELOPE_VERSION
    && String(value.alg || "") === E2EE_ALGORITHM
    && typeof value.iv === "string"
    && typeof value.salt === "string"
    && Number.isSafeInteger(Number(value.n))
    && typeof value.ciphertext === "string"
    && typeof value.senderDeviceId === "string"
    && value.senderSigningKey
    && typeof value.signature === "string"
  );
}

export async function encryptRoomPayload(
  roomKey: string,
  roomId: string,
  payload: unknown,
  counter: number,
  signer: { deviceId: string; publicKey: JsonWebKey; privateKey: JsonWebKey }
) {
  const normalizedRoomId = String(roomId || "");
  if (!Number.isSafeInteger(counter) || counter <= 0) throw new Error("Invalid message counter.");
  if (!signer?.deviceId || !signer.publicKey || !signer.privateKey) throw new Error("Missing device signing key.");
  const n = counter;
  const salt = new Uint8Array(MESSAGE_SALT_BYTES);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);
  const key = await deriveMessageKey(roomKey, normalizedRoomId, salt, n);
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(payload));
  const aad = TEXT_ENCODER.encode(`${normalizedRoomId}:${n}:${encodeBase64Url(salt)}:${signer.deviceId}`);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: strictBuffer(iv), additionalData: strictBuffer(aad) },
    key,
    strictBuffer(plaintext)
  );
  const envelope: any = {
    v: E2EE_ENVELOPE_VERSION,
    alg: E2EE_ALGORITHM,
    n,
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    roomId: normalizedRoomId,
    senderDeviceId: signer.deviceId,
    senderSigningKey: signer.publicKey
  };
  const privateKey = await importDevicePrivateKey(signer.privateKey);
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    strictBuffer(signingPayload(envelope))
  );
  envelope.signature = encodeBase64Url(new Uint8Array(signature));
  return envelope;
}

export async function decryptRoomPayload(roomKey: string, roomId: string, envelope: any, trustedSigningKey?: JsonWebKey | null) {
  if (!isEncryptedEnvelope(envelope)) throw new Error("Invalid encrypted payload.");
  if (trustedSigningKey && canonicalDeviceSigningKey(envelope.senderSigningKey) !== canonicalDeviceSigningKey(trustedSigningKey)) {
    throw new Error("Encrypted payload sender key mismatch.");
  }
  const publicKey = await importDevicePublicKey(envelope.senderSigningKey);
  const validSignature = await globalThis.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    strictBuffer(decodeBase64Url(envelope.signature)),
    strictBuffer(signingPayload(envelope))
  );
  if (!validSignature) throw new Error("Invalid encrypted payload signature.");
  const normalizedRoomId = String(roomId || "");
  const n = Number(envelope.n);
  const salt = decodeBase64Url(envelope.salt);
  const iv = decodeBase64Url(envelope.iv);
  const ciphertext = decodeBase64Url(envelope.ciphertext);
  const key = await deriveMessageKey(roomKey, normalizedRoomId, salt, n);
  const aad = TEXT_ENCODER.encode(`${normalizedRoomId}:${n}:${encodeBase64Url(salt)}:${envelope.senderDeviceId}`);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: strictBuffer(iv), additionalData: strictBuffer(aad) },
    key,
    strictBuffer(ciphertext)
  );
  return JSON.parse(TEXT_DECODER.decode(plaintext));
}
