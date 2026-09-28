<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import ModalShell from "@/components/ModalShell.vue";
import type { Messenger } from "@/composables/useMessenger";
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps<{ messenger: Messenger; open: boolean }>();
const emit = defineEmits(["close"]);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const current = ref("");
const next = ref("");
const confirm = ref("");
const showCurrent = ref(false);
const showNext = ref(false);
const showConfirm = ref(false);
const busy = ref(false);
const error = ref("");
const done = ref(false);

const lengthOk = computed(() => next.value.length >= 8 && next.value.length <= 128);
const matchOk = computed(() => Boolean(confirm.value) && next.value === confirm.value);
const differentOk = computed(() => Boolean(next.value) && next.value !== current.value);
const canSubmit = computed(
  () => Boolean(current.value) && lengthOk.value && matchOk.value && differentOk.value && !busy.value
);

function reset() {
  current.value = "";
  next.value = "";
  confirm.value = "";
  showCurrent.value = false;
  showNext.value = false;
  showConfirm.value = false;
  busy.value = false;
  error.value = "";
  done.value = false;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) reset();
  }
);

async function submit() {
  if (!canSubmit.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const ok = await props.messenger.changePassword(current.value, next.value);
    if (ok) {
      done.value = true;
      current.value = "";
      next.value = "";
      confirm.value = "";
    } else {
      error.value = String(props.messenger.state.lastError || t("errors.passwordChangeFailed"));
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <ModalShell :open="open" backdrop-class="password-modal-backdrop" @close="emit('close')">
      <div class="password-modal" role="dialog" aria-modal="true" :aria-label="t('settings.security.passwordModalTitle')">
        <header class="password-modal__head">
          <span class="password-modal__icon" aria-hidden="true">
            <Icon name="lock" viewBox="0 0 24 24" />
          </span>
          <div class="password-modal__titles">
            <strong>{{ t('settings.security.passwordModalTitle') }}</strong>
            <span>{{ t('settings.security.passwordModalLead') }}</span>
          </div>
          <button class="icon-btn" type="button" :aria-label="t('settings.security.passwordClose')" @click="emit('close')">✕</button>
        </header>

        <div v-if="done" class="password-modal__body">
          <div class="password-sent">
            <div class="password-sent__check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <strong class="password-sent__title">{{ t('settings.security.passwordChanged') }}</strong>
            <button class="btn--primary password-submit" type="button" @click="emit('close')">{{ t('settings.security.passwordDone') }}</button>
          </div>
        </div>

        <div v-else class="password-modal__body">
          <label class="password-field">
            <span>{{ t('settings.security.currentPassword') }}</span>
            <span class="password-input">
              <input v-model="current" :type="showCurrent ? 'text' : 'password'" autocomplete="current-password"
                :maxlength="128" @keydown.enter="submit" />
              <button type="button" class="password-eye"
                :aria-label="showCurrent ? t('settings.security.hidePassword') : t('settings.security.showPassword')"
                @click="showCurrent = !showCurrent">
                <Icon :name="showCurrent ? 'eye-off' : 'eye'" viewBox="0 0 24 24" />
              </button>
            </span>
          </label>

          <label class="password-field">
            <span>{{ t('settings.security.newPassword') }}</span>
            <span class="password-input">
              <input v-model="next" :type="showNext ? 'text' : 'password'" autocomplete="new-password"
                :maxlength="128" @keydown.enter="submit" />
              <button type="button" class="password-eye"
                :aria-label="showNext ? t('settings.security.hidePassword') : t('settings.security.showPassword')"
                @click="showNext = !showNext">
                <Icon :name="showNext ? 'eye-off' : 'eye'" viewBox="0 0 24 24" />
              </button>
            </span>
          </label>

          <label class="password-field">
            <span>{{ t('settings.security.confirmPassword') }}</span>
            <span class="password-input">
              <input v-model="confirm" :type="showConfirm ? 'text' : 'password'" autocomplete="new-password"
                :maxlength="128" @keydown.enter="submit" />
              <button type="button" class="password-eye"
                :aria-label="showConfirm ? t('settings.security.hidePassword') : t('settings.security.showPassword')"
                @click="showConfirm = !showConfirm">
                <Icon :name="showConfirm ? 'eye-off' : 'eye'" viewBox="0 0 24 24" />
              </button>
            </span>
          </label>

          <ul class="password-rules" aria-live="polite">
            <li :class="{ 'is-ok': lengthOk }">
              <span class="password-rules__dot" aria-hidden="true"></span>
              {{ t('settings.security.passwordRuleLength') }}
            </li>
            <li :class="{ 'is-ok': differentOk }">
              <span class="password-rules__dot" aria-hidden="true"></span>
              {{ t('settings.security.passwordRuleDifferent') }}
            </li>
            <li :class="{ 'is-ok': matchOk }">
              <span class="password-rules__dot" aria-hidden="true"></span>
              {{ t('settings.security.passwordRuleMatch') }}
            </li>
          </ul>

          <p v-if="error" class="password-error" role="alert">{{ error }}</p>

          <button class="btn--primary password-submit" type="button" :disabled="!canSubmit" @click="submit">
            {{ busy ? t('settings.security.changingPassword') : t('settings.security.changePassword') }}
          </button>
        </div>
      </div>
    </ModalShell>
  </Teleport>
</template>

<style scoped>
.password-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.password-modal {
  width: 100%;
  max-width: 420px;
  max-height: calc(var(--app-viewport-height) - 56px);
  overflow-y: auto;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  font-family: var(--font);
  color: var(--text);
}

.password-modal__head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 22px 22px 4px;
}

.password-modal__icon {
  flex: none;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.password-modal__icon svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.password-modal__titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.password-modal__titles strong {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.password-modal__titles span {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted);
}

.password-modal__head .icon-btn {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}

.password-modal__head .icon-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.password-modal__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 22px 22px;
}

.password-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}

.password-input {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 0;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  transition: border-color var(--dur-fast) var(--ease-out);
}

.password-input:focus-within {
  border-color: var(--accent);
}

.password-input input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 6px 6px 12px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  outline: none;
}

.password-eye {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.password-eye:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.password-eye svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.password-rules {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.password-rules li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--muted);
  transition: color var(--dur-fast) var(--ease-out);
}

.password-rules__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line-strong);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.password-rules li.is-ok {
  color: var(--text);
}

.password-rules li.is-ok .password-rules__dot {
  background: #22c55e;
}

.password-error {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--red);
}

.password-submit {
  align-self: stretch;
  padding: 11px 16px;
  border-radius: var(--radius-md);
  border: 0;
  cursor: pointer;
  color: #fff;
  background: var(--accent);
  font-size: 14px;
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.password-submit:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 85%, black 15%);
}

.password-submit:disabled {
  opacity: 0.55;
  cursor: default;
}

.password-sent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px 0 4px;
  text-align: center;
}

.password-sent__check {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.16);
  color: #22c55e;
}

.password-sent__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .password-modal-backdrop {
    padding: 0;
    align-items: flex-end;
  }

  .password-modal {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
  }
}
</style>
