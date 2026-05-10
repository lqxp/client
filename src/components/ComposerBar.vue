<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});

const composerRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const emojiWrapRef = ref<HTMLElement | null>(null);
const cameraVideoRef = ref<HTMLVideoElement | null>(null);
const cameraCanvasRef = ref<HTMLCanvasElement | null>(null);
const pickerOpen = ref(false);
const cameraOpen = ref(false);
const cameraBusy = ref(false);
const cameraError = ref("");
const mobileActionsOpen = ref(false);
const cursorPosition = ref(0);
const mentionIndex = ref(0);
const mentionSuppressedStart = ref(-1);
let cameraStream: MediaStream | null = null;

const canSend = computed(() => props.messenger.state.messageInput.trim().length > 0 && !!props.messenger.state.activeRoom);
const disabled = computed(() => !props.messenger.state.activeRoom);
const editing = computed(() => !!props.messenger.state.editingMessage);
const composerPlaceholder = computed(() => disabled.value
  ? t('composer.placeholder')
  : editing.value
    ? t('composer.editing')
    : t('composer.placeholder'));
const mediaDisabled = computed(() => disabled.value || editing.value);
const recording = computed(() => !!props.messenger.state.recording);
const mentionSearch = computed(() => {
  const input = inputRef.value;
  const cursor = input?.selectionStart ?? cursorPosition.value ?? 0;
  const beforeCursor = String(props.messenger.state.messageInput || "").slice(0, cursor);
  const match = /(^|[^a-zA-Z0-9_.])@([a-z0-9_.]{0,32})$/i.exec(beforeCursor);
  if (!match) return null;
  return {
    start: beforeCursor.length - match[2].length - 1,
    query: match[2].toLowerCase()
  };
});
const mentionOptions = computed<string[]>(() => {
  if (disabled.value || !mentionSearch.value) return [];
  const query = mentionSearch.value.query;
  const rawRoster = Array.isArray(props.messenger.memberRoster.value)
    ? props.messenger.memberRoster.value
    : [];
  const members = [...new Set<string>(rawRoster
    .map((name: unknown) => String(name || "").trim().toLowerCase())
    .filter((name: string) => Boolean(name)))];
  return members
    .filter((name: string) => !query || name.startsWith(query) || name.includes(query))
    .sort((a: string, b: string) => {
      const aStarts = a.startsWith(query) ? 0 : 1;
      const bStarts = b.startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b);
    })
    .slice(0, 8);
});
const mentionOpen = computed(() => mentionOptions.value.length > 0 && mentionSearch.value?.start !== mentionSuppressedStart.value);
const selectedMention = computed<string>(() => mentionOptions.value[Math.min(mentionIndex.value, mentionOptions.value.length - 1)] || "");

function syncComposerHeight() {
  const input = inputRef.value;
  if (!input) return;

  input.style.height = "auto";
  const maxHeight = 120;
  const nextHeight = Math.min(maxHeight, input.scrollHeight);
  input.style.height = `${Math.max(32, nextHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

// Curated emoji palette — intentionally compact (80 glyphs) so it fits one screenful
// without needing tabs/search.
const EMOJIS = [
  "😀","😂","🤣","😊","😍","🥰","😘","😎","🤩","😇",
  "🙂","😉","😋","😛","😜","🤪","🤗","🤭","🤔","🧐",
  "😏","🙄","😬","😒","😞","😔","😢","😭","😤","😡",
  "🥺","😳","😱","😴","🤒","🤕","🤧","🥳","🤯","💀",
  "👍","👎","👌","✌️","🤞","🤘","🤙","👏","🙏","🤝",
  "💪","👀","👋","🙌","🤦","🤷","💃","🕺","🦾","🧠",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","💘",
  "🔥","✨","⭐","🎉","🎊","💯","💢","💥","💫","☕"
];

function pastedExtension(mimeType) {
  const type = String(mimeType || "").toLowerCase().split(";")[0];
  const known = {
    "application/gzip": "gz",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "text/plain": "txt",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };
  if (known[type]) return known[type];
  const subtype = type.includes("/") ? type.split("/").pop() : "";
  const clean = String(subtype || "").replace(/[^a-z0-9]/g, "");
  return clean || "bin";
}

function namePastedFile(file: File, index: number) {
  if (file.name) return file;
  const filename = `pasted-${Date.now()}-${index + 1}.${pastedExtension(file.type)}`;
  try {
    return new File([file], filename, {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified || Date.now()
    });
  } catch {
    return file;
  }
}

function filesFromClipboard(event: ClipboardEvent): File[] {
  const clipboard = event.clipboardData;
  if (!clipboard) return [];

  const directFiles = Array.from(clipboard.files || []);
  const files = directFiles.length
    ? directFiles
    : Array.from((clipboard.items || []) as DataTransferItemList)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

  return files.map(namePastedFile);
}

function isEditableElement(element: Element | null) {
  if (!element || element === document.body || element === document.documentElement) return false;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

async function onPaste(event: ClipboardEvent) {
  if (mediaDisabled.value || recording.value) return;
  const files = filesFromClipboard(event);
  if (!files.length) return;

  const target = event.target;
  const isComposerPaste = target instanceof Node && !!composerRef.value?.contains(target);
  if (!isComposerPaste && isEditableElement(document.activeElement)) return;

  event.preventDefault();
  pickerOpen.value = false;
  for (const file of files) {
    await props.messenger.sendAttachment(file);
  }
}

function send() {
  if (!canSend.value) return;
  props.messenger.sendChat();
  props.messenger.setTyping?.(false);
}

function syncCursor() {
  const input = inputRef.value;
  cursorPosition.value = input?.selectionStart ?? String(props.messenger.state.messageInput || "").length;
  mentionIndex.value = 0;
  mentionSuppressedStart.value = -1;
  props.messenger.setTyping?.(Boolean(String(props.messenger.state.messageInput || "").trim()));
  syncComposerHeight();
}

async function insertMention(username: string) {
  const target = String(username || "").trim().toLowerCase();
  const search = mentionSearch.value;
  if (!target || !search) return;

  const input = inputRef.value;
  const current = String(props.messenger.state.messageInput || "");
  const cursor = input?.selectionEnd ?? cursorPosition.value ?? current.length;
  const before = current.slice(0, search.start);
  const after = current.slice(cursor);
  const spacer = after && !/^\s/.test(after) ? " " : "";
  const next = `${before}@${target} ${spacer}${after}`.slice(0, props.messenger.MESSAGE_LIMIT || 2000);
  const nextCursor = Math.min(next.length, before.length + target.length + 2);

  props.messenger.state.messageInput = next;
  mentionIndex.value = 0;
  mentionSuppressedStart.value = -1;
  await nextTick();
  inputRef.value?.focus();
  try { inputRef.value?.setSelectionRange(nextCursor, nextCursor); } catch { /* ignore */ }
  cursorPosition.value = nextCursor;
}

function onComposerKeydown(event: KeyboardEvent) {
  if (mentionOpen.value && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowDown") {
      mentionIndex.value = (mentionIndex.value + 1) % mentionOptions.value.length;
    } else if (event.key === "ArrowUp") {
      mentionIndex.value = (mentionIndex.value - 1 + mentionOptions.value.length) % mentionOptions.value.length;
    } else if (event.key === "Enter" || event.key === "Tab") {
      insertMention(selectedMention.value);
    } else if (event.key === "Escape") {
      mentionIndex.value = 0;
      mentionSuppressedStart.value = mentionSearch.value?.start ?? -1;
    }
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
}

function pickFile() {
  if (mediaDisabled.value) return;
  mobileActionsOpen.value = false;
  fileInputRef.value?.click();
}

async function pickCamera() {
  if (mediaDisabled.value) return;
  mobileActionsOpen.value = false;
  await openCamera();
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  for (const f of files) {
    await props.messenger.sendAttachment(f);
  }
  input.value = "";
}

function startHold() {
  if (mediaDisabled.value || recording.value) return;
  props.messenger.startRecordingVoiceMemo();
}

function endHold() {
  if (!recording.value) return;
  props.messenger.stopRecordingVoiceMemo(false);
}

function cancelHold() {
  if (!recording.value) return;
  props.messenger.stopRecordingVoiceMemo(true);
}

function startMobileRecording() {
  if (mediaDisabled.value || recording.value) return;
  mobileActionsOpen.value = false;
  props.messenger.startRecordingVoiceMemo();
}

function togglePicker() {
  if (disabled.value) return;
  pickerOpen.value = !pickerOpen.value;
}

function toggleMobileActions() {
  if (disabled.value) return;
  pickerOpen.value = false;
  mobileActionsOpen.value = !mobileActionsOpen.value;
}

async function insertEmoji(emoji: string) {
  pickerOpen.value = false;
  const input = inputRef.value;
  const current = props.messenger.state.messageInput || "";

  if (!input) {
    props.messenger.state.messageInput = current + emoji;
    return;
  }

  const start = input.selectionStart ?? current.length;
  const end = input.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  let next = before + emoji + after;
  // Respect the same character cap the composer enforces via maxlength.
  const limit = props.messenger.MESSAGE_LIMIT || 2000;
  if (next.length > limit) next = next.slice(0, limit);
  props.messenger.state.messageInput = next;

  await nextTick();
  input.focus();
  const pos = Math.min(next.length, before.length + emoji.length);
  try { input.setSelectionRange(pos, pos); } catch { /* some input types throw */ }
}

function onDocPointerDown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  if (pickerOpen.value && emojiWrapRef.value && !emojiWrapRef.value.contains(event.target)) {
    pickerOpen.value = false;
  }
  if (composerRef.value && !composerRef.value.contains(event.target)) {
    mentionIndex.value = 0;
    mentionSuppressedStart.value = mentionSearch.value?.start ?? -1;
  }
  if (mobileActionsOpen.value && composerRef.value && !composerRef.value.contains(event.target)) {
    mobileActionsOpen.value = false;
  }
}

function onDocKey(event: KeyboardEvent) {
  if (pickerOpen.value && event.key === "Escape") pickerOpen.value = false;
  if (mobileActionsOpen.value && event.key === "Escape") mobileActionsOpen.value = false;
  if (cameraOpen.value && event.key === "Escape") closeCamera();
}

function onResize() {
  syncComposerHeight();
}

function stopCameraStream() {
  if (!cameraStream) return;
  for (const track of cameraStream.getTracks()) track.stop();
  cameraStream = null;
}

async function openCamera() {
  cameraError.value = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = "Camera is not available in this browser.";
    return;
  }

  cameraOpen.value = true;
  await nextTick();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    if (cameraVideoRef.value) {
      cameraVideoRef.value.srcObject = cameraStream;
      await cameraVideoRef.value.play();
    }
  } catch {
    cameraError.value = "Camera access denied or unavailable.";
    stopCameraStream();
  }
}

function closeCamera() {
  stopCameraStream();
  cameraOpen.value = false;
  cameraBusy.value = false;
  cameraError.value = "";
}

async function capturePhoto() {
  const video = cameraVideoRef.value;
  const canvas = cameraCanvasRef.value;
  if (!video || !canvas || cameraBusy.value) return;

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  if (!width || !height) {
    cameraError.value = "Camera is not ready yet.";
    return;
  }

  cameraBusy.value = true;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cameraError.value = "Could not capture photo.";
    cameraBusy.value = false;
    return;
  }
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    cameraError.value = "Could not capture photo.";
    cameraBusy.value = false;
    return;
  }

  const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
  await props.messenger.sendAttachment(file);
  closeCamera();
}

watch(() => [props.messenger.state.messageInput, composerPlaceholder.value], async () => {
  await nextTick();
  syncComposerHeight();
}, { immediate: true });

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onDocKey);
  document.addEventListener("paste", onPaste);
  window.addEventListener("resize", onResize, { passive: true });
  nextTick(syncComposerHeight);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onDocKey);
  document.removeEventListener("paste", onPaste);
  window.removeEventListener("resize", onResize);
  stopCameraStream();
});
</script>

<template>
  <footer ref="composerRef" class="composer">
    <div v-if="recording" class="composer__recording">
      <span class="rec-dot"></span>
      <span class="rec-label">{{ t('composer.holdToRecord') }}</span>
      <span class="rec-time">{{ messenger.formatDuration(messenger.state.recordingElapsed) }}</span>
      <span class="rec-spacer"></span>
      <button type="button" class="btn--ghost" @click="cancelHold">{{ t('composer.recordCancel') }}</button>
      <button type="button" class="btn btn--send" @click="endHold">{{ t('composer.recordSend') }}</button>
    </div>

    <template v-else>
      <input
        ref="fileInputRef"
        type="file"
        multiple
        style="display: none"
        @change="onFile"
      />
      <div v-if="messenger.state.editingMessage" class="reply-draft edit-draft">
        <div>
          <span class="reply-draft__label">{{ t('composer.editing') }}</span>
          <span class="reply-draft__text">{{ messenger.state.editingMessage.text }}</span>
        </div>
        <button type="button" class="icon-btn" :aria-label="t('composer.cancelEdit')" @click="messenger.cancelEditMessage">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div v-else-if="messenger.state.replyingTo" class="reply-draft">
        <div>
          <span class="reply-draft__label">{{ t('composer.replyingTo') }} {{ messenger.state.replyingTo.username || t('message.reply') }}</span>
          <span class="reply-draft__text">{{ messenger.state.replyingTo.text }}</span>
        </div>
        <button type="button" class="icon-btn" :aria-label="t('composer.cancelReply')" @click="messenger.cancelReply">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="composer__mobile-actions">
        <button
          class="icon-btn composer__more"
          type="button"
          aria-label="More message actions"
          :aria-expanded="mobileActionsOpen"
          :disabled="disabled"
          @click="toggleMobileActions"
        >
          <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
        </button>

        <div v-if="mobileActionsOpen" class="composer__actions-pop" role="menu">
          <button type="button" role="menuitem" :disabled="mediaDisabled" @click="pickFile">
            <svg viewBox="0 0 24 24"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7"/></svg>
            <span>{{ t('composer.attachFile') }}</span>
          </button>
          <button type="button" role="menuitem" :disabled="mediaDisabled" @click="startMobileRecording">
            <svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            <span>{{ t('composer.holdToRecord') }}</span>
          </button>
          <button type="button" role="menuitem" :disabled="mediaDisabled" @click="pickCamera">
            <svg viewBox="0 0 24 24"><path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/></svg>
            <span>{{ t('camera.title') }}</span>
          </button>
        </div>
      </div>

      <button class="icon-btn composer__desktop-action" type="button" :aria-label="t('composer.attachFile')" :disabled="mediaDisabled" @click="pickFile">
        <svg viewBox="0 0 24 24"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7"/></svg>
      </button>
      <button class="icon-btn composer__desktop-action" type="button" :aria-label="t('camera.title')" :disabled="mediaDisabled" @click="pickCamera">
        <svg viewBox="0 0 24 24"><path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3.5"/></svg>
      </button>

      <label class="composer__input">
        <textarea
          ref="inputRef"
          v-model="messenger.state.messageInput"
          :maxlength="messenger.MESSAGE_LIMIT"
          rows="1"
          :placeholder="composerPlaceholder"
          :disabled="disabled"
          autocomplete="off"
          spellcheck="false"
          @input="syncCursor"
          @click="syncCursor"
          @keyup="syncCursor"
          @keydown="onComposerKeydown"
        ></textarea>
        <div v-if="mentionOpen" class="mention-picker" role="listbox" aria-label="Mention suggestions">
          <button
            v-for="(username, index) in mentionOptions"
            :key="username"
            type="button"
            class="mention-picker__item"
            :class="{ 'is-active': index === mentionIndex }"
            role="option"
            :aria-selected="index === mentionIndex"
            @mousedown.prevent="insertMention(username)"
          >
            <span class="mention-picker__avatar" :class="`avatar--${messenger.accentFor(username)}`">{{ username.slice(0, 2).toUpperCase() }}</span>
            <span class="mention-picker__name">@{{ username }}</span>
          </button>
        </div>
        <span class="composer__emoji-wrap" ref="emojiWrapRef">
          <button
            class="icon-btn"
            type="button"
            :aria-label="t('composer.emoji')"
            :aria-expanded="pickerOpen"
            :disabled="disabled"
            @click.prevent="togglePicker"
          >
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>

          <div v-if="pickerOpen" class="emoji-picker" role="menu">
            <button
              v-for="emoji in EMOJIS"
              :key="emoji"
              type="button"
              class="emoji-picker__cell"
              :aria-label="emoji"
              @click="insertEmoji(emoji)"
            >{{ emoji }}</button>
          </div>
        </span>
      </label>

      <button
        v-if="canSend"
        class="icon-btn composer__send"
        type="button"
        :aria-label="t('composer.send')"
        @click="send"
      >
        <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>
      </button>
      <button
        v-else
        class="icon-btn composer__mic composer__desktop-action"
        type="button"
        :aria-label="t('composer.holdToRecord')"
        :disabled="mediaDisabled"
        @mousedown.prevent="startHold"
        @mouseup.prevent="endHold"
        @mouseleave="endHold"
        @touchstart.prevent="startHold"
        @touchend.prevent="endHold"
        @touchcancel.prevent="cancelHold"
      >
        <svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
    </template>
  </footer>

  <Teleport to="body">
    <div v-if="cameraOpen" class="camera-modal" role="dialog" aria-modal="true" :aria-label="t('camera.title')">
      <div class="camera-modal__panel">
        <header class="camera-modal__head">
          <span>{{ t('camera.title') }}</span>
          <button type="button" class="icon-btn" :aria-label="t('camera.close')" @click="closeCamera">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="camera-modal__preview">
          <video
            ref="cameraVideoRef"
            autoplay
            muted
            playsinline
          ></video>
          <div v-if="cameraError" class="camera-modal__error">{{ cameraError }}</div>
        </div>

        <canvas ref="cameraCanvasRef" class="sr-only"></canvas>

        <div class="camera-modal__actions">
          <button type="button" class="btn" @click="closeCamera">{{ t('camera.cancel') }}</button>
          <button type="button" class="btn btn--primary" :disabled="cameraBusy || !!cameraError" @click="capturePhoto">
            {{ cameraBusy ? "..." : t('camera.capture') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
