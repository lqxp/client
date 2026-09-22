<script setup lang="ts">
import { inject, onMounted, ref, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import { isTauriDesktopRuntime as isDesktopRuntime } from "@/calls/tor";
import { getDiscordRpcStatus, setDiscordRpcEnabled, setDiscordRpcShowPlatform, type DiscordRpcStatus } from "@/calls/discordRpc";
import { targetChecked } from "@/utils/inputEvent";

defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const discordRpcEnabled = ref(true);
const discordRpcShowPlatform = ref(true);
const discordRpcConnected = ref(false);
const discordRpcReady = ref<boolean | null>(null);

function applyDiscordRpc(s: DiscordRpcStatus) {
  discordRpcEnabled.value = s.enabled;
  discordRpcShowPlatform.value = s.show_platform;
  discordRpcConnected.value = s.connected;
  discordRpcReady.value = true;
}

async function loadDiscordRpc() {
  try {
    applyDiscordRpc(await getDiscordRpcStatus());
  } catch {
    discordRpcReady.value = false;
  }
}

async function updateDiscordRpc(change: () => Promise<DiscordRpcStatus>) {
  try {
    applyDiscordRpc(await change());
  } catch {
    // The backend's state is shown as it really is.
  }
  await loadDiscordRpc();
}

onMounted(() => {
  if (isDesktopRuntime()) void loadDiscordRpc();
});
</script>

<template>
  <section class="settings-page">
    <div class="settings-group">
      <h4>{{ t('settings.advanced.connection') }}</h4>
      <label class="settings-check">
        <span>{{ t('settings.advanced.autoReconnect') }}</span>
        <input type="checkbox" :checked="messenger.state.autoReconnectEnabled"
          @change="messenger.setAutoReconnectEnabled(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <label class="settings-check">
        <span>{{ t('settings.advanced.serverClears') }}</span>
        <input type="checkbox" v-model="messenger.state.serverClearsLocalMessages"
          @change="messenger.setServerClearsLocalMessages(messenger.state.serverClearsLocalMessages)" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">
        {{ t('settings.advanced.serverClearsNote') }}
      </p>
      <label class="settings-check">
        <span>{{ t('settings.advanced.serverDefaultRoom') }}</span>
        <input type="checkbox" :checked="messenger.state.allowServerDefaultRoom"
          @change="messenger.setAllowServerDefaultRoom(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.advanced.uploads') }}</h4>
      <label class="settings-check">
        <span>{{ t('settings.advanced.autoArchive') }}</span>
        <input type="checkbox" :checked="messenger.state.autoArchiveUploads"
          @change="messenger.setAutoArchiveUploads(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">
        {{ t('settings.advanced.autoArchiveNote') }}
      </p>
      <label class="settings-check">
        <span>{{ t('settings.advanced.renameUploads') }}</span>
        <input type="checkbox" :checked="messenger.state.renameUploadsRandomly"
          @change="messenger.setRenameUploadsRandomly(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">
        {{ t('settings.advanced.renameUploadsNote') }}
      </p>
      <label class="settings-check">
        <span>{{ t('settings.advanced.stripExif') }}</span>
        <input type="checkbox" :checked="messenger.state.stripImageExif"
          @change="messenger.setStripImageExif(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">
        {{ t('settings.advanced.stripExifNote') }}
      </p>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.privacy.title') }}</h4>
      <label class="settings-check">
        <span>{{ t('settings.privacy.deleteOnLeave') }}</span>
        <input type="checkbox" :checked="messenger.state.deleteMessagesOnLeave"
          @change="messenger.setDeleteMessagesOnLeave(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <label class="settings-check">
        <span>{{ t('settings.privacy.streamerMode') }}</span>
        <input type="checkbox" :checked="messenger.state.streamerMode"
          @change="messenger.setStreamerMode(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">
        {{ t('settings.privacy.streamerNote') }}
      </p>
      <label class="settings-check">
        <span>{{ t('settings.advanced.disableTypingSend') }}</span>
        <input type="checkbox" :checked="!messenger.state.typingIndicatorsEnabled"
          @change="messenger.setTypingIndicatorsEnabled(!targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
    </div>

    <div v-if="isDesktopRuntime()" class="settings-group">
      <h4>{{ t('settings.advanced.discordRpc.title') }}</h4>
      <template v-if="discordRpcReady">
        <label class="settings-check">
          <span>{{ t('settings.advanced.discordRpc.enabled') }}</span>
          <input type="checkbox" :checked="discordRpcEnabled"
            @change="updateDiscordRpc(() => setDiscordRpcEnabled(targetChecked($event)))" />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
        <p class="settings-note">
          {{ t('settings.advanced.discordRpc.enabledNote') }}
        </p>
        <label class="settings-check">
          <span>{{ t('settings.advanced.discordRpc.showPlatform') }}</span>
          <input type="checkbox" :checked="discordRpcShowPlatform"
            @change="updateDiscordRpc(() => setDiscordRpcShowPlatform(targetChecked($event)))" />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
        <p class="settings-note">
          {{ t('settings.advanced.discordRpc.showPlatformNote') }}
        </p>
        <p class="settings-note">
          {{ discordRpcConnected
            ? t('settings.advanced.discordRpc.connected')
            : t('settings.advanced.discordRpc.disconnected') }}
        </p>
      </template>
      <p v-else-if="discordRpcReady === false" class="settings-note">
        {{ t('settings.advanced.discordRpc.unavailable') }}
      </p>
    </div>
  </section>
</template>
