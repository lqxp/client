// Live window zoom applied by main.ts as CSS `zoom` on <html>.
//
// Mouse/pointer event coordinates (clientX/clientY), window.innerWidth/
// innerHeight and getBoundingClientRect() are all reported in visual
// (unzoomed) pixels, while fixed-position left/top and layout math live in
// zoomed CSS pixels. Divide visual pixels by currentWindowZoom() before
// assigning positions so context menus open exactly under the cursor at any
// window scale.

const STORAGE_KEY = "lqxp:window-zoom";

/**
 * Window zoom is a desktop affordance (Ctrl/Cmd + keyboard/wheel). On touch
 * runtimes (coarse primary pointer, iOS) CSS `zoom` interacts badly with the
 * edge-to-edge WebView and the visual viewport: fixed shells drift and the
 * sidebar header ends up under the Android status bar. Keep the scale locked
 * at 1 there.
 */
export function isWindowZoomEnabled(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return false;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return !isIos;
  } catch {
    return false;
  }
}

/** Returns the active window zoom factor (1 when unscaled). */
export function currentWindowZoom(): number {
  if (!isWindowZoomEnabled()) return 1;
  try {
    const computed = Number.parseFloat(
      getComputedStyle(document.documentElement).zoom,
    );
    if (Number.isFinite(computed) && computed > 0) return computed;
  } catch {
    /* DOM unavailable (SSR/tests) */
  }
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    /* storage unavailable */
  }
  return 1;
}
