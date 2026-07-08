<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useMessenger } from "@/composables/useMessenger";
import MessengerSidebar from "@/components/MessengerSidebar.vue";
import MemberSidebar from "@/components/MemberSidebar.vue";
import ThreadHeader from "@/components/ThreadHeader.vue";
import MessageList from "@/components/MessageList.vue";
import ComposerBar from "@/components/ComposerBar.vue";
import CallPanel from "@/components/CallPanel.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import OnboardingScreen from "@/components/OnboardingScreen.vue";
import LockScreen from "@/components/LockScreen.vue";

const messenger = useMessenger();
const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const mobileThreadOpen = ref(false);
const settingsInitialSection = ref("profile");

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
const desktopTitle = computed(() => messenger.displayRoomName(messenger.state.activeRoom));
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
  if (messenger.state.authToken) messenger.refreshSession();
});

onBeforeUnmount(() => {
  if (adaptiveThemeTimer) clearInterval(adaptiveThemeTimer);
  systemThemeMedia?.removeEventListener("change", applyAppearance);
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
  <LockScreen v-if="isLocked" :messenger="messenger" />
  <OnboardingScreen v-else-if="needsOnboarding" :messenger="messenger" />

  <div v-else class="app app--desktop-titlebar" :class="{ 'is-thread': hasActive && mobileThreadOpen }">
    <header class="desktop-titlebar" aria-label="Desktop title bar">
      <div class="desktop-titlebar__spacer"></div>
      <div class="desktop-titlebar__room">
        <span
          class="avatar avatar--sm desktop-titlebar__room-icon"
          :class="desktopRoomIconIsImage ? 'desktop-titlebar__room-icon--image' : `avatar--${desktopAccent}`"
        >
          <img v-if="desktopRoomIconIsImage" :src="desktopRoomIcon" alt="" />
          <template v-else>{{ desktopInitials }}</template>
        </span>
        <span class="desktop-titlebar__title">{{ desktopTitle }}</span>
      </div>
      <div class="desktop-titlebar__actions">
        <button class="icon-btn" type="button" :aria-label="t('sidebar.settings')" @click="openSettings()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.08V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.99 19.4a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.08-.4H2.9a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.99a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.99 4.6h.01c.39 0 .76-.14 1.04-.4A1.7 1.7 0 0 0 10.4 3.1V3a2 2 0 1 1 4 0v.09c0 .4.14.77.4 1.05.28.26.65.4 1.04.4h.01a1.7 1.7 0 0 0 1.06-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.27.27-.4.65-.34 1.03v.01c0 .39.14.76.4 1.04.28.26.65.4 1.05.4h.09a2 2 0 1 1 0 4H21.1c-.4 0-.77.14-1.05.4-.26.28-.4.65-.4 1.04Z" />
          </svg>
        </button>
        <button class="icon-btn" type="button" :aria-label="t('settings.security.lockNow')" @click="lockClientNow">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 10V8a5 5 0 0 1 10 0v2" />
            <rect x="5" y="10" width="14" height="10" rx="2" ry="2" />
            <path d="M12 14v2" />
          </svg>
        </button>
      </div>
    </header>

    <MessengerSidebar :messenger="messenger" @conversation-selected="showConversationThread" />

    <Transition name="toast">
      <div v-if="messenger.state.toastMessage" class="toast" role="status" aria-live="polite">
        {{ messenger.state.toastMessage }}
      </div>
    </Transition>

    <main v-if="hasActive" class="thread">
      <div class="thread__shell">
        <section class="thread__main">
          <ThreadHeader :messenger="messenger" @back="showConversationList" />
          <CallPanel :messenger="messenger" />
          <MessageList :messenger="messenger" />
          <ComposerBar :messenger="messenger" />
        </section>

        <MemberSidebar :messenger="messenger" />
      </div>
    </main>

    <div v-else class="no-thread">
      <div>
        <h2>{{ t('app.noConversation') }}</h2>
        <p>{{ t('app.noConversationHint') }}</p>
      </div>
    </div>

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

@media (min-width: 901px) {
  .app.app--desktop-titlebar {
    grid-template-rows: 42px minmax(0, 1fr);
    align-content: stretch;
  }

  .app.app--desktop-titlebar > .side,
  .app.app--desktop-titlebar > .thread,
  .app.app--desktop-titlebar > .no-thread {
    grid-row: 2;
  }

  .desktop-titlebar {
    position: relative;
    grid-column: 1 / -1;
    grid-row: 1;
    width: 100%;
    height: 42px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--surface) 94%, black 6%);
    backdrop-filter: blur(12px);
    -webkit-app-region: drag;
  }

  .desktop-titlebar__spacer {
    flex: 1;
  }

  .desktop-titlebar__room {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: min(520px, calc(100% - 180px));
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transform: translate(-50%, -50%);
  }

  .desktop-titlebar__room-icon {
    width: 24px;
    height: 24px;
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
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desktop-titlebar__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    -webkit-app-region: no-drag;
  }

  .desktop-titlebar__actions .icon-btn {
    width: 30px;
    height: 30px;
  }

  :deep(.thread__main) {
    min-width: 0;
  }

  :deep(.thread__main > .thread-header) {
    display: none;
  }

}
</style>
