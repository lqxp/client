/** What a dialog resolves with: text for a prompt, a choice for a confirm. */
export type DialogResult = string | boolean | null | undefined;

import { reactive } from "vue";

export interface DialogOptions {
  /** The action cannot be undone, so the confirm button is drawn in red. */
  danger?: boolean;
  /** A verb for the confirm button ("Delete", "Leave"), rather than OK. */
  confirmLabel?: string;
}

export interface DialogState {
  open: boolean;
  kind: "confirm" | "prompt" | "alert";
  title: string;
  message: string;
  defaultValue: string;
  danger: boolean;
  confirmLabel: string;
  resolve: ((value: DialogResult) => void) | null;
}

const state = reactive<DialogState>({
  open: false,
  kind: "alert",
  title: "",
  message: "",
  defaultValue: "",
  danger: false,
  confirmLabel: "",
  resolve: null,
});

interface QueuedDialog {
  kind: DialogState["kind"];
  title: string;
  message: string;
  defaultValue: string;
  danger: boolean;
  confirmLabel: string;
  resolve: (value: DialogResult) => void;
}

const queue: QueuedDialog[] = [];

function processQueue() {
  if (state.open || queue.length === 0) return;
  const next = queue.shift()!;
  state.kind = next.kind;
  state.title = next.title;
  state.message = next.message;
  state.defaultValue = next.defaultValue;
  state.danger = next.danger;
  state.confirmLabel = next.confirmLabel;
  state.resolve = next.resolve;
  state.open = true;
}

function enqueue(dialog: Omit<QueuedDialog, "resolve">): Promise<DialogResult> {
  return new Promise((resolve) => {
    queue.push({ ...dialog, resolve });
    processQueue();
  });
}

export function useDialog() {
  function showAlert(message: string, title = ""): Promise<void> {
    return enqueue({ kind: "alert", title, message, defaultValue: "", danger: false, confirmLabel: "" }).then(
      () => undefined
    );
  }

  function showConfirm(message: string, title = "", options: DialogOptions = {}): Promise<boolean> {
    return enqueue({
      kind: "confirm",
      title,
      message,
      defaultValue: "",
      danger: Boolean(options.danger),
      confirmLabel: options.confirmLabel ?? "",
    }).then((value) => value === true);
  }

  function showPrompt(message: string, defaultValue = "", title = ""): Promise<string | null> {
    return enqueue({ kind: "prompt", title, message, defaultValue, danger: false, confirmLabel: "" }).then(
      (value) => (typeof value === "string" ? value : null)
    );
  }

  /**
   * Resolves the open dialog and starts its exit. Its text stays in place
   * until the exit has played: clearing it here used to empty the card
   * while it was still fading out.
   */
  function closeDialog(value: DialogResult) {
    if (state.resolve) {
      state.resolve(value);
      state.resolve = null;
    }
    state.open = false;
    // The dialog calls dialogLeft() once its exit ends; this is only the
    // fallback for a moment where no dialog is mounted to say so.
    setTimeout(processQueue, 400);
  }

  /** Called by the dialog when its exit transition has finished. */
  function dialogLeft() {
    processQueue();
  }

  return {
    dialogState: state,
    showAlert,
    showConfirm,
    showPrompt,
    closeDialog,
    dialogLeft,
  };
}
