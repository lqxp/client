<script setup lang="ts">
import type { Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import ThemeToggleButton from "./ThemeToggleButton.vue";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const pin = ref("");
const themeSwitchVisible = ref(false);

function showThemeSwitch() {
  themeSwitchVisible.value = true;
}

function hideThemeSwitch() {
  themeSwitchVisible.value = false;
}
const pinLength = computed(() => Number(props.messenger.state.clientLockPinLength) || 6);
const failedAttempts = computed(() => Number(props.messenger.state.clientLockFailedAttempts) || 0);
const remainingAttempts = computed(() => Math.max(0, Number(props.messenger.state.clientLockMaxFailedAttempts || 10) - failedAttempts.value));
const FALLBACK_LOGO = "https://qxch.at/app-icon.svg";
const lockIdentityHidden = computed(() => props.messenger.state.opsecHideLockIdentity !== false);
const username = computed(() => String(props.messenger.state.username || props.messenger.state.clientLockDisplayName || "").trim());
const displayName = computed(() => lockIdentityHidden.value ? t("lock.hiddenUser") : username.value || "QxChat");
const greetingKey = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return "lock.goodMorning";
  if (hour < 18) return "lock.goodAfternoon";
  return "lock.goodEvening";
});
const greeting = computed(() => t(greetingKey.value, { username: displayName.value }));
const avatarSrc = computed(() => lockIdentityHidden.value ? FALLBACK_LOGO : props.messenger.profileImageSrc?.(props.messenger.myProfile?.value?.avatar || props.messenger.state.clientLockAvatar, "avatar") || FALLBACK_LOGO);

async function unlock() {
  const ok = await props.messenger.unlockClientLock(pin.value);
  if (!ok) {
    pin.value = "";
  }
}

function appendDigit(digit: string) {
  if (pin.value.length >= pinLength.value) return;
  pin.value += digit;
  if (pin.value.length === pinLength.value) unlock();
}

function backspace() {
  pin.value = pin.value.slice(0, -1);
}

function onPinKeydown(event: KeyboardEvent) {
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    appendDigit(event.key);
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    backspace();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    unlock();
  }
}
</script>

<template>
  <main class="lock-screen" role="main" aria-labelledby="lock-title">
    <section class="lock-card" @mouseenter="hideThemeSwitch" @mouseleave="showThemeSwitch">
      <div class="lock-card__avatar lock-card__avatar--image" aria-hidden="true">
        <img :src="avatarSrc" alt="" />
      </div>
      <div class="lock-card__copy">
        <h1 id="lock-title">{{ greeting }}</h1>
        <p>{{ t('lock.subtitle') }}</p>
      </div>

      <form class="lock-form" :aria-label="t('lock.subtitle')" @submit.prevent="unlock">
        <input :value="''" class="lock-form__input" type="text" inputmode="none" readonly
          autocomplete="off" autocapitalize="off" spellcheck="false" :maxlength="pinLength" :aria-label="t('lock.pinPlaceholder')" autofocus
          @keydown="onPinKeydown" @paste.prevent />
        <div class="lock-form__mask" aria-hidden="true">
          <span v-for="index in pinLength" :key="index" :class="{ 'is-filled': pin.length >= index }"></span>
        </div>
      </form>

      <div v-if="props.messenger.state.clientLockLoading" class="lock-progress" role="progressbar" :aria-valuenow="props.messenger.state.clientLockProgress" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${props.messenger.state.clientLockProgress || 8}%` }"></span>
      </div>

      <div class="lock-pad" :aria-label="t('lock.pinPlaceholder')">
        <button v-for="digit in ['1','2','3','4','5','6','7','8','9']" :key="digit" type="button" @pointerdown.prevent="appendDigit(digit)">
          {{ digit }}
        </button>
        <span></span>
        <button type="button" @pointerdown.prevent="appendDigit('0')">0</button>
        <button type="button" :aria-label="t('lock.backspace')" @pointerdown.prevent="backspace">⌫</button>
      </div>

      <p v-if="failedAttempts > 0" class="lock-card__attempts">
        {{ t('lock.attemptsRemaining', { count: String(remainingAttempts) }) }}
      </p>
      <p v-if="props.messenger.state.lastError" class="lock-card__error">
        {{ props.messenger.state.lastError }}
      </p>
    </section>

    <ThemeToggleButton :messenger="messenger" :visible="themeSwitchVisible" lock />
  </main>
</template>

<style scoped>
.lock-screen {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: var(--app-viewport-height);
  display: grid;
  place-items: center;
  padding: calc(42px + var(--mobile-status-offset)) 24px 42px;
  background: #101014 url("/assets/wp_dark.jpg") center / cover no-repeat;
  color: white;
}

:root[data-lock-theme="light"] .lock-screen {
  background-image: url("/assets/wp_light.jpg");
  background-color: #f2f4f8;
}

:root[data-lock-theme="dark"] .lock-screen {
  background-image: url("/assets/wp_dark.jpg");
  background-color: #101014;
}

.lock-screen::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(24px) saturate(1.12);
}

@media (max-width: 640px) {
  .lock-screen {
      min-height: var(--app-viewport-height);
      display: flex;
      width: 100%;
      /* ← manquait, cause du décalage */
      flex-direction: column;
      justify-content: center;
      align-items: center;
      /* centrage horizontal explicite */
      padding: calc(42px + var(--mobile-status-offset)) 24px 42px;
      background:
        radial-gradient(ellipse at 18% 12%, rgba(255, 255, 255, 0.72) 0 8%, transparent 34%),
        radial-gradient(ellipse at 82% 16%, rgba(255, 196, 132, 0.9) 0 9%, transparent 32%),
        radial-gradient(ellipse at 72% 84%, rgba(60, 126, 255, 0.74) 0 12%, transparent 38%),
        radial-gradient(ellipse at 18% 76%, rgba(255, 74, 139, 0.8) 0 10%, transparent 36%),
        linear-gradient(135deg, #f8d7b6 0%, #f38f8f 24%, #b56fe8 48%, #4967f2 72%, #8ed3ff 100%);
      color: white;
      box-sizing: border-box;
      /* ← critique : inclut le padding dans la largeur */
      width: 100%;
      /* ← s'assure qu'il prend toute la largeur */
    }
}

.lock-card {
  position: relative;
  z-index: 1;
  width: min(100%, 360px);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
  text-align: center;
}

.lock-card__avatar {
  width: 132px;
  height: 132px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.52)),
    color-mix(in srgb, var(--accent) 32%, white);
  color: color-mix(in srgb, var(--accent) 68%, #26324a);
  font-size: 58px;
  font-weight: 700;
  letter-spacing: -0.08em;
  text-indent: -0.08em;
  box-shadow:
    0 22px 55px rgba(0, 0, 0, 0.28),
    inset 0 1px 1px rgba(255, 255, 255, 0.95);
}

.lock-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lock-card__avatar--image {
  background: rgba(255, 255, 255, 0.32);
}

.lock-card__copy {
  width: 100%;
  margin-top: 18px;
  text-align: center;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.42);
}

.lock-card h1 {
  width: 100%;
  margin: 0;
  color: white;
  font-size: 24px;
  font-weight: 650;
  line-height: 1.16;
  letter-spacing: -0.02em;
  text-align: center;
}

.lock-card p {
  width: 100%;
  margin: 8px auto 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  line-height: 1.45;
  text-align: center;
}

.lock-form {
  position: relative;
  width: min(100%, 238px);
  display: block;
  margin: 18px auto 0;
}

.lock-form__input {
  min-height: 36px;
  width: 100%;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.23);
  color: transparent;
  -webkit-text-fill-color: transparent;
  caret-color: transparent;
  user-select: none;
  font: 15px var(--mono);
  letter-spacing: 0.18em;
  text-align: center;
  outline: none;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.22),
    0 8px 24px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(20px) saturate(1.2);
  transition: background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}

.lock-form__input::selection {
  color: transparent;
  background: transparent;
  -webkit-text-fill-color: transparent;
}

.lock-form__input:focus {
  border-color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.32);
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.16),
    0 10px 28px rgba(0, 0, 0, 0.2);
}

.lock-form__mask {
  position: absolute;
  inset: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
}

.lock-form__mask span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  opacity: 0;
  background: white;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.2);
}

.lock-form__mask span.is-filled {
  opacity: 1;
}

.lock-progress {
  width: min(100%, 238px);
  height: 6px;
  margin: 16px auto 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(14px);
}

.lock-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.78);
  transition: width var(--dur-fast) var(--ease-out);
}

.lock-pad {
  display: none;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.lock-pad button {
  width: 100%;
  aspect-ratio: 1 / 1;
  min-height: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  color: white;
  font-size: 23px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none;
  user-select: none;
  outline: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(14px);
  -touch-action: manipulation;
}

.lock-pad button:active {
  transform: scale(0.96);
  background: rgba(255, 255, 255, 0.28);
}

.lock-card__attempts {
  margin: 16px 0 0;
  color: rgba(255, 255, 255, 0.78) !important;
  text-align: center;
  font-size: 13px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.34);
}

.lock-card__error {
  margin: 12px 0 0;
  color: white !important;
  text-align: center;
  font-weight: 650;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.44);
}

@media (max-width: 820px) {
  .lock-pad {
      display: grid;
      width: min(100%, 330px);
    }

  .lock-pad button {
      min-height: 0;
      font-size: 28px;
    }
}

@media (max-width: 640px) {
  .lock-card {
      position: relative;
      z-index: 1;
      width: min(100%, 360px);
      display: flex;
      flex-direction: column;
      align-items: center;
      /* centre avatar, form, dots */
      text-align: center;
    }

  .lock-card__avatar {
      width: 116px;
      height: 116px;
      font-size: 50px;
    }

  .lock-card h1 {
      font-size: 23px;
    }

  .lock-card p {
      max-width: 300px;
      margin-left: auto;
      margin-right: auto;
    }

  .lock-form {
      position: relative;
      width: 238px;
      display: block;
      margin: 18px 0 0;
    }

  .lock-pad {
      gap: 14px;
      width: min(100%, 318px);
      margin-top: 24px;
    }

  .lock-pad button {
      min-height: 0;
      border: 0;
      background: rgba(255, 255, 255, 0.2);
      font-size: 30px;
      font-weight: 500;
      box-shadow: none;
    }
}

:root[data-lock-theme="light"] .lock-screen {
  color: #1f2a36;
}

:root[data-lock-theme="light"] .lock-screen::before {
  background: rgba(255, 255, 255, 0.12);
}

:root[data-lock-theme="light"] .lock-card__copy {
  text-shadow: none;
}

:root[data-lock-theme="light"] .lock-card h1 {
  color: #1f2a36;
}

:root[data-lock-theme="light"] .lock-card p {
  color: rgba(31, 42, 54, 0.72);
}

:root[data-lock-theme="light"] .lock-form__input {
  border-color: rgba(12, 22, 34, 0.14);
  background: rgba(255, 255, 255, 0.6);
  box-shadow: 0 8px 24px rgba(57, 72, 92, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

:root[data-lock-theme="light"] .lock-form__input:focus {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), 0 10px 28px rgba(57, 72, 92, 0.12);
}

:root[data-lock-theme="light"] .lock-form__mask span {
  background: #1f2a36;
  box-shadow: none;
}

:root[data-lock-theme="light"] .lock-progress {
  background: rgba(12, 22, 34, 0.1);
  box-shadow: none;
}

:root[data-lock-theme="light"] .lock-progress span {
  background: rgba(31, 42, 54, 0.72);
}

:root[data-lock-theme="light"] .lock-pad button {
  border-color: rgba(12, 22, 34, 0.1);
  background: rgba(255, 255, 255, 0.55);
  color: #1f2a36;
  box-shadow: 0 6px 18px rgba(57, 72, 92, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

:root[data-lock-theme="light"] .lock-pad button:active {
  background: rgba(255, 255, 255, 0.82);
}

:root[data-lock-theme="light"] .lock-card__attempts {
  color: rgba(31, 42, 54, 0.72) !important;
  text-shadow: none;
}

:root[data-lock-theme="light"] .lock-card__error {
  color: var(--red) !important;
  text-shadow: none;
}
</style>
