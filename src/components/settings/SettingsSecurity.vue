<script setup lang="ts">
import { computed, inject, ref, watch, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import type { Phantom } from "@/composables/usePhantom";
import { useI18n } from "@/composables/useI18n";
import type { useDialog } from "@/composables/useDialog";
import { takePickedFile } from "@/utils/pickedFile";
import SelectMenu from "@/components/SelectMenu.vue";
import { targetChecked } from "@/utils/inputEvent";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const emit = defineEmits<{ logout: [] }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;
const phantom = inject<Phantom | null>("phantom", null);

const recoveryFileInputRef = ref<HTMLInputElement | null>(null);
const recoveryWordsInput = ref("");
const recoverySigned = computed(
  () => Array.isArray(props.messenger.state.recoveryWords) && props.messenger.state.recoveryWords.length === 12,
);

function importRecoveryWords() {
  if (!props.messenger.setRecoveryWords?.(recoveryWordsInput.value)) return;
  recoveryWordsInput.value = "";
  // The words decrypt the friend roster, so it is reloaded right away.
  phantom?.loadRoster?.().catch(() => {});
  phantom?.pollNow?.().catch(() => {});
}

function onRecoveryFilePick() {
  recoveryFileInputRef.value?.click();
}

async function onRecoveryFilePicked(event: Event) {
  const file = takePickedFile(event);
  if (!file) return;
  try {
    recoveryWordsInput.value = (await file.text()).trim();
    importRecoveryWords();
  } catch {
    // An unreadable file leaves the field as it was.
  }
}

const lockPin = ref("");
const lockPinConfirm = ref("");
const lockPinLength = computed(() => Number(props.messenger.state.clientLockPinLength) || 6);
const lockPinPlaceholder = computed(() => "•".repeat(lockPinLength.value));
const lockPinLabel = computed(() => t("settings.security.pinDigits", { count: String(lockPinLength.value) }));
const pinLengthOptions = [4, 6, 8].map((length) => ({ value: length, label: String(length) }));

const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, lockPinLength.value);

watch(lockPinLength, () => {
  lockPin.value = digitsOnly(lockPin.value);
  lockPinConfirm.value = digitsOnly(lockPinConfirm.value);
});

watch(lockPin, (value) => {
  const clean = digitsOnly(value);
  if (clean !== value) lockPin.value = clean;
});

watch(lockPinConfirm, (value) => {
  const clean = digitsOnly(value);
  if (clean !== value) lockPinConfirm.value = clean;
});

const AUTOLOCK_LABELS: Record<number, string> = {
  60_000: "settings.security.autolockOneMinute",
  600_000: "settings.security.autolockTenMinutes",
  1_800_000: "settings.security.autolockThirtyMinutes",
  3_600_000: "settings.security.autolockOneHour",
  7_200_000: "settings.security.autolockTwoHours",
  18_000_000: "settings.security.autolockFiveHours",
};

function autolockLabel(ms: number) {
  const key = AUTOLOCK_LABELS[Number(ms)];
  return key ? t(key) : t("settings.security.autolockMinutes", { count: String(Math.round(Number(ms) / 60000)) });
}

const autolockSelectOptions = computed(() =>
  (props.messenger.clientLockAutolockTimeoutsMs || []).map((ms: number) => ({ value: ms, label: autolockLabel(ms) }))
);

async function onEnableClientLock() {
  if (lockPin.value !== lockPinConfirm.value) {
    await dialog.showAlert(t("settings.security.pinMismatch"));
    return;
  }
  const ok = await props.messenger.enableClientLock(lockPin.value);
  if (ok) {
    lockPin.value = "";
    lockPinConfirm.value = "";
  }
}

async function onDisableClientLock() {
  const pin = await dialog.showPrompt(t("settings.security.disableLockPrompt"));
  if (!pin) return;
  const unlocked = await props.messenger.verifyClientLockPin(pin);
  if (!unlocked) return;
  if (!await dialog.showConfirm(t("settings.security.disableLockConfirm"))) return;
  const disabled = await props.messenger.disableClientLock();
  if (disabled) await dialog.showAlert(t("settings.security.disableLockSuccess"));
  lockPin.value = "";
  lockPinConfirm.value = "";
}
</script>

<template>
  <section class="settings-page">
    <div class="settings-group">
      <h4>{{ t('settings.security.account') }}</h4>
      <dl class="settings-kv">
        <div>
          <dt>{{ t('settings.security.userId') }}</dt>
          <dd>{{ messenger.state.userId || "-" }}</dd>
        </div>
        <div>
          <dt>{{ t('settings.security.username') }}</dt>
          <dd>{{ messenger.state.username || "-" }}</dd>
        </div>
      </dl>
      <div class="settings-actions">
        <button type="button" class="btn settings-btn" @click="messenger.downloadRecoveryWords">
          {{ t('settings.security.downloadRecovery') }}
        </button>
        <button type="button" class="btn settings-btn settings-btn--danger" @click="emit('logout')">
          {{ t('settings.security.logout') }}
        </button>
      </div>
      <p class="settings-note">
        {{ t('settings.security.recoveryNote') }}
      </p>
    </div>

    <div class="settings-group">
      <h4>{{ t("settings.security.recoveryTitle") }}</h4>
      <p v-if="recoverySigned" class="settings-note recovery-signed">
        {{ t("settings.security.recoverySigned") }}
      </p>
      <p v-else class="settings-note recovery-unsigned">
        {{ t("settings.security.recoveryNotSigned") }}
      </p>
      <p class="settings-note">{{ t("settings.security.recoveryHint") }}</p>
      <div class="settings-inline">
        <textarea
          id="security-recovery-words"
          v-model="recoveryWordsInput"
          class="settings-input settings-textarea"
          rows="3"
          :aria-label="t('settings.security.recoveryTitle')"
          :placeholder="t('settings.security.recoveryPlaceholder')"
          autocomplete="off"
          spellcheck="false"
        ></textarea>
      </div>
      <div class="settings-actions">
        <button
          type="button"
          class="btn settings-btn"
          :disabled="!recoveryWordsInput.trim()"
          @click="importRecoveryWords"
        >
          {{ t("settings.security.recoveryImport") }}
        </button>
        <button type="button" class="btn settings-btn" @click="onRecoveryFilePick">
          {{ t("settings.security.recoveryImportFile") }}
        </button>
        <input
          ref="recoveryFileInputRef"
          type="file"
          accept=".txt,text/plain"
          style="display: none"
          @change="onRecoveryFilePicked"
        />
      </div>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.security.clientLock') }}</h4>
      <div v-if="!messenger.state.clientLockEnabled" class="settings-lock-form">
        <div class="settings-select">
          <span>{{ lockPinLabel }}</span>
          <SelectMenu :aria-label="lockPinLabel" :model-value="messenger.state.clientLockPinLength" :options="pinLengthOptions"
            @update:model-value="messenger.state.clientLockPinLength = Number($event)" />
        </div>
        <div class="settings-inline settings-inline--lock">
          <input v-model="lockPin" class="settings-input settings-input--pin" inputmode="numeric" pattern="[0-9]*"
            autocomplete="new-password" :maxlength="messenger.state.clientLockPinLength"
            :placeholder="lockPinPlaceholder" />
          <input v-model="lockPinConfirm" class="settings-input settings-input--pin" inputmode="numeric"
            pattern="[0-9]*" autocomplete="new-password" :maxlength="messenger.state.clientLockPinLength"
            :placeholder="lockPinPlaceholder" />
          <button type="button" class="btn btn--primary settings-btn" :disabled="messenger.state.clientLockLoading"
            @click="onEnableClientLock">
            {{ messenger.state.clientLockLoading ? t('settings.security.encrypting') :
              t('settings.security.enableLock') }}
          </button>
        </div>
        <div v-if="messenger.state.clientLockLoading" class="settings-progress" role="progressbar"
          :aria-valuenow="messenger.state.clientLockProgress" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${messenger.state.clientLockProgress || 8}%` }"></span>
        </div>
        <p v-if="messenger.state.clientLockLoading" class="settings-note">
          {{ t('settings.security.encryptingNote') }}
        </p>
      </div>

      <div v-else>
        <label class="settings-check">
          <span>{{ t('settings.security.autolockEnabled') }}</span>
          <input type="checkbox" :checked="messenger.state.clientLockAutolockEnabled"
            @change="messenger.setClientLockAutolockEnabled(targetChecked($event))" />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
        <div class="settings-select">
          <span>{{ t('settings.security.autolockThreshold') }}</span>
          <SelectMenu :aria-label="t('settings.security.autolockThreshold')" :model-value="messenger.state.clientLockAutolockTimeoutMs" :options="autolockSelectOptions"
            :disabled="!messenger.state.clientLockAutolockEnabled"
            @update:model-value="messenger.setClientLockAutolockTimeoutMs(Number($event))" />
        </div>
        <div class="settings-actions">
          <button type="button" class="btn settings-btn" :disabled="messenger.state.clientLockLoading"
            @click="messenger.lockClient">
            {{ t('settings.security.lockNow') }}
          </button>
          <button type="button" class="btn settings-btn settings-btn--danger" @click="onDisableClientLock">
            {{ t('settings.security.disableLock') }}
          </button>
        </div>
      </div>
      <p class="settings-note">
        {{ t('settings.security.clientLockNote') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.settings-lock-form {
  margin-top: 14px;
}

.settings-progress {
  height: 8px;
  margin-top: 14px;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
}

.settings-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, white));
  transition: width var(--dur-base) var(--ease-out);
}

.recovery-signed {
  color: var(--green) !important;
}

.recovery-unsigned {
  color: var(--red) !important;
  font-weight: 600;
}
</style>
