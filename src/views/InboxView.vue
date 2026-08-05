<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "@/composables/useI18n";
import { useMessenger } from "@/composables/useMessenger";
import { useDialog } from "@/composables/useDialog";
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
import DialogModal from "@/components/DialogModal.vue";

const messenger = useMessenger();
const dialog = useDialog();
provide("dialog", dialog);
const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const TITLEBAR_TRAY_STORAGE_KEY = "lqxp:titlebar-tray-items";
const TITLEBAR_ACTIONS = ["streamer", "settings", "lock"] as const;
const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
const isAndroidRuntime = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent) && isTauri;
const isWebDesktopRuntime = typeof window !== "undefined" && !isTauri && window.matchMedia("(min-width: 901px) and (hover: hover) and (pointer: fine)").matches;
const showNativeTitlebar = isTauri && !isAndroidRuntime;
const showAuthTitlebar = showNativeTitlebar;
const showDesktopTitlebar = showNativeTitlebar || isWebDesktopRuntime;
const appWindow = showNativeTitlebar ? getCurrentWindow() : null;

type TitlebarAction = typeof TITLEBAR_ACTIONS[number];

const mobileThreadOpen = ref(false);
const showMobileMembers = ref(false);
const settingsInitialSection = ref("profile");
const titlebarTrayOpen = ref(false);
const titlebarTrayRef = ref<HTMLElement | null>(null);
const titlebarTrayItems = ref<TitlebarAction[]>([]);
const isWindowMaximized = ref(false);

const isLocked = computed(() => messenger.state.clientLockLocked);
const needsOnboarding = computed(
  () =>
    !isLocked.value
    && (!String(messenger.state.authToken || "").trim() || !String(messenger.state.username || "").trim()),
);
const hasActive = computed(() => !!messenger.roomLabel.value);
const inCall = computed(() => messenger.state.inCall);
const callRoom = computed(() => messenger.state.callRoom);
const callRoomLabel = computed(() => messenger.displayRoomName(callRoom.value));
const callRoomDifferent = computed(() => inCall.value && callRoom.value !== messenger.state.activeRoom);
const callElapsed = computed(() => messenger.formatDuration(messenger.state.callElapsed));
const desktopConversationSelected = computed(() => !!String(messenger.state.activeRoom || "").trim());
const desktopTitle = computed(() => {
  if (messenger.state.settingsOpen) return t("settings.title");
  return desktopConversationSelected.value ? messenger.displayRoomName(messenger.state.activeRoom) : t("app.noConversation");
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
  // Only trigger on horizontal swipe (left), threshold 60px, not too vertical
  if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    showMobileMembers.value = true;
  } else if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && showMobileMembers.value) {
    showMobileMembers.value = false;
  }
}

function closeMobileMembers() {
  showMobileMembers.value = false;
}

const titlebarMainItems = computed(() => TITLEBAR_ACTIONS.filter((action) => !titlebarTrayItems.value.includes(action)));
const titlebarTrayActionItems = computed(() => TITLEBAR_ACTIONS.filter((action) => titlebarTrayItems.value.includes(action)));
const titlebarTrayEmpty = computed(() => titlebarTrayActionItems.value.length === 0);

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
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!titlebarTrayOpen.value) return;
  const target = event.target as Node | null;
  if (target && titlebarTrayRef.value?.contains(target)) return;
  titlebarTrayOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") titlebarTrayOpen.value = false;
}

function toggleStreamerMode() {
  messenger.setStreamerMode(!messenger.state.streamerMode);
}

function titlebarActionLabel(action: TitlebarAction) {
  if (action === "streamer") return messenger.state.streamerMode ? t("titlebar.disableStreamer") : t("titlebar.enableStreamer");
  if (action === "settings") return t("sidebar.settings");
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
  () => [messenger.state.themeMode, messenger.state.clientLockThemeMode, messenger.state.appAccent, messenger.state.messageStyle],
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
    :class="{ 'app--desktop-titlebar app--lock-titlebar': showAuthTitlebar, 'is-tauri': showNativeTitlebar }">
    <header v-if="showAuthTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div v-if="showNativeTitlebar" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
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
  <div v-else-if="needsOnboarding" class="app app--auth"
    :class="{ 'app--onboarding-titlebar is-tauri': showAuthTitlebar }">
    <header v-if="showAuthTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div v-if="showNativeTitlebar" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
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

  <div v-else class="app app--desktop-titlebar"
    :class="{ 'is-thread': hasActive && mobileThreadOpen, 'is-tauri': showNativeTitlebar, 'is-web-titlebar': isWebDesktopRuntime }">
    <header v-if="showDesktopTitlebar" class="desktop-titlebar" aria-label="Desktop title bar"
      @pointerdown="startNativeDrag" @dblclick="toggleNativeMaximize">
      <div class="desktop-titlebar__spacer"></div>
      <div class="desktop-titlebar__room">
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

        <div v-if="showNativeTitlebar" class="desktop-titlebar__window-controls" aria-label="Contrôles de fenêtre">
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

    <MessengerSidebar :messenger="messenger" @conversation-selected="showConversationThread" />

    <Teleport to="body">
      <Transition name="toast">
        <div v-if="messenger.state.toastMessage" class="toast" :class="{ 'toast--badge': messenger.state.toastBadge }"
          role="status" aria-live="polite">
          <span v-if="messenger.state.toastBadge" class="toast__badge-icon">
            <BadgeIcon :badge="messenger.state.toastBadge" :avatar-src="messenger.state.toastBadgeAvatarSrc" />
          </span>
          <span>{{ messenger.state.toastMessage }}</span>
        </div>
      </Transition>
    </Teleport>

    <DialogModal />

    <main v-if="hasActive" class="thread" :class="{ 'thread--members-open': showMobileMembers }"
      @touchstart="onThreadTouchStart" @touchend="onThreadTouchEnd">
      <div class="thread__shell">
        <section class="thread__main">
          <ThreadHeader :messenger="messenger" @back="showConversationList" />
          <CallPanel :messenger="messenger" />
          <MessageList :messenger="messenger" />
          <ComposerBar :messenger="messenger" />
        </section>

        <MemberSidebar :messenger="messenger" v-if="!isMobile" />
      </div>
    </main>

    <div v-else class="no-thread">
      <div>
        <h2>{{ t('app.noConversation') }}</h2>
        <p>{{ t('app.noConversationHint') }}</p>
      </div>
    </div>

    <!-- Mobile: members overlay sliding from right -->
    <Teleport to="body">
      <div v-if="showMobileMembers" class="members-mobile-backdrop" @click="closeMobileMembers" aria-hidden="true"></div>
      <MemberSidebar v-if="showMobileMembers" :messenger="messenger" :show-mobile="true" class="members-mobile" :class="{ 'members-mobile--open': showMobileMembers }" @close-mobile="closeMobileMembers" />
    </Teleport>

    <div v-if="callRoomDifferent" class="call-pip" @click="goToCallRoom">
      <span class="call-dot"></span>
      <span>{{ t('app.inCall', { room: callRoomLabel, elapsed: callElapsed }) }}</span>
      <button type="button" class="btn--ghost" @click.stop="messenger.endCall">{{ t('app.endCall') }}</button>
    </div>

    <SettingsModal :messenger="messenger" :initial-section="settingsInitialSection" />
  </div>
</template>

<style scoped>
.desktop-titlebar {
  display: none;
}

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
.app.app--desktop-titlebar.is-tauri>.thread,
.app.app--desktop-titlebar.is-tauri>.no-thread,
.app.app--lock-titlebar.is-tauri>.lock-screen,
.app.app--onboarding-titlebar.is-tauri>.onboarding {
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
  z-index: 10;
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
    z-index: 10;
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

}
</style>
