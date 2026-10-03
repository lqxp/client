<script setup lang="ts">
import { computed, inject, ref, watch, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import type { Phantom } from "@/composables/usePhantom";
import { useI18n } from "@/composables/useI18n";
import type { useDialog } from "@/composables/useDialog";
import { takePickedFile } from "@/utils/pickedFile";
import SelectMenu from "@/components/SelectMenu.vue";
import ChangePasswordModal from "@/components/ChangePasswordModal.vue";
import { targetChecked } from "@/utils/inputEvent";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const emit = defineEmits<{ logout: [] }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;
const phantom = inject<Phantom | null>("phantom", null);

const recoveryFileInputRef = ref<HTMLInputElement | null>(null);
// One box per word: easier to review than a raw textarea, and the count
// makes a truncated paste obvious before anything is committed.
const recoveryBoxes = ref<string[]>(Array.from({ length: 12 }, () => ""));
// Signed clients hide the entry form entirely; replacing words is opt-in.
const recoveryReplaceMode = ref(false);
const recoveryVerifying = ref(false);
const recoveryError = ref("");
const recoveryNotice = ref("");
const recoveryInputs = ref<Array<HTMLInputElement | null>>([]);
const recoverySigned = computed(
  () => Array.isArray(props.messenger.state.recoveryWords) && props.messenger.state.recoveryWords.length === 12,
);
const recoveryFilledCount = computed(() => recoveryBoxes.value.filter((word) => word.trim()).length);

function setRecoveryInputRef(element: unknown, index: number) {
  recoveryInputs.value[index] = element instanceof HTMLInputElement ? element : null;
}

function focusRecoveryBox(index: number) {
  const clamped = Math.max(0, Math.min(11, index));
  recoveryInputs.value[clamped]?.focus();
}

function sanitizeRecoveryWord(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function onRecoveryBoxInput(index: number, event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) return;
  const clean = sanitizeRecoveryWord(target.value);
  // A space means the word is done: commit it and move to the next box.
  if (/\s/.test(target.value) && clean) {
    recoveryBoxes.value[index] = clean;
    recoveryError.value = "";
    focusRecoveryBox(index + 1);
    return;
  }
  recoveryBoxes.value[index] = clean;
  if (clean) recoveryError.value = "";
}

function onRecoveryBoxKeydown(index: number, event: KeyboardEvent) {
  if (event.key === "Backspace" && !recoveryBoxes.value[index]) {
    event.preventDefault();
    focusRecoveryBox(index - 1);
  }
}

function onRecoveryBoxPaste(index: number, event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text") || "";
  if (!text.trim()) return;
  event.preventDefault();
  // Strip an exported .txt header, then spread the words from this box on.
  const parsed = props.messenger.parseRecoveryWords?.(text);
  const words = parsed ?? String(text).split(/\s+/).map(sanitizeRecoveryWord).filter(Boolean).slice(0, 12);
  for (let i = 0; i < words.length && index + i < 12; i += 1) {
    recoveryBoxes.value[index + i] = words[i];
  }
  recoveryError.value = "";
  focusRecoveryBox(Math.min(11, index + words.length));
}

function clearRecoveryBoxes() {
  recoveryBoxes.value = Array.from({ length: 12 }, () => "");
  recoveryError.value = "";
  recoveryNotice.value = "";
  focusRecoveryBox(0);
}

async function importRecoveryWords() {
  recoveryError.value = "";
  recoveryNotice.value = "";
  const parsed = props.messenger.parseRecoveryWords?.(recoveryBoxes.value.join(" "));
  if (!parsed) {
    recoveryError.value = t("settings.security.invalidRecoveryWords");
    return;
  }
  // Crypto check before anything is stored: trial-decrypt the server-hosted
  // roster blob with the key these words derive. Wrong words are rejected
  // here instead of showing a bogus "signed" state that breaks later.
  if (phantom) {
    recoveryVerifying.value = true;
    try {
      const verdict = await phantom.verifyRecoveryWords(parsed);
      if (verdict === "mismatch") {
        recoveryError.value = t("settings.security.recoveryMismatch");
        return;
      }
      if (!props.messenger.setRecoveryWords?.(parsed.join(" "))) return;
      if (verdict === "unverifiable") {
        recoveryNotice.value = t("settings.security.recoveryUnverified");
      }
    } finally {
      recoveryVerifying.value = false;
    }
  } else if (!props.messenger.setRecoveryWords?.(parsed.join(" "))) {
    return;
  }
  recoveryReplaceMode.value = false;
  clearRecoveryBoxes();
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
    const text = (await file.text()).trim();
    const parsed = props.messenger.parseRecoveryWords?.(text);
    if (parsed) {
      recoveryBoxes.value = [...parsed];
      recoveryError.value = "";
      void importRecoveryWords();
    } else {
      // Fill what we can so the user sees (and fixes) the problem.
      const words = String(text).split(/\s+/).map(sanitizeRecoveryWord).filter(Boolean).slice(0, 12);
      for (let i = 0; i < 12; i += 1) recoveryBoxes.value[i] = words[i] || "";
      recoveryError.value = t("settings.security.invalidRecoveryWords");
    }
  } catch {
    // An unreadable file leaves the fields as they were.
  } finally {
    // Same file picked twice must fire change again.
    if (recoveryFileInputRef.value) recoveryFileInputRef.value.value = "";
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

const passwordModalOpen = ref(false);
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
      <h4>{{ t('settings.security.passwordTitle') }}</h4>
      <p class="settings-note">
        {{ t('settings.security.passwordModalLead') }}
      </p>
      <div class="settings-actions">
        <button type="button" class="btn settings-btn" @click="passwordModalOpen = true">
          {{ t('settings.security.changePassword') }}
        </button>
      </div>
    </div>

    <ChangePasswordModal :messenger="messenger" :open="passwordModalOpen" @close="passwordModalOpen = false" />

    <div class="settings-group">
      <h4>{{ t("settings.security.recoveryTitle") }}</h4>
      <div class="recovery-status" :class="recoverySigned ? 'is-signed' : 'is-unsigned'" role="status">
        <span class="recovery-status__dot" aria-hidden="true"></span>
        <span>{{ recoverySigned ? t("settings.security.recoverySigned") : t("settings.security.recoveryNotSigned") }}</span>
      </div>
      <p class="settings-note">{{ t("settings.security.recoveryHint") }}</p>
      <div v-if="recoverySigned && !recoveryReplaceMode" class="settings-actions">
        <button type="button" class="btn settings-btn recovery-replace" @click="recoveryReplaceMode = true">
          {{ t("settings.security.recoveryReplace") }}
        </button>
      </div>
      <template v-if="!recoverySigned || recoveryReplaceMode">
      <div class="recovery-grid" role="group" :aria-label="t('settings.security.recoveryTitle')">
        <label v-for="index in 12" :key="index" class="recovery-box">
          <span class="recovery-box__index" aria-hidden="true">{{ index }}</span>
          <input
            :ref="(el) => setRecoveryInputRef(el, index - 1)"
            :value="recoveryBoxes[index - 1]"
            class="settings-input recovery-box__input"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            :aria-label="t('settings.security.recoveryWordLabel', { n: String(index) })"
            @input="onRecoveryBoxInput(index - 1, $event)"
            @keydown="onRecoveryBoxKeydown(index - 1, $event)"
            @paste="onRecoveryBoxPaste(index - 1, $event)"
          />
        </label>
      </div>
      <p class="recovery-count" :class="{ 'is-complete': recoveryFilledCount === 12 }">
        {{ t("settings.security.recoveryWordCount", { done: String(recoveryFilledCount) }) }}
        <span class="recovery-count__hint">{{ t("settings.security.recoveryPasteHint") }}</span>
      </p>
      <p v-if="recoveryError" class="recovery-feedback is-error" role="alert">
        {{ recoveryError }}
      </p>
      <p v-else-if="recoveryNotice" class="recovery-feedback is-notice" role="status">
        {{ recoveryNotice }}
      </p>
      <div class="settings-actions recovery-actions">
        <button
          type="button"
          class="btn settings-btn recovery-verify"
          :disabled="recoveryFilledCount !== 12 || recoveryVerifying"
          @click="importRecoveryWords"
        >
          {{ recoveryVerifying ? t("settings.security.recoveryVerifying") : t("settings.security.recoveryVerify") }}
        </button>
        <button type="button" class="btn settings-btn" :disabled="recoveryVerifying" @click="onRecoveryFilePick">
          {{ t("settings.security.recoveryImportFile") }}
        </button>
        <button
          type="button"
          class="btn settings-btn settings-btn--danger"
          :disabled="recoveryFilledCount === 0 || recoveryVerifying"
          @click="clearRecoveryBoxes"
        >
          {{ t("settings.security.recoveryClear") }}
        </button>
        <input
          ref="recoveryFileInputRef"
          type="file"
          accept=".txt,text/plain"
          style="display: none"
          @change="onRecoveryFilePicked"
        />
      </div>
      </template>
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

.recovery-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  box-shadow: inset 0 0 0 1px var(--line);
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
}

.recovery-status__dot {
  width: 10px;
  height: 10px;
  flex: none;
  border-radius: 50%;
}

.recovery-status.is-signed {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--green) 38%, transparent);
}

.recovery-status.is-signed .recovery-status__dot {
  background: var(--green);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 18%, transparent);
}

.recovery-status.is-unsigned {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--red) 34%, transparent);
}

.recovery-status.is-unsigned .recovery-status__dot {
  background: var(--red);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--red) 16%, transparent);
  animation: recovery-dot-pulse 2s ease-in-out infinite;
}

@keyframes recovery-dot-pulse {
  50% { opacity: 0.45; }
}

.recovery-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.recovery-box {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 6px 6px 8px;
  border-radius: 10px;
  background: var(--field-bg);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow var(--dur-fast) var(--ease-out);
}

.recovery-box:focus-within {
  box-shadow: inset 0 0 0 1.5px var(--accent), 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}

.recovery-box__index {
  flex: none;
  min-width: 16px;
  color: var(--dim);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.recovery-box__input {
  min-width: 0;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-family: var(--mono);
  font-size: 13px;
}

.recovery-box__input:focus {
  outline: none;
  box-shadow: none;
}

.recovery-count {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.recovery-count.is-complete {
  color: var(--green);
}

.recovery-count__hint {
  font-weight: 400;
}

.recovery-feedback {
  margin: 10px 0 0;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
}

.recovery-feedback.is-error {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 9%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--red) 36%, transparent);
}

.recovery-feedback.is-notice {
  color: var(--muted);
  background: color-mix(in srgb, var(--text) 6%, transparent);
  box-shadow: inset 0 0 0 1px var(--line);
}

/* Same row, same height: unlike btn--primary (full-width + top margin) this
   keeps every action button on one baseline. */
.recovery-actions {
  align-items: stretch;
}

.recovery-actions .btn {
  height: auto;
}

.recovery-verify {
  background: var(--accent);
  color: #fff;
}

.recovery-verify:hover {
  background: color-mix(in srgb, var(--accent) 82%, #000 18%);
}

.recovery-verify:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.recovery-replace {
  color: var(--muted);
}

@media (max-width: 560px) {
  .recovery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .recovery-status.is-unsigned .recovery-status__dot {
    animation: none;
  }
}
</style>
