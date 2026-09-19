// Single source of truth for "are we inside the Tauri desktop WebView?".
//
// Previously every bridge module (tor, discord-rpc, screen-audio, …) duplicated
// its own `isTauriDesktopRuntime()` with slightly different global checks,
// which broke on setups where the Tauri globals are injected late (notably
// WebKitGTK on NixOS) and made the Advanced → Discord RPC section report
// "unavailable on this platform" even though the Rust backend was running.
//
// Detection rules:
// - `window.__TAURI_INTERNALS__`, `window.__TAURI__` or `window.__TAURI_IPC__`
//   present → we run inside Tauri (covers v1/v2 + `withGlobalTauri` timing).
// - Mobile user-agents (Android / iPhone / iPad / iPod) are excluded: those
//   builds have no Discord IPC socket / Tor proxy / screen-audio plugin.
// - Desktop Linux (incl. NixOS WebKitGTK), Windows and macOS UAs pass.

export function hasTauriGlobals(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.__TAURI_IPC__);
}

export function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "").toLowerCase();
  return ua.includes("android") || /iphone|ipad|ipod/.test(ua);
}

export function isTauriDesktopRuntime(): boolean {
  return hasTauriGlobals() && !isMobileUserAgent();
}
