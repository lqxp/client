import { ref, computed } from "vue";
import { apiUrl } from "@/config/runtime";
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
const currentVersion = ref("1.13.11");
const newVersion = ref("");
const releaseNotes = ref("");
const errorDetails = ref("");
const countdownSeconds = ref(3);

let countdownInterval: ReturnType<typeof setInterval> | null = null;
let listenerInitialized = false;

export function useUpdater() {
  const { t } = useI18n();

  const isTauri = computed(() => {
    return (
      "__TAURI_INTERNALS__" in window ||
      "__TAURI__" in window ||
      "__TAURI_IPC__" in window
    );
  });

  function initTrayListener() {
    if (listenerInitialized || typeof window === "undefined") return;
    listenerInitialized = true;

    window.addEventListener("qx:check-updates", () => {
      checkForUpdates(true);
    });

    if (isTauri.value) {
      const eventPkg = "@tauri-apps/api/event";
      import(/* @vite-ignore */ eventPkg)
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

  async function fetchLatestReleaseInfo() {
    try {
      const response = await fetch(apiUrl("api/release"), { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json();
      return {
        tag_name: data.tag_name || data.name || "",
        body: data.body || "",
        assets: data.assets || [],
      };
    } catch {
      return null;
    }
  }

  function resetState() {
    phase.value = "idle";
    currentStep.value = 1;
    step1Status.value = "pending";
    step2Status.value = "pending";
    progressPercent.value = 0;
    errorDetails.value = "";
    countdownSeconds.value = 3;
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  async function startRealTauriUpdate() {
    phase.value = "downloading";
    currentStep.value = 1;
    step1Status.value = "active";
    step2Status.value = "pending";

    try {
      const updaterPkg = "@tauri-apps/plugin-updater";
      const updaterModule = await import(/* @vite-ignore */ updaterPkg).catch(() => null);
      if (!updaterModule) {
        throw new Error(t("updater.error"));
      }

      const update = await updaterModule.check();
      if (!update) {
        phase.value = "upToDate";
        setTimeout(() => {
          isCheckActive.value = false;
          phase.value = "idle";
        }, 1200);
        return;
      }

      let downloadedBytes = 0;
      let totalBytes = 0;

      await update.downloadAndInstall((event: any) => {
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

      await new Promise((resolve) => setTimeout(resolve, 1000));

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
        const processPkg = "@tauri-apps/plugin-process";
        const processModule = await import(/* @vite-ignore */ processPkg).catch(() => null);
        if (processModule && processModule.relaunch) {
          await processModule.relaunch();
          return;
        }
      } catch { }
    }
    window.location.reload();
  }

  async function checkForUpdates(forceManual = false) {
    if (!isTauri.value && !forceManual) {
      return;
    }

    resetState();
    isCheckActive.value = true;
    phase.value = "checking";

    const minAnimationDelay = new Promise((resolve) => setTimeout(resolve, 1400));

    let updateFound = false;
    let fetchedVersion = "";
    let notes = "";

    try {
      const releaseInfo = await fetchLatestReleaseInfo();
      if (releaseInfo && releaseInfo.tag_name) {
        fetchedVersion = releaseInfo.tag_name.replace(/^v/, "").trim();
        notes = releaseInfo.body || "";
        if (fetchedVersion && fetchedVersion !== currentVersion.value) {
          updateFound = true;
        }
      }
    } catch { }

    await minAnimationDelay;

    if (!updateFound && !forceManual) {
      phase.value = "upToDate";
      setTimeout(() => {
        isCheckActive.value = false;
        phase.value = "idle";
      }, 1200);
      return;
    }

    if (updateFound || forceManual) {
      newVersion.value = fetchedVersion || "1.14.0";
      releaseNotes.value = notes;
      phase.value = "found";

      setTimeout(() => {
        startRealTauriUpdate();
      }, 1200);
    }
  }

  function dismissOverlay() {
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
    isTauri,
    checkForUpdates,
    dismissOverlay,
    retryUpdate,
    triggerRelaunch,
  };
}
