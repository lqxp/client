import { ref, computed } from "vue";
import { useI18n } from "@/composables/useI18n";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "found"
  | "downloading"
  | "installing"
  | "completed"
  | "error";

export type StepStatus = "pending" | "active" | "completed" | "error";

const isCheckActive = ref(false);
const phase = ref<UpdatePhase>("idle");
const currentStep = ref<1 | 2>(1);
const step1Status = ref<StepStatus>("pending");
const step2Status = ref<StepStatus>("pending");
const progressPercent = ref(0);
const currentVersion = ref(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.15.0");
const newVersion = ref("");
const releaseNotes = ref("");
const errorDetails = ref("");
const countdownSeconds = ref(3);
const updateAvailable = ref(false);
const skipDrawerVisible = ref(false);

let countdownInterval: ReturnType<typeof setInterval> | null = null;
let listenerInitialized = false;
let pendingUpdateObj: any = null;
let skipRequested = false;
let skipDrawerTimeout: ReturnType<typeof setTimeout> | null = null;

export function useUpdater() {
  const { t } = useI18n();

  const isTauri = computed(() => {
    const hasTauriGlobals =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window ||
        "__TAURI__" in window ||
        "__TAURI_IPC__" in window);
        
    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      
    return hasTauriGlobals && !isMobile;
  });

  function initTrayListener() {
    if (listenerInitialized || typeof window === "undefined") return;
    listenerInitialized = true;

    window.addEventListener("qx:check-updates", () => {
      checkForUpdates(true);
    });

    if (isTauri.value) {
      import("@tauri-apps/api/event")
        .then((eventModule) => {
          if (eventModule && eventModule.listen) {
            eventModule.listen("qx:check-updates", () => {
              checkForUpdates(true);
            });
          }
        })
        .catch(() => {});
    }
  }

  function triggerCheckUpdatesEvent() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("qx:check-updates"));
    }
    if (isTauri.value) {
      import("@tauri-apps/api/event")
        .then((eventModule) => {
          if (eventModule && eventModule.emit) {
            eventModule.emit("qx:check-updates");
          }
        })
        .catch(() => {});
    }
  }

  function clearSkipDrawerTimer() {
    if (skipDrawerTimeout) {
      clearTimeout(skipDrawerTimeout);
      skipDrawerTimeout = null;
    }
  }

  function showSkipDrawer() {
    clearSkipDrawerTimer();
    skipDrawerVisible.value = true;
    skipDrawerTimeout = setTimeout(() => {
      skipDrawerVisible.value = false;
      skipDrawerTimeout = null;
    }, 5000);
  }

  function hideSkipDrawer() {
    clearSkipDrawerTimer();
    skipDrawerVisible.value = false;
  }

  function resetState() {
    phase.value = "idle";
    currentStep.value = 1;
    step1Status.value = "pending";
    step2Status.value = "pending";
    progressPercent.value = 0;
    errorDetails.value = "";
    countdownSeconds.value = 3;
    pendingUpdateObj = null;
    hideSkipDrawer();
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  async function sendUpdateNotification(version: string) {
    if (!isTauri.value) return;
    try {
      const notifModule = await import("@tauri-apps/plugin-notification").catch(() => null);
      if (notifModule) {
        let granted = await notifModule.isPermissionGranted();
        if (!granted) {
          const permission = await notifModule.requestPermission();
          granted = permission === "granted";
        }
        if (granted) {
          notifModule.sendNotification({
            title: "QxChat Update",
            body: `A new version (v${version}) is available.`,
          });
        }
      }
    } catch { }
  }

  async function performUpdate() {
    if (!pendingUpdateObj) {
      try {
        const updaterModule = await import("@tauri-apps/plugin-updater").catch(() => null);
        if (updaterModule) {
          pendingUpdateObj = await updaterModule.check();
        }
      } catch { }
    }

    if (!pendingUpdateObj) {
      phase.value = "error";
      errorDetails.value = t("updater.error");
      return;
    }

    phase.value = "downloading";
    currentStep.value = 1;
    step1Status.value = "active";
    step2Status.value = "pending";

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      await pendingUpdateObj.downloadAndInstall((event: any) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength || 0;
          if (totalBytes > 0) {
            progressPercent.value = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          }
        }
      });

      step1Status.value = "completed";
      currentStep.value = 2;
      step2Status.value = "active";
      phase.value = "installing";
      progressPercent.value = 100;

      step2Status.value = "completed";
      phase.value = "completed";
      startCountdown();
    } catch (err: any) {
      console.error("Failed to perform Tauri update:", err);
      step1Status.value = "error";
      step2Status.value = "error";
      phase.value = "error";
      errorDetails.value = err?.message || t("updater.error");
    }
  }

  function startCountdown() {
    countdownSeconds.value = 3;
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
      countdownSeconds.value -= 1;
      if (countdownSeconds.value <= 0) {
        if (countdownInterval) clearInterval(countdownInterval);
        triggerRelaunch();
      }
    }, 1000);
  }

  async function triggerRelaunch() {
    if (isTauri.value) {
      try {
        const processModule = await import("@tauri-apps/plugin-process").catch(() => null);
        if (processModule && processModule.relaunch) {
          await processModule.relaunch();
          return;
        }
      } catch { }
    }
    window.location.reload();
  }

  async function checkForUpdates(forceManual = false) {
    if (!isTauri.value) {
      return;
    }

    resetState();
    skipRequested = false;

    // Startup auto-check: surface a discreet skip drawer in the corner instead of
    // blocking the app with the full-screen overlay while we look for an update.
    if (forceManual) {
      isCheckActive.value = true;
      hideSkipDrawer();
    } else {
      isCheckActive.value = false;
      showSkipDrawer();
    }
    phase.value = "checking";

    const searchMinTime = new Promise((resolve) => setTimeout(resolve, 1200));

    try {
      const updaterModule = await import("@tauri-apps/plugin-updater").catch(() => null);
      if (!updaterModule) {
        throw new Error("Updater plugin unavailable");
      }

      const updatePromise = updaterModule.check();
      const [update] = await Promise.all([updatePromise, searchMinTime]);

      if (skipRequested) {
        hideSkipDrawer();
        return;
      }

      if (!update || !update.available) {
        updateAvailable.value = false;
        if (forceManual) {
          phase.value = "upToDate";
          setTimeout(() => {
            isCheckActive.value = false;
            phase.value = "idle";
          }, 1600);
        } else {
          hideSkipDrawer();
          phase.value = "idle";
        }
        return;
      }

      updateAvailable.value = true;
      pendingUpdateObj = update;
      newVersion.value = update.version || "";
      releaseNotes.value = update.body || "";
      phase.value = "found";

      // An update was found: swap the skip drawer for the full progress overlay.
      if (!forceManual) {
        hideSkipDrawer();
        isCheckActive.value = true;
      }

      sendUpdateNotification(newVersion.value);
      performUpdate();
    } catch (err: any) {
      await searchMinTime;
      console.error("Failed to check for updates:", err);
      if (skipRequested) {
        hideSkipDrawer();
        return;
      }
      if (forceManual) {
        phase.value = "error";
        errorDetails.value = err?.message || t("updater.error");
      } else {
        isCheckActive.value = false;
        hideSkipDrawer();
        phase.value = "idle";
      }
    }
  }

  function dismissOverlay() {
    isCheckActive.value = false;
    resetState();
  }

  function skipUpdate() {
    skipRequested = true;
    isCheckActive.value = false;
    resetState();
  }

  function retryUpdate() {
    checkForUpdates(true);
  }

  initTrayListener();

  return {
    isCheckActive,
    phase,
    currentStep,
    step1Status,
    step2Status,
    progressPercent,
    currentVersion,
    newVersion,
    releaseNotes,
    errorDetails,
    countdownSeconds,
    updateAvailable,
    isTauri,
    skipDrawerVisible,
    checkForUpdates,
    triggerCheckUpdatesEvent,
    dismissOverlay,
    skipUpdate,
    retryUpdate,
    triggerRelaunch,
    performUpdate,
  };
}
