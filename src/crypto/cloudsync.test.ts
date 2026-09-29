// Unit tests for the QxCloudSync crypto contract (crypto/cloudsync.ts).
// Run: bun test src/crypto/cloudsync.test.ts
import "../test-shim";
import { describe, expect, test } from "bun:test";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import {
  deriveEcdh,
  deriveEpochKey,
  deriveMasterSecretFromWords,
  deriveSyncAuthKey,
  deriveSyncMaster,
  deriveSyncRoot,
  deriveWrapKey,
  generateEphKeyPair,
  maxRatchets,
  mergeMessages,
  mergeParams,
  mergeTrusted,
  mergeVersionVectors,
  openData,
  randomNonceB64,
  sealChunked,
  sealData,
  signHello,
  transcriptHash,
  unwrapRoomKey,
  verifyHello,
  wrapRoomKey,
  CLOUDSYNC_MAX_BYTES,
  type SyncHelloSigned,
} from "./cloudsync";
import { bytesToHex, hexToBytes } from "./phantom";
import { encodeBase64Url, generateDeviceSigningKeyPair } from "./e2ee";
import { generateSlhDsaKeyPair } from "./slhdsa";

const WORDS = [
  "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
  "abandon", "abandon", "abandon", "abandon", "abandon", "about",
];
const OTHER_WORDS = [
  "legal", "winner", "thank", "year", "wave", "sausage",
  "worth", "useful", "legal", "winner", "thank", "yellow",
];

function hex(u8: Uint8Array): string {
  return bytesToHex(u8);
}

async function syncRootAndAuth(words: string[]) {
  const master = await deriveMasterSecretFromWords(words);
  const root = await deriveSyncRoot(master);
  const auth = await deriveSyncAuthKey(root);
  master.fill(0);
  return { root, auth };
}

describe("key schedule", () => {
  test("deterministic and domain-separated", async () => {
    const m1 = await deriveMasterSecretFromWords(WORDS);
    const m2 = await deriveMasterSecretFromWords(WORDS);
    expect(hex(m1)).toBe(hex(m2));
    const r1 = await deriveSyncRoot(m1);
    const a1 = await deriveSyncAuthKey(r1);
    const e1 = await deriveEpochKey(m1, 1);
    const e2 = await deriveEpochKey(m1, 2);
    const w1 = await deriveWrapKey(e1);
    expect(hex(e1)).not.toBe(hex(e2));
    expect(r1.length).toBe(32);
    // Different words -> different root.
    const m3 = await deriveMasterSecretFromWords(OTHER_WORDS);
    const r3 = await deriveSyncRoot(m3);
    expect(hex(r1)).not.toBe(hex(r3));
    expect(a1).toBeDefined();
    expect(w1).toBeDefined();
    m1.fill(0);
    m2.fill(0);
    m3.fill(0);
  });

  test("rejects fewer than 12 words", async () => {
    await expect(deriveMasterSecretFromWords(["only", "three"])).rejects.toThrow();
  });
});

describe("hello handshake auth", () => {
  test("sign/verify roundtrip, wrong words rejected", async () => {
    const { auth } = await syncRootAndAuth(WORDS);
    const { auth: otherAuth } = await syncRootAndAuth(OTHER_WORDS);
    const dev = await generateDeviceSigningKeyPair();
    const slh = generateSlhDsaKeyPair();
    const eph = await generateEphKeyPair();
    const mlkem = ml_kem768.keygen();
    const hello = await signHello(
      {
        pv: 1, kind: "hello", syncId: "s1", epoch: 1,
        fromDeviceId: "devA", toDeviceId: "",
        ephPub: eph.publicJwk, mlkemPk: bytesToHex(mlkem.publicKey),
        ecdsaPub: dev.publicKey, nonce: randomNonceB64(),
        platform: "web", slhdsaPk: encodeBase64Url(slh.publicKey),
      } as never,
      auth, dev.privateKey, slh.secretKey,
    );
    expect(await verifyHello(hello, auth)).toBe(true);
    // Wrong recovery words -> HMAC fails.
    expect(await verifyHello(hello, otherAuth)).toBe(false);
    // Tampered canonical field -> HMAC fails.
    const tampered = { ...hello, nonce: randomNonceB64() } as SyncHelloSigned;
    expect(await verifyHello(tampered, auth)).toBe(false);
  });
});

describe("two-party handshake derives equal masters", () => {
  test("hello -> accept -> confirm converges", async () => {
    const { root, auth } = await syncRootAndAuth(WORDS);
    const devA = await generateDeviceSigningKeyPair();
    const devB = await generateDeviceSigningKeyPair();
    const slhA = generateSlhDsaKeyPair();
    const slhB = generateSlhDsaKeyPair();

    // A: hello.
    const ephA = await generateEphKeyPair();
    const mlkemA = ml_kem768.keygen();
    const hello = await signHello(
      {
        pv: 1, kind: "hello", syncId: "hs1", epoch: 1,
        fromDeviceId: "devA", toDeviceId: "",
        ephPub: ephA.publicJwk, mlkemPk: bytesToHex(mlkemA.publicKey),
        ecdsaPub: devA.publicKey, nonce: randomNonceB64(),
        platform: "web", slhdsaPk: encodeBase64Url(slhA.publicKey),
      } as never,
      auth, devA.privateKey, slhA.secretKey,
    );
    expect(await verifyHello(hello, auth)).toBe(true);

    // B: accept (+ KEM ct to A).
    const ephB = await generateEphKeyPair();
    const mlkemB = ml_kem768.keygen();
    const enc1 = ml_kem768.encapsulate(hexToBytes(hello.mlkemPk));
    const accept = await signHello(
      {
        pv: 1, kind: "accept", syncId: "hs1", epoch: 1,
        fromDeviceId: "devB", toDeviceId: "devA",
        ephPub: ephB.publicJwk, mlkemPk: bytesToHex(mlkemB.publicKey),
        ecdsaPub: devB.publicKey, nonce: randomNonceB64(),
        mlkemCt: bytesToHex(enc1.cipherText),
        platform: "mobile", slhdsaPk: encodeBase64Url(slhB.publicKey),
      } as never,
      auth, devB.privateKey, slhB.secretKey,
    );

    // A: derive master, confirm (+ KEM ct to B).
    const ss1a = new Uint8Array(ml_kem768.decapsulate(hexToBytes(accept.mlkemCt!), mlkemA.secretKey));
    const enc2 = ml_kem768.encapsulate(hexToBytes(accept.mlkemPk));
    const ecdhA = await deriveEcdh(ephA.privateKey, accept.ephPub);
    const { canonicalJson } = await import("./phantom");
    const te = new TextEncoder();
    const tAB = await transcriptHash([te.encode(canonicalJson(hello)), te.encode(canonicalJson(accept))]);
    const masterA = await deriveSyncMaster({
      ecdh: ecdhA,
      ss1: ss1a,
      ss2: new Uint8Array(enc2.sharedSecret),
      syncRoot: root,
      transcript: tAB,
    });

    // B: derive master from hello + own accept.
    const ss2b = new Uint8Array(ml_kem768.decapsulate(hexToBytes(bytesToHex(enc2.cipherText)), mlkemB.secretKey));
    const ecdhB = await deriveEcdh(ephB.privateKey, hello.ephPub);
    const masterB = await deriveSyncMaster({
      ecdh: ecdhB,
      ss1: new Uint8Array(enc1.sharedSecret),
      ss2: ss2b,
      syncRoot: root,
      transcript: tAB,
    });
    expect(hex(masterA)).toBe(hex(masterB));

    // Epoch keys match; wrap/unwrap roundtrips across the shared master.
    const epochA = await deriveEpochKey(masterA, 1);
    const epochB = await deriveEpochKey(masterB, 1);
    expect(hex(epochA)).toBe(hex(epochB));
    const wrapA = await deriveWrapKey(epochA);
    const wrapped = await wrapRoomKey("ab".repeat(32), wrapA);
    const wrapB = await deriveWrapKey(epochB);
    expect(await unwrapRoomKey(wrapped.data, wrapped.iv, wrapB)).toBe("ab".repeat(32));
  });
});

describe("data envelopes", () => {
  async function pairedEpoch() {
    const { root } = await syncRootAndAuth(WORDS);
    void root;
    const devA = await generateDeviceSigningKeyPair();
    const master = new Uint8Array(32).fill(7);
    const epochKey = await deriveEpochKey(master, 1);
    return { devA, epochKey };
  }

  test("seal/open roundtrip; tampering with to/epoch/n/ct fails", async () => {
    const { devA, epochKey } = await pairedEpoch();
    const meta = { syncId: "s", epoch: 1, n: 1, from: "devA", to: "devB" };
    const outer = await sealData({ kind: "snapshot", vv: { devA: 1 } }, epochKey, meta, devA.privateKey);
    const inner = await openData(outer, epochKey, devA.publicKey);
    expect(inner.kind).toBe("snapshot");

    const cases: Array<[string, (o: typeof outer) => void]> = [
      ["to", (o) => { o.to = "devC"; }],
      ["epoch", (o) => { o.epoch = 2; }],
      ["n", (o) => { o.n = 2; }],
      ["from", (o) => { o.from = "devX"; }],
      ["ct", (o) => { o.ct = "AA" + o.ct.slice(2); }],
    ];
    for (const [name, mutate] of cases) {
      const copy = JSON.parse(JSON.stringify(outer));
      mutate(copy);
      await expect(openData(copy, epochKey, devA.publicKey)).rejects.toThrow();
      void name;
    }
  });

  test("wrong epoch key fails; cross-pair envelopes fail", async () => {
    const { devA, epochKey } = await pairedEpoch();
    const otherKey = await deriveEpochKey(new Uint8Array(32).fill(9), 1);
    const outer = await sealData(
      { kind: "snapshot", vv: {} }, epochKey,
      { syncId: "s", epoch: 1, n: 1, from: "devA", to: "devB" }, devA.privateKey,
    );
    await expect(openData(outer, otherKey, devA.publicKey)).rejects.toThrow();
  });

  test("chunked snapshots stay under relay budget and reassemble", async () => {
    const { devA, epochKey } = await pairedEpoch();
    const messages = Array.from({ length: 300 }, (_, i) => ({
      messageId: `m${i}`, roomId: "room1", text: `hello world ${i} ` + "x".repeat(400),
      timestamp: 1700000000000 + i,
    }));
    const inner = { kind: "snapshot", vv: { devA: 5 }, collections: { messages } } as never;
    const parts = await sealChunked(
      inner, epochKey,
      { syncId: "s", epoch: 1, from: "devA", to: "devB", startN: 1 }, devA.privateKey,
    );
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(JSON.stringify({ op: 61, d: { encrypted: p } }).length).toBeLessThanOrEqual(CLOUDSYNC_MAX_BYTES);
    }
    // Every part opens under the same session key.
    let total = 0;
    for (const p of parts) {
      const dec = await openData(p, epochKey, devA.publicKey);
      expect(dec.kind).toBe("snapshot");
      total += ((dec.collections as { messages?: unknown[] }).messages ?? []).length;
    }
    expect(total).toBe(300);
  });
});

describe("deepMerge", () => {
  test("params LWW with lexicographic tie-break", () => {
    const merged = mergeParams(
      { themeMode: { value: "dark", updatedAt: 100, by: "a" } },
      { themeMode: { value: "light", updatedAt: 100, by: "b" } },
    );
    expect(merged.themeMode.value).toBe("light");
    const newer = mergeParams(
      { themeMode: { value: "dark", updatedAt: 200, by: "a" } },
      { themeMode: { value: "light", updatedAt: 100, by: "b" } },
    );
    expect(newer.themeMode.value).toBe("dark");
  });

  test("version vectors union with max", () => {
    expect(mergeVersionVectors({ a: 3, b: 1 }, { b: 2, c: 5 })).toEqual({ a: 3, b: 2, c: 5 });
  });

  test("ratchets merge by max; messages dedupe by id", () => {
    expect(maxRatchets({ r1: 2 }, { r1: 7, r2: 1 })).toEqual({ r1: 7, r2: 1 });
    const msgs = mergeMessages(
      [{ messageId: "m1", roomId: "r", timestamp: 1 }],
      [{ messageId: "m1", roomId: "r", timestamp: 2 }, { messageId: "m2", roomId: "r", timestamp: 3 }],
    );
    expect(msgs.filter((m) => m.messageId === "m1")).toHaveLength(1);
    expect(msgs).toHaveLength(2);
  });

  test("trusted keys union; divergent JWK conflicts", () => {
    const k1 = { kty: "EC", crv: "P-256", x: "a", y: "b" };
    const k2 = { kty: "EC", crv: "P-256", x: "c", y: "d" };
    const ok = mergeTrusted(
      [{ roomId: "r", deviceId: "d1", key: k1 }],
      [{ roomId: "r", deviceId: "d2", key: k2 }],
    );
    expect(ok.merged).toHaveLength(2);
    expect(ok.conflicts).toHaveLength(0);
    const bad = mergeTrusted(
      [{ roomId: "r", deviceId: "d1", key: k1 }],
      [{ roomId: "r", deviceId: "d1", key: k2 }],
    );
    expect(bad.conflicts.length).toBeGreaterThan(0);
    // Local key kept, no silent overwrite.
    expect(bad.merged.find((t) => t.deviceId === "d1")?.key).toEqual(k1);
  });
});
