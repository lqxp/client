<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

const props = defineProps({
  messenger: { type: Object, required: true }
});
defineEmits(["back"]);

const name = computed(() => props.messenger.displayRoomNameBeautified(props.messenger.state.activeRoom));
const accent = computed(() => props.messenger.activeConversation.value?.accent || "slate");

const initials = computed(() => {
  const n = String(name.value || "?").trim();
  const parts = n.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase() || "?";
});

const roomIcon = computed(() => props.messenger.roomIcon?.(props.messenger.state.activeRoom) || "");
const roomIconIsImage = computed(() => {
  const icon = String(roomIcon.value || "").trim();
  return !!icon && !icon.startsWith("data:");
});
const callActiveHere = computed(() =>
  props.messenger.state.inCall && props.messenger.state.callRoom === props.messenger.state.activeRoom
);

const callElapsed = computed(() => props.messenger.formatDuration(props.messenger.state.callElapsed));
const roomHasKey = computed(() => props.messenger.hasRoomKey(props.messenger.state.activeRoom));
const securityLabel = computed(() => roomHasKey.value ? t("thread.e2eeReady") : t("thread.noRoomKeyYet"));
const callsAvailable = computed(() => props.messenger.callsAvailable.value);
const callsUnavailableReason = computed(() => props.messenger.callsUnavailableReason.value);
const callsDisabledByTor = computed(() => Boolean(props.messenger.callsDisabledByTor?.value));
const callsTooltip = computed(() => {
  if (callsAvailable.value) return t('thread.startCall');
  if (callsDisabledByTor.value) return t('thread.callsTorDisabled');
  return callsUnavailableReason.value;
});

function startCall() {
  props.messenger.startCall();
}

function copyInvite() {
  const id = props.messenger.state.activeRoom;
  if (!id) return;
  props.messenger.copyRoomInvite(id)
    .then(() => {
      props.messenger.showToast(t("thread.copyTokenSuccess"));
    })
    .catch((error) => {
      props.messenger.state.lastError = error?.message || t("thread.copyTokenError");
      props.messenger.showToast(props.messenger.state.lastError);
    });
}

async function removeHere() {
  const id = props.messenger.state.activeRoom;
  if (!id) return;
  const label = props.messenger.displayRoomName(id);
  const suffix = props.messenger.state.deleteMessagesOnLeave ? ` ${t("thread.leaveRoomDeletesLocal")}` : "";
  const confirmed = await dialog.showConfirm(t("thread.leaveRoomConfirm", { room: label, suffix }));
  if (!confirmed) return;
  props.messenger.leaveRoom(id);
}
</script>

<template>
  <header class="thread__head">
    <button
      class="icon-btn thread__back"
      type="button"
      :aria-label="t('thread.back')"
      @click="$emit('back')"
    >
      <svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"/></svg>
    </button>

    <div class="thread__who">
      <span
        class="avatar avatar--md thread__room-icon"
        :class="roomIconIsImage ? 'thread__room-icon--image' : `avatar--${accent}`"
      >
        <img v-if="roomIconIsImage" :src="roomIcon" alt="" class="thread__room-icon-image" />
        <template v-else>{{ initials }}</template>
      </span>
      <div>
        <div class="thread__name">{{ name }}</div>
        <div class="thread__sub">
          <template v-if="callActiveHere">
            <span class="call-dot"></span>
            {{ t('call.live') }} · {{ callElapsed }}
          </template>
          <template v-else-if="callsAvailable">{{ t('thread.roomConversation') }} · {{ securityLabel }}</template>
          <template v-else-if="callsDisabledByTor">{{ t('thread.callsTorDisabled') }}</template>
          <template v-else>{{ t('thread.roomConversation') }} · {{ securityLabel }} · {{ callsUnavailableReason }}</template>
        </div>
      </div>
    </div>

    <div class="thread__tools">
      <button
        class="icon-btn"
        type="button"
        :aria-label="t('thread.copyToken')"
        @click="copyInvite"
      >
        <svg viewBox="0 0 24 24"><path d="M14 5h5v5"/><path d="M10 14 19 5"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
      </button>
      <button
        v-if="!callActiveHere"
        class="icon-btn"
        type="button"
        :aria-label="t('thread.startCall')"
        :title="callsTooltip"
        :disabled="!callsAvailable"
        @click="startCall"
      >
        <svg viewBox="0 0 24 24"><path d="M7.6 10.8a14.5 14.5 0 0 0 5.6 5.6l1.9-1.9a1.5 1.5 0 0 1 1.5-.37c1.03.34 2.1.52 3.2.52.83 0 1.5.67 1.5 1.5v3.05c0 .83-.67 1.5-1.5 1.5C10.45 20.7 3.3 13.55 3.3 4.2c0-.83.67-1.5 1.5-1.5h3.05c.83 0 1.5.67 1.5 1.5 0 1.1.18 2.17.52 3.2.17.53.03 1.1-.37 1.5l-1.9 1.9Z"/></svg>
      </button>
      <button class="icon-btn" type="button"       :aria-label="t('thread.leaveRoom')" @click="removeHere">
        <svg viewBox="0 0 24 24"><path d="M9 12h12"/><path d="m17 8 4 4-4 4"/><path d="M9 4h-4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.thread__room-icon {
  overflow: hidden;
}

.thread__room-icon--image {
  background: transparent;
}

.thread__room-icon-image {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
</style>
