<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  open: { type: Boolean, default: false },
  roomId: { type: String, default: "" },
  targetUserId: { type: String, default: "" }
});
const emit = defineEmits(["close"]);

const durations = [
  { key: "mute5m", seconds: 300 },
  { key: "mute15m", seconds: 900 },
  { key: "mute30m", seconds: 1800 },
  { key: "mute1h", seconds: 3600 },
  { key: "mute2h", seconds: 7200 },
  { key: "mute4h", seconds: 14400 },
  { key: "mute8h", seconds: 28800 },
  { key: "mute1d", seconds: 86400 },
  { key: "mute2d", seconds: 172800 },
  { key: "mute14d", seconds: 1209600 }
];

function choose(seconds: number) {
  if (props.targetUserId) {
    props.messenger.timeoutMember?.(props.roomId, props.targetUserId, seconds);
  }
  emit("close");
}

function close() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mute-modal-backdrop" @click.self="close">
      <div class="mute-modal" role="dialog" :aria-label="t('rooms.muteTitle')">
        <header class="mute-modal__head">
          <h2 class="mute-modal__title">{{ t('rooms.muteTitle') }}</h2>
          <button class="icon-btn mute-modal__close" type="button" :aria-label="t('message.cancel')" @click="close">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="mute-modal__body">
          <div class="mute-modal__grid">
            <button
              v-for="duration in durations"
              :key="duration.key"
              type="button"
              class="mute-modal__duration"
              @click="choose(duration.seconds)"
            >
              {{ t(`rooms.${duration.key}`) }}
            </button>
          </div>
        </div>

        <footer class="mute-modal__foot">
          <button type="button" class="mute-modal__btn mute-modal__btn--secondary" @click="close">
            {{ t('message.cancel') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mute-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.mute-modal {
  width: 100%;
  max-width: 380px;
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  font-family: var(--font);
}

.mute-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 6px;
}

.mute-modal__title {
  margin: 0;
  font-family: var(--font);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.mute-modal__close {
  flex: none;
}

.mute-modal__body {
  padding: 8px 24px 16px;
}

.mute-modal__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mute-modal__duration {
  min-height: 44px;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.mute-modal__duration:hover,
.mute-modal__duration:focus-visible {
  background: var(--surface-hover);
  border-color: var(--accent);
  outline: none;
}

.mute-modal__foot {
  display: flex;
  justify-content: flex-end;
  padding: 12px 24px 24px;
  border-top: 1px solid var(--line);
}

.mute-modal__btn {
  height: 40px;
  padding: 0 20px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
}

.mute-modal__btn--secondary {
  background: transparent;
  color: var(--muted);
}

.mute-modal__btn--secondary:hover {
  background: var(--surface-hover);
  color: var(--text);
}

@keyframes mute-modal-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes mute-modal-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .mute-modal-backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: mute-modal-backdrop-in 160ms ease-out;
  }

  .mute-modal {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    padding-bottom: max(18px, env(safe-area-inset-bottom));
    animation: mute-modal-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    overscroll-behavior: contain;
  }

  .mute-modal::before {
    content: "";
    display: block;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .mute-modal__head {
    padding: 8px 18px 6px;
  }

  .mute-modal__body {
    padding: 8px 18px 16px;
  }

  .mute-modal__duration {
    min-height: 52px;
    font-size: 15px;
  }

  .mute-modal__foot {
    padding: 12px 18px calc(12px + env(safe-area-inset-bottom));
  }

  .mute-modal__btn {
    width: 100%;
    height: 48px;
  }
}
</style>
