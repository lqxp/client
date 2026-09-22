<script setup lang="ts">
import { inject, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import { targetChecked } from "@/utils/inputEvent";
import SelectMenu from "@/components/SelectMenu.vue";

defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

type SoundKey = keyof Messenger["state"]["soundFlags"];

const privacyOptions = [
  { value: "hidden", label: t("settings.notifications.privacyHidden") },
  { value: "sender", label: t("settings.notifications.privacySender") },
  { value: "full", label: t("settings.notifications.privacyFull") },
];

const sounds: { key: SoundKey; label: string }[] = [
  { key: "message", label: "settings.notifications.soundMessage" },
  { key: "join", label: "settings.notifications.soundJoin" },
  { key: "leave", label: "settings.notifications.soundLeave" },
  { key: "mute", label: "settings.notifications.soundMute" },
  { key: "unmute", label: "settings.notifications.soundUnmute" },
  { key: "deafen", label: "settings.notifications.soundDeafen" },
  { key: "undeafen", label: "settings.notifications.soundUndeafen" },
  { key: "cameraOn", label: "settings.notifications.soundCameraOn" },
  { key: "cameraOff", label: "settings.notifications.soundCameraOff" },
  { key: "screenOn", label: "settings.notifications.soundScreenOn" },
  { key: "screenOff", label: "settings.notifications.soundScreenOff" },
];

</script>

<template>
  <section class="settings-page">
    <div class="settings-group">
      <h4>{{ t('settings.notifications.messages') }}</h4>
      <label class="settings-check">
        <span>{{ t('settings.notifications.messageSound') }}</span>
        <input type="checkbox" :checked="messenger.state.messageSoundEnabled"
          @change="messenger.setMessageSoundEnabled(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <label class="settings-check">
        <span>{{ t('settings.notifications.backgroundNotifs') }}</span>
        <input type="checkbox" :checked="messenger.state.androidNotificationsEnabled"
          @change="messenger.setAndroidNotificationsEnabled(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <div class="settings-select">
        <span>{{ t('settings.notifications.privacy') }}</span>
        <SelectMenu :aria-label="t('settings.notifications.privacy')" :model-value="messenger.state.notificationPrivacy"
          :options="privacyOptions" @update:model-value="messenger.setNotificationPrivacy(String($event))" />
      </div>
      <p class="settings-note">{{ t('settings.notifications.privacyNote') }}</p>
      <p class="settings-note">{{ t('settings.notifications.localOnlyNote') }}</p>
      <p class="settings-note">
        {{ t('settings.notifications.permission', { status: messenger.notificationPermission() }) }}
      </p>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.notifications.sounds') }}</h4>
      <div class="sound-list">
        <div v-for="sound in sounds" :key="sound.key" class="sound-row">
          <div class="sound-row__info">
            <span class="sound-row__label">{{ t(sound.label) }}</span>
            <button type="button" class="sound-row__preview" @click="messenger.previewSound(sound.key)">
              {{ t('settings.notifications.previewSound') }}
            </button>
          </div>
          <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags[sound.key] }">
            <input type="checkbox" :checked="messenger.state.soundFlags[sound.key]"
              @change="messenger.setSoundEnabled(sound.key, targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sound-list {
  display: flex;
  flex-direction: column;
}

.sound-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}

.sound-row:last-child {
  border-bottom: 0;
}

.sound-row__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.sound-row__label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.sound-row__preview {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-align: left;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  width: fit-content;
}

.sound-row__preview:hover {
  text-decoration: underline;
}
</style>
