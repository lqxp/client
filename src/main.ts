import { createApp } from "vue";
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
  const height = Math.round(viewport?.height || window.innerHeight);
  document.documentElement.style.setProperty("--app-viewport-height", `${height}px`);
  resetRootScroll();
}

function syncPlatformChromeOffset() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  document.documentElement.classList.toggle("is-android-runtime", isAndroid && isTauri);
}

function preventMobileZoom() {
  const preventDefaultGesture = (e: Event) => {
    e.preventDefault();
  };
  document.addEventListener("gesturestart", preventDefaultGesture, { passive: false });
  document.addEventListener("gesturechange", preventDefaultGesture, { passive: false });
  document.addEventListener("gestureend", preventDefaultGesture, { passive: false });

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
        if (target && !target.closest("input, textarea, [contenteditable='true']")) {
          e.preventDefault();
        }
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );

  window.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    },
    { passive: false }
  );
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

syncViewportHeight();
syncPlatformChromeOffset();
preventMobileZoom();
setupScrollLockdown();

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
    createApp(App).use(router).mount("#app");
    const splash = document.getElementById("splash");
    if (splash) {
      // Laisse un tick pour que Vue finisse le premier rendu
      requestAnimationFrame(() => {
        splash.classList.add("is-hidden");
        splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      });
    }
  });
