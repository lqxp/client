<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { twemojiSvgUrl } from "@/utils/twemoji";
import { EMOJI_SHORTCODES } from "@/config/emoji";
import EmojiPicker from "@/components/EmojiPicker.vue";

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
/** Which failure to explain, rather than the browser's own wording. */
type CameraFault = "" | "unavailable" | "denied" | "notFound" | "busy" | "failed" | "notReady" | "captureFailed";
/** Which failure to explain, rather than the browser's own wording. */
const cameraError = ref<CameraFault>("");
const mobileActionsOpen = ref(false);
const isMobile = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
const cursorPosition = ref(0);
const mentionIndex = ref(0);
const mentionSuppressedStart = ref(-1);
const shortcodeIndex = ref(0);
const shortcodeSuppressedStart = ref(-1);
const cameraFacing = ref<"user" | "environment">(
  (typeof localStorage !== "undefined" && (localStorage.getItem("lqxp_camera_facing") as "user" | "environment" | null)) || "environment"
);
let cameraStream: MediaStream | null = null;

const pendingFiles = ref<{ id: string; file: File; preview: string; progress: number }[]>([]);
const uploading = ref(false);
const muteNow = ref(Date.now());
let muteTimer: ReturnType<typeof setInterval> | null = null;

const hasPendingFiles = computed(() => pendingFiles.value.length > 0);
const speakBlockReason = computed(() => props.messenger.speakBlockReason?.(props.messenger.state.activeRoom) || "");
const speakBlocked = computed(() => Boolean(speakBlockReason.value));
const canSend = computed(() => !uploading.value && !speakBlocked.value && (props.messenger.state.messageInput.trim().length > 0 || hasPendingFiles.value) && !!props.messenger.state.activeRoom);
const disabled = computed(() => !props.messenger.state.activeRoom || speakBlocked.value);
const editing = computed(() => !!props.messenger.state.editingMessage);
const composerPlaceholder = computed(() => {
  if (speakBlocked.value) {
    switch (speakBlockReason.value) {
      case "banned": return t('rooms.cannotSpeakBanned');
      case "timeout": return t('rooms.cannotSpeakTimeout');
      case "locked": return t('composer.cannotSpeakHere', { channel: props.messenger.displayRoomName?.(props.messenger.state.activeRoom) || "" });
      default: return t('composer.placeholder');
    }
  }
  if (disabled.value) return t('composer.placeholder');
  return editing.value ? t('composer.editing') : t('composer.placeholder');
});
const mediaDisabled = computed(() => disabled.value || editing.value);
const recording = computed(() => !!props.messenger.state.recording);

function formatMuteRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const muteCooldownLabel = computed(() => {
  const roomId = props.messenger.state.activeRoom;
  if (!roomId) return "";
  void muteNow.value;
  const remaining = Number(props.messenger.myTimeoutRemaining?.(roomId) || 0);
  if (remaining <= 0) return "";
  return formatMuteRemaining(remaining);
});
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
/**
 * A half-typed `:shortcode`. The colon has to start a word, so `http://` and
 * `12:30` never open the list.
 */
const shortcodeSearch = computed(() => {
  const input = inputRef.value;
  const cursor = input?.selectionStart ?? cursorPosition.value ?? 0;
  const beforeCursor = String(props.messenger.state.messageInput || "").slice(0, cursor);
  const match = /(^|[^a-zA-Z0-9_]):([a-z0-9_+-]{1,32})$/i.exec(beforeCursor);
  if (!match) return null;
  return {
    start: beforeCursor.length - match[2].length - 1,
    query: match[2].toLowerCase()
  };
});

const shortcodeOptions = computed<{ code: string; emoji: string }[]>(() => {
  if (disabled.value || !shortcodeSearch.value) return [];
  const query = shortcodeSearch.value.query;
  const seen = new Set<string>();
  return Object.keys(EMOJI_SHORTCODES)
    .filter((code) => code.startsWith(query) || code.includes(query))
    .sort((a, b) => {
      const aStarts = a.startsWith(query) ? 0 : 1;
      const bStarts = b.startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.length - b.length || a.localeCompare(b);
    })
    // One row per emoji: several words point at the same character.
    .filter((code) => {
      const emoji = EMOJI_SHORTCODES[code];
      if (seen.has(emoji)) return false;
      seen.add(emoji);
      return true;
    })
    .slice(0, 8)
    .map((code) => ({ code, emoji: EMOJI_SHORTCODES[code] }));
});

const shortcodeOpen = computed(
  () => shortcodeOptions.value.length > 0 && shortcodeSearch.value?.start !== shortcodeSuppressedStart.value
);
const selectedShortcode = computed(
  () => shortcodeOptions.value[Math.min(shortcodeIndex.value, shortcodeOptions.value.length - 1)] || null
);

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
  addPendingFiles(files);
}

async function send() {
  if (!canSend.value) return;

  // Upload pending attachments with progress before/alongside the text.
  const files = pendingFiles.value.map((f) => ({ ...f }));
  if (files.length) {
    uploading.value = true;
  }

  try {
    const text = props.messenger.state.messageInput.trim();

    if (files.length === 0) {
      // Text-only message.
      if (text) props.messenger.sendChat();
      props.messenger.setTyping?.(false);
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      const target = pendingFiles.value.find((f) => f.id === item.id);
      // Attach the text to the last file so text and image(s) ship as a single message.
      const caption = i === files.length - 1 ? text : "";
      await props.messenger.sendAttachment(item.file, caption, (pct: number) => {
        if (target) target.progress = pct;
      });
      if (target) {
        URL.revokeObjectURL(target.preview);
        pendingFiles.value = pendingFiles.value.filter((f) => f.id !== item.id);
      }
    }

    props.messenger.state.messageInput = "";
    props.messenger.setTyping?.(false);
  } finally {
    uploading.value = false;
    nextTick(() => focusInput());
  }
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

function onComposerContainerClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  // Clicking the padding around the field puts the caret back in the message,
  // but the emoji picker and the suggestion lists are children of the same
  // container: without this guard a click on the picker's search box focused
  // it and then handed the focus straight back to the message field, so every
  // keystroke went to the chat.
  if (target.closest("button, input, select, a, .emoji-picker, .mention-picker")) return;
  focusInput();
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
  if (shortcodeOpen.value && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
    event.preventDefault();
    const count = shortcodeOptions.value.length;
    if (event.key === "ArrowDown") {
      shortcodeIndex.value = (shortcodeIndex.value + 1) % count;
    } else if (event.key === "ArrowUp") {
      shortcodeIndex.value = (shortcodeIndex.value - 1 + count) % count;
    } else if (event.key === "Enter" || event.key === "Tab") {
      const option = selectedShortcode.value;
      if (option) void insertShortcode(option);
    } else {
      shortcodeIndex.value = 0;
      shortcodeSuppressedStart.value = shortcodeSearch.value?.start ?? -1;
    }
    return;
  }

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

function renameUploadFile(file: File): File {
  try {
    return new File([file], props.messenger.randomUploadFilename(file.name), {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    return file;
  }
}

function addPendingFiles(files: File[]) {
  for (const file of files) {
    const finalFile = props.messenger.state.renameUploadsRandomly
      ? renameUploadFile(file)
      : file;
    pendingFiles.value.push({
      id: crypto.randomUUID(),
      file: finalFile,
      preview: URL.createObjectURL(finalFile),
      progress: 0,
    });
  }
}

// Exposed so the conversation view can feed files dropped anywhere over it.
defineExpose({ addFiles: addPendingFiles });

function removePendingFile(id: string) {
  const item = pendingFiles.value.find((f) => f.id === id);
  if (item) URL.revokeObjectURL(item.preview);
  pendingFiles.value = pendingFiles.value.filter((f) => f.id !== id);
}

function clearPendingFiles() {
  for (const item of pendingFiles.value) URL.revokeObjectURL(item.preview);
  pendingFiles.value = [];
}

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files || []);
  addPendingFiles(files);
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

/**
 * `getUserMedia` rejects with a DOMException whose message is written by the
 * browser, in the browser's language, for developers. Each cause gets its own
 * sentence and its own way out instead.
 */
function cameraFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied" as const;
  if (name === "NotFoundError" || name === "OverconstrainedError") return "notFound" as const;
  if (name === "NotReadableError" || name === "AbortError") return "busy" as const;
  return "failed" as const;
}

async function startCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = "unavailable";
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
    cameraError.value = cameraFailure(error);
    stopCameraStream();
  }
}

/** Only some faults are worth offering a second attempt for. */
const cameraRetryable = computed(() => ["denied", "notFound", "busy", "failed"].includes(cameraError.value));
const cameraHint = computed(() => {
  const key = cameraError.value;
  if (key === "denied") return t("camera.deniedHint");
  if (key === "notFound") return t("camera.notFoundHint");
  if (key === "busy") return t("camera.busyHint");
  return "";
});

async function retryCamera() {
  cameraError.value = "";
  await nextTick();
  await startCameraStream();
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

/** Swaps the half-typed `:code` for its character and closes the list. */
async function insertShortcode(option: { code: string; emoji: string }) {
  const search = shortcodeSearch.value;
  const input = inputRef.value;
  if (!search || !input) return;
  const value = props.messenger.state.messageInput || "";
  const caret = input.selectionStart ?? value.length;

  props.messenger.state.messageInput = value.slice(0, search.start) + option.emoji + value.slice(caret);
  shortcodeIndex.value = 0;
  shortcodeSuppressedStart.value = -1;
  const position = search.start + option.emoji.length;
  await nextTick();
  input.focus();
  input.setSelectionRange(position, position);
  syncCursor();
}

const SHORTCODE_AT_CARET = /:([a-z0-9_+-]{2,32}):$/i;

/**
 * Turns `:tada:` into 🎉 the moment the closing colon is typed, leaving the
 * caret after the emoji. Typing continues uninterrupted; nothing happens when
 * the word is unknown, so `10:30:` and the like are left alone.
 */
function expandShortcodeAtCaret() {
  const input = inputRef.value;
  if (!input) return;
  const value = props.messenger.state.messageInput || "";
  const caret = input.selectionStart ?? value.length;
  const match = SHORTCODE_AT_CARET.exec(value.slice(0, caret));
  if (!match) return;
  const emoji = EMOJI_SHORTCODES[match[1].toLowerCase()];
  if (!emoji) return;

  props.messenger.state.messageInput = value.slice(0, match.index) + emoji + value.slice(caret);
  const position = match.index + emoji.length;
  nextTick(() => {
    input.setSelectionRange(position, position);
    input.focus();
  });
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
  isMobile.value = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
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
    cameraError.value = "notReady";
    return;
  }

  cameraBusy.value = true;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cameraError.value = "captureFailed";
    cameraBusy.value = false;
    return;
  }
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    cameraError.value = "captureFailed";
    cameraBusy.value = false;
    return;
  }

  const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
  addPendingFiles([file]);
  closeCamera();
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
  shortcodeSuppressedStart.value = -1;
  shortcodeIndex.value = 0;
  expandShortcodeAtCaret();
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
  muteTimer = setInterval(() => {
    muteNow.value = Date.now();
  }, 1000);
  nextTick(() => {
    syncComposerHeight();
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onDocKey);
  window.removeEventListener("resize", onResize);
  document.removeEventListener("paste", onPaste);
  if (muteTimer) clearInterval(muteTimer);
  muteTimer = null;
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
      <div v-if="hasPendingFiles" class="composer__attachments">
        <div
          v-for="item in pendingFiles"
          :key="item.id"
          class="composer__attachment"
        >
          <img v-if="item.file.type.startsWith('image/')" :src="item.preview" alt="" class="composer__attachment-thumb" />
          <div v-else class="composer__attachment-thumb composer__attachment-thumb--file">
            <svg viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M13 2v7h7"/></svg>
          </div>
          <div class="composer__attachment-meta">
            <span class="composer__attachment-name">{{ item.file.name }}</span>
            <div v-if="uploading" class="composer__attachment-progress">
              <span class="composer__attachment-progress-bar" :style="{ width: `${item.progress}%` }"></span>
            </div>
          </div>
          <button v-if="!uploading" type="button" class="icon-btn composer__attachment-remove" :aria-label="t('composer.removeAttachment')" @click="removePendingFile(item.id)">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

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
        <div v-if="muteCooldownLabel" class="composer__mute-cooldown">
          <svg class="composer__mute-cooldown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2 2" />
            <path d="M9 2h6" />
          </svg>
          <span>{{ muteCooldownLabel }}</span>
        </div>
      </div>
      <input ref="fileInputRef" type="file" multiple style="display: none" @change="onFile" />
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

      <div class="composer__input" :class="{ 'composer__input--streamer-blur': messenger.state.streamerMode, 'composer__input--disabled': speakBlocked }"
        @click="onComposerContainerClick">
        <button v-if="!isMobile" class="icon-btn composer__desktop-action composer__attach" type="button" :aria-label="t('composer.attachFile')"
          :disabled="mediaDisabled" @click="pickFile">
          <svg viewBox="0 0 24 24">
            <path
              d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83L14.83 7" />
          </svg>
        </button>

        <textarea ref="inputRef" v-model="messenger.state.messageInput" :maxlength="messenger.MESSAGE_LIMIT" rows="1"
          :placeholder="composerPlaceholder" :disabled="disabled" autocomplete="off" spellcheck="false"
          @input="onInput" @click="onComposerClick" @keyup="onComposerKeyup"
          @keydown="onComposerKeydown"></textarea>

        <button class="icon-btn composer__desktop-action" type="button" :aria-label="t('camera.title')"
          :disabled="mediaDisabled" @click="pickCamera">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
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

        <div v-if="shortcodeOpen" class="mention-picker mention-picker--emoji" role="listbox"
          :aria-label="t('composer.emojiSuggestions')">
          <button v-for="(option, index) in shortcodeOptions" :key="option.code" type="button"
            class="mention-picker__item" :class="{ 'is-active': index === shortcodeIndex }" role="option"
            :aria-selected="index === shortcodeIndex" @mousedown.prevent="insertShortcode(option)">
            <span class="mention-picker__emoji"><img class="emoji-picker__glyph" :src="twemojiSvgUrl(option.emoji)" :alt="option.emoji" draggable="false" /></span>
            <span class="mention-picker__name">:{{ option.code }}:</span>
          </button>
        </div>

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
            :class="{ 'is-active': pickerOpen }" :disabled="disabled" @click.prevent="togglePicker">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>

          <EmojiPicker v-if="pickerOpen" @pick="insertEmoji" />
        </span>

        <button v-if="canSend" class="icon-btn composer__send" type="button" :aria-label="t('composer.send')"
          @click="send">
          <svg viewBox="0 0 24 24">
            <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          </svg>
        </button>
      </div>
    </template>
  </footer>

  <Teleport to="body">
    <div v-if="cameraOpen" class="shot" role="dialog" aria-modal="true" :aria-label="t('camera.title')">
      <div class="shot__stage">
        <video v-show="!cameraError" ref="cameraVideoRef" autoplay muted playsinline></video>

        <!-- Says what went wrong and what to do about it, rather than echoing
             the browser's own developer-facing message. -->
        <div v-if="cameraError" class="shot__fault">
          <!-- A whole camera with the slash cutting its own gap through it. The
               outline used to stop dead on the right, which read as a drawing
               mistake rather than a struck-through camera. -->
          <svg class="shot__fault-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 7l1.5-2h3L15 7h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13.5" r="3.5" />
            <path class="shot__fault-cut" d="M3.6 2.6 20.4 21.4" stroke-width="4" />
            <path d="M4 3 20 21" />
          </svg>
          <p class="shot__fault-title">{{ t(`camera.${cameraError}`) }}</p>
          <p v-if="cameraHint" class="shot__fault-hint">{{ cameraHint }}</p>
          <button v-if="cameraRetryable" type="button" class="shot__retry" @click="retryCamera">
            {{ t('camera.retry') }}
          </button>
        </div>
      </div>

      <header class="shot__top">
        <button type="button" class="shot__chip" :aria-label="t('camera.close')" :title="t('camera.close')"
          @click="closeCamera">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <button v-if="!cameraError" type="button" class="shot__chip" :aria-label="t('camera.switch')"
          :title="t('camera.switch')" @click="switchCamera">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M20 7h-5l-1.5-2h-3L9 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
            <path d="M12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
          </svg>
        </button>
      </header>

      <canvas ref="cameraCanvasRef" class="sr-only"></canvas>

      <footer class="shot__bar">
        <button type="button" class="shot__cancel" @click="closeCamera">{{ t('camera.cancel') }}</button>
        <!-- No viewfinder means nothing to capture: a greyed-out shutter would
             just be a dead control sitting where the main action belongs. -->
        <template v-if="!cameraError">
          <button type="button" class="shot__shutter" :class="{ 'is-busy': cameraBusy }" :disabled="cameraBusy"
            :aria-label="cameraBusy ? t('camera.capturing') : t('camera.capture')"
            :title="cameraBusy ? t('camera.capturing') : t('camera.capture')" @click="capturePhoto">
            <span class="shot__shutter-core"></span>
          </button>
          <span class="shot__spacer" aria-hidden="true"></span>
        </template>
      </footer>
    </div>
  </Teleport>
</template>
