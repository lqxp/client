import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const candidate = window as any;
  return Boolean(candidate.__TAURI_INTERNALS__ || candidate.__TAURI__);
}

/**
 * Bridges QxChat to the native Android foreground service that keeps the app
 * alive in the background (so the WebSocket that receives new messages and
 * long-lived calls survive). On non-Tauri / desktop runtimes it is a no-op.
 */
export function useBackground() {
  const running = ref(false);
  const lastError = ref("");

  async function isRunning(): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
      lastError.value = "";
      running.value = await invoke<boolean>("plugin:background|is_background_running");
      return running.value;
    } catch (e) {
      lastError.value = String((e as any)?.message || e);
      return false;
    }
  }

  async function start(): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
      lastError.value = "";
      await invoke("plugin:background|start_background");
      running.value = true;
      return true;
    } catch (e) {
      lastError.value = String((e as any)?.message || e);
      return false;
    }
  }

  async function stop(): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
      lastError.value = "";
      await invoke("plugin:background|stop_background");
      running.value = false;
      return true;
    } catch (e) {
      lastError.value = String((e as any)?.message || e);
      return false;
    }
  }

  return { running, lastError, isRunning, start, stop };
}
