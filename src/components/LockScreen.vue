<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  messenger: { type: Object, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const pin = ref("");
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
    <section class="lock-card">
      <div class="lock-card__avatar lock-card__avatar--image" aria-hidden="true">
        <img :src="avatarSrc" alt="" />
      </div>
      <div class="lock-card__copy">
        <h1 id="lock-title">{{ greeting }}</h1>
        <p>{{ t('lock.subtitle') }}</p>
      </div>

      <form class="lock-form" :aria-label="t('lock.subtitle')" @submit.prevent="unlock">
        <input :value="''" class="lock-form__input" type="text" inputmode="numeric" pattern="[0-9]*"
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
        <button v-for="digit in ['1','2','3','4','5','6','7','8','9']" :key="digit" type="button" @click="appendDigit(digit)">
          {{ digit }}
        </button>
        <span></span>
        <button type="button" @click="appendDigit('0')">0</button>
        <button type="button" :aria-label="t('lock.backspace')" @click="backspace">⌫</button>
      </div>

      <p v-if="failedAttempts > 0" class="lock-card__attempts">
        {{ t('lock.attemptsRemaining', { count: String(remainingAttempts) }) }}
      </p>
      <p v-if="props.messenger.state.lastError" class="lock-card__error">
        {{ props.messenger.state.lastError }}
      </p>
    </section>
  </main>
</template>
