import { reactive } from "vue";

const broken = reactive(new Set<string>());

export function isBrokenImage(src: string | null | undefined) {
  return Boolean(src) && broken.has(String(src));
}

export function usableImage(src: string | null | undefined) {
  const value = String(src || "");
  return value && !broken.has(value) ? value : "";
}

export function installBrokenImageWatch() {
  // Error events do not bubble, but they can be caught on the way down.
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || target.classList.contains("twemoji")) return;
      const src = target.getAttribute("src");
      if (!src) return;
      target.dataset.broken = "";
      broken.add(src);
    },
    true,
  );
  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement) delete event.target.dataset.broken;
    },
    true,
  );
  window.addEventListener("online", () => broken.clear());
}
