<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import type { useDialog as UseDialogType } from "@/composables/useDialog";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialogApi = inject<ReturnType<typeof UseDialogType>>("dialog")!;

const inputValue = ref("");

/** Which symbol heads the dialog: a warning for what cannot be undone. */
const glyphKind = computed(() =>
  dialogApi.dialogState.danger ? "danger" : dialogApi.dialogState.kind
);
const inputRef = ref<HTMLInputElement | null>(null);
const okRef = ref<HTMLButtonElement | null>(null);

watch(
  () => dialogApi.dialogState.open,
  async (open) => {
    if (open && dialogApi.dialogState.kind === "prompt") {
      inputValue.value = dialogApi.dialogState.defaultValue;
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    } else if (open) {
      // Donne le focus au bouton OK (défaut) pour que Entrée/Échap répondent
      // sans dépendre de l'attribut `autofocus` (peu fiable dans un Teleport).
      await nextTick();
      okRef.value?.focus();
    }
  },
);

function onSubmit(event?: Event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (dialogApi.dialogState.kind === "prompt") {
    dialogApi.closeDialog(inputValue.value);
  } else if (dialogApi.dialogState.kind === "confirm") {
    dialogApi.closeDialog(true);
  } else {
    dialogApi.closeDialog(undefined);
  }
}

function onCancel(event?: Event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (dialogApi.dialogState.kind === "confirm") {
    dialogApi.closeDialog(false);
  } else if (dialogApi.dialogState.kind === "prompt") {
    dialogApi.closeDialog(null);
  } else {
    dialogApi.closeDialog(undefined);
  }
}

// Gestion clavier au niveau de la fenêtre (fiable quel que soit le focus).
function onKeydown(event: KeyboardEvent) {
  if (!dialogApi.dialogState.open) return;
  if (event.key === "Enter") {
    onSubmit(event);
  } else if (event.key === "Escape") {
    onCancel(event);
  }
}

window.addEventListener("keydown", onKeydown);
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" @after-leave="dialogApi.dialogLeft()">
      <div v-if="dialogApi.dialogState.open" class="dialog-backdrop" @click="onCancel">
        <div v-sheet-dismiss="() => onCancel()" class="dialog-card" :class="{ 'is-danger': dialogApi.dialogState.danger }" role="alertdialog"
          aria-modal="true" :aria-label="dialogApi.dialogState.title || dialogApi.dialogState.message" @click.stop>
          <span class="dialog-card__glyph" :class="`is-${glyphKind}`" aria-hidden="true">
            <svg v-if="glyphKind === 'danger'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9.5v4" />
              <path d="M12 17h.01" />
            </svg>
            <svg v-else-if="glyphKind === 'prompt'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <svg v-else-if="glyphKind === 'confirm'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4" />
              <path d="M12 17h.01" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5" />
              <path d="M12 7.5h.01" />
            </svg>
          </span>

          <h2 v-if="dialogApi.dialogState.title" class="dialog-card__title">{{ dialogApi.dialogState.title }}</h2>
          <p class="dialog-card__message"
            :class="{ 'is-lead': !dialogApi.dialogState.title }">{{ dialogApi.dialogState.message }}</p>

          <input v-if="dialogApi.dialogState.kind === 'prompt'" ref="inputRef" v-model="inputValue"
            class="qx-field dialog-card__input" type="text" :placeholder="dialogApi.dialogState.defaultValue"
            autocomplete="off" />

          <div class="dialog-card__actions" :class="{ 'is-single': dialogApi.dialogState.kind === 'alert' }">
            <button v-if="dialogApi.dialogState.kind !== 'alert'" class="dialog-btn dialog-btn--cancel" type="button"
              @click="onCancel">
              {{ t("message.cancel") }}
            </button>
            <button ref="okRef" class="dialog-btn dialog-btn--primary" type="button" @click="onSubmit">
              {{ dialogApi.dialogState.confirmLabel || t("message.ok") }}
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
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, .46);
  backdrop-filter: blur(5px);
}

.dialog-card {
  width: min(320px, calc(100vw - 40px));
  max-height: calc(var(--app-viewport-height) - 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 20px 18px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line-strong), 0 26px 70px rgba(0, 0, 0, .42);
  color: var(--text);
  font-family: var(--font);
  text-align: center;
}

.dialog-card__glyph {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.dialog-card__glyph.is-danger {
  background: color-mix(in srgb, var(--red) 16%, transparent);
  color: var(--red);
}

.dialog-card__glyph svg {
  width: 24px;
  height: 24px;
}

.dialog-card__title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
}

.dialog-card__message {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* With no title, the message is the question and reads as one. */
.dialog-card__message.is-lead {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}

.dialog-card__input {
  margin-top: 14px;
  text-align: left;
}

.dialog-card__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
  margin-top: 18px;
}

.dialog-card__actions.is-single {
  grid-template-columns: 1fr;
}

.dialog-btn {
  height: 32px;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  border-radius: 8px;
  font-family: var(--font);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out);
}

.dialog-btn:active {
  filter: brightness(.9);
}

.dialog-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
  outline-offset: 2px;
}

.dialog-btn--cancel {
  background: color-mix(in srgb, var(--text) 9%, transparent);
  color: var(--text);
}

.dialog-btn--cancel:hover {
  background: color-mix(in srgb, var(--text) 14%, transparent);
}

.dialog-btn--primary {
  background: var(--accent);
  color: #fff;
}

.dialog-btn--primary:hover {
  background: color-mix(in srgb, #fff 8%, var(--accent));
}

/* What cannot be undone says so in the colour of its button. */
.dialog-card.is-danger .dialog-btn--primary {
  background: color-mix(in srgb, var(--red) 86%, #000);
}

.dialog-card.is-danger .dialog-btn--primary:hover {
  background: var(--red);
}

/* An alert pops rather than slides: it is a question put to you now, not a
   panel arriving from somewhere. */
.dialog-enter-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}

.dialog-enter-active .dialog-card {
  transition: transform var(--dur-slow) var(--ease-spring), opacity var(--dur-fast) var(--ease-out);
}

.dialog-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}

.dialog-leave-active .dialog-card {
  transition: transform var(--dur-fast) var(--ease-in), opacity var(--dur-fast) var(--ease-in);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog-card {
  opacity: 0;
  transform: scale(1.08);
}

.dialog-leave-to .dialog-card {
  opacity: 0;
  transform: scale(.96);
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .dialog-backdrop {
    place-items: end stretch;
    padding: 0;
    background: rgba(0, 0, 0, .52);
    backdrop-filter: blur(12px);
  }

  .dialog-card {
    width: 100%;
    max-height: 88vh;
    padding: 10px 20px max(18px, var(--app-safe-bottom));
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, .5), 0 -1px 0 var(--line-strong);
  }

  .dialog-card::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 2px auto 18px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .dialog-card__title {
    font-size: 17px;
  }

  .dialog-card__message,
  .dialog-card__message.is-lead {
    font-size: 15px;
  }

  .dialog-card__actions {
    grid-template-columns: 1fr;
    gap: 10px;
    margin-top: 22px;
  }

  .dialog-btn {
    height: 50px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
  }

  .dialog-btn--primary {
    order: -1;
  }

  .dialog-enter-active .dialog-card {
    transition: transform var(--dur-slow) var(--ease-out);
  }

  .dialog-leave-active .dialog-card {
    transition: transform var(--dur-base) var(--ease-in);
  }

  .dialog-enter-from .dialog-card,
  .dialog-leave-to .dialog-card {
    opacity: 1;
    transform: translateY(100%);
  }
}

@media (prefers-reduced-motion: reduce) {

  .dialog-enter-from .dialog-card,
  .dialog-leave-to .dialog-card {
    transform: none;
  }
}
</style>
