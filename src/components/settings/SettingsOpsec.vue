<script setup lang="ts">
import { computed, inject, ref, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import type { useDialog } from "@/composables/useDialog";
import SelectMenu from "@/components/SelectMenu.vue";
import { targetChecked } from "@/utils/inputEvent";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

const duressPin = ref("");
const duressPinConfirm = ref("");
const duressActionOptions = computed(() => [
  { value: "wipe", label: t("settings.opsec.actionWipe") },
  { value: "decoy", label: t("settings.opsec.actionDecoy") }
]);

async function onSaveDuressPin() {
  if (duressPin.value !== duressPinConfirm.value) {
    await dialog.showAlert(t("settings.security.pinMismatch"));
    return;
  }
  const ok = await props.messenger.setOpsecDuressPin(duressPin.value);
  if (ok) {
    duressPin.value = "";
    duressPinConfirm.value = "";
  }
}

async function onStartDecoySetup() {
  if (!await dialog.showConfirm(t("settings.opsec.decoySetupConfirm"))) return;
  await props.messenger.startOpsecDecoySetup();
}
</script>

<template>
  <section class="settings-page">
    <div class="settings-group">
      <h4>{{ t('settings.opsec.lockScreenPrivacyTitle') }}</h4>
      <label class="settings-check">
        <span>{{ t('settings.opsec.hideLockIdentity') }}</span>
        <input type="checkbox" :checked="messenger.state.opsecHideLockIdentity"
          @change="messenger.setOpsecHideLockIdentity(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">{{ t('settings.opsec.hideLockIdentityNote') }}</p>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.opsec.duressTitle') }}</h4>
      <div class="settings-select">
        <span>{{ t('settings.opsec.duressAction') }}</span>
        <SelectMenu :aria-label="t('settings.opsec.duressAction')" :model-value="messenger.state.opsecDuressAction" :options="duressActionOptions"
          @update:model-value="messenger.setOpsecDuressAction(String($event))" />
      </div>
      <div class="settings-inline settings-inline--lock">
        <input v-model="duressPin" class="settings-input settings-input--pin settings-input--duress"
          inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
          :maxlength="messenger.state.clientLockPinLength" :placeholder="t('settings.opsec.duressPin')" />
        <input v-model="duressPinConfirm" class="settings-input settings-input--pin settings-input--duress"
          inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
          :maxlength="messenger.state.clientLockPinLength" :placeholder="t('settings.opsec.confirmDuressPin')" />
        <button type="button" class="btn btn--primary settings-btn"
          :disabled="!messenger.state.clientLockEnabled || messenger.state.clientLockLocked"
          @click="onSaveDuressPin">
          {{ t('settings.opsec.saveDuressPin') }}
        </button>
      </div>
      <div class="settings-actions" v-if="messenger.state.opsecDuressEnabled">
        <button type="button" class="btn settings-btn settings-btn--danger" @click="messenger.clearOpsecDuressPin">
          {{ t('settings.opsec.disableDuressPin') }}
        </button>
      </div>
      <p class="settings-note" v-if="!messenger.state.clientLockEnabled">{{ t('settings.opsec.requiresLock') }}</p>
      <p class="settings-note">{{ t('settings.opsec.duressNote') }}</p>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.opsec.decoyTitle') }}</h4>
      <div class="settings-actions">
        <button type="button" class="btn settings-btn"
          :disabled="!messenger.state.clientLockEnabled || messenger.state.clientLockLocked"
          @click="onStartDecoySetup">
          {{ t('settings.opsec.configureDecoy') }}
        </button>
      </div>
      <p class="settings-note" v-if="messenger.state.opsecDecoyConfigured">{{ t('settings.opsec.decoyConfigured') }}
      </p>
      <p class="settings-note">{{ t('settings.opsec.decoyNote') }}</p>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.opsec.ramOnlyTitle') }}</h4>
      <label class="settings-check">
        <span>{{ t('settings.opsec.ramOnlyEnabled') }}</span>
        <input type="checkbox" :checked="messenger.state.opsecRamOnlyEnabled"
          @change="messenger.setOpsecRamOnlyEnabled(targetChecked($event))" />
        <span class="toggle__track"><span class="toggle__thumb"></span></span>
      </label>
      <p class="settings-note">{{ t('settings.opsec.ramOnlyNote') }}</p>
    </div>
  </section>
</template>
