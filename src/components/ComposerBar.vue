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
const cameraFacing = ref<"user" | "environment">(
  (typeof localStorage !== "undefined" && (localStorage.getItem("lqxp_camera_facing") as "user" | "environment" | null)) || "environment"
);
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
const typingLabel = computed(() => {
  const users = props.messenger.typingUsers?.value || [];
  if (!users.length) return "";
  if (users.length === 1) return t("thread.typingOne", { user: users[0] });
  return t("thread.typingMany", { count: String(users.length) });
});
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

function initialsFor(name: string) {
  const clean = String(name || "?").trim();
  const parts = clean.split(/[\s\-_]+/).filter(Boolean).slice(0, 2);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || "?";
}

function mentionAvatarSrc(username: string) {
  return props.messenger.profileImageSrc?.(props.messenger.profileFor?.(username)?.avatar, "avatar") || "";
}

function syncComposerHeight() {
  const input = inputRef.value;
  if (!input) return;

  input.style.height = "auto";
  const maxHeight = 120;
  const nextHeight = Math.min(maxHeight, input.scrollHeight);
  input.style.height = `${Math.max(32, nextHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function focusInput(options: { end?: boolean } = {}) {
  const input = inputRef.value;
  if (!input || disabled.value) return;
  input.focus();
  if (!options.end) return;
  const length = input.value.length;
  try { input.setSelectionRange(length, length); } catch { }
}

const EMOJIS = [
  "😀", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩", "😇",
  "🙂", "😉", "😋", "😛", "😜", "🤪", "🤗", "🤭", "🤔", "🧐",
  "😏", "🙄", "😬", "😒", "😞", "😔", "😢", "😭", "😤", "😡",
  "🥺", "😳", "😱", "😴", "🤒", "🤕", "🤧", "🥳", "🤯", "💀",
  "👍", "👎", "👌", "✌️", "🤞", "🤘", "🤙", "👏", "🙏", "🤝",
  "💪", "👀", "👋", "🙌", "🤦", "🤷", "💃", "🕺", "🦾", "🧠",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💘",
  "🔥", "✨", "⭐", "🎉", "🎊", "💯", "💢", "💥", "💫", "☕"
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
  nextTick(() => focusInput());
}

function syncCursor(options: { resetMentionIndex?: boolean } = {}) {
  const input = inputRef.value;
  cursorPosition.value = input?.selectionStart ?? String(props.messenger.state.messageInput || "").length;
  if (options.resetMentionIndex ?? true) mentionIndex.value = 0;
  props.messenger.setTyping?.(Boolean(String(props.messenger.state.messageInput || "").trim()));
  syncComposerHeight();
}

function onComposerClick() {
  syncCursor();
}

function onComposerKeyup() {
  syncCursor({ resetMentionIndex: !mentionOpen.value });
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
  try { inputRef.value?.setSelectionRange(nextCursor, nextCursor); } catch { }
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
      const mention = selectedMention.value;
      insertMention(mention).then(() => {
        syncCursor();
        mentionSuppressedStart.value = mentionSearch.value?.start ?? 0;
      });
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

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  for (const file of files) {
    await props.messenger.sendAttachment(file);
  }
  target.value = "";
  nextTick(() => focusInput());
}

async function pickCamera() {
  if (mediaDisabled.value || cameraOpen.value) return;
  mobileActionsOpen.value = false;
  pickerOpen.value = false;
  cameraError.value = "";
  cameraBusy.value = false;
  cameraOpen.value = true;
  await nextTick();
  await startCameraStream();
}

async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = "Camera is not available in this browser.";
    return;
  }

  stopCameraStream();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: cameraFacing.value
      },
      audio: false
    });
    if (cameraVideoRef.value) {
      cameraVideoRef.value.srcObject = cameraStream;
      await cameraVideoRef.value.play().catch(() => { });
    }
  } catch (error) {
    cameraError.value = error instanceof Error ? error.message : "Could not open camera.";
    stopCameraStream();
  }
}

function switchCamera() {
  cameraFacing.value = cameraFacing.value === "environment" ? "user" : "environment";
  try { localStorage.setItem("lqxp_camera_facing", cameraFacing.value); } catch { }
  startCameraStream();
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
  const limit = props.messenger.MESSAGE_LIMIT || 2000;
  if (next.length > limit) next = next.slice(0, limit);
  props.messenger.state.messageInput = next;

  await nextTick();
  input.focus();
  const pos = Math.min(next.length, before.length + emoji.length);
  try { input.setSelectionRange(pos, pos); } catch { }
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
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  if (cameraVideoRef.value) cameraVideoRef.value.srcObject = null;
}

function closeCamera() {
  stopCameraStream();
  cameraOpen.value = false;
  cameraBusy.value = false;
  cameraError.value = "";
  nextTick(() => focusInput());
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

  const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
  try {
    await props.messenger.sendAttachment(file);
    closeCamera();
  } catch (error) {
    cameraError.value = error instanceof Error ? error.message : "Could not send photo.";
  } finally {
    cameraBusy.value = false;
  }
}

watch(() => props.messenger.state.activeRoom, () => {
  pickerOpen.value = false;
  mobileActionsOpen.value = false;
  mentionIndex.value = 0;
  mentionSuppressedStart.value = -1;
  nextTick(() => {
    syncComposerHeight();
  });
});

function onInput() {
  mentionSuppressedStart.value = -1;
  syncCursor();
}

watch(() => props.messenger.state.messageInput, () => {
  nextTick(() => syncComposerHeight());
});

watch(() => props.messenger.state.editingMessage?.messageId || "", (messageId) => {
  if (!messageId) return;
  nextTick(() => focusInput({ end: true }));
});

watch(() => props.messenger.state.replyingTo?.messageId || "", (messageId) => {
  if (!messageId) return;
  nextTick(() => focusInput());
});

watch(recording, (active) => {
  if (!active) return;
  pickerOpen.value = false;
  mobileActionsOpen.value = false;
});

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onDocKey);
  window.addEventListener("resize", onResize);
  document.addEventListener("paste", onPaste);
  nextTick(() => {
    syncComposerHeight();
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onDocKey);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("paste", onPaste);
  stopCameraStream();
});
</script>

<template>
  <footer ref="composerRef" class="composer">
    <div v-if="messenger.state.recording" class="voice-recorder">
      <div class="voice-recorder__pulse"></div>
      <span>{{ t('composer.recording') }}</span>
      <div class="voice-recorder__actions">
        <button type="button" class="btn--ghost" @click="cancelHold">{{ t('composer.recordCancel') }}</button>
        <button type="button" class="btn btn--send" @click="endHold">{{ t('composer.recordSend') }}</button>
      </div>
    </div>

    <template v-else>
      <div class="composer__topline">
        <div v-if="typingLabel" class="typing-indicator composer__typing-indicator" aria-live="polite">{{ typingLabel }}
        </div>
        <div v-if="messenger.state.editingMessage" class="reply-draft edit-draft">
          <div>
            <span class="reply-draft__label">{{ t('composer.editing') }}</span>
            <span class="reply-draft__text">{{ messenger.state.editingMessage.text }}</span>
          </div>
          <button type="button" class="icon-btn" :aria-label="t('composer.cancelEdit')"
            @click="messenger.cancelEditMessage">
            <svg viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div v-else-if="messenger.state.replyingTo" class="reply-draft">
          <div>
            <span class="reply-draft__label">{{ t('composer.replyingTo') }} {{ messenger.state.replyingTo.username ||
              t('message.reply') }}</span>
            <span class="reply-draft__text">{{ messenger.state.replyingTo.text }}</span>
          </div>
          <button type="button" class="icon-btn" :aria-label="t('composer.cancelReply')" @click="messenger.cancelReply">
            <svg viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <input ref="fileInputRef" type="file" multiple accept="image/png,image/gif,image/jpeg" style="display: none" @change="onFile" />
      <div class="composer__mobile-actions">
        <button class="icon-btn composer__more" type="button" aria-label="More message actions"
          :aria-expanded="mobileActionsOpen" :disabled="disabled" @click="toggleMobileActions">
          <svg viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>

        <Teleport to="body">
          <div v-if="mobileActionsOpen" class="composer__actions-backdrop" @click.self="mobileActionsOpen = false">
            <div class="composer__actions-pop" role="menu" @click.stop>
              <div class="composer__actions-header">
                <strong>{{ t('composer.attachFile') }}</strong>
              </div>
              <button type="button" role="menuitem" :disabled="mediaDisabled" @click="pickFile">
                <svg viewBox="0 0 24 24">
                  <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7" />
                </svg>
                <span>{{ t('composer.attachFile') }}</span>
              </button>
              <button type="button" role="menuitem" :disabled="mediaDisabled" @click="startMobileRecording">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10a7 7 0 0 1-14 0" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                <span>{{ t('composer.holdToRecord') }}</span>
              </button>
              <button type="button" role="menuitem" :disabled="mediaDisabled" @click="pickCamera">
                <svg viewBox="0 0 24 24">
                  <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span>{{ t('camera.title') }}</span>
              </button>
              <div class="composer__actions-separator" aria-hidden="true"></div>
              <button type="button" class="composer__actions-cancel" role="menuitem" @click="mobileActionsOpen = false">
                <span>{{ t('message.cancel') }}</span>
              </button>
            </div>
          </div>
        </Teleport>
      </div>

      <label class="composer__input" :class="{ 'composer__input--streamer-blur': messenger.state.streamerMode }">
        <textarea ref="inputRef" v-model="messenger.state.messageInput" :maxlength="messenger.MESSAGE_LIMIT" rows="1"
          :placeholder="composerPlaceholder" :disabled="disabled" autocomplete="off" spellcheck="false" @input="onInput"
          @click="onComposerClick" @keyup="onComposerKeyup" @keydown="onComposerKeydown"></textarea>

        <button class="icon-btn composer__desktop-action" type="button" :aria-label="t('camera.title')"
          :disabled="mediaDisabled" @click="pickCamera">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>
        <button class="icon-btn composer__desktop-action" type="button" :aria-label="t('composer.attachFile')"
          :disabled="mediaDisabled" @click="pickFile">
          <svg viewBox="0 0 24 24">
            <path
              d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7" />
          </svg>
        </button>

        <button v-if="!canSend" class="icon-btn composer__mic composer__desktop-action" type="button"
          :aria-label="t('composer.holdToRecord')" :disabled="mediaDisabled" @mousedown.prevent="startHold"
          @mouseup.prevent="endHold" @mouseleave="endHold" @touchstart.prevent="startHold"
          @touchend.prevent="endHold" @touchcancel.prevent="cancelHold">
          <svg viewBox="0 0 24 24">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10a7 7 0 0 1-14 0" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        <div v-if="mentionOpen" class="mention-picker" role="listbox" aria-label="Mention suggestions">
          <button v-for="(username, index) in mentionOptions" :key="username" type="button" class="mention-picker__item"
            :class="{ 'is-active': index === mentionIndex }" role="option" :aria-selected="index === mentionIndex"
            @mousedown.prevent="insertMention(username)">
            <span class="mention-picker__avatar" :class="mentionAvatarSrc(username) ? 'mention-picker__avatar--image' : `avatar--${messenger.accentFor(username)}`">
              <img v-if="mentionAvatarSrc(username)" :src="mentionAvatarSrc(username)" alt="" />
              <template v-else>{{ initialsFor(username) }}</template>
            </span>
            <span class="mention-picker__name">@{{ username }}</span>
          </button>
        </div>
        <span class="composer__emoji-wrap" ref="emojiWrapRef">
          <button class="icon-btn" type="button" :aria-label="t('composer.emoji')" :aria-expanded="pickerOpen"
            :disabled="disabled" @click.prevent="togglePicker">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>

          <div v-if="pickerOpen" class="emoji-picker" role="menu">
            <button v-for="emoji in EMOJIS" :key="emoji" type="button" class="emoji-picker__cell" :aria-label="emoji"
              @click="insertEmoji(emoji)">{{ emoji }}</button>
          </div>
        </span>
      </label>

      <button v-if="canSend" class="icon-btn composer__send" type="button" :aria-label="t('composer.send')"
        @click="send">
        <svg viewBox="0 0 24 24">
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        </svg>
      </button>
    </template>
  </footer>

  <Teleport to="body">
    <div v-if="cameraOpen" class="camera-modal" role="dialog" aria-modal="true" :aria-label="t('camera.title')">
      <div class="camera-modal__panel">
        <header class="camera-modal__head">
          <span>{{ t('camera.title') }}</span>
          <div class="camera-modal__head-actions">
            <button type="button" class="icon-btn" :aria-label="t('camera.switch')" @click="switchCamera">
              <svg viewBox="0 0 24 24">
                <path d="M20 7h-5l-1.5-2h-3L9 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
                <path d="M12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                <path d="m7 3 2 2" />
                <path d="m17 3-2 2" />
              </svg>
            </button>
            <button type="button" class="icon-btn" :aria-label="t('camera.close')" @click="closeCamera">
              <svg viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <div class="camera-modal__preview">
          <video ref="cameraVideoRef" autoplay muted playsinline></video>
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
