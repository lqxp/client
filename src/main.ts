import { createApp } from "vue";
import type { Plugin } from "vue";
import App from "./App.vue";
import { sheetDismiss } from "@/directives/sheetDismiss";
import { installBrokenImageWatch } from "@/utils/brokenImages";
import { installCustomTheme } from "@/composables/useCustomTheme";
import router from "./router";
import { initializeRuntimeConfig } from "./config/runtime";
import { WINDOW_ZOOM_EVENT, isWindowZoomEnabled } from "./utils/windowZoom";
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest?.("input, textarea, select, [contenteditable='true']"));
}

type VirtualKeyboardHandle = {
  overlaysContent?: boolean;
  boundingRect?: { height?: number };
  addEventListener?: (type: string, cb: () => void) => void;
};

function readVirtualKeyboard(): VirtualKeyboardHandle | undefined {
  try {
    return (navigator as unknown as { virtualKeyboard?: VirtualKeyboardHandle }).virtualKeyboard;
  } catch {
    return undefined;
  }
}

/** Chrome/Edge/Samsung Internet: keyboard rect even when no viewport resizes. CSS px. */
function readVirtualKeyboardHeight(): number {
  try {
    const h = Number(readVirtualKeyboard()?.boundingRect?.height ?? 0);
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  } catch {
    return 0;
  }
}

function syncViewportHeight() {
  const viewport = window.visualViewport;
  // While the WebView is natively pinch-zoomed (scale !== 1) the visual
  // viewport is offset and resized: deriving --app-viewport-* from it would
  // shrink/shift the fixed app shell and push the sidebar header under the
  // Android status bar. Fall back to the (unzoomed) layout viewport instead.
  const nativePinch = (viewport?.scale ?? 1) !== 1;
  // Layout viewport: already shrunk by the keyboard when the browser uses
  // `interactive-widget=resizes-content` (Android Chrome). Stays full height
  // when the keyboard overlays instead (iOS Safari, resizes-visual).
  const layoutHeight = window.innerHeight;
  const layoutWidth = window.innerWidth;
  const visualHeight = nativePinch ? layoutHeight : Math.round(viewport?.height ?? layoutHeight);
  const visualWidth = nativePinch ? layoutWidth : Math.round(viewport?.width ?? layoutWidth);
  const offsetTop = nativePinch ? 0 : Math.max(0, Math.round(viewport?.offsetTop ?? 0));
  // Overlay keyboard height: the bottom strip of the layout viewport hidden
  // behind the virtual keyboard. 0 when the layout already resized
  // (resizes-content / adjustResize) — the app shell shrank on its own and no
  // extra padding is needed. >0 on iOS Safari / resizes-visual / overlaid
  // VirtualKeyboard — the shell stays tall and the composer must be padded up
  // by exactly this amount. Three independent sources, take the max:
  // visualViewport diff, VirtualKeyboard.boundingRect (Chrome/Samsung even
  // when no viewport event fires, e.g. WebViews), native ime forwarding.
  const vkHeight = readVirtualKeyboardHeight();
  const keyboardRaw = nativePinch
    ? 0
    : Math.max(0, layoutHeight - visualHeight - offsetTop, vkHeight);
  // CSS `zoom` does NOT rescale viewport units (vh/vw/dvh) nor
  // window.innerHeight/innerWidth: they stay in unzoomed pixels. Divide by
  // the current zoom so both vars always equal the *visual* viewport and
  // full-screen shells keep filling exactly one screen at any zoom level.
  const height = Math.max(1, Math.round(layoutHeight / windowScale));
  const width = Math.max(1, Math.round(layoutWidth / windowScale));
  const keyboardHeight = Math.max(0, Math.round(keyboardRaw / windowScale));
  const root = document.documentElement;
  root.style.setProperty("--app-viewport-height", `${height}px`);
  root.style.setProperty("--app-viewport-width", `${width}px`);
  root.style.setProperty("--keyboard-height", `${keyboardHeight}px`);
  // >4px filters out rounding noise / URL-bar transitions: only a real
  // keyboard counts as "open" (drives composer padding + feed pinning).
  root.classList.toggle("is-keyboard-open", keyboardHeight > 4);
}

function syncPlatformChromeOffset() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  document.documentElement.classList.toggle("is-android-runtime", isAndroid && isTauri);
  // The desktop title bar sits at --z-window-chrome, above every overlay, and
  // the ones teleported to `body` start at y=0: without this offset their top
  // controls end up underneath it. Same conditions InboxView uses to show it.
  const isWebDesktop = window.matchMedia("(min-width: 901px) and (hover: hover) and (pointer: fine)").matches;
  const hasTitlebar = (isTauri && !isAndroid) || isWebDesktop;
  document.documentElement.style.setProperty("--app-chrome-top", hasTitlebar ? "30px" : "0px");
}

function preventMobileZoom() {
  const preventDefaultGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener("gesturestart", preventDefaultGesture, { passive: false });
  document.addEventListener("gesturechange", preventDefaultGesture, { passive: false });
  document.addEventListener("gestureend", preventDefaultGesture, { passive: false });

  // Two-finger touches must always be blocked (gesturestart above is
  // WebKit-only — Chromium never fires it): the WebView's native page
  // pinch-zoom is what leaves the client in a broken scale. The Tor map
  // (Leaflet) is NOT exempted — it zooms through its own touch handlers
  // (touch-action: none), which keep working behind preventDefault.
  document.addEventListener(
    "touchmove",
    (e: TouchEvent) => {
      if (e.touches.length > 1) {
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
        // Double-tap zoom stays allowed on the Leaflet map (double-tap zoom).
        if (target && !target.closest("input, textarea, [contenteditable='true'], .leaflet-container")) {
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
  if (!isWindowZoomEnabled()) {
    // Touch runtime: never scale the shell, just keep the viewport vars fresh.
    windowScale = 1;
    syncViewportHeight();
    return;
  }
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
  // CSS `zoom` reflows without firing `resize`: tell positioned overlays to
  // recompute their placement (SelectMenu re-places, context menus reopen).
  try {
    window.dispatchEvent(new CustomEvent(WINDOW_ZOOM_EVENT, { detail: { scale: windowScale } }));
  } catch {
    /* DOM unavailable (SSR/tests) */
  }
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
  if (!isWindowZoomEnabled()) return;
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
  if (!isWindowZoomEnabled()) return;
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

  // Sync on every visualViewport change (keyboard open/close animates through
  // several resize+scroll events): this keeps --keyboard-height tracking the
  // real keyboard instead of jumping once at the end.
  const scheduleSync = () => {
    syncViewportHeight();
    requestAnimationFrame(syncViewportHeight);
  };

  window.addEventListener("scroll", resetRootScroll, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleSync, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleSync, { passive: true });

  // Forcing scrollTo(0,0) while an input is focused fights the browser's
  // "keep the caret above the keyboard" pan: on iOS Safari the field ends up
  // stuck under the keyboard and the visual viewport never settles. When the
  // focus lands in an editable, sync the keyboard vars (with a delayed pass
  // for the opening animation) and let the composer padding do the lifting
  // instead of yanking the scroll back to zero.
  document.addEventListener(
    "focusin",
    (event) => {
      scheduleSync();
      setTimeout(syncViewportHeight, 120);
      setTimeout(syncViewportHeight, 350);
      if (isEditableTarget(event.target)) {
        // Once the keyboard has (mostly) opened, pin the feed to the bottom
        // so the latest messages + composer stay visible above it.
        setTimeout(() => {
          const feed = document.querySelector(".feed");
          if (feed) feed.scrollTop = feed.scrollHeight;
        }, 350);
        return;
      }
      scheduleReset();
    },
    { passive: true },
  );
  document.addEventListener(
    "focusout",
    () => {
      scheduleSync();
      setTimeout(syncViewportHeight, 120);
      scheduleReset();
    },
    { passive: true },
  );
  window.addEventListener("orientationchange", scheduleReset, { passive: true });

  // Opt into overlaying content: WE move the composer via --keyboard-height /
  // env(keyboard-inset-height) instead of letting the browser shrink the
  // layout viewport underneath our fixed shell (which, combined with
  // position:fixed + overflow:hidden, leaves the field stuck under the
  // keyboard on several mobile browsers). geometrychange fires per animation
  // frame while the keyboard opens/closes, even when neither window.resize
  // nor visualViewport.resize fires (Samsung Internet, some WebViews).
  try {
    const vk = readVirtualKeyboard();
    if (vk) {
      try {
        if ("overlaysContent" in vk) vk.overlaysContent = true;
      } catch {
        /* keep default overlay behavior */
      }
      vk.addEventListener?.("geometrychange", scheduleSync);
    }
  } catch {
    /* VirtualKeyboard API unavailable */
  }

  // Remote-diagnosis helper (adb/devtools console): __lqxpKbDebug() shows why
  // the composer does or does not lift above the keyboard.
  try {
    (window as unknown as { __lqxpKbDebug?: () => unknown }).__lqxpKbDebug = () => {
      const viewport = window.visualViewport;
      return {
        layoutH: window.innerHeight,
        layoutW: window.innerWidth,
        visualH: viewport?.height ?? null,
        visualW: viewport?.width ?? null,
        offsetTop: viewport?.offsetTop ?? null,
        scale: viewport?.scale ?? null,
        vkHeight: readVirtualKeyboardHeight(),
        keyboardVar: getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height").trim(),
        keyboardOpen: document.documentElement.classList.contains("is-keyboard-open"),
        vkOverlay: (() => {
          try {
            return (readVirtualKeyboard() as { overlaysContent?: unknown } | undefined)?.overlaysContent ?? null;
          } catch {
            return null;
          }
        })(),
      };
    };
  } catch {
    /* debug helper unavailable */
  }
}

// applyWindowZoom() also syncs the zoom-compensated viewport vars, so it
// replaces the standalone syncViewportHeight() call here.
applyWindowZoom(readStoredZoom());
syncPlatformChromeOffset();
preventMobileZoom();
setupScrollLockdown();
window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
window.addEventListener("wheel", handleGlobalWheel, { passive: false, capture: true });

/**
 * A file dropped outside a drop zone must not take the window with it.
 *
 * The default action for a dropped file is to open it, which in a single page
 * app means the session, the draft and the call all go. The conversation has
 * its own handler and still receives the drop first; this only stops the
 * navigation that would otherwise follow everywhere else.
 */
function blockStrayFileDrop(event: DragEvent) {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
}

window.addEventListener("dragover", blockStrayFileDrop);
window.addEventListener("drop", blockStrayFileDrop);

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
    installBrokenImageWatch();
    installCustomTheme();
    createApp(App).use(router as Plugin).directive("sheet-dismiss", sheetDismiss).mount("#app");
    const splash = document.getElementById("splash");
    if (splash) {
      // Laisse un tick pour que Vue finisse le premier rendu
      requestAnimationFrame(() => {
        splash.classList.add("is-hidden");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      });
    }
  });
