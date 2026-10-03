// QxChat-native rich activity ("Playing Baldur's Gate 3") rendered
// Discord-style on profile cards. Broadcast inside the user profile (same
// visibility as the custom status); detection runs on desktop via the Tauri
// `activity` plugin, calls override it everywhere.

export type ActivityKind = "game" | "app" | "media" | "call";

export interface ActivityArtwork {
  large?: string;
  small?: string;
}

export interface UserActivity {
  kind: ActivityKind;
  name: string;
  details?: string;
  state?: string;
  /** Epoch millis when the activity started (elapsed timer). */
  startedAt?: number;
  /** Emitter's Discord application id (resolves bare artwork keys). */
  appId?: string;
  /** Raw artwork references (URLs, CDN keys, `mp:`/`spotify:` ids). */
  assets?: ActivityArtwork;
}

function isKind(value: unknown): value is ActivityKind {
  return value === "game" || value === "app" || value === "media" || value === "call";
}

/** Validates + trims a wire activity. `null`/garbage → `null` (cleared). */
export function normalizeActivity(value: unknown): UserActivity | null {
  if (value == null) return null;
  if (typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  if (!isKind(src.kind)) return null;
  const name = String(src.name ?? "").trim().slice(0, 64);
  if (!name) return null;
  const details = String(src.details ?? "").trim().slice(0, 64);
  const state = String(src.state ?? "").trim().slice(0, 64);
  // The server serializes snake_case; accept both casings.
  const rawStarted = src.startedAt ?? src.started_at ?? 0;
  const startedAt = Number(rawStarted);
  const appId = String(src.appId ?? src.app_id ?? "").trim().slice(0, 64);
  const out: UserActivity = { kind: src.kind, name };
  if (details) out.details = details;
  if (state) out.state = state;
  if (Number.isFinite(startedAt) && startedAt > 0) out.startedAt = Math.floor(startedAt);
  if (appId) out.appId = appId;
  const rawAssets = (src.assets ?? null) as Record<string, unknown> | null;
  if (rawAssets && typeof rawAssets === "object") {
    const large = String(rawAssets.large ?? "").trim().slice(0, 512);
    const small = String(rawAssets.small ?? "").trim().slice(0, 512);
    if (large || small) out.assets = { ...(large ? { large } : {}), ...(small ? { small } : {}) };
  }
  return out;
}

/** Change detection so the poller only pushes on real transitions. */
export function sameActivity(a: UserActivity | null, b: UserActivity | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind
    && a.name === b.name
    && (a.details || "") === (b.details || "")
    && (a.state || "") === (b.state || "")
    && (a.startedAt || 0) === (b.startedAt || 0)
  );
}

/**
 * Resolves an artwork reference to a full `https://` URL:
 * direct URLs pass through, `mp:`/`spotify:` ids map to their CDNs, bare
 * keys resolve against the emitter's Discord application assets.
 * Anything else → `null` (never fetchable, never proxied).
 */
export function resolveActivityAssetUrl(value: unknown, appId?: string): string | null {
  const ref = String(value ?? "").trim();
  if (!ref || ref.length > 512) return null;
  if (/^https:\/\//i.test(ref)) return ref;
  if (ref.startsWith("mp:")) {
    const rest = ref.slice(3).replace(/^\/+/, "");
    return rest ? `https://media.discordapp.net/${rest}` : null;
  }
  if (ref.startsWith("spotify:")) {
    const id = ref.slice(8).trim();
    return id ? `https://i.scdn.co/image/${id}` : null;
  }
  const app = String(appId ?? "").trim();
  if (app && /^[A-Za-z0-9_-]+$/.test(ref)) {
    return `https://cdn.discordapp.com/app-icons/${app}/${ref}.png`;
  }
  return null;
}

/** Elapsed clock like Discord: "4:07", "1:02:03". Empty when no start. */
export function formatElapsed(startedAt: number | undefined, now = Date.now()): string {
  if (!startedAt || startedAt <= 0) return "";
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
