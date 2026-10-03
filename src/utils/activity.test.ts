// Unit tests for the rich-activity helpers.
// Run: bun test src/utils/activity.test.ts
import { describe, expect, test } from "bun:test";
import { formatElapsed, normalizeActivity, resolveActivityAssetUrl, sameActivity } from "./activity";

describe("normalizeActivity", () => {
  test("accepts a full activity", () => {
    expect(
      normalizeActivity({ kind: "game", name: "Baldur's Gate 3", details: "Acte II", state: "En groupe", startedAt: 1000 }),
    ).toEqual({ kind: "game", name: "Baldur's Gate 3", details: "Acte II", state: "En groupe", startedAt: 1000 });
  });

  test("accepts the server snake_case timestamp", () => {
    expect(normalizeActivity({ kind: "app", name: "Code", started_at: 2000 })?.startedAt).toBe(2000);
  });

  test("rejects unknown kinds, empty names and garbage", () => {
    expect(normalizeActivity({ kind: "hacking", name: "x" })).toBeNull();
    expect(normalizeActivity({ kind: "game", name: "   " })).toBeNull();
    expect(normalizeActivity({ kind: "game" })).toBeNull();
    expect(normalizeActivity(null)).toBeNull();
    expect(normalizeActivity(42)).toBeNull();
    expect(normalizeActivity("game")).toBeNull();
  });

  test("trims strings to 64 chars and drops non-finite timestamps", () => {
    const out = normalizeActivity({ kind: "media", name: ` ${"x".repeat(200)} `, startedAt: Number.NaN });
    expect(out?.name.length).toBe(64);
    expect(out?.startedAt).toBe(undefined);
  });
});

describe("normalizeActivity artwork", () => {
  test("carries appId + assets, truncates, drops garbage", () => {
    const out = normalizeActivity({
      kind: "game", name: "G", appId: "123",
      assets: { large: "https://cdn/x.png", small: "abc123" },
    });
    expect(out?.appId).toBe("123");
    expect(out?.assets).toEqual({ large: "https://cdn/x.png", small: "abc123" });
    expect(normalizeActivity({ kind: "game", name: "G", assets: "nope" })?.assets).toBe(undefined);
    expect(normalizeActivity({ kind: "game", name: "G", assets: {} })?.assets).toBe(undefined);
  });
});

describe("resolveActivityAssetUrl", () => {
  test("direct https passes, keys resolve via app id", () => {
    expect(resolveActivityAssetUrl("https://cdn/x.png", "1")).toBe("https://cdn/x.png");
    expect(resolveActivityAssetUrl("iconhash", "123")).toBe(
      "https://cdn.discordapp.com/app-icons/123/iconhash.png",
    );
    expect(resolveActivityAssetUrl("mp:external/abc/https://x/y.png", "1")).toBe(
      "https://media.discordapp.net/external/abc/https://x/y.png",
    );
    expect(resolveActivityAssetUrl("spotify:xyz", "1")).toBe("https://i.scdn.co/image/xyz");
  });
  test("rejects http, empty, oversized and keyless refs", () => {
    expect(resolveActivityAssetUrl("http://x/y.png", "1")).toBeNull();
    expect(resolveActivityAssetUrl("iconhash", "")).toBeNull();
    expect(resolveActivityAssetUrl("", "1")).toBeNull();
    expect(resolveActivityAssetUrl(null, "1")).toBeNull();
    expect(resolveActivityAssetUrl("x".repeat(600), "1")).toBeNull();
    expect(resolveActivityAssetUrl("not a url at all ???", "1")).toBeNull();
  });
});

describe("sameActivity", () => {
  test("null-safe deep comparison ignoring timestamp absence", () => {
    const a = { kind: "game" as const, name: "X" };
    expect(sameActivity(a, { ...a })).toBe(true);
    expect(sameActivity(a, null)).toBe(false);
    expect(sameActivity(null, null)).toBe(true);
    expect(sameActivity({ ...a, details: "d" }, a)).toBe(false);
  });
});

describe("formatElapsed", () => {
  test("renders m:ss and h:mm:ss clocks", () => {
    expect(formatElapsed(1000, 1000 + 4 * 60 * 1000 + 7000)).toBe("4:07");
    expect(formatElapsed(1000, 1000 + 3600 * 1000 + 2 * 60 * 1000 + 3000)).toBe("1:02:03");
    expect(formatElapsed(undefined)).toBe("");
    expect(formatElapsed(Date.now() + 60_000)).toBe("0:00");
  });
});
