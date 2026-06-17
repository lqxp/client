<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});

const mode = ref("login");
const username = ref(String(props.messenger.state.username || ""));
const password = ref("");
const newPassword = ref("");
const recoveryWords = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

const cleanUsername = computed(() => username.value.trim().toLowerCase());
const usernameError = computed(() => props.messenger.validateUsername(cleanUsername.value));
const passwordValid = computed(() => password.value.length >= 8 && password.value.length <= 128);
const newPasswordValid = computed(() => newPassword.value.length >= 8 && newPassword.value.length <= 128);
const canSubmit = computed(() => {
  if (usernameError.value) return false;
  if (mode.value === "recover") return recoveryWords.value.trim().length > 0 && newPasswordValid.value;
  return passwordValid.value;
});
const previewAccent = computed(() => props.messenger.accentFor(cleanUsername.value || "you"));
const errorMessage = computed(() => String(props.messenger.state.lastError || "").trim());
const title = computed(() => mode.value === "register"
  ? t("onboarding.createAccount")
  : mode.value === "recover"
    ? t("onboarding.recoverAccount")
    : t("onboarding.logIn"));
const helperText = computed(() => {
  if (mode.value === "register") return t("onboarding.recoveryAfterSignup");
  if (mode.value === "recover") return t("onboarding.recoveryHelp");
  return t("onboarding.secureSessionRequired");
});
const modeLabel = computed(() => mode.value === "register"
  ? t("onboarding.createAccount")
  : mode.value === "recover"
    ? t("onboarding.recover")
    : t("onboarding.login"));
const cardTitle = computed(() => mode.value === "register"
  ? t("onboarding.createAccount")
  : mode.value === "recover"
    ? t("onboarding.recoverAccountTitle")
    : t("onboarding.welcomeBackTitle"));
const cardSubtitle = computed(() => mode.value === "register"
  ? t("onboarding.createAccountSubtitle")
  : mode.value === "recover"
    ? t("onboarding.recoverAccountSubtitle")
    : t("onboarding.welcomeBackSubtitle"));

function initialsOf(name: string) {
  const trimmed = String(name || "?").trim();
  return (trimmed.slice(0, 2) || "?").toUpperCase();
}

function setMode(next: string) {
  mode.value = next;
  props.messenger.state.lastError = "";
  nextTick(() => inputRef.value?.focus());
}

async function submit() {
  props.messenger.state.lastError = "";
  if (mode.value === "register") {
    await props.messenger.registerAccount(cleanUsername.value, password.value);
  } else if (mode.value === "recover") {
    await props.messenger.recoverAccount(cleanUsername.value, recoveryWords.value, newPassword.value);
  } else {
    await props.messenger.loginAccount(cleanUsername.value, password.value);
  }
}

onMounted(() => nextTick(() => inputRef.value?.focus()));
</script>

<template>
  <section class="onboarding">
    <div class="onboarding__shell">

      <div class="onboarding__card">
        <div class="onboarding__brand">
          <div class="onboarding__brand-mark" aria-hidden="true">
            <svg viewBox="-3.68 -3.68 23.36 23.36" role="img">
              <rect x="-3.68" y="-3.68" width="23.36" height="23.36" rx="4" fill="#1c71d8" />
              <g transform="translate(16 0) scale(-1 1)">
                <g transform="translate(0 1)" fill="#ffffff">
                  <path d="M5.939 0C2.666 0 0.009 1.987 0.009 4.438c0 2.236 2.215 4.082 5.092 4.387L3.88 11.26l4.249-2.7C10.318 7.906 12 6.309 12 4.438 12 1.988 9.213 0 5.939 0Z" />
                  <path d="M15.947 8.89c0-1.124-1.062-2.288-2.289-2.868-.344 1.95-1.924 3.745-4.417 4.447l-1.187.642c.454.34 1.01.611 1.634.788l3.638 1.971-1.303-1.776c2.217-.225 3.924-1.571 3.924-3.204Z" />
                </g>
              </g>
            </svg>
          </div>
          <span>QxChat</span>
        </div>

        <div class="onboarding__card-head">
          <div>
            <h1>{{ cardTitle }}</h1>
            <p class="onboarding__copy">{{ cardSubtitle }}</p>
          </div>
        </div>

        <div class="onboarding__hero">
          <div class="onboarding__hero-avatar">
            <span class="avatar avatar--lg" :class="`avatar--${previewAccent}`">{{ initialsOf(cleanUsername || "You") }}</span>
          </div>
          <div class="onboarding__hero-copy">
            <strong>{{ cleanUsername || "your.username" }}</strong>
            <span>{{ modeLabel }}</span>
          </div>
        </div>

        <div class="onboarding__tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" :class="{ 'is-active': mode === 'login' }" @click="setMode('login')">{{ t('onboarding.login') }}</button>
          <button type="button" :class="{ 'is-active': mode === 'register' }" @click="setMode('register')">{{ t('onboarding.register') }}</button>
          <button type="button" :class="{ 'is-active': mode === 'recover' }" @click="setMode('recover')">{{ t('onboarding.recover') }}</button>
        </div>

        <form class="onboarding__form" @submit.prevent="submit">
          <label class="onboarding__field" for="onboarding-username">
            <span>
              {{ t('settings.security.username') }}
              <em v-if="usernameError" class="onboarding__field-error">{{ usernameError }}</em>
            </span>
            <input id="onboarding-username" ref="inputRef" v-model="username" type="text" maxlength="32"
              autocomplete="username" spellcheck="false" :placeholder="t('onboarding.usernamePlaceholder')" />
          </label>

          <label v-if="mode !== 'recover'" class="onboarding__field" for="onboarding-password">
            <span>Password</span>
            <input id="onboarding-password" v-model="password" type="password" maxlength="128"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
              :placeholder="t('onboarding.passwordPlaceholder')" />
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field onboarding__field--stacked" for="onboarding-recovery">
            <span>Recovery words</span>
            <textarea id="onboarding-recovery" v-model="recoveryWords" rows="4" autocomplete="off" spellcheck="false"
              :placeholder="t('onboarding.recoveryPlaceholder')"></textarea>
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field" for="onboarding-new-password">
            <span>New password</span>
            <input id="onboarding-new-password" v-model="newPassword" type="password" maxlength="128"
              autocomplete="new-password" :placeholder="t('onboarding.passwordPlaceholder')" />
          </label>

          <p v-if="errorMessage" class="onboarding__error">{{ errorMessage }}</p>

          <button class="btn btn--primary onboarding__submit" type="submit" :disabled="!canSubmit || messenger.state.authLoading">
            {{ messenger.state.authLoading ? "Please wait..." : title }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.onboarding {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px 16px;
  background: #5865f2;
  overflow: hidden;
}

.onboarding__shell {
  position: relative;
  width: min(100%, 500px);
}

.onboarding__backdrop {
  position: absolute;
  inset: -80px;
  pointer-events: none;
}

.onboarding__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  border-radius: 0;
  background: #101827;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 40px rgba(5, 14, 28, 0.28);
}

.onboarding__brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #f8fbff;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.onboarding__brand-mark {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex: none;
}

.onboarding__brand-mark svg {
  width: 32px;
  height: 32px;
}

.onboarding__card-head {
  display: flex;
  justify-content: center;
  text-align: center;
}

.onboarding__card-head h1 {
  margin: 0;
  color: #f8fbff;
  font-size: 1.55rem;
  line-height: 1.2;
  font-weight: 700;
}

.onboarding__copy {
  margin: 8px 0 0;
  color: rgba(231, 239, 255, 0.76);
  font-size: 0.96rem;
  line-height: 1.35;
}

.onboarding__hero {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 0;
  background: #0d1420;
  border: 1px solid rgba(28, 113, 216, 0.28);
}

.onboarding__hero-copy {
  display: grid;
  gap: 2px;
}

.onboarding__hero-copy strong {
  color: #f8fbff;
  font-size: 0.95rem;
  font-weight: 600;
}

.onboarding__hero-copy span {
  color: rgba(204, 220, 244, 0.74);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.onboarding__tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  border-radius: 0;
  background: #2b2d31;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.onboarding__tabs button {
  min-height: 42px;
  border-radius: 0;
  color: #a9bddb;
  font-size: 0.83rem;
  font-weight: 700;
  transition: background-color 120ms ease, color 120ms ease;
}

.onboarding__tabs button + button {
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.onboarding__tabs button.is-active {
  background: #1c71d8;
  color: #fff;
}

.onboarding__form {
  display: grid;
  gap: 16px;
}

.onboarding__field {
  display: grid;
  gap: 8px;
}

.onboarding__field span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #bfd2ee;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.onboarding__field-error {
  color: #ff6b6b;
  font-style: normal;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
}

.onboarding__field input,
.onboarding__field textarea {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
  background: #0d1420;
  color: #f8fbff;
  font: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
}

.onboarding__field input {
  height: 44px;
  padding: 10px 12px;
}

.onboarding__field textarea {
  min-height: 104px;
  resize: vertical;
  padding: 10px 12px;
}

.onboarding__field input::placeholder,
.onboarding__field textarea::placeholder {
  color: #6f88aa;
}

.onboarding__field input:focus,
.onboarding__field textarea:focus {
  border-color: #1c71d8;
  box-shadow: inset 0 0 0 1px #1c71d8;
}

.onboarding__meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  color: #9cb5d8;
  font-size: 0.75rem;
  line-height: 1.4;
}

.onboarding__error {
  margin: 0;
  color: #ff7b7b;
  font-size: 0.8rem;
  font-weight: 600;
}

.onboarding__submit {
  height: 46px;
  margin-top: 2px;
  border-radius: 0;
  background: #1c71d8;
  font-size: 0.98rem;
  font-weight: 700;
}

.onboarding__submit:hover {
  background: #165cad;
}

@media (max-width: 640px) {
  .onboarding {
    min-height: var(--app-viewport-height, 100dvh);
    padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)) 16px;
  }

  .onboarding__card {
    padding: 24px 16px;
  }

  .onboarding__card-head h1 {
    font-size: 1.35rem;
  }

  .onboarding__copy {
    font-size: 0.92rem;
  }
}

@media (max-width: 420px) {
  .onboarding__meta,
  .onboarding__field span {
    flex-direction: column;
    align-items: flex-start;
  }

  .onboarding__tabs button {
    min-height: 40px;
    font-size: 0.79rem;
  }
}
</style>