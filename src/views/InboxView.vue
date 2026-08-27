<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "@/composables/useI18n";
import { useMessenger } from "@/composables/useMessenger";
import { usePhantom } from "@/composables/usePhantom";
import { useDialog } from "@/composables/useDialog";
import { usePermissions } from "@/composables/usePermissions";
import { useBackground } from "@/composables/useBackground";
import { onTorStatus, torStatus as fetchTorStatus, isTauriDesktopRuntime as isTorRuntime } from "@/calls/tor";
import MessengerSidebar from "@/components/MessengerSidebar.vue";
import MemberSidebar from "@/components/MemberSidebar.vue";
import ThreadHeader from "@/components/ThreadHeader.vue";
import MessageList from "@/components/MessageList.vue";
import ComposerBar from "@/components/ComposerBar.vue";
import CallPanel from "@/components/CallPanel.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import OnboardingScreen from "@/components/OnboardingScreen.vue";
import LockScreen from "@/components/LockScreen.vue";
import BadgeIcon from "@/components/BadgeIcon.vue";
import BanOverlay from "@/components/BanOverlay.vue";
import RoomBanOverlay from "@/components/RoomBanOverlay.vue";
import DialogModal from "@/components/DialogModal.vue";
import SpotlightSearch from "@/components/SpotlightSearch.vue";
import ProfileCard from "@/components/ProfileCard.vue";
import ThemeToggleButton from "@/components/ThemeToggleButton.vue";
import CapWidget from "@/components/CapWidget.vue";

const messenger = useMessenger();
const phantom = usePhantom(messenger);
const dialog = useDialog();
const permissions = usePermissions();
const background = useBackground();
provide("dialog", dialog);
provide("phantom", phantom);
const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

// Publie la prékey dès l'identification (sinon le flux « Pseudo » échoue si
// l'utilisateur n'a jamais ouvert le panneau Amis : l'op 36 doit partir une
// fois le WS authentifié, pas seulement à l'ouverture du panneau).
watch(
  () => messenger.state.identified,
  (identified) => {
    if (!identified) return;
    phantom.ensurePrekey().catch(() => {});
    phantom.loadRoster().catch(() => {});
    phantom.startScheduler();
  },
  { immediate: true },
);
const TITLEBAR_TRAY_STORAGE_KEY = "lqxp:titlebar-tray-items";
const TITLEBAR_ACTIONS = ["streamer", "settings", "lock", "theme", "logout"] as const;
const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
const isAndroidRuntime = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent) && isTauri;
const isMacOS = typeof navigator !== "undefined" && /Macintosh/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
const isWebDesktopRuntime = typeof window !== "undefined" && !isTauri && window.matchMedia("(min-width: 901px) and (hover: hover) and (pointer: fine)").matches;
const showNativeTitlebar = isTauri && !isAndroidRuntime;
const showAuthTitlebar = showNativeTitlebar;
const showDesktopTitlebar = showNativeTitlebar || isWebDesktopRuntime;
const showWindowControls = showNativeTitlebar && !isMacOS;
const appWindow = showNativeTitlebar ? getCurrentWindow() : null;

type TitlebarAction = typeof TITLEBAR_ACTIONS[number];

const mobileThreadOpen = ref(false);
const showMobileMembers = ref(false);
const spotlightOpen = ref(false);
const spotlightProfile = ref("");
const settingsInitialSection = ref("profile");
const titlebarTrayOpen = ref(false);
const titlebarTrayRef = ref<HTMLElement | null>(null);
const titlebarTrayItems = ref<TitlebarAction[]>([]);
const isWindowMaximized = ref(false);

const isLocked = computed(() => messenger.state.clientLockLocked);
const sessionExpired = computed(() => !isLocked.value && messenger.state.sessionExpired);
const needsOnboarding = computed(
  () =>
    !isLocked.value
    && !sessionExpired.value
    && (!String(messenger.state.authToken || "").trim() || !String(messenger.state.username || "").trim()),
);
const renewPassword = ref("");
const renewCapToken = ref<string | null>(null);
const renewCapWidgetRef = ref<{ reset: () => void } | null>(null);
const sessionThemeSwitchVisible = ref(false);

function showSessionThemeSwitch() {
  sessionThemeSwitchVisible.value = true;
}

function hideSessionThemeSwitch() {
  sessionThemeSwitchVisible.value = false;
}

async function submitSessionRenewal() {
  if (!renewCapToken.value) {
    messenger.state.lastError = "Please complete the CAPTCHA.";
    messenger.showToast(messenger.state.lastError);
    return;
  }
  const ok = await messenger.renewSession(renewPassword.value, renewCapToken.value);
  if (ok && !messenger.state.sessionExpired) {
    renewPassword.value = "";
    renewCapToken.value = null;
    renewCapWidgetRef.value?.reset();
  } else {
    renewCapToken.value = null;
    renewCapWidgetRef.value?.reset();
  }
}

function cancelSessionRenewal() {
  messenger.dismissSessionExpired();
  renewPassword.value = "";
  renewCapToken.value = null;
  renewCapWidgetRef.value?.reset();
}

const hasActive = computed(() => !!messenger.roomLabel.value);
const activeRoomBanned = computed(() => messenger.isBannedFromRoom(messenger.state.activeRoom));
const activeRoomBannedLabel = computed(() => messenger.displayRoomName(messenger.state.activeRoom));
const inCall = computed(() => messenger.state.inCall);
const callRoom = computed(() => messenger.state.callRoom);
const callRoomLabel = computed(() => messenger.displayRoomName(callRoom.value));
const callRoomDifferent = computed(() => inCall.value && callRoom.value !== messenger.state.activeRoom);
const callElapsed = computed(() => messenger.formatDuration(messenger.state.callElapsed));
const desktopConversationSelected = computed(() => !!String(messenger.state.activeRoom || "").trim());
const desktopTitle = computed(() => {
  if (messenger.state.settingsOpen) return t("settings.title");
  return desktopConversationSelected.value ? messenger.displayRoomNameBeautified(messenger.state.activeRoom) : "QxChat";
});
const desktopAccent = computed(() => messenger.activeConversation.value?.accent || "slate");
const desktopInitials = computed(() => {
  const name = String(desktopTitle.value || "?").trim();
  const parts = name.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
});
const desktopRoomIcon = computed(() => messenger.roomIcon?.(messenger.state.activeRoom) || "");
const desktopRoomIconIsImage = computed(() => {
  const icon = String(desktopRoomIcon.value || "").trim();
  return !!icon && !icon.startsWith("data:");
});

const isMobile = computed(() =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches
);

// Drag & drop files over the open conversation.
const composerBarRef = ref<{ addFiles: (files: File[]) => void } | null>(null);
const fileDragDepth = ref(0);
const isFileDrag = computed(() => fileDragDepth.value > 0);

function dragEventHasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function onThreadDragEnter(event: DragEvent) {
  if (!dragEventHasFiles(event)) return;
  event.preventDefault();
  fileDragDepth.value += 1;
}

function onThreadDragOver(event: DragEvent) {
  if (!dragEventHasFiles(event)) return;
  event.preventDefault();
}

function onThreadDragLeave(event: DragEvent) {
  if (!dragEventHasFiles(event)) return;
  fileDragDepth.value = Math.max(0, fileDragDepth.value - 1);
}

function onThreadDrop(event: DragEvent) {
  if (!dragEventHasFiles(event)) return;
  event.preventDefault();
  fileDragDepth.value = 0;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) composerBarRef.value?.addFiles(files);
}

// Swipe-to-members on mobile
let touchStartX = 0;
let touchStartY = 0;

function onThreadTouchStart(event: TouchEvent) {
  if (!isMobile.value) return;
  touchStartX = event.touches[0].clientX;
  touchStartY = event.touches[0].clientY;
}

function onThreadTouchEnd(event: TouchEvent) {
  if (!isMobile.value) return;
  const dx = (event.changedTouches[0]?.clientX || 0) - touchStartX;
  const dy = (event.changedTouches[0]?.clientY || 0) - touchStartY;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return; // not horizontal enough
  // Swipe left → open members panel
  if (dx < -60) {
    showMobileMembers.value = true;
  }
  // Swipe right while members open → close members
  else if (dx > 60 && showMobileMembers.value) {
    showMobileMembers.value = false;
  }
  // Swipe right from thread → back to conversation list
  else if (dx > 60) {
    showConversationList();
  }
}

function closeMobileMembers() {
  showMobileMembers.value = false;
}

const titlebarMainItems = computed(() => TITLEBAR_ACTIONS.filter((action) => !titlebarTrayItems.value.includes(action)));
const titlebarTrayActionItems = computed(() => TITLEBAR_ACTIONS.filter((action) => titlebarTrayItems.value.includes(action)));
const titlebarTrayEmpty = computed(() => titlebarTrayActionItems.value.length === 0);
const titlebarResolvedTheme = computed(() => resolveThemeMode(messenger.state.themeMode || "system"));

let adaptiveThemeTimer: ReturnType<typeof setInterval> | null = null;
let systemThemeMedia: MediaQueryList | null = null;

watch(
  needsOnboarding,
  (required) => {
    if (!required && !messenger.state.connected && !messenger.state.ws) {
      messenger.connect();
    }
  },
  { immediate: true },
);

// Once the user reaches the home screen (authenticated and unlocked), request
// every native runtime permission required by the client in one pass instead of
// relying on the Web runtime (camera/micro/notifications/media).
let permissionsRequested = false;
watch(
  () =>
    !isLocked.value
    && !sessionExpired.value
    && !needsOnboarding.value
    && Boolean(String(messenger.state.authToken || "").trim()),
  (ready) => {
    if (!ready || permissionsRequested) return;
    permissionsRequested = true;
    permissions.request();
  },
  { immediate: true },
);

// Start / stop the background keep-alive (native foreground service) following
// the authentication state, so the WebSocket that receives new messages survives
// while the app is backgrounded — and it shuts down on lock/logout.
let backgroundStarted = false;
watch(
  () =>
    !isLocked.value
    && !sessionExpired.value
    && !needsOnboarding.value
    && Boolean(String(messenger.state.authToken || "").trim()),
  (ready) => {
    if (ready) {
      if (!backgroundStarted) {
        backgroundStarted = true;
        background.start();
      }
    } else if (backgroundStarted) {
      backgroundStarted = false;
      background.stop();
    }
  },
  { immediate: true },
);

// (Tor auto-start/stop previously lived here; removed — the backend now owns
// bootstrap on boot via the persisted marker, and the frontend only mirrors
// state, see `syncTorEnabledFromBackend` above.)

// Keep the persisted `torEnabled` flag in sync with the backend's real state,
// The backend is now the single source of truth for Tor's on/off state: a
// user toggle persists the setting server-side (backend marker) and restarts
// the app, and the backend bootstraps Tor itself on boot when the marker is
// set. So we no longer drive bootstrap from the frontend (which previously
// raced the backend and left a stale `torEnabled` flag); we only mirror the
// backend's real state into `torEnabled` for the UI.
let unsubTorSync: (() => void) | null = null;
function syncTorEnabledFromBackend() {
  if (!isTorRuntime()) return;

  // Seed from the backend's real state immediately (the backend may have
  // bootstrapped before the frontend loaded).
  fetchTorStatus().then((s) => {
    if (Boolean(s.running) !== Boolean(messenger.state.torEnabled)) {
      messenger.setTorEnabled(Boolean(s.running));
    }
  }).catch(() => {});

  unsubTorSync = onTorStatus((s) => {
    if (Boolean(s.running) !== Boolean(messenger.state.torEnabled)) {
      messenger.setTorEnabled(Boolean(s.running));
    }
  });
}

onMounted(syncTorEnabledFromBackend);
onBeforeUnmount(() => unsubTorSync?.());

watch(
  () => messenger.state.activeRoom,
  (room) => {
    mobileThreadOpen.value = !!room;
  },
  { immediate: true },
);

function systemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveThemeMode(mode: string) {
  if (mode === "system") return systemTheme();
  const hour = new Date().getHours();
  const adaptiveTheme = hour >= 7 && hour < 19 ? "light" : "dark";
  return mode === "adaptive" ? adaptiveTheme : mode;
}

function applyAppearance() {
  const theme = resolveThemeMode(messenger.state.themeMode || "system");
  const lockTheme = resolveThemeMode(messenger.state.clientLockThemeMode || messenger.state.themeMode || "system");

  document.documentElement.setAttribute("data-theme", theme || "dark");
  document.documentElement.setAttribute("data-lock-theme", lockTheme || "dark");
  document.documentElement.setAttribute("data-accent", messenger.state.appAccent || "blue");
  document.documentElement.setAttribute("data-message-style", messenger.state.messageStyle || "bubble");

  // Sync the native Tauri window titlebar with the active theme.
  // The lock screen uses its own theme, so use lockTheme when locked.
  if (appWindow) {
    const activeTheme = isLocked.value ? lockTheme : theme;
    const nativeTheme = activeTheme === "light" ? "light" : "dark";
    appWindow.setTheme?.(nativeTheme).catch?.(() => {});
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!titlebarTrayOpen.value) return;
  const target = event.target as Node | null;
  if (target && titlebarTrayRef.value?.contains(target)) return;
  titlebarTrayOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") titlebarTrayOpen.value = false;
  if ((event.ctrlKey || event.metaKey) && event.key === "k") {
    event.preventDefault();
    if (messenger.state.spotlightSearchEnabled && !isMobile.value) {
      spotlightOpen.value = !spotlightOpen.value;
    }
  }
}

function toggleStreamerMode() {
  messenger.setStreamerMode(!messenger.state.streamerMode);
}

function titlebarActionLabel(action: TitlebarAction) {
  if (action === "streamer") return messenger.state.streamerMode ? t("titlebar.disableStreamer") : t("titlebar.enableStreamer");
  if (action === "settings") return t("sidebar.settings");
  if (action === "theme") return titlebarResolvedTheme.value === "light" ? t("settings.ui.dark") : t("settings.ui.light");
  if (action === "logout") return t("settings.security.logout");
  return t("settings.security.lockNow");
}

function loadTitlebarTrayItems() {
  try {
    const raw = JSON.parse(localStorage.getItem(TITLEBAR_TRAY_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is TitlebarAction => (TITLEBAR_ACTIONS as readonly string[]).includes(item));
  } catch {
    return [];
  }
}

function persistTitlebarTrayItems() {
  localStorage.setItem(TITLEBAR_TRAY_STORAGE_KEY, JSON.stringify(titlebarTrayItems.value));
}

function isInTitlebarTray(action: TitlebarAction) {
  return titlebarTrayItems.value.includes(action);
}

function toggleTitlebarActionLocation(action: TitlebarAction) {
  if (isInTitlebarTray(action)) titlebarTrayItems.value = titlebarTrayItems.value.filter((item) => item !== action);
  else titlebarTrayItems.value = [...titlebarTrayItems.value, action];
  persistTitlebarTrayItems();
}

function moveTitlebarActionToTray(action: TitlebarAction) {
  if (isInTitlebarTray(action)) return;
  titlebarTrayItems.value = [...titlebarTrayItems.value, action];
  persistTitlebarTrayItems();
}

function runTitlebarAction(action: TitlebarAction) {
  if (action === "streamer") {
    toggleStreamerMode();
    return;
  }
  if (action === "settings") {
    openSettings();
    titlebarTrayOpen.value = false;
    return;
  }
  if (action === "theme") {
    messenger.setThemeMode(titlebarResolvedTheme.value === "light" ? "dark" : "light");
    return;
  }
  if (action === "logout") {
    messenger.logoutAccount();
    titlebarTrayOpen.value = false;
    return;
  }
  lockClientNow();
  titlebarTrayOpen.value = false;
}

function toggleTitlebarTray() {
  titlebarTrayOpen.value = !titlebarTrayOpen.value;
}

async function syncWindowMaximizedState() {
  if (!appWindow) return;
  isWindowMaximized.value = await appWindow.isMaximized();
}

async function minimizeNativeWindow() {
  await appWindow?.minimize();
}

async function toggleNativeMaximize(event?: MouseEvent) {
  if (!appWindow || (event?.target as HTMLElement | null)?.closest("button")) return;
  await appWindow.toggleMaximize();
  await syncWindowMaximizedState();
}

async function closeNativeWindow() {
  await appWindow?.close();
}

async function startNativeDrag(event: PointerEvent) {
  if (!appWindow || event.button !== 0 || event.detail > 1 || (event.target as HTMLElement | null)?.closest("button")) return;
  await appWindow.startDragging();
}

function syncAppearanceWatchers() {
  if (adaptiveThemeTimer) {
    clearInterval(adaptiveThemeTimer);
    adaptiveThemeTimer = null;
  }
  systemThemeMedia?.removeEventListener("change", applyAppearance);
  systemThemeMedia = null;

  const modes = [messenger.state.themeMode, messenger.state.clientLockThemeMode];
  if (modes.includes("adaptive")) {
    adaptiveThemeTimer = setInterval(applyAppearance, 60_000);
  }
  if (modes.includes("system") && typeof window !== "undefined" && window.matchMedia) {
    systemThemeMedia = window.matchMedia("(prefers-color-scheme: light)");
    systemThemeMedia.addEventListener("change", applyAppearance);
  }
}

watch(
  () => [messenger.state.themeMode, messenger.state.clientLockThemeMode, messenger.state.appAccent, messenger.state.messageStyle, isLocked.value],
  () => {
    syncAppearanceWatchers();
    applyAppearance();
  },
  { immediate: true },
);

onMounted(() => {
  titlebarTrayItems.value = loadTitlebarTrayItems();
  void syncWindowMaximizedState();
  if (messenger.state.authToken) messenger.refreshSession();
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
});

onBeforeUnmount(() => {
  if (adaptiveThemeTimer) clearInterval(adaptiveThemeTimer);
  systemThemeMedia?.removeEventListener("change", applyAppearance);
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
});

function showConversationList() {
  mobileThreadOpen.value = false;
}

function showConversationThread() {
  mobileThreadOpen.value = true;
}

function goToCallRoom() {
  if (callRoom.value && callRoom.value !== messenger.state.activeRoom) {
    messenger.selectConversation(callRoom.value);
  }
}

function openSettings(section = "profile") {
  settingsInitialSection.value = section;
  messenger.state.settingsOpen = true;
}

async function lockClientNow() {
  if (!messenger.state.clientLockEnabled) {
    openSettings("security");
    return;
  }
  const locked = await messenger.lockClient();
  if (!locked) openSettings("security");
}
</script>

<template>
  <BanOverlay
    v-if="messenger.state.isBanned"
    :message="messenger.state.banMessage"
  />

  <div v-if="isLocked" class="app app--auth"
    :class="{ 'app--desktop-titlebar app--lock-titlebar': showAuthTitlebar, 'is-tauri': showNativeTitlebar, 'is-macos': isMacOS }">
    <header v-if="showAuthTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div v-if="showWindowControls" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
        <button class="desktop-titlebar__window-button" type="button" aria-label="Minimiser"
          @click="minimizeNativeWindow">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 8.5h8" />
          </svg>
        </button>
        <button class="desktop-titlebar__window-button" type="button"
          :aria-label="isWindowMaximized ? 'Restaurer' : 'Maximiser'" @click="toggleNativeMaximize()">
          <svg v-if="isWindowMaximized" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4.5 2.5h5v5" />
            <path d="M2.5 4.5h5v5h-5z" />
          </svg>
          <svg v-else viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3h6v6H3z" />
          </svg>
        </button>
        <button class="desktop-titlebar__window-button desktop-titlebar__window-button--close" type="button"
          aria-label="Fermer" @click="closeNativeWindow">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3 3 6 6" />
            <path d="m9 3-6 6" />
          </svg>
        </button>
      </div>
    </header>
    <LockScreen :messenger="messenger" />
  </div>
  <div v-else-if="sessionExpired" class="app app--auth"
    :class="{ 'app--onboarding-titlebar is-tauri': showAuthTitlebar, 'is-macos': isMacOS }">
    <header v-if="showAuthTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div v-if="showWindowControls" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
        <button class="desktop-titlebar__window-button" type="button" aria-label="Minimiser"
          @click="minimizeNativeWindow">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5h8" /></svg>
        </button>
        <button class="desktop-titlebar__window-button" type="button"
          :aria-label="isWindowMaximized ? 'Restaurer' : 'Maximiser'" @click="toggleNativeMaximize()">
          <svg v-if="isWindowMaximized" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4.5 2.5h5v5" /><path d="M2.5 4.5h5v5h-5z" />
          </svg>
          <svg v-else viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3h6v6H3z" /></svg>
        </button>
        <button class="desktop-titlebar__window-button desktop-titlebar__window-button--close" type="button"
          aria-label="Fermer" @click="closeNativeWindow">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6" /><path d="m9 3-6 6" /></svg>
        </button>
      </div>
    </header>
    <section class="session-renew">
      <div class="session-renew__card" @mouseenter="hideSessionThemeSwitch" @mouseleave="showSessionThemeSwitch">
        <div class="session-renew__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 class="session-renew__title">{{ t('sessionExpired.title') }}</h1>
        <p class="session-renew__sub">{{ t('sessionExpired.subtitle') }}</p>

        <form class="session-renew__form" @submit.prevent="submitSessionRenewal">
          <label class="session-renew__field">
            <span>{{ t('settings.security.username') }}</span>
            <input type="text" :value="messenger.state.username" disabled autocomplete="username" spellcheck="false" />
          </label>
          <label class="session-renew__field">
            <span>{{ t('sessionExpired.password') }}</span>
            <input v-model="renewPassword" type="password" maxlength="128" autocomplete="current-password"
              :placeholder="t('onboarding.passwordPlaceholder')" />
          </label>
          <CapWidget
            ref="renewCapWidgetRef"
            scope="login"
            :target="messenger.state.username"
            @solve="(payload) => renewCapToken = payload.token"
            @reset="renewCapToken = null"
          />
          <button class="session-renew__btn session-renew__btn--primary" type="submit"
            :disabled="!renewPassword || !renewCapToken || messenger.state.authLoading">
            {{ messenger.state.authLoading ? t('sessionExpired.renewing') : t('sessionExpired.renew') }}
          </button>
          <button type="button" class="session-renew__btn session-renew__btn--secondary"
            @click="cancelSessionRenewal">
            {{ t('sessionExpired.logoutInstead') }}
          </button>
        </form>
      </div>
      <ThemeToggleButton :messenger="messenger" :visible="sessionThemeSwitchVisible" />
    </section>
  </div>
  <div v-else-if="needsOnboarding" class="app app--auth"
    :class="{ 'app--onboarding-titlebar is-tauri': showAuthTitlebar, 'is-macos': isMacOS }">
    <header v-if="showAuthTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div v-if="showWindowControls" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
        <button class="desktop-titlebar__window-button" type="button" aria-label="Minimiser"
          @click="minimizeNativeWindow">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 8.5h8" />
          </svg>
        </button>
        <button class="desktop-titlebar__window-button" type="button"
          :aria-label="isWindowMaximized ? 'Restaurer' : 'Maximiser'" @click="toggleNativeMaximize()">
          <svg v-if="isWindowMaximized" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4.5 2.5h5v5" />
            <path d="M2.5 4.5h5v5h-5z" />
          </svg>
          <svg v-else viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3h6v6H3z" />
          </svg>
        </button>
        <button class="desktop-titlebar__window-button desktop-titlebar__window-button--close" type="button"
          aria-label="Fermer" @click="closeNativeWindow">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3 3 6 6" />
            <path d="m9 3-6 6" />
          </svg>
        </button>
      </div>
    </header>
    <OnboardingScreen :messenger="messenger" />
  </div>

  <div v-else class="app"
    :class="{ 'app--desktop-titlebar': showDesktopTitlebar, 'is-thread': hasActive && mobileThreadOpen, 'is-tauri': showNativeTitlebar, 'is-web-titlebar': isWebDesktopRuntime }">
    <header v-if="showDesktopTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div class="desktop-titlebar__room">
        <svg v-if="!desktopConversationSelected && !messenger.state.settingsOpen" class="desktop-titlebar__logo" width="22" height="22" viewBox="-3.68 -3.68 23.36 23.36" xmlns="http://www.w3.org/2000/svg">
          <g transform="translate(16 0) scale(-1 1)">
            <g transform="translate(0 1)">
              <path d="M5.939 0C2.666 0 0.009 1.987 0.009 4.438c0 2.236 2.215 4.082 5.092 4.387L3.88 11.26l4.249-2.7C10.318 7.906 12 6.309 12 4.438 12 1.988 9.213 0 5.939 0Z" />
              <path d="M15.947 8.89c0-1.124-1.062-2.288-2.289-2.868-.344 1.95-1.924 3.745-4.417 4.447l-1.187.642c.454.34 1.01.611 1.634.788l3.638 1.971-1.303-1.776c2.217-.225 3.924-1.571 3.924-3.204Z" />
            </g>
          </g>
        </svg>
        <span v-if="desktopConversationSelected && !messenger.state.settingsOpen"
          class="avatar avatar--sm desktop-titlebar__room-icon"
          :class="desktopRoomIconIsImage ? 'desktop-titlebar__room-icon--image' : `avatar--${desktopAccent}`">
          <img v-if="desktopRoomIconIsImage" :src="desktopRoomIcon" alt="" />
          <template v-else>{{ desktopInitials }}</template>
        </span>
        <span class="desktop-titlebar__title">{{ desktopTitle }}</span>
      </div>
      <div ref="titlebarTrayRef" class="desktop-titlebar__actions">
        <div v-for="action in titlebarMainItems" :key="`main-${action}`" class="desktop-titlebar__action-wrap"
          @contextmenu.prevent="moveTitlebarActionToTray(action)">
          <button class="icon-btn"
            :class="{ 'desktop-titlebar__streamer': action === 'streamer', 'is-active': action === 'streamer' && messenger.state.streamerMode }"
            type="button" :aria-pressed="action === 'streamer' ? messenger.state.streamerMode : undefined"
            :aria-label="titlebarActionLabel(action)" :title="titlebarActionLabel(action)"
            @click="runTitlebarAction(action)">
            <svg v-if="action === 'streamer' && messenger.state.streamerMode" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6A2 2 0 0 0 13.4 13.4" />
              <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9 4.5 10 8a12.4 12.4 0 0 1-2.1 3.8" />
              <path d="M6.1 6.1A12.1 12.1 0 0 0 2 12c1 3.5 5 8 10 8 1.5 0 2.9-.4 4.1-1.1" />
            </svg>
            <svg v-else-if="action === 'streamer'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <svg v-else-if="action === 'settings'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z" />
              <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.99 19.4a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.9a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.99a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.99 4.6h.01c.39 0 .76-.14 1.04-.4A1.7 1.7 0 0 0 10.4 3.1V3a2 2 0 1 1 4 0v.09c0 .4.14.77.4 1.05.28.26.65.4 1.04.4h.01a1.7 1.7 0 0 0 1.06-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.27.27-.4.65-.34 1.03v.01c0 .39.14.76.4 1.04.28.26.65.4 1.05.4h.09a2 2 0 1 1 0 4H21.1c-.4 0-.77.14-1.05.4-.26.28-.4.65-.4 1.04Z" />
            </svg>
            <svg v-else-if="action === 'theme' && titlebarResolvedTheme === 'light'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            </svg>
            <svg v-else-if="action === 'theme'" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            <svg v-else-if="action === 'logout'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2" />
              <rect x="5" y="10" width="14" height="10" rx="2" ry="2" />
              <path d="M12 14v2" />
            </svg>
          </button>
        </div>

        <div class="desktop-titlebar__tray" :class="{ 'is-open': titlebarTrayOpen }">
          <button class="icon-btn desktop-titlebar__tray-toggle" type="button" :aria-expanded="titlebarTrayOpen"
            :aria-label="t('titlebar.openTray')" :title="t('titlebar.tray')" @click="toggleTitlebarTray">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 15 12 9l6 6" />
            </svg>
          </button>
          <div v-if="titlebarTrayOpen" class="desktop-titlebar__tray-menu" role="menu"
            :aria-label="t('titlebar.quickActions')">
            <template v-if="titlebarTrayEmpty">
              <div class="desktop-titlebar__tray-hint">{{ t('titlebar.rightClickHint') }}</div>
              <div class="desktop-titlebar__tray-empty">{{ t('titlebar.emptyTray') }}</div>
            </template>
            <template v-else>
              <div v-for="action in titlebarTrayActionItems" :key="`tray-${action}`" class="desktop-titlebar__tray-row">
                <button class="desktop-titlebar__tray-item" type="button" role="menuitem"
                  @click="runTitlebarAction(action)">
                  <svg v-if="action === 'streamer' && messenger.state.streamerMode" viewBox="0 0 24 24"
                    aria-hidden="true">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6A2 2 0 0 0 13.4 13.4" />
                    <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9 4.5 10 8a12.4 12.4 0 0 1-2.1 3.8" />
                    <path d="M6.1 6.1A12.1 12.1 0 0 0 2 12c1 3.5 5 8 10 8 1.5 0 2.9-.4 4.1-1.1" />
                  </svg>
                  <svg v-else-if="action === 'streamer'" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg v-else-if="action === 'settings'" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z" />
                    <path
                      d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.99 19.4a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.9a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.99a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.99 4.6h.01c.39 0 .76-.14 1.04-.4A1.7 1.7 0 0 0 10.4 3.1V3a2 2 0 1 1 4 0v.09c0 .4.14.77.4 1.05.28.26.65.4 1.04.4h.01a1.7 1.7 0 0 0 1.06-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.27.27-.4.65-.34 1.03v.01c0 .39.14.76.4 1.04.28.26.65.4 1.05.4h.09a2 2 0 1 1 0 4H21.1c-.4 0-.77.14-1.05.4-.26.28-.4.65-.4 1.04Z" />
                  </svg>
                  <svg v-else-if="action === 'theme' && titlebarResolvedTheme === 'light'" viewBox="0 0 24 24"
                    aria-hidden="true">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
                  </svg>
                  <svg v-else-if="action === 'theme'" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                  <svg v-else-if="action === 'logout'" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M16 17l5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 10V8a5 5 0 0 1 10 0v2" />
                    <rect x="5" y="10" width="14" height="10" rx="2" ry="2" />
                    <path d="M12 14v2" />
                  </svg>
                  <span>{{ titlebarActionLabel(action) }}</span>
                </button>
                <button class="desktop-titlebar__tray-move" type="button"
                  :aria-label="t('titlebar.moveFromTray', { action: titlebarActionLabel(action) })"
                  :title="t('titlebar.moveFromTray', { action: titlebarActionLabel(action) })"
                  @click="toggleTitlebarActionLocation(action)">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 18 9 12l6-6" />
                  </svg>
                </button>
              </div>
            </template>
          </div>
        </div>

        <div v-if="showWindowControls" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
          <button class="desktop-titlebar__window-button" type="button" aria-label="Minimiser"
            @click="minimizeNativeWindow">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 8.5h8" />
            </svg>
          </button>
          <button class="desktop-titlebar__window-button" type="button"
            :aria-label="isWindowMaximized ? 'Restaurer' : 'Maximiser'" @click="toggleNativeMaximize()">
            <svg v-if="isWindowMaximized" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4.5 2.5h5v5" />
              <path d="M2.5 4.5h5v5h-5z" />
            </svg>
            <svg v-else viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3h6v6H3z" />
            </svg>
          </button>
          <button class="desktop-titlebar__window-button desktop-titlebar__window-button--close" type="button"
            aria-label="Fermer" @click="closeNativeWindow">
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="m3 3 6 6" />
              <path d="m9 3-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <MessengerSidebar :messenger="messenger" @conversation-selected="showConversationThread" @open-spotlight="spotlightOpen = !isMobile && messenger.state.spotlightSearchEnabled" />

    <Teleport to="body">
      <Transition name="toast">
        <div v-if="messenger.state.toastMessage" class="toast" :class="{ 'toast--badge': messenger.state.toastBadge, 'toast--error': messenger.state.toastError }"
          role="status" aria-live="polite">
          <span v-if="messenger.state.toastError" class="toast__error-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <span v-else-if="messenger.state.toastBadge" class="toast__badge-icon">
            <BadgeIcon :badge="messenger.state.toastBadge" :avatar-src="messenger.state.toastBadgeAvatarSrc" />
          </span>
          <span>{{ messenger.state.toastMessage }}</span>
        </div>
      </Transition>
    </Teleport>

    <DialogModal />

    <SpotlightSearch :messenger="messenger" :open="spotlightOpen" @close="spotlightOpen = false" @open-profile="(username) => { spotlightProfile = username }" />

    <!-- Profile card from spotlight -->
    <Teleport to="body">
      <ProfileCard v-if="spotlightProfile" :messenger="messenger" :username="spotlightProfile" @close="spotlightProfile = ''" />
    </Teleport>

    <main v-if="hasActive" class="thread" :class="{ 'thread--members-open': showMobileMembers }"
      @touchstart="onThreadTouchStart" @touchend="onThreadTouchEnd"
      @dragenter="onThreadDragEnter" @dragover="onThreadDragOver"
      @dragleave="onThreadDragLeave" @drop="onThreadDrop">
      <div class="thread__shell">
        <section class="thread__main">
          <ThreadHeader :messenger="messenger" @back="showConversationList" />
          <template v-if="activeRoomBanned">
            <RoomBanOverlay :channel="activeRoomBannedLabel" />
          </template>
          <template v-else>
            <div v-if="callRoomDifferent" class="call-pip" @click="goToCallRoom">
              <span class="call-dot"></span>
              <span class="call-pip__label">{{ t('app.inCall', { room: callRoomLabel, elapsed: callElapsed }) }}</span>
              <button type="button" class="call-pip__end" @click.stop="messenger.endCall" :aria-label="t('call.endCall')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
              </button>
            </div>
            <CallPanel :messenger="messenger" />
            <MessageList :messenger="messenger" />
            <ComposerBar ref="composerBarRef" :messenger="messenger" />
          </template>
        </section>

        <MemberSidebar :messenger="messenger" v-if="!isMobile" />
      </div>

      <Transition name="drop-fade">
        <div v-if="isFileDrag" class="thread__drop-overlay" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{{ t('composer.dropToSend') }}</span>
        </div>
      </Transition>
    </main>

    <div v-else class="no-thread">
      <div>
        <h2>{{ t('app.noConversation') }}</h2>
        <p>{{ t('app.noConversationHint') }}</p>
      </div>
    </div>

    <!-- Mobile: members overlay sliding from right -->
    <Teleport to="body">
      <Transition name="members-fade">
        <div v-if="showMobileMembers" class="members-mobile-backdrop" @click="closeMobileMembers" @touchstart="onThreadTouchStart" @touchend="onThreadTouchEnd" aria-hidden="true"></div>
      </Transition>
      <Transition name="members-slide">
        <MemberSidebar v-if="showMobileMembers" :messenger="messenger" :show-mobile="true" class="members-mobile" @close-mobile="closeMobileMembers" />
      </Transition>
    </Teleport>

    <SettingsModal :messenger="messenger" :initial-section="settingsInitialSection" />
  </div>
</template>

<style scoped>
.desktop-titlebar {
  display: none;
}

.desktop-titlebar__logo {
  fill: rgb(243, 245, 248);
  flex: none;
}

.thread {
  position: relative;
}

.thread__drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--bg);
  color: var(--muted);
  font-size: 16px;
  font-weight: 700;
  border: 2px dashed var(--accent);
  border-radius: 12px;
  pointer-events: none;
}

.thread__drop-overlay svg {
  color: var(--accent);
}

.drop-fade-enter-active,
.drop-fade-leave-active {
  transition: opacity 120ms ease;
}

.drop-fade-enter-from,
.drop-fade-leave-to {
  opacity: 0;
}
</style>

<style>
:root[data-theme="light"] .desktop-titlebar__logo {
  fill: #1b1b1d;
}
</style>

<style scoped>

.app.app--desktop-titlebar.is-tauri,
.app.app--desktop-titlebar.is-web-titlebar,
.app.app--lock-titlebar.is-tauri,
.app.app--lock-titlebar.is-web-titlebar,
.app.app--onboarding-titlebar.is-tauri,
.app.app--onboarding-titlebar.is-web-titlebar {
  grid-template-rows: 30px minmax(0, 1fr);
  align-content: stretch;
}

.app.app--auth,
.app.app--lock-titlebar,
.app.app--onboarding-titlebar.is-tauri {
  display: grid;
  min-height: 100dvh;
  grid-template-columns: minmax(0, 1fr);
}

.app.app--lock-titlebar:not(.is-tauri),
.app.app--onboarding-titlebar:not(.is-tauri) {
  grid-template-rows: minmax(0, 1fr);
}

.app.app--desktop-titlebar.is-tauri>.side,
.app.app--desktop-titlebar.is-web-titlebar>.side,
.app.app--desktop-titlebar.is-tauri>.thread,
.app.app--desktop-titlebar.is-web-titlebar>.thread,
.app.app--desktop-titlebar.is-tauri>.no-thread,
.app.app--desktop-titlebar.is-web-titlebar>.no-thread,
.app.app--lock-titlebar.is-tauri>.lock-screen,
.app.app--lock-titlebar.is-web-titlebar>.lock-screen,
.app.app--onboarding-titlebar.is-tauri>.onboarding,
.app.app--onboarding-titlebar.is-web-titlebar>.onboarding {
  grid-row: 2;
}

.app.app--auth>.lock-screen,
.app.app--auth>.onboarding,
.app.app--lock-titlebar:not(.is-tauri)>.lock-screen,
.app.app--onboarding-titlebar:not(.is-tauri)>.onboarding {
  grid-column: 1 / -1;
  grid-row: 1;
}

.app.app--auth.is-tauri>.lock-screen,
.app.app--auth.is-tauri>.onboarding {
  grid-row: 2;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar,
.app.app--lock-titlebar.is-tauri .desktop-titlebar,
.app.app--lock-titlebar.is-web-titlebar .desktop-titlebar,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar,
.app.app--onboarding-titlebar.is-web-titlebar .desktop-titlebar {
  position: relative;
  z-index: 50;
  grid-column: 1 / -1;
  grid-row: 1;
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  background: color-mix(in srgb, var(--surface) 94%, black 6%);
  backdrop-filter: blur(16px) saturate(1.08);
  user-select: none;
}

.app.app--lock-titlebar.is-tauri .desktop-titlebar,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar {
  border-bottom-color: color-mix(in srgb, var(--lock-titlebar-line) 78%, transparent);
  background: color-mix(in srgb, var(--lock-titlebar-surface) 94%, black 6%);
}

.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-controls,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-controls {
  border-left-color: color-mix(in srgb, var(--lock-titlebar-line) 78%, transparent);
}

.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-button,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button {
  color: color-mix(in srgb, var(--lock-titlebar-text) 78%, transparent);
}

.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-button:hover,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button:hover {
  background: var(--lock-titlebar-hover);
  color: var(--lock-titlebar-text);
}

.app.app--desktop-titlebar.is-tauri :deep(.thread__main) {
  min-width: 0;
}

.app.app--desktop-titlebar.is-tauri :deep(.thread__main > .thread-header) {
  display: none;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__spacer,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__spacer,
.app.app--lock-titlebar.is-tauri .desktop-titlebar__spacer,
.app.app--lock-titlebar.is-web-titlebar .desktop-titlebar__spacer,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__spacer,
.app.app--onboarding-titlebar.is-web-titlebar .desktop-titlebar__spacer {
  flex: 1;
  min-width: 0;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__room,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__room {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: min(520px, calc(100% - 160px));
  min-width: 0;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  overflow: hidden;
  transform: translate(-50%, -50%);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__room-icon,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__room-icon {
  width: 20px;
  height: 20px;
  max-width: 20px;
  max-height: 20px;
  overflow: hidden;
  flex: 0 0 20px;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__room-icon--image,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__room-icon--image {
  background: transparent;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__room-icon img,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__room-icon img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__title,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__title {
  min-width: 0;
  font-size: 12px;
  line-height: 1;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__actions,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__actions {
  position: relative;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex: none;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__actions .icon-btn,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__actions .icon-btn {
  width: 24px;
  height: 24px;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__actions .icon-btn svg,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__actions .icon-btn svg {
  width: 16px;
  height: 16px;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__action-wrap,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__action-wrap {
  position: relative;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__streamer.is-active,
.app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__streamer.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 42%, transparent);
}

@media (max-width: 1120px) {
  .app.app--desktop-titlebar.is-web-titlebar .desktop-titlebar__room {
    display: none;
  }
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__window-controls,
.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-controls,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-controls {
  height: 30px;
  display: flex;
  align-items: stretch;
  margin: 0 -8px 0 8px;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__window-button,
.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-button,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button {
  width: 42px;
  height: 30px;
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--text) 78%, transparent);
  border-radius: 0;
  transition: background-color 120ms ease, color 120ms ease;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__window-button:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__window-button--close:hover,
.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-button--close:hover,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button--close:hover {
  background: var(--red);
  color: #fff;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__window-button svg,
.app.app--lock-titlebar.is-tauri .desktop-titlebar__window-button svg,
.app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray {
  position: relative;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-toggle {
  transition: transform 140ms ease, background-color 140ms ease;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray.is-open .desktop-titlebar__tray-toggle {
  transform: translateY(1px) scale(0.96);
  background: var(--surface-2);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 80;
  min-width: 190px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 94%, black 6%);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(18px) saturate(1.1);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-menu::before {
  content: "";
  position: absolute;
  top: -6px;
  right: 11px;
  width: 10px;
  height: 10px;
  border-left: 1px solid var(--line);
  border-top: 1px solid var(--line);
  background: inherit;
  transform: rotate(45deg);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-hint {
  position: relative;
  z-index: 1;
  max-width: 220px;
  padding: 8px 10px 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-empty {
  position: relative;
  z-index: 1;
  padding: 10px 12px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-item {
  position: relative;
  z-index: 1;
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-item:hover,
.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-move:hover {
  background: var(--surface-2);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-move {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-move:hover {
  color: var(--text);
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-item svg {
  width: 18px;
  height: 18px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-item svg circle {
  fill: none;
}

.app.app--desktop-titlebar.is-tauri .desktop-titlebar__tray-move svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (min-width: 901px) {
  .app.app--desktop-titlebar.is-tauri {
    grid-template-rows: 30px minmax(0, 1fr);
    align-content: stretch;
  }

  .app.app--lock-titlebar,
  .app.app--onboarding-titlebar.is-tauri {
    display: grid;
    min-height: 100dvh;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
  }

  .app.app--lock-titlebar.is-tauri,
  .app.app--onboarding-titlebar.is-tauri {
    grid-template-rows: 30px minmax(0, 1fr);
  }

  .app.app--lock-titlebar>.lock-screen,
  .app.app--onboarding-titlebar.is-tauri>.onboarding {
    grid-row: 1;
  }

  .app.app--lock-titlebar.is-tauri>.lock-screen,
  .app.app--onboarding-titlebar.is-tauri>.onboarding {
    grid-row: 2;
  }

  .app.app--desktop-titlebar.is-tauri>.side,
  .app.app--desktop-titlebar.is-tauri>.thread,
  .app.app--desktop-titlebar.is-tauri>.no-thread {
    grid-row: 2;
  }

  .app.app--desktop-titlebar.is-tauri .desktop-titlebar,
  .app.app--lock-titlebar.is-tauri .desktop-titlebar,
  .app.app--onboarding-titlebar.is-tauri .desktop-titlebar {
    position: relative;
    z-index: 50;
    grid-column: 1 / -1;
    grid-row: 1;
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
    background: color-mix(in srgb, var(--surface) 94%, black 6%);
    backdrop-filter: blur(16px) saturate(1.08);
    user-select: none;
  }

  .app.app--lock-titlebar .desktop-titlebar,
  .app.app--onboarding-titlebar.is-tauri .desktop-titlebar {
    border-bottom-color: color-mix(in srgb, var(--lock-titlebar-line) 78%, transparent);
    background: color-mix(in srgb, var(--lock-titlebar-surface) 94%, black 6%);
  }

  .app.app--lock-titlebar .desktop-titlebar__window-controls,
  .app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-controls {
    border-left-color: color-mix(in srgb, var(--lock-titlebar-line) 78%, transparent);
  }

  .app.app--lock-titlebar .desktop-titlebar__window-button,
  .app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button {
    color: color-mix(in srgb, var(--lock-titlebar-text) 78%, transparent);
  }

  .app.app--lock-titlebar .desktop-titlebar__window-button:hover,
  .app.app--onboarding-titlebar.is-tauri .desktop-titlebar__window-button:hover {
    background: var(--lock-titlebar-hover);
    color: var(--lock-titlebar-text);
  }

  .desktop-titlebar__spacer {
    flex: 1;
  }

  .desktop-titlebar__room {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: min(520px, calc(100% - 160px));
    min-width: 0;
    max-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    overflow: hidden;
    transform: translate(-50%, -50%);
  }

  .desktop-titlebar__room-icon {
    width: 20px;
    height: 20px;
    overflow: hidden;
    flex: none;
  }

  .desktop-titlebar__room-icon--image {
    background: transparent;
  }

  .desktop-titlebar__room-icon img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .desktop-titlebar__title {
    min-width: 0;
    font-size: 12px;
    line-height: 1;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desktop-titlebar__actions {
    position: relative;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .desktop-titlebar__actions .icon-btn {
    width: 24px;
    height: 24px;
  }

  .desktop-titlebar__actions .icon-btn svg {
    width: 16px;
    height: 16px;
  }

  .desktop-titlebar__action-wrap {
    position: relative;
  }

  .desktop-titlebar__tray-move svg {
    width: 12px;
    height: 12px;
  }

  .desktop-titlebar__streamer.is-active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 42%, transparent);
  }

  .desktop-titlebar__window-controls {
    height: 30px;
    display: flex;
    align-items: stretch;
    margin: 0 -8px 0 8px;
    padding-left: 8px;
    border-left: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  }

  .desktop-titlebar__window-button {
    width: 42px;
    height: 30px;
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--text) 78%, transparent);
    border-radius: 0;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .desktop-titlebar__window-button:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .desktop-titlebar__window-button--close:hover {
    background: var(--red);
    color: #fff;
  }

  .desktop-titlebar__window-button svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .desktop-titlebar__tray {
    position: relative;
  }

  .desktop-titlebar__tray-toggle {
    transition: transform 140ms ease, background-color 140ms ease;
  }

  .desktop-titlebar__tray.is-open .desktop-titlebar__tray-toggle {
    transform: translateY(1px) scale(0.96);
    background: var(--surface-2);
  }

  .desktop-titlebar__tray-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 80;
    min-width: 190px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--surface) 94%, black 6%);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px) saturate(1.1);
  }

  .desktop-titlebar__tray-menu::before {
    content: "";
    position: absolute;
    top: -6px;
    right: 11px;
    width: 10px;
    height: 10px;
    border-left: 1px solid var(--line);
    border-top: 1px solid var(--line);
    background: inherit;
    transform: rotate(45deg);
  }

  .desktop-titlebar__tray-hint {
    position: relative;
    z-index: 1;
    max-width: 220px;
    padding: 8px 10px 10px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .desktop-titlebar__tray-empty {
    position: relative;
    z-index: 1;
    padding: 10px 12px;
    color: var(--muted);
    font-size: 13px;
    text-align: center;
  }

  .desktop-titlebar__tray-row {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .desktop-titlebar__tray-item {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .desktop-titlebar__tray-item:hover {
    background: var(--surface-2);
  }

  .desktop-titlebar__tray-move {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .desktop-titlebar__tray-move:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .desktop-titlebar__tray-item svg {
    width: 18px;
    height: 18px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .desktop-titlebar__tray-item svg circle {
    fill: none;
  }

  .desktop-titlebar__tray-move svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  :deep(.thread__main) {
    min-width: 0;
  }

  :deep(.thread__main > .thread-header) {
    display: none;
  }

  /* macOS native traffic lights (overlay): reserve left space so the title
     bar brand/room content never sits under the red/yellow/green controls. */
  .app.is-macos .desktop-titlebar {
    padding-left: 76px;
  }

  .app.is-macos .desktop-titlebar__room {
    left: calc(50% + 38px);
  }

}
</style>
