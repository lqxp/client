// Live window zoom applied by main.ts as CSS `zoom` on <html>.
//
// Mouse/pointer event coordinates (clientX/clientY), window.innerWidth/
// innerHeight and getBoundingClientRect() are all reported in visual
// (unzoomed) pixels, while fixed-position left/top and layout math live in
// zoomed CSS pixels. Divide visual pixels by currentWindowZoom() before
// assigning positions so context menus open exactly under the cursor at any
// window scale.

const STORAGE_KEY = "lqxp:window-zoom";

/** Returns the active window zoom factor (1 when unscaled). */
export function currentWindowZoom(): number {
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
