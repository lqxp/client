// Regression: switching accounts must not leak the previous account's friend
// list (or prekey) into the new account, and roster loads must replace rather
// than merge. Run: bun test src/composables/phantom-account-switch.test.ts
import "../test-shim";
import { describe, expect, test } from "bun:test";
import { nextTick, reactive } from "vue";
import { newTestStorage, runWithStorage } from "../test-shim";
import { hkdfSha256 } from "../crypto/phantom";
import { usePhantom, type PhantomIncoming, type PhantomMessengerCtx } from "./usePhantom";

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

function fakeIncoming(id: string, prekeyFp: string): PhantomIncoming {
  return {
    id,
    sender: {
      contextualPub: {} as JsonWebKey,
      prekeyFp,
      displayName: `sender-${prekeyFp}`,
      mlkem768Pk: "00",
    },
  } as unknown as PhantomIncoming;
}

function makeCtx(blobByPath?: (path: string) => Record<string, unknown>) {
  const state = reactive({
    userId: "user-a",
    username: "alice",
    recoveryWords: [...WORDS_A],
    roomKeysByRoom: {} as Record<string, string>,
    connected: true,
    identified: true,
  });
  const registered: Array<{ roomId: string; name?: string }> = [];
  const unregistered: string[] = [];
  const snapshotCalls = { count: 0 };
  const ctx: PhantomMessengerCtx = {
    state: state as unknown as Record<string, unknown>,
    apiRequest: async (path: string) => (blobByPath ? blobByPath(path) : {}),
    send: () => {},
    roomKeyFor: () => "",
    ensureRoomKey: () => "",
    importRoomKey: () => "",
    hasRoomKey: () => false,
    generateRoomAccessToken: () => ({ roomId: "room-x", roomKey: "k", token: "t" }),
    requestJoin: () => {},
    setLocalRoomTitle: () => {},
    registerFriendRoom: (roomId: string, name?: string) => {
      registered.push({ roomId, name });
    },
    unregisterFriendRoom: (roomId: string) => {
      unregistered.push(roomId);
    },
    mutualRoomsWith: () => [],
    persistAccountSnapshot: () => {
      snapshotCalls.count += 1;
    },
  };
  return { state, ctx, registered, unregistered, snapshotCalls };
}

function fakePrekey(): Record<string, unknown> {
  return {
    mlkemPublicKeyHex: "ab".repeat(1200),
    mlkemSecretKeyHex: "cd".repeat(2500),
    mldsaSecretKeyHex: "ef".repeat(4100),
    ecdsaPublicJwk: {},
    ecdsaPrivateJwk: {},
    bundle: { mlkem768Pk: "ab".repeat(1200) },
  };
}

async function rosterBlob(words: string[], roster: unknown): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    te.encode(words.join(" ")) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const seed = new Uint8Array(
    await crypto.subtle.deriveBits(
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
  const master = await hkdfSha256(seed, new Uint8Array(0), "qxp-master", 32);
  const keyBytes = await hkdfSha256(master, new Uint8Array(0), "qxphantom:roster", 32);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      te.encode(JSON.stringify(roster)) as BufferSource,
    ),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return b64(out);
}

describe("phantom account isolation", () => {
  test("switching userId clears friends, pendings and prekey", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const { state, ctx } = makeCtx();
      const phantom = usePhantom(ctx);
      phantom.state.friendsByUser["bob"] = {
        peerFp: "fp-bob",
        peerDisplayName: "bob",
        roomId: "room-bob",
        state: "friends",
      };
      phantom.state.pendingIncoming.push(fakeIncoming("in-1", "fp-x"));
      phantom.state.pendingOutgoing.push(fakeIncoming("out-1", "fp-y"));
      phantom.state.prekey = { bundle: null } as unknown as typeof phantom.state.prekey;
      phantom.state.ready = true;

      state.userId = "user-b";
      state.recoveryWords = [...WORDS_B];
      state.username = "bruno";
      await nextTick();
      await nextTick();

      expect(Object.keys(phantom.state.friendsByUser)).toEqual([]);
      expect(phantom.state.pendingIncoming).toHaveLength(0);
      expect(phantom.state.pendingOutgoing).toHaveLength(0);
      expect(phantom.state.prekey).toBeNull();
      expect(phantom.state.ready).toBe(false);
    });
  });

  test("logging out clears the friend list", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const { state, ctx } = makeCtx();
      const phantom = usePhantom(ctx);
      phantom.state.friendsByUser["bob"] = {
        peerFp: "fp-bob",
        peerDisplayName: "bob",
        roomId: "room-bob",
        state: "friends",
      };

      state.userId = "";
      state.recoveryWords = [];
      await nextTick();
      await nextTick();

      expect(Object.keys(phantom.state.friendsByUser)).toEqual([]);
    });
  });

  test("loadRoster replaces stale entries instead of merging", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const blob = await rosterBlob(WORDS_B, {
        friends: [
          {
            peerFp: "fp-carol",
            peerDisplayName: "carol",
            roomId: "room-carol",
            state: "friends",
          },
        ],
        pendingOut: [],
        blocks: [],
        settings: {},
      });
      const { state, ctx, registered, unregistered } = makeCtx((path) =>
        path === "/api/social/blob" ? { blob } : {},
      );
      state.userId = "user-b";
      state.recoveryWords = [...WORDS_B];
      const phantom = usePhantom(ctx);
      // Leftover from the previous account (or removed on another device).
      phantom.state.friendsByUser["stale"] = {
        peerFp: "fp-stale",
        peerDisplayName: "stale",
        roomId: "room-stale",
        state: "friends",
      };

      await phantom.loadRoster();

      expect(Object.keys(phantom.state.friendsByUser).sort()).toEqual(["carol"]);
      expect(unregistered).toContain("room-stale");
      expect(registered.map((r) => r.roomId)).toContain("room-carol");
    });
  });
});

describe("phantom snapshot storage", () => {
  test("ensurePrekey adopts the snapshot prekey without generating", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const { ctx } = makeCtx();
      (ctx.state as Record<string, unknown>).phantomPrekey = fakePrekey();
      const phantom = usePhantom(ctx);
      const prekey = await phantom.ensurePrekey();
      expect(prekey).not.toBeNull();
      expect(phantom.state.prekey?.mlkemPublicKeyHex).toBe("ab".repeat(1200));
      expect(phantom.state.ready).toBe(true);
    });
  });

  test("legacy standalone prekey migrates into the snapshot, old keys deleted", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const { ctx, snapshotCalls } = makeCtx();
      localStorage.setItem("qxphantom-prekey-v1", JSON.stringify(fakePrekey()));
      const phantom = usePhantom(ctx);
      const prekey = await phantom.ensurePrekey();
      expect(prekey).not.toBeNull();
      expect(phantom.state.prekey?.mlkemSecretKeyHex).toBe("cd".repeat(2500));
      const snap = (ctx.state as Record<string, unknown>).phantomPrekey as Record<string, unknown>;
      expect(snap.mlkemSecretKeyHex).toBe("cd".repeat(2500));
      expect(localStorage.getItem("qxphantom-prekey-v1")).toBeNull();
      expect(localStorage.getItem("qxphantom-prekey-v1:user-a")).toBeNull();
      expect(snapshotCalls.count).toBeGreaterThan(0);
    });
  });

  test("legacy scoped prekey migrates too", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      const { ctx } = makeCtx();
      localStorage.setItem("qxphantom-prekey-v1:user-a", JSON.stringify(fakePrekey()));
      const phantom = usePhantom(ctx);
      const prekey = await phantom.ensurePrekey();
      expect(prekey).not.toBeNull();
      expect(localStorage.getItem("qxphantom-prekey-v1:user-a")).toBeNull();
      expect(localStorage.getItem("qxphantom-prekey-v1")).toBeNull();
    });
  });

  test("legacy standalone settings migrate into the snapshot, old keys deleted", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      localStorage.setItem(
        "qxphantom-settings-v1",
        JSON.stringify({ acceptUnknown: "off", blockList: ["fp-blocked"] }),
      );
      const { ctx, snapshotCalls } = makeCtx();
      const phantom = usePhantom(ctx);
      expect(phantom.state.acceptUnknown).toBe("off");
      expect(phantom.state.blockList).toEqual(["fp-blocked"]);
      expect(localStorage.getItem("qxphantom-settings-v1")).toBeNull();
      expect(localStorage.getItem("qxphantom-settings-v1:user-a")).toBeNull();
      const snap = (ctx.state as Record<string, unknown>).phantomSettings as Record<string, unknown>;
      expect(snap.acceptUnknown).toBe("off");
      expect(snapshotCalls.count).toBeGreaterThan(0);
    });
  });

  test("snapshot settings take precedence over legacy keys", async () => {
    const store = newTestStorage();
    await runWithStorage(store, async () => {
      localStorage.setItem(
        "qxphantom-settings-v1",
        JSON.stringify({ acceptUnknown: "off", blockList: ["fp-stale"] }),
      );
      const { ctx } = makeCtx();
      (ctx.state as Record<string, unknown>).phantomSettings = {
        acceptUnknown: "filter",
        blockList: [],
        friendsCollapsed: false,
        pollIntervalSeconds: null,
        pollingEnabled: true,
      };
      const phantom = usePhantom(ctx);
      expect(phantom.state.acceptUnknown).toBe("filter");
      expect(phantom.state.blockList).toEqual([]);
    });
  });
});
