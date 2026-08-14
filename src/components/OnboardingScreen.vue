<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import ThemeToggleButton from "./ThemeToggleButton.vue";

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
const themeSwitchVisible = ref(false);

function showThemeSwitch() {
  themeSwitchVisible.value = true;
}

function hideThemeSwitch() {
  themeSwitchVisible.value = false;
}

function onFieldFocus(e: FocusEvent) {
  const el = e.target as HTMLElement;
  // Let the keyboard open, then scroll into view
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
}

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

      <div class="onboarding__card" @mouseenter="hideThemeSwitch" @mouseleave="showThemeSwitch">
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
              autocomplete="username" spellcheck="false" :placeholder="t('onboarding.usernamePlaceholder')"
              @focus="onFieldFocus" />
          </label>

          <label v-if="mode !== 'recover'" class="onboarding__field" for="onboarding-password">
            <span>Password</span>
            <input id="onboarding-password" v-model="password" type="password" maxlength="128"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
              :placeholder="t('onboarding.passwordPlaceholder')" @focus="onFieldFocus" />
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field onboarding__field--stacked" for="onboarding-recovery">
            <span>Recovery words</span>
            <textarea id="onboarding-recovery" v-model="recoveryWords" rows="4" autocomplete="off" spellcheck="false"
              :placeholder="t('onboarding.recoveryPlaceholder')" @focus="onFieldFocus"></textarea>
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field" for="onboarding-new-password">
            <span>New password</span>
            <input id="onboarding-new-password" v-model="newPassword" type="password" maxlength="128"
              autocomplete="new-password" :placeholder="t('onboarding.passwordPlaceholder')" @focus="onFieldFocus" />
          </label>

          <p v-if="errorMessage" class="onboarding__error">{{ errorMessage }}</p>

          <button class="btn btn--primary onboarding__submit" type="submit" :disabled="!canSubmit || messenger.state.authLoading">
            {{ messenger.state.authLoading ? "Please wait..." : title }}
          </button>
        </form>
      </div>
    </div>

    <ThemeToggleButton :messenger="messenger" :visible="themeSwitchVisible" />
  </section>
</template>

<style scoped>
.onboarding {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: calc(42px + var(--mobile-status-offset)) 24px 42px;
  background: #101014 url("/assets/wp_dark.jpg") center / cover no-repeat;
  color: white;
  overflow: hidden;
}

.onboarding::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(24px) saturate(1.12);
}

:global(:root[data-theme="light"] .onboarding) {
  background-image: url("/assets/wp_light.jpg");
  background-color: #f2f4f8;
}

:global(:root[data-theme="light"] .onboarding::before) {
  background: rgba(255, 255, 255, 0.12);
}

:global(:root[data-theme="light"] .onboarding__card) {
  background: rgba(255, 255, 255, 0.34);
  border-color: rgba(255, 255, 255, 0.52);
  box-shadow:
    0 30px 80px rgba(57, 72, 92, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.62);
}

:global(:root[data-theme="light"] .onboarding__brand) {
  color: var(--text);
  text-shadow: none;
}

:global(:root[data-theme="light"] .onboarding__card-head h1) {
  color: var(--text);
  text-shadow: none;
}

:global(:root[data-theme="light"] .onboarding__copy) {
  color: var(--muted);
  text-shadow: none;
}

:global(:root[data-theme="light"] .onboarding__tabs) {
  background: rgba(12, 22, 34, 0.06);
  border-color: rgba(12, 22, 34, 0.1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

:global(:root[data-theme="light"] .onboarding__tabs button) {
  color: var(--muted);
}

:global(:root[data-theme="light"] .onboarding__tabs button.is-active) {
  background: #fff;
  color: var(--text);
  box-shadow: 0 8px 22px rgba(57, 72, 92, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

:global(:root[data-theme="light"] .onboarding__field span) {
  color: var(--muted);
  text-shadow: none;
}

:global(:root[data-theme="light"] .onboarding__field-error) {
  color: var(--red);
}

:global(:root[data-theme="light"] .onboarding__field input),
:global(:root[data-theme="light"] .onboarding__field textarea) {
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(12, 22, 34, 0.14);
  color: var(--text);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.8),
    0 8px 24px rgba(57, 72, 92, 0.08);
}

:global(:root[data-theme="light"] .onboarding__field input::placeholder),
:global(:root[data-theme="light"] .onboarding__field textarea::placeholder) {
  color: var(--dim);
}

:global(:root[data-theme="light"] .onboarding__field input:focus),
:global(:root[data-theme="light"] .onboarding__field textarea:focus) {
  background: #fff;
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent),
    0 10px 28px rgba(57, 72, 92, 0.12);
}

:global(:root[data-theme="light"] .onboarding__field input:-webkit-autofill),
:global(:root[data-theme="light"] .onboarding__field input:-webkit-autofill:hover),
:global(:root[data-theme="light"] .onboarding__field input:-webkit-autofill:focus),
:global(:root[data-theme="light"] .onboarding__field textarea:-webkit-autofill),
:global(:root[data-theme="light"] .onboarding__field textarea:-webkit-autofill:hover),
:global(:root[data-theme="light"] .onboarding__field textarea:-webkit-autofill:focus) {
  -webkit-text-fill-color: var(--text);
  -webkit-box-shadow: 0 0 0 1000px #fff inset;
  box-shadow: 0 0 0 1000px #fff inset;
  caret-color: var(--text);
}

:global(:root[data-theme="light"] .onboarding__error) {
  color: var(--red);
  text-shadow: none;
  background: rgba(255, 107, 112, 0.12);
  border-color: rgba(255, 107, 112, 0.28);
}

:global(:root[data-theme="light"] .onboarding__submit) {
  background: rgba(255, 255, 255, 0.42);
  border-color: rgba(12, 22, 34, 0.16);
  color: var(--text);
  box-shadow:
    0 12px 30px rgba(57, 72, 92, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

:global(:root[data-theme="light"] .onboarding__submit:hover) {
  background: rgba(255, 255, 255, 0.58);
}

.onboarding__shell {
  position: relative;
  z-index: 1;
  width: min(100%, 420px);
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
  padding: 28px;
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.26);
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(26px) saturate(1.18);
}

.onboarding__brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  font-size: 1.06rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.38);
}

.onboarding__brand-mark {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex: none;
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.24));
}

.onboarding__brand-mark svg {
  width: 38px;
  height: 38px;
  border-radius: 12px;
}

.onboarding__card-head {
  display: flex;
  justify-content: center;
  text-align: center;
}

.onboarding__card-head h1 {
  margin: 0;
  color: #fff;
  font-size: 1.68rem;
  line-height: 1.15;
  font-weight: 650;
  letter-spacing: -0.035em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.42);
}

.onboarding__copy {
  margin: 8px 0 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.96rem;
  line-height: 1.4;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.34);
}

.onboarding__tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(18px) saturate(1.18);
}

.onboarding__tabs button {
  min-height: 38px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.81rem;
  font-weight: 700;
  transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}

.onboarding__tabs button.is-active {
  background: rgba(255, 255, 255, 0.32);
  color: #fff;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.2);
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
  color: rgba(255, 255, 255, 0.84);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.24);
}

.onboarding__field-error {
  color: #ffd0d0;
  font-style: normal;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
}

.onboarding__field input,
.onboarding__field textarea {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font: inherit;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.16),
    0 8px 24px rgba(0, 0, 0, 0.14);
  backdrop-filter: blur(18px) saturate(1.16);
  transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}

.onboarding__field input {
  height: 46px;
  padding: 10px 14px;
}

.onboarding__field textarea {
  min-height: 104px;
  resize: vertical;
  padding: 12px 14px;
}

.onboarding__field input::placeholder,
.onboarding__field textarea::placeholder {
  color: rgba(255, 255, 255, 0.56);
}

.onboarding__field input:-webkit-autofill,
.onboarding__field input:-webkit-autofill:hover,
.onboarding__field input:-webkit-autofill:focus,
.onboarding__field textarea:-webkit-autofill,
.onboarding__field textarea:-webkit-autofill:hover,
.onboarding__field textarea:-webkit-autofill:focus {
  -webkit-text-fill-color: #fff;
  -webkit-box-shadow: 0 0 0 1000px transparent inset;
  box-shadow: 0 0 0 1000px transparent inset;
  caret-color: #fff;
  transition: background-color 9999s ease-out 0s;
}

.onboarding__field input:focus,
.onboarding__field textarea:focus {
  border-color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.26);
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.14),
    0 10px 28px rgba(0, 0, 0, 0.18);
}

.onboarding__meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.75rem;
  line-height: 1.4;
}

.onboarding__error {
  margin: 0;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 650;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.44);
  background: rgba(255, 107, 112, 0.16);
  border: 1px solid rgba(255, 107, 112, 0.32);
  border-radius: 12px;
  padding: 10px 12px;
}

.onboarding__submit {
  height: 46px;
  margin-top: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.26);
  border: 1px solid rgba(255, 255, 255, 0.32);
  color: #fff;
  font-size: 0.98rem;
  font-weight: 750;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(18px) saturate(1.2);
}

.onboarding__submit:hover {
  background: rgba(255, 255, 255, 0.34);
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