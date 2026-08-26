// Tor connectivity bridge for QxChat (desktop).
//
// Mirrors the `screenAudio.ts` pattern: a thin wrapper around the Rust `tor`
// plugin, invoked with `plugin:tor|…` commands, with status streamed back over
// the "tor:status" event. The on/off + port setting is persisted in the same
// place as the rest of the app settings (useMessenger's persisted payload), so
// this module only exposes imperative controls + live status.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface TorStatus {
  running: boolean;
  port: number;
  phase: "idle" | "bootstrapping" | "ready" | "error";
  /** Where traffic actually routes: `embedded` (our Arti + circuit), `external`
   * (a foreign Tor on the port — no circuit view), or `none`. */
  mode: "embedded" | "external" | "none";
  /** Present only during the `error` phase. */
  error?: string;
}

export interface CircuitHop {
  role: "guard" | "middle" | "exit";
  ip: string | null;
  nickname: string;
  /** ISO 3166-1 alpha-2 country code, if known. */
  country: string | null;
  ed25519: string | null;
  rsa: string | null;
}

export interface CircuitPath {
  hops: CircuitHop[];
}

export function isTauriDesktopRuntime() {
  if (typeof window === "undefined") return false;
  const w = window as any;
  if (!(w.__TAURI_INTERNALS__ || w.__TAURI__)) return false;
  const ua = String(navigator?.userAgent || "").toLowerCase();
  return !ua.includes("android") && !/iphone|ipad|ipod/.test(ua);
}

let statusListeners = new Set<(s: TorStatus) => void>();
let unlisten: (() => void) | null = null;

/** Subscribes to live `tor:status` events; returns an unsubscribe function. */
export function onTorStatus(cb: (s: TorStatus) => void): () => void {
  statusListeners.add(cb);
  if (!unlisten && isTauriDesktopRuntime()) {
    listen<TorStatus>("tor:status", (event) => {
      const s = event.payload;
      for (const l of statusListeners) l(s);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* non-Tauri environment */
      });
  }
  return () => statusListeners.delete(cb);
}

/** Queries the current Tor status. */
export async function torStatus(): Promise<TorStatus> {
  return invoke<TorStatus>("plugin:tor|status");
}

/** Starts embedded Tor, optionally on a specific SOCKS5 port. */
export async function startTor(port?: number): Promise<TorStatus> {
  return invoke<TorStatus>("plugin:tor|start", { port });
}

/** Stops Tor and restores direct connectivity. */
export async function stopTor(): Promise<TorStatus> {
  return invoke<TorStatus>("plugin:tor|stop");
}

/**
 * Toggles Tor (start or stop) and triggers a clean app restart so the WebView
 * proxy takes effect. This is the user-facing toggle; the boot-time auto-start
 * continues to use `startTor`/`stopTor` directly (no restart).
 */
export async function toggleTor(enabled: boolean): Promise<TorStatus> {
  return invoke<TorStatus>("plugin:tor|toggle", { enabled });
}

/** Probes whether the local SOCKS5 port is actually accepting connections. */
export async function isTorReady(): Promise<boolean> {
  return invoke<boolean>("plugin:tor|is_ready");
}

/** Returns the most recently established Tor circuit (guard → middle → exit). */
export async function getCircuit(): Promise<CircuitPath | null> {
  return invoke<CircuitPath | null>("plugin:tor|circuit");
}

export interface GeoPoint {
  ip: string;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  org: string | null;
}

export interface GeoInfo {
  client: GeoPoint | null;
  server: GeoPoint | null;
}

/** Fetches client + server coarse geolocation (IP masked) for the map. */
export async function getGeo(): Promise<GeoInfo> {
  return invoke<GeoInfo>("plugin:tor|geo");
}
