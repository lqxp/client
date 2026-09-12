import { createApp } from "vue";
import type { Plugin } from "vue";
import App from "./App.vue";
import router from "./router";
import { initializeRuntimeConfig } from "./config/runtime";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";

function resetRootScroll() {
  if (window.scrollY !== 0 || window.scrollX !== 0) {
    window.scrollTo(0, 0);
  }
  if (document.documentElement.scrollTop !== 0) {
    document.documentElement.scrollTop = 0;
  }
  if (document.body.scrollTop !== 0) {
    document.body.scrollTop = 0;
  }
}

function syncViewportHeight() {
  const viewport = window.visualViewport;
  const rawHeight = Math.round(viewport?.height || window.innerHeight);
  const rawWidth = Math.round(viewport?.width || window.innerWidth);
  // CSS `zoom` does NOT rescale viewport units (vh/vw/dvh) nor
  // window.innerHeight/innerWidth: they stay in unzoomed pixels. Divide by
  // the current zoom so both vars always equal the *visual* viewport and
  // full-screen shells keep filling exactly one screen at any zoom level.
  const height = Math.max(1, Math.round(rawHeight / windowScale));
  const width = Math.max(1, Math.round(rawWidth / windowScale));
  const root = document.documentElement;
  root.style.setProperty("--app-viewport-height", `${height}px`);
  root.style.setProperty("--app-viewport-width", `${width}px`);
  resetRootScroll();
}

function syncPlatformChromeOffset() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  document.documentElement.classList.toggle("is-android-runtime", isAndroid && isTauri);
}

function isInMap(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && typeof (el as HTMLElement).closest === "function" && (el as HTMLElement).closest(".world-map, .leaflet-container"));
}

function preventMobileZoom() {
  const preventDefaultGesture = (e: Event) => {
    // Let the Tor map (Leaflet) keep its own pinch-to-zoom; block page-level
    // pinch everywhere else so the client layout never gets a buggy scale.
    if (isInMap(e.target)) return;
    e.preventDefault();
  };
  document.addEventListener("gesturestart", preventDefaultGesture, { passive: false });
  document.addEventListener("gesturechange", preventDefaultGesture, { passive: false });
  document.addEventListener("gestureend", preventDefaultGesture, { passive: false });

  document.addEventListener(
    "touchmove",
    (e: TouchEvent) => {
      if (e.touches.length > 1 && !isInMap(e.target)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        const target = e.target as HTMLElement | null;
        if (target && !target.closest("input, textarea, [contenteditable='true']")) {
          e.preventDefault();
        }
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

// Browser-like window zoom (Ctrl/Cmd + +, -, 0, wheel/pinch).
//
// NOTE: this intentionally uses the CSS `zoom` property — NOT
// `transform: scale()`. `transform: scale()` on <html> does not reflow layout:
// it leaves a blank area, breaks `position: fixed` descendants (dialogs,
// settings, titlebar) and requires closing the app to reset. `zoom` reflows
// like a real browser zoom, so <body> resizes and fixed overlays stay correct.
const ZOOM_STORAGE_KEY = "lqxp:window-zoom";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

let windowScale = 1;

function readStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw == null) return 1;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 100) / 100));
  } catch {
    return 1;
  }
}

function applyWindowZoom(scale: number) {
  windowScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(scale * 100) / 100));
  const root = document.documentElement;
  // Clear any legacy transform-based zoom left by older builds.
  if (root.style.transform) root.style.transform = "";
  if (root.style.transformOrigin) root.style.transformOrigin = "";
  // `zoom` reflows layout (no blank areas, fixed modals keep working).
  (root.style as CSSStyleDeclaration & { zoom?: string }).zoom =
    windowScale === 1 ? "" : String(windowScale);
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(windowScale));
  } catch {
    /* storage unavailable */
  }
  // Viewport units don't follow `zoom`: re-resolve the compensated viewport
  // vars so heights (and fullscreen widths) track the new visual viewport.
  syncViewportHeight();
}

function zoomIn() {
  applyWindowZoom(windowScale + ZOOM_STEP);
}

function zoomOut() {
  applyWindowZoom(windowScale - ZOOM_STEP);
}

function zoomReset() {
  applyWindowZoom(1);
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  // Like browsers, these shortcuts work even when an input is focused.
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
    e.preventDefault();
    e.stopPropagation();
    zoomIn();
  } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") {
    e.preventDefault();
    e.stopPropagation();
    zoomOut();
  } else if (e.key === "0" || e.code === "Numpad0") {
    e.preventDefault();
    e.stopPropagation();
    zoomReset();
  }
}

function handleGlobalWheel(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  // Ctrl/Cmd+wheel (touchpad pinch included) drives our own zoom, like a
  // browser, instead of letting the WebView apply a native zoom that leaves
  // the client in a broken scale.
  e.preventDefault();
  e.stopPropagation();
  if (e.deltaY < 0) zoomIn();
  else if (e.deltaY > 0) zoomOut();
}

function setupScrollLockdown() {
  const scheduleReset = () => {
    resetRootScroll();
    requestAnimationFrame(resetRootScroll);
    setTimeout(resetRootScroll, 50);
    setTimeout(resetRootScroll, 150);
  };

  window.addEventListener("scroll", resetRootScroll, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleReset, { passive: true });
  window.visualViewport?.addEventListener("resize", syncViewportHeight, { passive: true });

  document.addEventListener("focusin", scheduleReset, { passive: true });
  document.addEventListener("focusout", scheduleReset, { passive: true });
  window.addEventListener("orientationchange", scheduleReset, { passive: true });
}

// applyWindowZoom() also syncs the zoom-compensated viewport vars, so it
// replaces the standalone syncViewportHeight() call here.
applyWindowZoom(readStoredZoom());
syncPlatformChromeOffset();
preventMobileZoom();
setupScrollLockdown();
window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
window.addEventListener("wheel", handleGlobalWheel, { passive: false, capture: true });

window.addEventListener("resize", syncViewportHeight, { passive: true });
window.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-allow-native-context-menu]")) return;
  event.preventDefault();
});

initializeRuntimeConfig()
  .catch(() => {
    /* Keep the bundled runtime config when the server runtime cannot be fetched. */
  })
  .finally(() => {
    createApp(App).use(router as Plugin).mount("#app");
    const splash = document.getElementById("splash");
    if (splash) {
      // Laisse un tick pour que Vue finisse le premier rendu
      requestAnimationFrame(() => {
        splash.classList.add("is-hidden");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      });
    }
  });
