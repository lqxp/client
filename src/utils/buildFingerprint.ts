import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "@/calls/tor";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over the interface files actually loaded, in a stable order. */
export async function interfaceFingerprint(): Promise<string> {
  const urls = [
    ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"), (node) => node.src),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'), (node) => node.href),
  ]
    .filter((url) => new URL(url, location.href).origin === location.origin)
    .sort();
  if (!urls.length) return "";
  try {
    const parts = await Promise.all(urls.map(async (url) => new Uint8Array(await (await fetch(url, { cache: "no-store" })).arrayBuffer())));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    return toHex(await crypto.subtle.digest("SHA-256", joined));
  } catch {
    return "";
  }
}

/** SHA-256 of the desktop executable, computed by the native side. */
export async function binaryFingerprint(): Promise<string> {
  if (!isTauriDesktopRuntime()) return "";
  try {
    return await invoke<string>("plugin:integrity|fingerprint");
  } catch {
    return "";
  }
}
