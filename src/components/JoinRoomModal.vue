<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import ModalShell from "@/components/ModalShell.vue";
import type { Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { inject, nextTick, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true },
  open: { type: Boolean, default: false }
});
const emit = defineEmits(["close"]);

const input = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    input.value = "";
    await nextTick();
    inputRef.value?.focus();
  }
);

function close() {
  emit("close");
}

function submit() {
  const raw = String(input.value || "").trim();
  if (!raw) return;
  if (props.messenger.joinRoom?.(raw) === true) {
    input.value = "";
    close();
  }
}
</script>

<template>
  <Teleport to="body">
    <ModalShell :open="open" backdrop-class="join-room-backdrop" @close="close">
      <div v-sheet-dismiss="close" class="join-room" role="dialog" :aria-label="t('sidebar.addServerJoin')">
        <header class="join-room__head">
          <div>
            <h2 class="join-room__title">{{ t('sidebar.addServerJoin') }}</h2>
            <p class="join-room__subtitle">{{ t('sidebar.addServerJoinHint') }}</p>
          </div>
          <button class="icon-btn join-room__close" type="button" :aria-label="t('message.cancel')" @click="close">
            <Icon name="close" viewBox="0 0 24 24" />
          </button>
        </header>

        <div class="join-room__body">
          <label class="join-room__field">
            <Icon name="user-plus" viewBox="0 0 24 24" aria-hidden="true" />
            <input
              ref="inputRef"
              v-model="input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('sidebar.pasteRoomToken')"
              :aria-label="t('sidebar.pasteRoomToken')"
              @keydown.enter.prevent="submit"
              @keydown.esc="close"
            />
          </label>
        </div>

        <footer class="join-room__foot">
          <button type="button" class="join-room__btn join-room__btn--secondary" @click="close">
            {{ t('message.cancel') }}
          </button>
          <button type="button" class="join-room__btn join-room__btn--primary" :disabled="!input.trim()" @click="submit">
            {{ t('sidebar.joinRoomAction') }}
          </button>
        </footer>
      </div>
    </ModalShell>
  </Teleport>
</template>

<style scoped>
.join-room-backdrop {
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

.join-room {
  width: 100%;
  max-width: 460px;
  max-height: calc(var(--app-viewport-height) - 56px);
  overflow-y: auto;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  font-family: var(--font);
}

.join-room__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 6px;
}

.join-room__title {
  margin: 0;
  font-family: var(--font);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.join-room__subtitle {
  margin: 6px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--muted);
}

.join-room__close {
  flex: none;
}

.join-room__body {
  padding: 14px 24px 8px;
}

.join-room__field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-radius: var(--field-radius);
  background: var(--field-bg);
  box-shadow: inset 0 0 0 1px var(--field-edge);
  transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.join-room__field:focus-within {
  background: var(--field-bg-focus);
  box-shadow: var(--field-focus);
}

.join-room__field svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--muted);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.join-room__field input {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
}

.join-room__field input::placeholder {
  color: var(--dim);
}

.join-room__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 24px;
}

.join-room__btn {
  height: 40px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

.join-room__btn--secondary {
  background: transparent;
  color: var(--muted);
}

.join-room__btn--secondary:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.join-room__btn--primary {
  background: var(--accent);
  color: #fff;
}

.join-room__btn--primary:hover {
  background: color-mix(in srgb, var(--accent) 82%, #000 18%);
}

.join-room__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .join-room-backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
  }

  .join-room {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    padding-bottom: max(18px, var(--app-safe-bottom));
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .join-room::before {
    content: "";
    display: block;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .join-room__head {
    padding: 8px 18px 6px;
  }

  .join-room__body {
    padding: 10px 18px 8px;
  }

  .join-room__field input {
    font-size: 16px;
    height: 50px;
  }

  .join-room__foot {
    padding: 12px 18px calc(12px + var(--app-safe-bottom));
  }

  .join-room__btn {
    flex: 1;
    height: 48px;
  }
}
</style>
