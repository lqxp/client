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
  if (usernameError.value) return usernameError.value;
  if (mode.value === "register") return "Recovery words are downloaded after signup";
  if (mode.value === "recover") return "Use your saved recovery words to reset access";
  return "Secure account session required";
});

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
      <aside class="onboarding__rail">
        <div class="onboarding__rail-top">
          <p class="onboarding__eyebrow">QxProtocol Desktop</p>
          <h1>{{ title }}</h1>
          <p class="onboarding__copy">
            Open-Source, scalable, dockerized chat application for teams or communities.
          </p>
        </div>

        <div class="onboarding__rail-preview">
          <div class="onboarding__window">
            <div class="onboarding__window-bar">
              <span></span><span></span><span></span>
            </div>
            <div class="onboarding__window-body">
              <div class="onboarding__window-side">
                <span class="avatar avatar--lg" :class="`avatar--${previewAccent}`">{{ initialsOf(cleanUsername || "You") }}</span>
                <div>
                  <strong>{{ cleanUsername || "your.username" }}</strong>
                  <small>2-32 chars · lowercase · numbers · _ and .</small>
                </div>
              </div>
              <div class="onboarding__window-panel">
                <div class="onboarding__window-row is-active"></div>
                <div class="onboarding__window-row"></div>
                <div class="onboarding__window-row short"></div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="onboarding__card">
        <div class="onboarding__tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" :class="{ 'is-active': mode === 'login' }" @click="setMode('login')">{{ t('onboarding.login') }}</button>
          <button type="button" :class="{ 'is-active': mode === 'register' }" @click="setMode('register')">{{ t('onboarding.register') }}</button>
          <button type="button" :class="{ 'is-active': mode === 'recover' }" @click="setMode('recover')">{{ t('onboarding.recover') }}</button>
        </div>

        <div class="onboarding__card-head">
          <div>
            <p class="onboarding__card-kicker">Desktop access</p>
            <h2>{{ title }}</h2>
          </div>
          <span class="onboarding__mode-chip">{{ mode }}</span>
        </div>

        <form class="onboarding__form" @submit.prevent="submit">
          <label class="onboarding__field" for="onboarding-username">
            <span>Username</span>
            <input
              id="onboarding-username"
              ref="inputRef"
              v-model="username"
              type="text"
              maxlength="32"
              autocomplete="username"
              spellcheck="false"
              :placeholder="t('onboarding.usernamePlaceholder')"
            />
          </label>

          <label v-if="mode !== 'recover'" class="onboarding__field" for="onboarding-password">
            <span>Password</span>
            <input
              id="onboarding-password"
              v-model="password"
              type="password"
              maxlength="128"
              autocomplete="current-password"
              :placeholder="t('onboarding.passwordPlaceholder')"
            />
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field onboarding__field--stacked" for="onboarding-recovery">
            <span>Recovery words</span>
            <textarea
              id="onboarding-recovery"
              v-model="recoveryWords"
              rows="4"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('onboarding.recoveryPlaceholder')"
            ></textarea>
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field" for="onboarding-new-password">
            <span>New password</span>
            <input
              id="onboarding-new-password"
              v-model="newPassword"
              type="password"
              maxlength="128"
              autocomplete="new-password"
              :placeholder="t('onboarding.passwordPlaceholder')"
            />
          </label>

          <div class="onboarding__meta">
            <span>{{ helperText }}</span>
            <span>{{ cleanUsername.length }}/32</span>
          </div>

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
  padding: 32px;
  background:
    radial-gradient(900px 460px at 8% 10%, rgba(88, 101, 242, 0.22), transparent),
    radial-gradient(720px 320px at 88% 92%, rgba(86, 198, 125, 0.12), transparent),
    linear-gradient(180deg, #0f1115 0%, #17191f 100%);
}

.onboarding__shell {
  width: min(100%, 1040px);
  display: grid;
  grid-template-columns: minmax(320px, 1.05fr) minmax(380px, 0.95fr);
  border-radius: 22px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(20, 22, 28, 0.92);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.44);
  backdrop-filter: blur(16px);
}

.onboarding__rail {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
  padding: 36px;
  background:
    linear-gradient(180deg, rgba(43, 45, 49, 0.98) 0%, rgba(31, 34, 40, 0.98) 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.onboarding__rail-top {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.onboarding__eyebrow {
  margin: 0;
  color: #9ecdf6;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.onboarding__rail h1 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 2.8rem);
  line-height: 1.02;
  letter-spacing: -0.04em;
  color: #f7f9fc;
}

.onboarding__copy {
  margin: 0;
  max-width: 34ch;
  color: rgba(218, 225, 237, 0.76);
  font-size: 0.98rem;
  line-height: 1.65;
}

.onboarding__rail-preview {
  display: flex;
  align-items: flex-end;
}

.onboarding__window {
  width: min(100%, 420px);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(48, 51, 57, 0.96), rgba(30, 33, 39, 0.96));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 20px 40px rgba(0, 0, 0, 0.34);
}

.onboarding__window-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.onboarding__window-bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
}

.onboarding__window-body {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.onboarding__window-side {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 12px;
  background: rgba(17, 19, 24, 0.42);
}

.onboarding__window-side strong {
  display: block;
  color: #f3f5fa;
  font-size: 0.98rem;
}

.onboarding__window-side small {
  display: block;
  margin-top: 4px;
  color: rgba(205, 211, 223, 0.64);
  line-height: 1.45;
}

.onboarding__window-panel {
  display: grid;
  gap: 10px;
}

.onboarding__window-row {
  height: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.onboarding__window-row.short {
  width: 58%;
}

.onboarding__window-row.is-active {
  background: linear-gradient(90deg, rgba(88, 101, 242, 0.72), rgba(88, 101, 242, 0.18));
}

.onboarding__card {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 32px;
  background: linear-gradient(180deg, rgba(242, 244, 247, 0.98), rgba(228, 232, 239, 0.96));
}

.onboarding__tabs {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(18, 20, 26, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.onboarding__tabs button {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #4d5563;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.onboarding__tabs button.is-active {
  background: linear-gradient(180deg, #5865f2, #4450d8);
  color: #fff;
  box-shadow: 0 10px 24px rgba(88, 101, 242, 0.28);
}

.onboarding__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.onboarding__card-kicker {
  margin: 0 0 6px;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6a7280;
}

.onboarding__card-head h2 {
  margin: 0;
  color: #171b22;
  font-size: 1.7rem;
  line-height: 1.1;
  letter-spacing: -0.03em;
}

.onboarding__mode-chip {
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(88, 101, 242, 0.1);
  color: #4450d8;
  font-size: 0.76rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
  color: #313845;
  font-size: 0.86rem;
  font-weight: 700;
}

.onboarding__field input,
.onboarding__field textarea {
  width: 100%;
  border: 1px solid rgba(32, 37, 48, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.66);
  color: #171b22;
  font: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
}

.onboarding__field input {
  height: 48px;
  padding: 0 14px;
}

.onboarding__field textarea {
  min-height: 112px;
  resize: vertical;
  padding: 12px 14px;
}

.onboarding__field input:focus,
.onboarding__field textarea:focus {
  outline: none;
  border-color: rgba(88, 101, 242, 0.58);
  box-shadow: 0 0 0 4px rgba(88, 101, 242, 0.14);
  background: #fff;
}

.onboarding__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #626b79;
  font-size: 0.8rem;
  line-height: 1.4;
}

.onboarding__error {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(211, 73, 73, 0.18);
  background: rgba(211, 73, 73, 0.08);
  color: #9e2f2f;
  font-size: 0.88rem;
  font-weight: 600;
}

.onboarding__submit {
  margin-top: 2px;
  height: 48px;
  border-radius: 12px;
  font-size: 0.96rem;
  font-weight: 800;
}

@media (max-width: 920px) {
  .onboarding__shell {
    grid-template-columns: 1fr;
  }

  .onboarding__rail {
    padding: 28px 28px 18px;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
}

@media (max-width: 640px) {
  .onboarding {
    padding: 18px;
  }

  .onboarding__rail,
  .onboarding__card {
    padding: 22px;
  }

  .onboarding__card-head,
  .onboarding__meta {
    flex-direction: column;
    align-items: flex-start;
  }

  .onboarding__tabs {
    width: 100%;
  }
}
</style>
