<script setup lang="ts">
import { inject, ref, watch, nextTick } from "vue";
import { useI18n } from "@/composables/useI18n";
import type { useDialog as UseDialogType } from "@/composables/useDialog";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialogApi = inject<ReturnType<typeof UseDialogType>>("dialog")!;

const inputValue = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => dialogApi.dialogState.open,
  async (open) => {
    if (open && dialogApi.dialogState.kind === "prompt") {
      inputValue.value = dialogApi.dialogState.defaultValue;
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  },
);

function onSubmit() {
  if (dialogApi.dialogState.kind === "prompt") {
    dialogApi.closeDialog(inputValue.value);
  } else if (dialogApi.dialogState.kind === "confirm") {
    dialogApi.closeDialog(true);
  } else {
    dialogApi.closeDialog(undefined);
  }
}

function onCancel() {
  if (dialogApi.dialogState.kind === "confirm") {
    dialogApi.closeDialog(false);
  } else if (dialogApi.dialogState.kind === "prompt") {
    dialogApi.closeDialog(null);
  } else {
    dialogApi.closeDialog(undefined);
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    onSubmit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="dialogApi.dialogState.open" class="dialog-backdrop" @click="onCancel">
        <div
          class="dialog-card"
          role="dialog"
          aria-modal="true"
          :aria-label="dialogApi.dialogState.title || dialogApi.dialogState.message"
          @click.stop
          @keydown="onKeydown"
        >
          <div v-if="dialogApi.dialogState.title" class="dialog-card__title">
            {{ dialogApi.dialogState.title }}
          </div>
          <div class="dialog-card__message">{{ dialogApi.dialogState.message }}</div>

          <input
            v-if="dialogApi.dialogState.kind === 'prompt'"
            ref="inputRef"
            v-model="inputValue"
            class="dialog-card__input"
            type="text"
            :placeholder="dialogApi.dialogState.defaultValue"
            autocomplete="off"
          />

          <div class="dialog-card__actions">
            <button
              v-if="dialogApi.dialogState.kind !== 'alert'"
              class="dialog-btn dialog-btn--cancel"
              type="button"
              @click="onCancel"
            >
              {{ t("message.cancel") }}
            </button>
            <button
              class="dialog-btn dialog-btn--primary"
              type="button"
              autofocus
              @click="onSubmit"
            >
              {{ t("message.ok") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(6px);
}

.dialog-card {
  width: min(400px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px 24px 20px;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48), 0 0 0 1px var(--line-strong);
  color: var(--text);
  font-family: var(--font);
}

.dialog-card__title {
  font-size: 18px;
  font-weight: 750;
  line-height: 1.25;
  color: var(--text);
}

.dialog-card__message {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dialog-card__input {
  width: 100%;
  height: 46px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 15px;
  font-weight: 500;
  font-family: var(--font);
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.dialog-card__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.dialog-card__input::placeholder {
  color: var(--dim);
}

.dialog-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.dialog-btn {
  height: 42px;
  min-width: 90px;
  padding: 0 20px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  font-family: var(--font);
  cursor: pointer;
  border: none;
  transition: background 120ms ease, color 120ms ease, transform 80ms ease;
}

.dialog-btn:active {
  transform: scale(0.97);
}

.dialog-btn--cancel {
  background: var(--surface-2);
  color: var(--text);
}

.dialog-btn--cancel:hover,
.dialog-btn--cancel:focus-visible {
  background: var(--surface-hover);
}

.dialog-btn--primary {
  background: var(--accent);
  color: #fff;
}

.dialog-btn--primary:hover,
.dialog-btn--primary:focus-visible {
  background: color-mix(in srgb, var(--accent) 85%, white);
}

/* Transition */
.dialog-enter-active {
  transition: opacity 160ms ease-out;
}
.dialog-enter-active .dialog-card {
  transition: transform 180ms cubic-bezier(0.16, 0.8, 0.2, 1), opacity 160ms ease-out;
}
.dialog-leave-active {
  transition: opacity 120ms ease-in;
}
.dialog-leave-active .dialog-card {
  transition: transform 140ms cubic-bezier(0.4, 0, 1, 1), opacity 120ms ease-in;
}

.dialog-enter-from {
  opacity: 0;
}
.dialog-enter-from .dialog-card {
  transform: translateY(16px) scale(0.96);
  opacity: 0;
}
.dialog-leave-to {
  opacity: 0;
}
.dialog-leave-to .dialog-card {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}

@media (max-width: 640px) {
  .dialog-backdrop {
    padding: 20px;
  }

  .dialog-card {
    width: 100%;
    max-height: calc(100vh - 40px);
    border-radius: 20px;
    border: 1px solid var(--line-strong);
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48), 0 0 0 1px var(--line-strong);
    padding: 24px 20px 20px;
    gap: 12px;
  }

  .dialog-card__title {
    font-size: 17px;
  }

  .dialog-card__message {
    font-size: 14px;
  }

  .dialog-card__input {
    height: 48px;
    font-size: 16px;
  }

  .dialog-btn {
    height: 48px;
    min-width: 0;
    flex: 1;
    font-size: 16px;
    border-radius: 14px;
  }
}
</style>
