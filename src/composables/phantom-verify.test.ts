// Regression: importing any 12 words used to show a bogus "signed" state.
// verifyRecoveryWords must cryptographically prove the words belong to the
// account by trial-decrypting the server-hosted roster blob.
// Run: bun test src/composables/phantom-verify.test.ts
import "../test-shim";
import { describe, expect, test } from "bun:test";
import { reactive } from "vue";
import { newTestStorage, runWithStorage } from "../test-shim";
import { hkdfSha256 } from "../crypto/phantom";
import { usePhantom, type PhantomMessengerCtx } from "./usePhantom";

const WORDS_A = [
  "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
  "abandon", "abandon", "abandon", "abandon", "abandon", "about",
];
const WORDS_B = [
  "legal", "winner", "thank", "year", "wave", "sausage",
  "worth", "useful", "legal", "winner", "thank", "yellow",
];

const te = new TextEncoder();

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// Mirror of the phantom KDF (PBKDF2 + hkdf "qxp-master" + hkdf
// "qxphantom:roster") so the test encrypts blobs exactly like syncRoster.
async function rosterKeyForWords(words: string[]): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw", te.encode(words.join(" ")) as BufferSource, "PBKDF2", false, ["deriveBits"],
  );
  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: te.encode("qxphantom:master") as BufferSource, iterations: 100_000 },
      material, 256,
    ),
  );
  const master = await hkdfSha256(seed, new Uint8Array(0), "qxp-master", 32);
  const bytes = await hkdfSha256(master, new Uint8Array(0), "qxphantom:roster", 32);
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function makeBlob(words: string[]): Promise<string> {
  const key = await rosterKeyForWords(words);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, te.encode("{}") as BufferSource),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64(out);
}

function makePhantom(apiRequest: (path: string) => Promise<Record<string, unknown>>) {
  const state = reactive({
    userId: "user-a",
    username: "alice",
    recoveryWords: [...WORDS_A],
    roomKeysByRoom: {} as Record<string, string>,
    connected: true,
    identified: true,
  });
  const ctx: PhantomMessengerCtx = {
    state: state as unknown as Record<string, unknown>,
    apiRequest: apiRequest as PhantomMessengerCtx["apiRequest"],
    send: () => {},
    roomKeyFor: () => "",
    ensureRoomKey: () => "",
    importRoomKey: () => "",
    hasRoomKey: () => false,
    generateRoomAccessToken: () => ({ roomId: "room-x", roomKey: "k", token: "t" }),
    requestJoin: () => {},
    setLocalRoomTitle: () => {},
    registerFriendRoom: () => {},
    unregisterFriendRoom: () => {},
    mutualRoomsWith: () => [],
    persistAccountSnapshot: () => {},
  };
  return usePhantom(ctx);
}

describe("verifyRecoveryWords", () => {
  test("accepts the words that encrypted the roster blob", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const blob = await makeBlob(WORDS_A);
      const phantom = makePhantom(async () => ({ blob }));
      expect(await phantom.verifyRecoveryWords(WORDS_A)).toBe("ok");
    });
  });

  test("rejects unrelated 12 words when a blob exists", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const blob = await makeBlob(WORDS_A);
      const phantom = makePhantom(async () => ({ blob }));
      expect(await phantom.verifyRecoveryWords(WORDS_B)).toBe("mismatch");
    });
  });

  test("rejects truncated phrases", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const blob = await makeBlob(WORDS_A);
      const phantom = makePhantom(async () => ({ blob }));
      expect(await phantom.verifyRecoveryWords(["only", "three"])).toBe("mismatch");
    });
  });

  test("rejects a corrupt blob instead of throwing", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const phantom = makePhantom(async () => ({ blob: "!!!not-base64!!!" }));
      expect(await phantom.verifyRecoveryWords(WORDS_A)).toBe("mismatch");
    });
  });

  test("reports unverifiable with no stored blob (fresh account)", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const phantom = makePhantom(async () => ({}));
      expect(await phantom.verifyRecoveryWords(WORDS_A)).toBe("unverifiable");
      expect(await phantom.verifyRecoveryWords(WORDS_B)).toBe("unverifiable");
    });
  });

  test("reports unverifiable when the server is unreachable", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const phantom = makePhantom(async () => {
        throw new Error("offline");
      });
      expect(await phantom.verifyRecoveryWords(WORDS_A)).toBe("unverifiable");
    });
  });
});
