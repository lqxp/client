// Test-only browser shims so app modules (which touch window/localStorage/
// navigator at import time) load under `bun test`. Import this FIRST in
// every test file. No production code may import it.
import { AsyncLocalStorage } from "node:async_hooks";

const globalStore = new Map<string, string>();
const als = new AsyncLocalStorage<Map<string, string>>();

function curStore(): Map<string, string> {
  return als.getStore() ?? globalStore;
}

/** Run `fn` with an isolated localStorage (one Map per mesh device). */
export function runWithStorage<T>(store: Map<string, string>, fn: () => T): T {
  return als.run(store, fn);
}

export function newTestStorage(): Map<string, string> {
  return new Map<string, string>();
}

Object.assign(globalThis, {
  location: {
    protocol: "https:",
    host: "test.local",
    origin: "https://test.local",
    href: "https://test.local/",
  },
});

(globalThis as Record<string, unknown>).window = Object.assign(globalThis, {
  addEventListener() {},
  removeEventListener() {},
});

(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => {
    const s = curStore();
    return s.has(k) ? s.get(k)! : null;
  },
  setItem: (k: string, v: string) => {
    curStore().set(k, String(v));
  },
  removeItem: (k: string) => {
    curStore().delete(k);
  },
  clear: () => curStore().clear(),
};

(globalThis as Record<string, unknown>).navigator = { userAgent: "bun-test" };
(globalThis as Record<string, unknown>).document = {
  addEventListener() {},
  removeEventListener() {},
  hidden: false,
  title: "",
};
(globalThis as Record<string, unknown>).__QXP_RUNTIME__ = undefined;

export function resetTestStorage(): void {
  globalStore.clear();
}
