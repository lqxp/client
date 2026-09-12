// Discord Rich Presence bridge (Tauri desktop only).
//
// The presence itself is owned by the Rust `discord-rpc` plugin, which talks
// to Discord over the local IPC socket (named pipes on Windows, Unix sockets
// on macOS/Linux). This module is the thin IPC frontend used by the
// "Advanced" settings section: read/persist the two toggles and expose the
// live connection state.
//
// Every call rejects outside the desktop runtime (web, Android, iOS) —
// callers must gate on `isTauriDesktopRuntime()` or catch.

import { invoke } from "@tauri-apps/api/core";

export function isTauriDesktopRuntime() {
  if (typeof window === "undefined") return false;
  const candidate = window as any;
  if (!(candidate.__TAURI_INTERNALS__ || candidate.__TAURI__)) return false;
  const ua = String(navigator?.userAgent || "").toLowerCase();
  return !ua.includes("android") && !/iphone|ipad|ipod/.test(ua);
}

export interface DiscordRpcSettings {
  enabled: boolean;
  show_platform: boolean;
}

export interface DiscordRpcStatus extends DiscordRpcSettings {
  /** True once the worker holds a live Discord IPC connection. */
  connected: boolean;
}

export async function getDiscordRpcSettings(): Promise<DiscordRpcSettings> {
  return invoke<DiscordRpcSettings>("plugin:discord-rpc|get_settings");
}

export async function setDiscordRpcEnabled(enabled: boolean): Promise<DiscordRpcSettings> {
  return invoke<DiscordRpcSettings>("plugin:discord-rpc|set_enabled", { enabled });
}

export async function setDiscordRpcShowPlatform(
  showPlatform: boolean,
): Promise<DiscordRpcSettings> {
  // Rust command arg is `show_platform`; Tauri maps camelCase → snake_case.
  return invoke<DiscordRpcSettings>("plugin:discord-rpc|set_show_platform", {
    showPlatform,
  });
}

export async function getDiscordRpcStatus(): Promise<DiscordRpcStatus> {
  return invoke<DiscordRpcStatus>("plugin:discord-rpc|get_status");
}
