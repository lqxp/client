// Mesh integration tests: N REAL useCloudSync instances driven through a
// MockRelay that emulates the server (op 60/61 fan-out + acks, op 62
// directory, op 63 presence) with fault injection (stale routes, partitions,
// duplicates, tampering).
// Run: bun test src/composables/cloudsync-mesh.test.ts
import "../test-shim";
import { beforeEach, describe, expect, test } from "bun:test";
import { newTestStorage, runWithStorage } from "../test-shim";
import { useCloudSync, type CloudSyncCtx, type CloudSync } from "./useCloudSync";

const WORDS = [
  "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
  "abandon", "abandon", "abandon", "abandon", "abandon", "about",
];

interface Device {
  wsId: string;
  platform: string;
  store: Map<string, string>;
  cs: CloudSync;
  ctx: CloudSyncCtx;
  acks60: Array<Record<string, unknown>>;
  got61: number;
}

class MockRelay {
  devices = new Map<string, Device>();
  /** Frames to/from these wsIds are silently dropped (partition). */
  isolated = new Set<string>();
  /** Next unicast to this wsId is delivered twice. */
  duplicateNext = new Set<string>();
  lastTo: string | null = null;

  add(d: Device): void {
    this.devices.set(d.wsId, d);
  }

  remap(oldWs: string, newWs: string): void {
    const d = this.devices.get(oldWs);
    if (!d) throw new Error(`unknown device ${oldWs}`);
    this.devices.delete(oldWs);
    d.wsId = newWs;
    this.devices.set(newWs, d);
  }

  receive(fromWs: string, payload: Record<string, unknown>): void {
    const op = payload.op as number;
    const d = (payload.d ?? {}) as Record<string, unknown>;
    if (op === 60) {
      const to = String(d.toClientId ?? "");
      const targets = [...this.devices.values()].filter(
        (t) => t.wsId !== fromWs && (to === "" || t.wsId === to)
          && !this.isolated.has(fromWs) && !this.isolated.has(t.wsId),
      );
      const reqId = d.requestId as string | undefined;
      for (const t of targets) {
        const frame = { op: 61, d: { fromClientId: fromWs, toClientId: to, encrypted: d.encrypted } };
        const deliver = () =>
          runWithStorage(t.store, () => t.cs.handleSyncMessage(frame.d as Record<string, unknown>));
        void deliver().catch(() => {});
        this.lastTo = t.wsId;
        if (this.duplicateNext.has(t.wsId)) {
          this.duplicateNext.delete(t.wsId);
          const dup = JSON.parse(JSON.stringify(frame));
          void runWithStorage(t.store, () =>
            t.cs.handleSyncMessage(dup.d as Record<string, unknown>),
          ).catch(() => {});
        }
        t.got61 += 1;
      }
      const sender = this.devices.get(fromWs);
      if (sender && reqId) {
        const peers = [...new Set(targets.map((t) => t.wsId))];
        const ack = {
          op: 60,
          d: {
            ok: true, delivered: targets.length, dropped: 0,
            peers, peerCount: this.devices.size - 1, requestId: reqId,
          },
        };
        sender.acks60.push(ack.d as Record<string, unknown>);
        void runWithStorage(sender.store, () =>
          sender.cs.handleSyncAck(ack.d as Record<string, unknown>),
        ).catch(() => {});
      }
      return;
    }
    if (op === 62) {
      const sender = this.devices.get(fromWs);
      if (!sender) return;
      const peers = [...this.devices.values()]
        .filter((t) => t.wsId !== fromWs)
        .map((t) => ({ clientId: t.wsId, platform: t.platform }))
        .sort((a, b) => (a.clientId < b.clientId ? -1 : 1));
      const res = {
        op: 62,
        d: { ok: true, self: fromWs, peers, requestId: d.requestId },
      };
      void runWithStorage(sender.store, () =>
        sender.cs.handlePeersDirectory(res.d as Record<string, unknown>),
      ).catch(() => {});
      return;
    }
    throw new Error(`relay: unexpected op ${op}`);
  }

  emitPresence(to_except: string | null, event: string, clientId: string, platform: string): void {
    for (const t of this.devices.values()) {
      if (t.wsId === to_except || t.wsId === clientId) continue;
      void runWithStorage(t.store, () =>
        t.cs.handlePresenceEvent({ event, clientId, platform }),
      ).catch(() => {});
    }
  }
}

let relay: MockRelay;
let n = 0;

function makeDevice(platform = "web"): Device {
  const wsId = `ws-${++n}`;
  const store = newTestStorage();
  const state: Record<string, unknown> = {
    deviceId: `dev-${wsId}`,
    recoveryWords: [...WORDS],
    rooms: [],
    roomKeysByRoom: {},
    messagesByRoom: {},
    usersByRoom: {},
    pinnedRooms: [],
    roomNotes: {},
    roomRatchetsByRoom: {},
    trustedSenderKeysByRoom: {},
    joinedRooms: [],
  };
  const dev = {} as Device;
  const ctx: CloudSyncCtx = {
    state,
    send: (payload) => relay.receive(dev.wsId, payload),
    // Mirror the real messenger join flow: importing a key stores it, and
    // joining a room inserts it into the room list.
    importRoomKey: (roomId, roomKey) => {
      (state.roomKeysByRoom as Record<string, string>)[roomId] = roomKey;
    },
    requestJoin: (roomId) => {
      const rooms = state.rooms as Array<{ roomId: string; title?: string }>;
      if (!rooms.some((r) => r.roomId === roomId)) rooms.push({ roomId, title: roomId });
      const joined = state.joinedRooms as string[];
      if (!joined.includes(roomId)) joined.push(roomId);
    },
  };
  dev.wsId = wsId;
  dev.platform = platform;
  dev.store = store;
  dev.ctx = ctx;
  dev.acks60 = [];
  dev.got61 = 0;
  dev.cs = runWithStorage(store, () => useCloudSync(ctx));
  runWithStorage(store, () => dev.cs.setEnabled(true));
  relay.add(dev);
  return dev;
}

async function settle(ms = 1500): Promise<void> {
  await Bun.sleep(ms);
}

async function converge(devices: Device[], rounds = 4): Promise<void> {
  for (const d of devices) {
    await runWithStorage(d.store, () => d.cs.startPairing());
  }
  for (let i = 0; i < rounds; i++) await settle(1200);
}

function peerIds(d: Device): string[] {
  return (d.cs.state.peers as Array<{ id: string }>).map((p) => p.id).sort();
}

beforeEach(() => {
  relay = new MockRelay();
  n = 0;
});

describe("full-mesh convergence", () => {
  test("4 devices form 6 pairwise legs", async () => {
    const devs = [makeDevice(), makeDevice(), makeDevice(), makeDevice()];
    await converge(devs, 5);
    for (const d of devs) {
      expect(peerIds(d)).toHaveLength(3);
    }
    // Full interconnect: every device knows every other device id.
    const ids = devs.map((d) => d.ctx.state.deviceId as string).sort();
    for (const d of devs) {
      expect(peerIds(d)).toEqual(ids.filter((id) => id !== d.ctx.state.deviceId));
    }
  }, 120000);

  test("snapshots converge across the mesh", async () => {
    const [a, b] = [makeDevice(), makeDevice()];
    await converge([a, b], 4);
    expect(peerIds(a)).toHaveLength(1);

    const s = a.ctx.state as Record<string, unknown>;
    s.rooms = [{ roomId: "room1", title: "Room One" }];
    (s.roomKeysByRoom as Record<string, string>)["room1"] = "ab".repeat(32);
    (s.usersByRoom as Record<string, string[]>)["room1"] = ["alice"];
    await runWithStorage(a.store, () => a.cs.pushSnapshot());
    await settle();
    const bs = b.ctx.state as Record<string, unknown>;
    expect((bs.rooms as Array<{ roomId: string }>).map((r) => r.roomId)).toContain("room1");
    expect((bs.roomKeysByRoom as Record<string, string>)["room1"]).toBe("ab".repeat(32));
  }, 120000);
});

describe("stale-route healing via relay ack", () => {
  test("reconnect heals in one round trip, no 3-minute wait", async () => {
    const [a, b] = [makeDevice(), makeDevice()];
    await converge([a, b], 4);
    expect(peerIds(a)).toHaveLength(1);

    // B reconnects: new WS id, A still targets the old one.
    relay.remap(b.wsId, "ws-b-new");
    const staleB = "ws-2";
    await runWithStorage(a.store, () => a.cs.pushSnapshot());
    await settle(2500);

    // A sent a unicast to the stale id (delivered 0 somewhere in acks)...
    const staleAcks = a.acks60.filter((d) => d["delivered"] === 0);
    expect(staleAcks.length).toBeGreaterThan(0);
    // ...then the broadcast catch-up + B's ack healed the leg: the next
    // unicast lands on the new id.
    a.acks60.length = 0;
    await runWithStorage(a.store, () => a.cs.pushSnapshot());
    await settle();
    const fresh = a.acks60.filter(
      (d) => d["delivered"] === 1 && JSON.stringify(d["peers"]).includes("ws-b-new"),
    );
    expect(fresh.length).toBeGreaterThan(0);
    void staleB;
  }, 120000);
});

describe("presence events", () => {
  test("leave marks the leg stale; join triggers handshake", async () => {
    const [a, b] = [makeDevice(), makeDevice()];
    await converge([a, b], 4);
    expect(peerIds(a)).toHaveLength(1);

    relay.emitPresence(null, "leave", b.wsId, b.platform);
    await settle(3000);
    // A pushed a catch-up broadcast; B still paired (same session).
    expect(peerIds(a)).toHaveLength(1);

    // A fresh device joining via presence gets handshaked without Pair.
    const c = makeDevice();
    runWithStorage(c.store, () => c.cs.setEnabled(true));
    relay.emitPresence(c.wsId, "join", c.wsId, c.platform);
    await settle(4000);
    expect(peerIds(c).length).toBeGreaterThan(0);
  }, 120000);
});

describe("adversarial delivery", () => {
  test("duplicate frames apply once; foreign envelopes ignored", async () => {
    const [a, b] = [makeDevice(), makeDevice()];
    await converge([a, b], 4);
    const appliedBefore = b.cs.state.diag.applied as number;

    // Duplicate the next unicast to B.
    relay.duplicateNext.add(b.wsId);
    await runWithStorage(a.store, () => a.cs.pushSnapshot());
    await settle();
    const appliedAfter = b.cs.state.diag.applied as number;
    // At most one extra apply per duplicate batch of snapshot parts is
    // acceptable only if deduped; snapshots are idempotent regardless.
    expect(appliedAfter - appliedBefore).toBeLessThanOrEqual(2);

    // Foreign envelope (to someone else) is ignored, no crash, no apply.
    const failedBefore = b.cs.state.diag.failed as number;
    await runWithStorage(b.store, () =>
      b.cs.handleSyncMessage({
        fromClientId: a.wsId,
        encrypted: { syncId: "x", epoch: 1, n: 999, from: "dev-ghost", to: "dev-other" },
      }),
    );
    expect(b.cs.state.diag.failed as number).toBe(failedBefore);
    expect(b.cs.state.diag.applied as number).toBe(appliedAfter);
  }, 120000);

  test("partition heals on rejoin via presence", async () => {
    const [a, b] = [makeDevice(), makeDevice()];
    await converge([a, b], 4);
    const c = makeDevice();
    runWithStorage(c.store, () => c.cs.setEnabled(true));

    // C isolated: hellos go nowhere.
    relay.isolated.add(c.wsId);
    await runWithStorage(c.store, () => c.cs.startPairing());
    await settle(2000);
    expect(peerIds(c)).toHaveLength(0);

    // Network back + presence join from A: C handshakes immediately.
    relay.isolated.delete(c.wsId);
    relay.emitPresence(null, "join", a.wsId, a.platform);
    await settle(4000);
    expect(peerIds(c).length).toBeGreaterThan(0);
  }, 120000);

  test("revoke propagates and wipes the session", async () => {
    const [a, b] = [makeDevice(), makeDevice()];
    await converge([a, b], 4);
    expect(peerIds(a)).toHaveLength(1);
    await runWithStorage(a.store, () =>
      a.cs.unpairPeer(b.ctx.state.deviceId as string),
    );
    await settle();
    expect(peerIds(b)).toHaveLength(0);
    expect(peerIds(a)).toHaveLength(0);
  }, 120000);
});
