<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  messenger: { type: Object, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const pin = ref("");
const pinLength = computed(() => Number(props.messenger.state.clientLockPinLength) || 6);
const pinPlaceholder = computed(() => "•".repeat(pinLength.value));

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
</script>

<template>
  <main class="lock-screen" role="main" aria-labelledby="lock-title">
    <section class="lock-card">
      <div class="lock-card__mark">
        <svg viewBox="0 0 24 24">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <path d="M12 14v2.5" />
        </svg>
      </div>
      <div class="lock-card__copy">
        <p class="lock-card__eyebrow">QxChat</p>
        <h1 id="lock-title">{{ t('lock.title') }}</h1>
        <p>{{ t('lock.subtitle') }}</p>
      </div>

      <form class="lock-form" @submit.prevent="unlock">
        <input v-model="pin" class="lock-form__input" type="password" inputmode="numeric" pattern="[0-9]*"
          autocomplete="current-password" :maxlength="pinLength" :placeholder="pinPlaceholder" autofocus />
        <button type="submit" class="btn btn--primary lock-form__submit" :disabled="props.messenger.state.clientLockLoading">
          {{ t('lock.unlock') }}
        </button>
      </form>

      <div class="lock-dots" aria-hidden="true">
        <span v-for="index in pinLength" :key="index" :class="{ 'is-filled': pin.length >= index }"></span>
      </div>

      <div class="lock-pad" aria-label="PIN keypad">
        <button v-for="digit in ['1','2','3','4','5','6','7','8','9']" :key="digit" type="button" @click="appendDigit(digit)">
          {{ digit }}
        </button>
        <span></span>
        <button type="button" @click="appendDigit('0')">0</button>
        <button type="button" :aria-label="t('lock.backspace')" @click="backspace">⌫</button>
      </div>

      <p v-if="props.messenger.state.lastError" class="lock-card__error">
        {{ props.messenger.state.lastError }}
      </p>
    </section>
  </main>
</template>
