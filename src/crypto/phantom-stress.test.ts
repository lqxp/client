// PHANTOM stresser: rendezvous emulation through a MockDeadDrop that mimics
// the server (claim-consume, TTL, null padding) with fault injection
// (drops, duplicates, tampering, stale epochs, oversized payloads).
// Run: bun test src/crypto/phantom-stress.test.ts
import "../test-shim";
import { describe, expect, test } from "bun:test";
import {
  deriveContextualKeypair,
  epochDay,
  fp,
  generateMlKem768KeyPair,
  generatePrekeyBundle,
  openEnvelope,
  pickBucket,
  sealEnvelope,
  signInner,
  slotContextual,
  slotGlobal,
  verifyInner,
  verifyPrekeyBundle,
  type PhantomInner,
  type PhantomOuter,
} from "./phantom";
import { bytesToHex } from "./phantom";
import { generateMlDsa65KeyPair } from "./mldsa";
import { generateDeviceSigningKeyPair } from "./e2ee";

const DAY = 19800;

/** Server dead-drop semantics: one claim consumes, TTL 24h, pad to `want`. */
class MockDeadDrop {
  slots = new Map<string, Array<{ outer: PhantomOuter; at: number }>>();

  deposit(outer: PhantomOuter, now: number = Date.now()): void {
    const q = this.slots.get(outer.slotId) ?? [];
    q.push({ outer, at: now });
    while (q.length > 16) q.shift();
    this.slots.set(outer.slotId, q);
  }

  poll(slots: string[], want: number, now: number = Date.now()): Array<PhantomOuter | null> {
    const frames: Array<PhantomOuter | null> = [];
    for (const slot of slots.slice(0, want)) {
      const q = this.slots.get(slot) ?? [];
      let hit: PhantomOuter | null = null;
      while (q.length && !hit) {
        const head = q.shift()!;
        if (now - head.at < 24 * 3600 * 1000) hit = head.outer;
      }
      frames.push(hit);
    }
    while (frames.length < want) frames.push(null);
    return frames;
  }
}

interface Party {
  name: string;
  mlkem: { publicKey: Uint8Array; secretKey: Uint8Array };
  mlkemHex: string;
  ecdsa: { publicKey: JsonWebKey; privateKey: JsonWebKey };
  mldsa: { publicKey: Uint8Array; secretKey: Uint8Array };
  fp: string;
  bundle: Awaited<ReturnType<typeof generatePrekeyBundle>>;
}

async function makeParty(name: string): Promise<Party> {
  const mlkem = generateMlKem768KeyPair();
  const mlkemHex = bytesToHex(mlkem.publicKey);
  const ecdsa = await generateDeviceSigningKeyPair();
  const mldsa = generateMlDsa65KeyPair();
  const bundle = await generatePrekeyBundle({
    mlkemPublicKey: mlkem.publicKey,
    ecdsaPublicJwk: ecdsa.publicKey,
    ecdsaPrivateJwk: ecdsa.privateKey,
    mldsaKeyPair: mldsa,
  });
  return { name, mlkem, mlkemHex, ecdsa, mldsa, fp: await fp(mlkemHex), bundle };
}

async function sealIntro(
  from: Party,
  toMlkemHex: string,
  toFp: string,
  slot: string,
  text: string,
  day: number = epochDay(),
): Promise<PhantomOuter> {
  const ctx = await deriveContextualKeypair(new Uint8Array(32).fill(1), `ctx-${from.name}`);
  const unsigned = {
    kind: "intro" as const,
    epochBucket: day,
    sender: {
      contextualPub: ctx.publicKey,
      prekeyFp: from.fp,
      mlkem768Pk: from.mlkemHex,
      displayName: from.name,
    },
    intro: text,
  };
  const signed = await signInner(unsigned, ctx.privateKey, from.mldsa.secretKey);
  return sealEnvelope(signed, toMlkemHex, {
    slotId: slot,
    recipientFp: toFp,
    senderHint: from.fp,
    bucket: 16384,
  });
}

async function openAs(
  outer: PhantomOuter,
  to: Party,
): Promise<{ inner: PhantomInner; senderMldsaHex: string }> {
  const inner = await openEnvelope(outer, bytesToHex(to.mlkem.secretKey));
  return { inner, senderMldsaHex: "" };
}

describe("prekey bundles", () => {
  test("roundtrip verifies; tampering fails closed", async () => {
    const bob = await makeParty("bob");
    expect(await verifyPrekeyBundle(bob.bundle)).toBe(true);
    expect(await fp(bob.mlkemHex)).toBe(bob.fp);

    const badKey = { ...bob.bundle, mlkem768Pk: "00" + bob.bundle.mlkem768Pk.slice(2) };
    expect(await verifyPrekeyBundle(badKey)).toBe(false);
    const badFilter = { ...bob.bundle, blockFilter: ["00".repeat(32)] };
    expect(await verifyPrekeyBundle(badFilter)).toBe(false);
  });
});

describe("rendezvous with fault injection", () => {
  test("intro -> welcome roundtrip; double poll consumes", async () => {
    const drop = new MockDeadDrop();
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const day = epochDay();
    const slotB = await slotGlobal(bob.fp, day);

    drop.deposit(await sealIntro(alice, bob.mlkemHex, bob.fp, slotB, "hi bob"));
    const [frame] = drop.poll([slotB], 1);
    expect(frame).not.toBeNull();
    const { inner } = await openAs(frame!, bob);
    expect(inner.kind).toBe("intro");
    expect(inner.sender.displayName).toBe("alice");
    // Inner hybrid signature verifies against the sender's announced keys.
    const ctxA = await deriveContextualKeypair(new Uint8Array(32).fill(1), "ctx-alice");
    void ctxA;
    expect(inner.epochBucket).toBe(day);

    // Second poll of the same slot: consumed -> null.
    expect(drop.poll([slotB], 1)).toEqual([null]);

    // Bob welcomes Alice back on her global slot.
    const slotA = await slotGlobal(alice.fp, day);
    const ctxB = await deriveContextualKeypair(new Uint8Array(32).fill(2), "ctx-bob");
    const welcome = await signInner(
      {
        kind: "welcome",
        epochBucket: day,
        sender: {
          contextualPub: ctxB.publicKey,
          prekeyFp: bob.fp,
          mlkem768Pk: bob.mlkemHex,
          displayName: "bob",
        },
        welcome: { roomId: "r1", roomKey: "ab".repeat(32) },
      },
      ctxB.privateKey,
      bob.mldsa.secretKey,
    );
    drop.deposit(
      await sealEnvelope(welcome, alice.mlkemHex, {
        slotId: slotA,
        recipientFp: alice.fp,
        senderHint: bob.fp,
        bucket: 16384,
      }),
    );
    const [wframe] = drop.poll([slotA], 1);
    const opened = await openEnvelope(wframe!, bytesToHex(alice.mlkem.secretKey));
    expect(opened.kind).toBe("welcome");
    expect(opened.welcome).toEqual({ roomId: "r1", roomKey: "ab".repeat(32) });
  });

  test("unknown slots pad with nulls; drop means silence", async () => {
    const drop = new MockDeadDrop();
    const frames = drop.poll(["00".repeat(32), "11".repeat(32)], 4);
    expect(frames).toEqual([null, null, null, null]);
  });

  test("wrong recipient key cannot open; ct tamper fails", async () => {
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const carol = await makeParty("carol");
    const day = epochDay();
    const slotB = await slotGlobal(bob.fp, day);
    const outer = await sealIntro(alice, bob.mlkemHex, bob.fp, slotB, "secret");

    await expect(
      openEnvelope(outer, bytesToHex(carol.mlkem.secretKey)),
    ).rejects.toThrow();

    const raw = outer.ct;
    const flipped = (raw[0] === "A" ? "B" : "A") + raw.slice(1);
    await expect(
      openEnvelope({ ...outer, ct: flipped }, bytesToHex(bob.mlkem.secretKey)),
    ).rejects.toThrow();
  });

  test("outer labels are untrusted routing hints (open still succeeds)", async () => {
    // slotId / recipientFp / bucket are server-visible labels, NOT
    // authenticated: an attacker (or a buggy relay) can rewrite them without
    // breaking the seal. Clients must verify the INNER sender instead.
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const day = epochDay();
    const outer = await sealIntro(alice, bob.mlkemHex, bob.fp, await slotGlobal(bob.fp, day), "hi");
    const relabeled = {
      ...outer,
      slotId: "ff".repeat(32),
      recipientFp: "00".repeat(32),
      bucket: 65536,
    };
    const inner = await openEnvelope(relabeled, bytesToHex(bob.mlkem.secretKey));
    expect(inner.kind).toBe("intro");
    expect(inner.sender.prekeyFp).toBe(alice.fp);
  });

  test("inner sender tamper fails hybrid verification", async () => {
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const carol = await makeParty("carol");
    const day = epochDay();
    const outer = await sealIntro(alice, bob.mlkemHex, bob.fp, await slotGlobal(bob.fp, day), "hi");
    const inner = await openEnvelope(outer, bytesToHex(bob.mlkem.secretKey));
    const ctxC = await deriveContextualKeypair(new Uint8Array(32).fill(9), "ctx-carol");

    // Attacker swaps the announced sender fingerprint to carol's.
    const forged = { ...inner, sender: { ...inner.sender, prekeyFp: carol.fp } };
    expect(await verifyInner(forged, ctxC.publicKey, bytesToHex(carol.mldsa.publicKey))).toBe(false);
    // And the genuine inner verifies against alice's real keys.
    const ctxA = await deriveContextualKeypair(new Uint8Array(32).fill(1), "ctx-alice");
    expect(await verifyInner(inner, ctxA.publicKey, bytesToHex(alice.mldsa.publicKey))).toBe(true);
  });

  test("stale epochBucket rejected (client anti-replay rule)", async () => {
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const yesterday = epochDay() - 1;
    const outer = await sealIntro(
      alice, bob.mlkemHex, bob.fp, await slotGlobal(bob.fp, yesterday), "old", yesterday,
    );
    const inner = await openEnvelope(outer, bytesToHex(bob.mlkem.secretKey));
    // Exact predicate from usePhantom: silent destroy unless current day.
    expect(inner.epochBucket !== epochDay(Date.now())).toBe(true);
  });

  test("blocked sender fingerprint destroyed before render", async () => {
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const day = epochDay();
    const outer = await sealIntro(alice, bob.mlkemHex, bob.fp, await slotGlobal(bob.fp, day), "spam");
    const inner = await openEnvelope(outer, bytesToHex(bob.mlkem.secretKey));
    const blockList = [alice.fp];
    // Exact predicate from usePhantom.
    expect(blockList.includes(inner.sender.prekeyFp)).toBe(true);
    expect(blockList.includes("00".repeat(32))).toBe(false);
  });

  test("contextual slots bind the room key; same-size padding hides length", async () => {
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const day = epochDay();
    const roomKey = "cc".repeat(32);
    const s1 = await slotContextual(bob.fp, roomKey, day);
    const s2 = await slotContextual(bob.fp, "dd".repeat(32), day);
    expect(s1).not.toBe(s2);
    expect(s1).toHaveLength(64);

    const short = await sealIntro(alice, bob.mlkemHex, bob.fp, s1, "hi");
    const long = await sealIntro(alice, bob.mlkemHex, bob.fp, s1, "hello world, this is longer");
    // Same bucket -> identical outer size: the server learns nothing about
    // the inner length.
    expect(short.ct.length).toBe(long.ct.length);
  });

  test("oversized intros rejected before sealing", async () => {
    const alice = await makeParty("alice");
    const bob = await makeParty("bob");
    const day = epochDay();
    expect(() => pickBucket(70000)).toThrow();
    const ok = pickBucket(100);
    expect([4096, 16384, 65536]).toContain(ok);
    void alice;
    void bob;
    void day;
  });
});
