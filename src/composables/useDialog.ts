/** What a dialog resolves with: text for a prompt, a choice for a confirm. */
export type DialogResult = string | boolean | null | undefined;

import { reactive, ref } from "vue";

export interface DialogState {
  open: boolean;
  kind: "confirm" | "prompt" | "alert";
  title: string;
  message: string;
  defaultValue: string;
  resolve: ((value: DialogResult) => void) | null;
}

const state = reactive<DialogState>({
  open: false,
  kind: "alert",
  title: "",
  message: "",
  defaultValue: "",
  resolve: null,
});

interface QueuedDialog {
  kind: DialogState["kind"];
  title: string;
  message: string;
  defaultValue: string;
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
  state.resolve = next.resolve;
  state.open = true;
}

export function useDialog() {
  function showAlert(message: string, title = ""): Promise<void> {
    return new Promise((resolve) => {
      queue.push({ kind: "alert", title, message, defaultValue: "", resolve: resolve as (value: DialogResult) => void });
      processQueue();
    });
  }

  function showConfirm(message: string, title = ""): Promise<boolean> {
    return new Promise((resolve) => {
      queue.push({ kind: "confirm", title, message, defaultValue: "", resolve: resolve as (value: DialogResult) => void });
      processQueue();
    });
  }

  function showPrompt(message: string, defaultValue = "", title = ""): Promise<string | null> {
    return new Promise((resolve) => {
      queue.push({ kind: "prompt", title, message, defaultValue, resolve: resolve as (value: DialogResult) => void });
      processQueue();
    });
  }

  function closeDialog(value: DialogResult) {
    if (state.resolve) {
      state.resolve(value);
      state.resolve = null;
    }
    state.open = false;
    state.title = "";
    state.message = "";
    state.defaultValue = "";
    // Process next in queue after a short delay to allow transition out
    setTimeout(() => processQueue(), 180);
  }

  return {
    dialogState: state,
    showAlert,
    showConfirm,
    showPrompt,
    closeDialog,
  };
}
