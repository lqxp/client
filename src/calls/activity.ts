// Local activity detection bridge (Tauri desktop only).
//
// The Rust `activity` plugin scans running processes against a curated
// allowlist and reports what this user is doing. This module is the thin IPC
// frontend; every call rejects outside the desktop runtime (web, Android,
// iOS) — callers must gate on `isTauriDesktopRuntime()` or catch.

import { invoke } from "@tauri-apps/api/core";
import { apiUrl } from "@/config/runtime";
import { normalizeActivity, resolveActivityAssetUrl, type UserActivity } from "@/utils/activity";

export type { UserActivity };

export function isTauriDesktopRuntime() {
  if (typeof window === "undefined") return false;
  const candidate = window as unknown as Record<string, unknown>;
  if (!(candidate.__TAURI_INTERNALS__ || candidate.__TAURI__)) return false;
  const ua = String(navigator?.userAgent || "").toLowerCase();
  return !ua.includes("android") && !/iphone|ipad|ipod/.test(ua);
}

interface DetectedActivity {
  kind: string;
  name: string;
  details?: string;
  state?: string;
  appId?: string;
  assets?: { large?: string; small?: string };
  started_at: number;
}

/** Current activity: native RPC frames first, process scan as fallback. */
export async function getDetectedActivity(): Promise<UserActivity | null> {
  const raw = await invoke<DetectedActivity | null>("plugin:activity|get_activity");
  if (!raw) return null;
  return normalizeActivity({
    kind: raw.kind,
    name: raw.name,
    details: raw.details,
    state: raw.state,
    appId: raw.appId,
    assets: raw.assets,
    startedAt: raw.started_at,
  });
}

/**
 * Proxied artwork URL through our own server (`GET /api/activity/assets`):
 * no browser ever hotlinks Discord or third-party CDNs directly (IP leak +
 * CSP). `null` when unresolvable or unproxyable.
 */
export function proxiedActivityAssetUrl(
  activity: Pick<UserActivity, "assets" | "appId"> | null | undefined,
  which: "large" | "small",
  apiBase: (path: string) => string,
): string | null {
  const ref = which === "large" ? activity?.assets?.large : activity?.assets?.small;
  const resolved = resolveActivityAssetUrl(ref, activity?.appId);
  if (!resolved) return null;
  return `${apiBase("/api/activity/assets")}?u=${encodeURIComponent(resolved)}`;
}

export interface DetectableList {
  updatedAt: number;
  games: Record<string, string>;
}

const DETECTABLE_STORAGE_KEY = "lqxp:activity-detectable";
const DETECTABLE_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_DETECTABLE_ENTRIES = 250_000;

/** Validates + trims a server detectable payload (wrong shapes → `null`). */
export function sanitizeDetectableList(value: unknown): DetectableList | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const games = src.games;
  if (!games || typeof games !== "object" || Array.isArray(games)) return null;
  const entries = Object.entries(games as Record<string, unknown>);
  if (entries.length > MAX_DETECTABLE_ENTRIES) return null;
  const clean: Record<string, string> = {};
  for (const [key, name] of entries) {
    const k = String(key || "").trim().toLowerCase().slice(0, 64);
    const n = String(name || "").trim().slice(0, 96);
    if (k && n) clean[k] = n;
  }
  const updatedAt = Number(src.updatedAt ?? 0);
  return {
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
    games: clean,
  };
}

function readCachedDetectable(): DetectableList | null {
  try {
    const raw = localStorage.getItem(DETECTABLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = sanitizeDetectableList(JSON.parse(raw));
    if (!parsed) return null;
    if (Date.now() - parsed.updatedAt > DETECTABLE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedDetectable(list: DetectableList) {
  try {
    localStorage.setItem(DETECTABLE_STORAGE_KEY, JSON.stringify({ ...list, games: list.games }));
  } catch {
    /* quota exceeded: memory cache still applies this session */
  }
}

/**
 * Detectable game list served by our own server (which compacts the upstream
 * Discord official feed). Cached for days; `null` when unreachable (the plugin falls
 * back to its built-in table).
 */
export async function fetchDetectableList(): Promise<DetectableList | null> {
  const cached = readCachedDetectable();
  if (cached) return cached;
  try {
    const res = await fetch(apiUrl("/api/activity/detectable"));
    if (!res.ok) return null;
    const list = sanitizeDetectableList(await res.json());
    if (!list || !Object.keys(list.games).length) return null;
    writeCachedDetectable({ ...list, updatedAt: list.updatedAt || Date.now() });
    return list;
  } catch {
    return null;
  }
}

/** Pushes the server list into the local detection plugin. Returns entries stored. */
export async function pushDetectableList(list: DetectableList): Promise<number> {
  return invoke<number>("plugin:activity|set_detectable", { games: list.games });
}
