<script setup lang="ts">
import { computed, inject, ref, type PropType } from "vue";
import Icon from "@/components/Icon.vue";
import ModalShell from "@/components/ModalShell.vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});
const emit = defineEmits<{ "open-settings": [section: string] }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const SEEN_KEY = "qx-security-tour-seen";
const steps = [
  { icon: "lock", key: "lock", section: "security" },
  { icon: "eye-off", key: "duress", section: "opsec" },
  { icon: "trash", key: "ramOnly", section: "opsec" },
];

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

const seen = ref(readSeen());
const index = ref(0);
const step = computed(() => steps[index.value]);
const open = computed(() => {
  const state = props.messenger.state;
  return !seen.value && Boolean(state.authToken && state.username) && !state.recoveryNotice && !state.clientLockLocked;
});

function markSeen() {
  seen.value = true;
  // RAM-only mode writes nothing, not even this flag.
  if (props.messenger.state.opsecRamOnlyEnabled) return;
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked: the tour simply shows again next time.
  }
}

function next() {
  if (index.value < steps.length - 1) index.value += 1;
  else markSeen();
}

function configure() {
  const section = step.value.section;
  markSeen();
  emit("open-settings", section);
}
</script>

<template>
  <Teleport to="body">
    <ModalShell :open="open" backdrop-class="security-tour-backdrop" @close="markSeen">
      <div class="security-tour" role="dialog" aria-modal="true" aria-labelledby="security-tour-title">
        <p class="security-tour__eyebrow">{{ t('securityTour.eyebrow') }}</p>
        <Transition name="tour-step" mode="out-in">
          <div :key="step.key" class="security-tour__step">
            <span class="security-tour__glyph" aria-hidden="true">
              <Icon :name="step.icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" />
            </span>
            <h2 id="security-tour-title" class="security-tour__title">{{ t(`securityTour.${step.key}.title`) }}</h2>
            <p class="security-tour__body">{{ t(`securityTour.${step.key}.body`) }}</p>
          </div>
        </Transition>
        <div class="security-tour__dots" aria-hidden="true">
          <span v-for="(item, i) in steps" :key="item.key" :class="{ 'is-active': i === index }"></span>
        </div>
        <div class="security-tour__actions">
          <button type="button" class="security-tour__btn" @click="configure">{{ t('securityTour.configure') }}</button>
          <button type="button" class="security-tour__btn security-tour__btn--primary" @click="next">
            {{ index < steps.length - 1 ? t('securityTour.next') : t('securityTour.finish') }}
          </button>
        </div>
        <button type="button" class="security-tour__skip" @click="markSeen">{{ t('securityTour.later') }}</button>
      </div>
    </ModalShell>
  </Teleport>
</template>

<style scoped>
.security-tour-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.security-tour {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 24px 16px;
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42), 0 0 0 1px var(--line-strong);
  text-align: center;
}

.security-tour__eyebrow {
  margin: 0 0 14px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.security-tour__step {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 190px;
}

.security-tour__glyph {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.security-tour__glyph svg {
  width: 28px;
  height: 28px;
}

.security-tour__title {
  margin: 14px 0 6px;
  font-size: 17px;
  font-weight: 700;
}

.security-tour__body {
  margin: 0;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.5;
}

.security-tour__dots {
  display: flex;
  gap: 6px;
  margin: 14px 0 16px;
}

.security-tour__dots span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 20%, transparent);
  transition: width var(--dur-base) var(--ease-out), background-color var(--dur-base) var(--ease-out);
}

.security-tour__dots span.is-active {
  width: 18px;
  background: var(--accent);
}

.security-tour__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
}

.security-tour__btn {
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text) 9%, transparent);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 500;
}

.security-tour__btn:active {
  filter: brightness(.9);
}

.security-tour__btn--primary {
  background: var(--accent);
  color: #fff;
}

.security-tour__skip {
  margin-top: 10px;
  color: var(--muted);
  font-size: 12.5px;
}

.tour-step-enter-active,
.tour-step-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.tour-step-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

.tour-step-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .security-tour-backdrop {
    padding: 0;
    align-items: flex-end;
  }

  .security-tour {
    max-width: 100%;
    padding-bottom: max(16px, var(--app-safe-bottom));
    border-radius: 22px 22px 0 0;
  }

  .security-tour__btn {
    height: 46px;
    border-radius: 12px;
    font-size: 15px;
  }
}
</style>
