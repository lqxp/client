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

const isLocked = computed(() => messenger.state.clientLockLocked);
const needsOnboarding = computed(() => !isLocked.value && (!String(messenger.state.authToken || "").trim() || !String(messenger.state.username || "").trim()));
const hasActive = computed(() => !!messenger.roomLabel.value);
const inCall = computed(() => messenger.state.inCall);
const callRoom = computed(() => messenger.state.callRoom);
const callRoomLabel = computed(() => messenger.displayRoomName(callRoom.value));
const callRoomDifferent = computed(() => inCall.value && callRoom.value !== messenger.state.activeRoom);
const callElapsed = computed(() => messenger.formatDuration(messenger.state.callElapsed));
let adaptiveThemeTimer: ReturnType<typeof setInterval> | null = null;

watch(needsOnboarding, (required) => {
  if (!required && !messenger.state.connected && !messenger.state.ws) {
    messenger.connect();
  }
}, { immediate: true });

watch(() => messenger.state.activeRoom, (room) => {
  mobileThreadOpen.value = !!room;
}, { immediate: true });

function resolveThemeMode(mode) {
  const hour = new Date().getHours();
  const adaptiveTheme = (hour >= 7 && hour < 19) ? "light" : "dark";
  return mode === "adaptive" ? adaptiveTheme : mode;
}

function applyAppearance() {
  const theme = resolveThemeMode(messenger.state.themeMode);
  const lockTheme = resolveThemeMode(messenger.state.clientLockThemeMode || messenger.state.themeMode);

  document.documentElement.setAttribute("data-theme", theme || "dark");
  document.documentElement.setAttribute("data-lock-theme", lockTheme || "dark");
  document.documentElement.setAttribute("data-accent", messenger.state.appAccent || "blue");
  document.documentElement.setAttribute("data-message-style", messenger.state.messageStyle || "bubble");
}

watch(() => [messenger.state.themeMode, messenger.state.clientLockThemeMode, messenger.state.appAccent, messenger.state.messageStyle], () => {
  applyAppearance();
}, { immediate: true });

watch(() => messenger.state.themeMode, (mode) => {
  if (adaptiveThemeTimer) {
    clearInterval(adaptiveThemeTimer);
    adaptiveThemeTimer = null;
  }
  if (mode === "adaptive") {
    adaptiveThemeTimer = setInterval(applyAppearance, 60_000);
  }
}, { immediate: true });

onMounted(() => {
  if (messenger.state.authToken) messenger.refreshSession();
});

onBeforeUnmount(() => {
  if (adaptiveThemeTimer) clearInterval(adaptiveThemeTimer);
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
</script>

<template>
  <LockScreen v-if="isLocked" :messenger="messenger" />
  <OnboardingScreen v-else-if="needsOnboarding" :messenger="messenger" />

  <div v-else class="app" :class="{ 'is-thread': hasActive && mobileThreadOpen }">
    <MessengerSidebar :messenger="messenger" @conversation-selected="showConversationThread" />

    <Transition name="toast">
      <div v-if="messenger.state.toastMessage" class="toast" role="status" aria-live="polite">
        {{ messenger.state.toastMessage }}
      </div>
    </Transition>

    <main class="thread" v-if="hasActive">
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

    <div class="no-thread" v-else>
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

    <SettingsModal :messenger="messenger" />
  </div>
</template>
