import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

export type PermissionAlias = "camera" | "microphone" | "notifications" | "storage";
export type PermissionResult = Partial<Record<PermissionAlias, "granted" | "denied" | "prompt">>;

type PermissionStateResponse = Record<string, "granted" | "denied" | "prompt">;

function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const candidate = window as any;
  return Boolean(candidate.__TAURI_INTERNALS__ || candidate.__TAURI__);
}

/**
 * Bridges QxChat to the native Android runtime-permission gateway exposed by the
 * `permissions` Tauri plugin. On non-Tauri / desktop runtimes it behaves as a
 * no-op and reports everything as granted (the Web runtime handles those).
 */
export function usePermissions() {
  const requesting = ref(false);
  const state = ref<PermissionResult>({});
  const lastError = ref("");

  async function normalize(fn: () => Promise<PermissionStateResponse>): Promise<PermissionResult> {
    if (!isTauriRuntime()) {
      return { camera: "granted", microphone: "granted", notifications: "granted", storage: "granted" };
    }
    const raw = await fn();
    // The backend returns a flat alias -> state map; coerce keys defensively.
    const out: PermissionResult = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      const v = value === "denied" || value === "granted" || value === "prompt" ? value : "granted";
      (out as Record<string, string>)[key] = v;
    }
    return out;
  }

  async function check(): Promise<PermissionResult> {
    if (!isTauriRuntime()) {
      return { camera: "granted", microphone: "granted", notifications: "granted", storage: "granted" };
    }
    try {
      lastError.value = "";
      state.value = await normalize(() => invoke<PermissionStateResponse>("plugin:permissions|check_permissions"));
      return state.value;
    } catch (e) {
      lastError.value = String((e as any)?.message || e);
      return {};
    }
  }

  async function request(): Promise<PermissionResult> {
    if (!isTauriRuntime()) {
      return { camera: "granted", microphone: "granted", notifications: "granted", storage: "granted" };
    }
    requesting.value = true;
    lastError.value = "";
    try {
      state.value = await normalize(() => invoke<PermissionStateResponse>("plugin:permissions|request_permissions"));
      return state.value;
    } catch (e) {
      lastError.value = String((e as any)?.message || e);
      return {};
    } finally {
      requesting.value = false;
    }
  }

  return { requesting, state, lastError, check, request };
}
