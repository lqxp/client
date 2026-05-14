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

        <div class="onboarding__rail-preview onboarding__rail-preview--desktop">
          <div class="onboarding__window">
            <div class="onboarding__window-bar">
              <span></span><span></span><span></span>
            </div>
            <div class="onboarding__window-body">
              <div class="onboarding__window-side">
                <span class="avatar avatar--lg" :class="`avatar--${previewAccent}`">{{ initialsOf(cleanUsername ||
                  "You") }}</span>
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
          <button type="button" :class="{ 'is-active': mode === 'login' }" @click="setMode('login')">{{
            t('onboarding.login') }}</button>
          <button type="button" :class="{ 'is-active': mode === 'register' }" @click="setMode('register')">{{
            t('onboarding.register') }}</button>
          <button type="button" :class="{ 'is-active': mode === 'recover' }" @click="setMode('recover')">{{
            t('onboarding.recover') }}</button>
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
            <input id="onboarding-username" ref="inputRef" v-model="username" type="text" maxlength="32"
              autocomplete="username" spellcheck="false" :placeholder="t('onboarding.usernamePlaceholder')" />
          </label>

          <label v-if="mode !== 'recover'" class="onboarding__field" for="onboarding-password">
            <span>Password</span>
            <input id="onboarding-password" v-model="password" type="password" maxlength="128"
              autocomplete="current-password" :placeholder="t('onboarding.passwordPlaceholder')" />
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field onboarding__field--stacked"
            for="onboarding-recovery">
            <span>Recovery words</span>
            <textarea id="onboarding-recovery" v-model="recoveryWords" rows="4" autocomplete="off" spellcheck="false"
              :placeholder="t('onboarding.recoveryPlaceholder')"></textarea>
          </label>

          <label v-if="mode === 'recover'" class="onboarding__field" for="onboarding-new-password">
            <span>New password</span>
            <input id="onboarding-new-password" v-model="newPassword" type="password" maxlength="128"
              autocomplete="new-password" :placeholder="t('onboarding.passwordPlaceholder')" />
          </label>

          <div class="onboarding__meta">
            <span>{{ helperText }}</span>
            <span>{{ cleanUsername.length }}/32</span>
          </div>

          <p v-if="errorMessage" class="onboarding__error">{{ errorMessage }}</p>

          <button class="btn btn--primary onboarding__submit" type="submit"
            :disabled="!canSubmit || messenger.state.authLoading">
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
    linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, #0f1115 8%) 0%, color-mix(in srgb, var(--bg) 98%, #17191f 2%) 100%);
}

.onboarding__shell {
  width: min(100%, 1040px);
  display: grid;
  grid-template-columns: minmax(320px, 1.05fr) minmax(380px, 0.95fr);
  border-radius: 22px;
  overflow: hidden;
  border: 1px solid var(--onboarding-shell-border);
  background: var(--onboarding-shell-bg);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.44);
  backdrop-filter: blur(16px);
}

.onboarding__rail {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
  padding: 36px;
  background: var(--onboarding-rail-bg);
  border-right: 1px solid var(--onboarding-rail-border);
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
  color: var(--onboarding-title);
}

.onboarding__copy {
  margin: 0;
  max-width: 34ch;
  color: var(--onboarding-copy);
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
  border: 1px solid var(--onboarding-preview-border);
  background: var(--onboarding-preview-bg);
  box-shadow: var(--onboarding-preview-shadow);
}

.onboarding__window-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--onboarding-window-bar-border);
}

.onboarding__window-bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--onboarding-window-dot);
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
  background: color-mix(in srgb, var(--surface) 72%, var(--bg) 28%);
}

.onboarding__window-side strong {
  display: block;
  color: var(--text);
  font-size: 0.98rem;
}

.onboarding__window-side small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  line-height: 1.45;
}

.onboarding__window-panel {
  display: grid;
  gap: 10px;
}

.onboarding__window-row {
  height: 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-2) 82%, transparent 18%);
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
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, white 4%), color-mix(in srgb, var(--surface-2) 82%, white 18%));
}

.onboarding__tabs {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  background: var(--onboarding-tabs-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.onboarding__tabs button {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: color-mix(in srgb, var(--text) 70%, var(--muted) 30%);
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
  color: var(--muted);
}

.onboarding__card-head h2 {
  margin: 0;
  color: var(--text);
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
  color: color-mix(in srgb, var(--text) 86%, var(--muted) 14%);
  font-size: 0.86rem;
  font-weight: 700;
}

.onboarding__field input,
.onboarding__field textarea {
  width: 100%;
  border: 1px solid rgba(32, 37, 48, 0.16);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 92%, white 8%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.66);
  color: var(--text);
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
  color: var(--muted);
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
    border-bottom: 1px solid var(--onboarding-rail-border);
  }
}

@media (max-width: 640px) {
  .onboarding {
    display: block;
    min-height: var(--app-viewport-height, 100dvh);
    padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)) 10px;
  }

  .onboarding__shell {
    width: 100%;
    min-height: auto;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
  }

  .onboarding__rail {
    gap: 10px;
    padding: 8px 4px 14px;
    background: transparent;
    border: 0;
  }

  .onboarding__card {
    gap: 16px;
    padding: 0 4px 10px;
    background: transparent;
  }

  .onboarding__eyebrow,
  .onboarding__card-kicker,
  .onboarding__mode-chip,
  .onboarding__rail-preview,
  .onboarding__card-head h2 {
    display: none;
  }

  .onboarding__rail h1 {
    font-size: 1.4rem;
    line-height: 1.12;
  }

  .onboarding__copy {
    max-width: none;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .onboarding__tabs {
    width: 100%;
    gap: 4px;
    padding: 4px;
    background: var(--onboarding-tabs-bg);
  }

  .onboarding__tabs button {
    min-height: 44px;
    padding: 0 8px;
    font-size: 0.84rem;
  }

  .onboarding__card-head,
  .onboarding__meta {
    flex-direction: column;
    align-items: flex-start;
  }

  .onboarding__card-head {
    gap: 0;
    min-height: 0;
  }

  .onboarding__field span {
    color: rgba(240, 244, 255, 0.86);
  }

  .onboarding__field input,
  .onboarding__field textarea {
    border-color: rgba(148, 163, 184, 0.22);
    background: rgba(100, 116, 139, 0.2);
    box-shadow: none;
    color: #070c14;
  }

  .onboarding__field input::placeholder,
  .onboarding__field textarea::placeholder {
    color: rgba(203, 213, 225, 0.62);
  }

  .onboarding__field input,
  .onboarding__submit {
    height: 46px;
  }

  .onboarding__meta {
    gap: 6px;
    color: rgba(218, 225, 237, 0.72);
  }

  .onboarding__error {
    color: #ffd7d7;
    background: rgba(211, 73, 73, 0.14);
  }
}

@media (max-width: 420px) {
  .onboarding {
    padding-inline: 8px;
  }

  .onboarding__rail,
  .onboarding__card {
    padding-inline: 0;
  }

  .onboarding__tabs button {
    font-size: 0.8rem;
  }
}
</style>