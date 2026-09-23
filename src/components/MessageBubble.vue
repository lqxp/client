<script setup lang="ts">
import { renderMarkdown } from "@/utils/markdown";
import { initialsOf } from "@/utils/initials";
import Icon from "@/components/Icon.vue";
import Avatar from "@/components/Avatar.vue";
import type { ChatMessage, Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import AudioPlayer from "@/components/AudioPlayer.vue";
import ImageViewer from "@/components/ImageViewer.vue";
import EmojiPicker from "@/components/EmojiPicker.vue";
import ProfileCard from "@/components/ProfileCard.vue";
import TextFilePreview from "@/components/TextFilePreview.vue";
import VideoPlayer from "@/components/VideoPlayer.vue";
import { TEXT_ATTACHMENT_EXTENSIONS } from "@/composables/useMessenger";
import { currentWindowZoom } from "@/utils/windowZoom";
import { renderEmojiHtml } from "@/utils/twemoji";
import { isBrokenImage } from "@/utils/brokenImages";

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

const props = defineProps({
  message: { type: Object as PropType<ChatMessage>, required: true },
  messenger: { type: Object as PropType<Messenger>, required: true },
  position: { type: String, default: "single" },
  showAuthor: { type: Boolean, default: true },
  showAvatar: { type: Boolean, default: true },
  inThread: { type: Boolean, default: false }
});

/** A reaction as the normaliser stores it on a message. */
type MessageReaction = NonNullable<ChatMessage["reactions"]>[number];


function messageDomId(messageId: string) {
  return `msg-${String(messageId || "")}`;
}

function previewTextFor(target: ChatMessage | null | undefined, fallbackId = "") {
  if (!target) return fallbackId ? t("message.originalNotLoaded") : "";
  if (target.deleted) return target.deletedByModerator ? t("message.deletedByModerator") : t("message.messageDeleted");
  if (target.kind === "image") return t("message.photo");
  if (target.kind === "video") return t("message.video");
  if (target.kind === "audio" || target.kind === "voice") return t("message.voiceMessage");
  if (target.kind === "file") return target.attachment?.filename || t("message.fileAttachment");
  return target.text || t("composer.placeholder");
}

const isOwn = computed(() => props.messenger.isOwnMessage(props.message));
const canDelete = computed(() => Boolean(props.messenger.canDeleteMessage?.(props.message)));
const isSystem = computed(() => Boolean(props.message.system));
const isSystemCall = computed(() => String(props.message.systemKind || "") === "call");

/**
 * The call line split around the name, so the name can be a button.
 *
 * The split is taken from the translation itself rather than from a regular
 * expression over the sentence: rendering the template with a sentinel in
 * place of the name gives the exact prefix and suffix for whichever language
 * is loaded, and word order changes between them. The line about your own
 * call has no name in it, and falls back to plain text.
 */
const callParts = computed(() => {
  if (!isSystemCall.value) return null;
  const SENTINEL = "\u0000";
  const template = t("thread.callStarted", { user: SENTINEL });
  const cut = template.indexOf(SENTINEL);
  if (cut < 0) return null;
  const before = template.slice(0, cut);
  const after = template.slice(cut + SENTINEL.length);
  const text = String(props.message.text || "");
  if (!text.startsWith(before) || !text.endsWith(after)) return null;
  const user = text.slice(before.length, text.length - (after.length || 0)).trim();
  return user ? { before, user, after } : null;
});
const isSystemPresenceEvent = computed(() =>
  ["presence", "call"].includes(String(props.message.systemKind || "")) ||
  /^msg-system-(join|leave)-/.test(String(props.message.messageId || "")) ||
  /^system-(join|leave)-/.test(String(props.message.messageId || ""))
);
const isDiscordStyle = computed(() => props.messenger.state.messageStyle === "discord");
const streamerBlur = computed(() =>
  Boolean(props.messenger.state.streamerMode || props.messenger.state.streamerLeaving) &&
  !props.message.deleted &&
  !isSystem.value
);
const showTimestamp = computed(() => props.position === "end" || props.position === "single");
const discordActionsStyle = computed(() => (
  isDiscordStyle.value
    ? { left: "auto", right: "12px" }
    : undefined
));

const runClass = computed(() => {
  switch (props.position) {
    case "start": return "is-run-start";
    case "mid": return "is-run-mid";
    case "end": return "is-run-end";
    default: return "is-single";
  }
});

const avatarInitials = computed(() => initialsOf(props.message.username));
const avatarAccent = computed(() => props.messenger.accentFor(props.message.username || ""));
const avatarSrc = computed(() => {
  const messageAvatar = props.messenger.profileImageSrc?.(props.message.profile?.avatar, "avatar") || "";
  if (messageAvatar) return messageAvatar;
  const profile = props.messenger.profileFor?.(props.message.username || "");
  return props.messenger.profileImageSrc?.(profile?.avatar, "avatar") || "";
});

const attachmentUrl = computed(() => props.messenger.attachmentUrlFor(props.message));
const attachmentKind = computed(() => props.message.kind);

const isTextAttachment = computed(() => {
  const attachment = props.message.attachment;
  const mimeType = String(attachment?.mimeType || "").toLowerCase();
  if (mimeType.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript", "application/x-javascript", "application/typescript", "application/x-sh", "application/x-shellscript"].includes(mimeType)) return true;
  const filename = String(attachment?.filename || "").toLowerCase();
  const ext = filename.match(/\.([a-z0-9]+)$/)?.[1] || "";
  return TEXT_ATTACHMENT_EXTENSIONS.has(ext);
});
const jumbo = computed(() => props.message.jumboEmoji && !props.message.deleted);
const deleted = computed(() => props.message.deleted);
const deletedByModerator = computed(() => Boolean(props.message.deletedByModerator));
const deletedLabel = computed(() =>
  deleted.value ? (deletedByModerator.value ? t("message.deletedByModerator") : t("message.deleted")) : ""
);
const preview = computed(() => props.message.preview);
const edited = computed(() => Number(props.message.editedAt || 0) > 0 && !props.message.deleted);
const canEdit = computed(() => props.messenger.canEditMessage?.(props.message));
const validMentionUsers = computed(() => {
  const users = new Set(
    (props.messenger.state.usersByRoom?.[props.message.roomId || props.messenger.state.activeRoom] || [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  users.add("system");
  return users;
});
const effectiveMentioned = computed(() => {
  const me = String(props.messenger.state.username || "").trim().toLowerCase();
  if (!me || !validMentionUsers.value.has(me) || props.messenger.isOwnMessage(props.message)) return false;
  const mentionRegex = new RegExp(`(^|[^a-z0-9_.])@${me.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?=$|[^a-z0-9_.])`, "i");
  return Boolean(props.message.mentioned) && mentionRegex.test(String(props.message.text || ""));
});

const imageViewerOpen = ref(false);
const textViewerOpen = ref(false);
const expandedText = ref(false);
const selectedProfile = ref("");
const contextMenuOpen = ref(false);
const contextMenuRef = ref<HTMLElement | null>(null);
const contextMenuStyle = ref<Record<string, string>>({ top: "0px", left: "0px" });

// Long-press to open context menu on touch devices
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressStartX = 0;
let longPressStartY = 0;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

function isTouchDevice() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

// Starting within the screen edge belongs to the back gesture, not to reply.
const SWIPE_EDGE_GUARD = 24;
const SWIPE_REPLY_THRESHOLD = 64;
const swipeX = ref(0);
const swipeArmed = ref(false);
const swipeReleasing = ref(false);
let swipeTracking = false;
let swipeEngaged = false;
let swipeDecided = false;
let suppressClick = false;

const swipeStyle = computed(() =>
  swipeX.value || swipeReleasing.value
    ? { "--swipe-x": `${swipeX.value}px`, "--swipe-p": String(Math.min(1, swipeX.value / SWIPE_REPLY_THRESHOLD)) }
    : undefined
);

function releaseSwipe() {
  swipeTracking = false;
  swipeDecided = false;
  if (!swipeEngaged && !swipeX.value) return;
  swipeEngaged = false;
  swipeReleasing.value = true;
  swipeX.value = 0;
  swipeArmed.value = false;
  setTimeout(() => (swipeReleasing.value = false), 260);
}

function onMessageClickCapture(event: MouseEvent) {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  onStreamerReveal(event);
}

function onMessagePointerDown(event: PointerEvent) {
  if (!isTouchDevice()) return;
  swipeTracking = !deleted.value && !isSystem.value && event.clientX > SWIPE_EDGE_GUARD;
  swipeEngaged = false;
  swipeDecided = false;
  longPressStartX = event.clientX;
  longPressStartY = event.clientY;
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    contextMenuOpen.value = true;
    positionContextMenu(longPressStartX, longPressStartY);
  }, LONG_PRESS_MS);
}

function onMessagePointerMove(event: PointerEvent) {
  const dx = event.clientX - longPressStartX;
  const dy = event.clientY - longPressStartY;
  if (longPressTimer && (Math.abs(dx) > LONG_PRESS_MOVE_THRESHOLD || Math.abs(dy) > LONG_PRESS_MOVE_THRESHOLD)) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (!swipeTracking) return;
  if (!swipeDecided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    swipeDecided = true;
    swipeEngaged = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (!swipeEngaged) swipeTracking = false;
  }
  if (!swipeEngaged) return;
  const pull = Math.max(0, dx);
  swipeX.value = pull < SWIPE_REPLY_THRESHOLD ? pull : SWIPE_REPLY_THRESHOLD + (pull - SWIPE_REPLY_THRESHOLD) * 0.25;
  const armed = pull >= SWIPE_REPLY_THRESHOLD;
  if (armed && !swipeArmed.value) navigator.vibrate?.(8);
  swipeArmed.value = armed;
}

function onMessagePointerUp() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (swipeEngaged) {
    suppressClick = true;
    if (swipeArmed.value) props.messenger.startReply(props.message);
  }
  releaseSwipe();
}

function onMessagePointerCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  releaseSwipe();
}
const reactionTooltip = ref<{
  emoji: string;
  count: number;
  users: string[];
  left: number;
  top: number;
  placement: "top" | "bottom";
} | null>(null);
let reactionTooltipHideTimer: number | null = null;
let reactionTooltipFallbackTimer: number | null = null;
const repliedMessage = computed(() =>
  props.messenger.findMessageById(props.message.roomId, props.message.replyToMessageId)
);
const replyLabel = computed(() => repliedMessage.value?.username || (props.message.replyToMessageId ? "Message" : ""));
const replyText = computed(() => previewTextFor(repliedMessage.value, props.message.replyToMessageId));
const replyEdited = computed(() => Number(repliedMessage.value?.editedAt || 0) > 0 && !repliedMessage.value?.deleted);
const replyAvatarSrc = computed(() => {
  const messageAvatar = props.messenger.profileImageSrc?.(repliedMessage.value?.profile?.avatar, "avatar") || "";
  if (messageAvatar) return messageAvatar;
  const profile = props.messenger.profileFor?.(repliedMessage.value?.username || "");
  return props.messenger.profileImageSrc?.(profile?.avatar, "avatar") || "";
});
const replyAvatarAccent = computed(() => props.messenger.accentFor(repliedMessage.value?.username || replyLabel.value || ""));
const replyAvatarInitials = computed(() => initialsOf(repliedMessage.value?.username || replyLabel.value || "?"));
const replyHasVisual = computed(() => {
  const kind = repliedMessage.value?.kind;
  return kind === "image" || kind === "video" || kind === "audio" || kind === "voice" || kind === "file";
});
const textLineCount = computed(() => String(props.message.text || "").split(/\r?\n/).length);
const isTextCollapsible = computed(() =>
  !deleted.value
  && textLineCount.value > 10
  && ["text", "file", "audio", "video", "image"].includes(String(attachmentKind.value || "text"))
);

function reactionUsers(reaction: MessageReaction | null | undefined) {
  return (Array.isArray(reaction?.users) ? reaction.users : [])
    .map((user: unknown) => String(user || "").trim())
    .filter(Boolean);
}

function showReactionTooltip(event: MouseEvent, reaction: MessageReaction) {
  const users = reactionUsers(reaction);
  if (!users.length) return;
  if (reactionTooltipHideTimer) {
    window.clearTimeout(reactionTooltipHideTimer);
    reactionTooltipHideTimer = null;
  }
  // getBoundingClientRect()/innerWidth are visual (unzoomed) pixels but the
  // fixed tooltip's left/top live in zoomed CSS pixels: convert everything.
  const zoom = currentWindowZoom();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = 220;
  const height = 220;
  const padding = 8;
  const styles = getComputedStyle(document.documentElement);
  const mobileStatusOffset = Number.parseFloat(styles.getPropertyValue("--mobile-status-offset")) || 0;
  const topPadding = mobileStatusOffset + padding;
  const anchorLeft = rect.left / zoom;
  const anchorTop = rect.top / zoom;
  const anchorBottom = rect.bottom / zoom;
  const left = Math.min(Math.max(anchorLeft, padding), window.innerWidth / zoom - width - padding);
  const placement: "top" | "bottom" = anchorTop - height - 10 < topPadding ? "bottom" : "top";
  reactionTooltip.value = {
    emoji: reaction.emoji,
    count: reaction.count,
    users,
    left,
    top: placement === "top" ? anchorTop - 10 : Math.max(anchorBottom + 10, topPadding),
    placement
  };
  if (reactionTooltipFallbackTimer) window.clearTimeout(reactionTooltipFallbackTimer);
  reactionTooltipFallbackTimer = window.setTimeout(() => {
    reactionTooltip.value = null;
  }, 3000);
}

function scheduleHideReactionTooltip() {
  if (reactionTooltipFallbackTimer) {
    window.clearTimeout(reactionTooltipFallbackTimer);
    reactionTooltipFallbackTimer = null;
  }
  reactionTooltipHideTimer = window.setTimeout(() => {
    reactionTooltip.value = null;
  }, 100);
}

function keepReactionTooltip() {
  if (reactionTooltipHideTimer) {
    window.clearTimeout(reactionTooltipHideTimer);
    reactionTooltipHideTimer = null;
  }
  if (reactionTooltipFallbackTimer) {
    window.clearTimeout(reactionTooltipFallbackTimer);
    reactionTooltipFallbackTimer = null;
  }
  reactionTooltipFallbackTimer = window.setTimeout(() => {
    reactionTooltip.value = null;
  }, 3000);
}

const myName = computed(() => String(props.messenger.state.username || "").trim().toLowerCase());

function isMine(reaction: MessageReaction) {
  return reactionUsers(reaction).some((user) => user.toLowerCase() === myName.value);
}

const myReactions = computed(() => new Set(props.message.reactions.filter(isMine).map((reaction) => reaction.emoji)));

const visibleReactions = computed(() => props.message.reactions);
const threadInfo = computed(() =>
  props.inThread || props.message.threadRootId ? undefined : props.messenger.threadSummaries.value.get(String(props.message.messageId || ""))
);

function threadLabel(count: number) {
  const key = `threads.replies.${new Intl.PluralRules(locale.value).select(count)}`;
  const value = t(key, { count: String(count) });
  return value === key ? t("threads.replies.other", { count: String(count) }) : value;
}

function onOpenThread() {
  closeContextMenu();
  props.messenger.openThread(props.message);
}
const pollSelection = ref<number[]>([]);
const pollMine = computed(() => props.messenger.pollChoices.get(String(props.message.messageId || "")) || []);
const pollVoted = computed(() => props.message.pollState.voted);

function pollShare(index: number) {
  const state = props.message.pollState;
  return state.total ? Math.min(1, (state.counts[index] || 0) / state.total) : 0;
}

function togglePollOption(index: number) {
  if (pollVoted.value) return;
  const selected = pollSelection.value;
  if (!props.message.poll?.multi) pollSelection.value = selected[0] === index ? [] : [index];
  else pollSelection.value = selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index];
}

function submitPollVote() {
  if (!pollSelection.value.length) return;
  props.messenger.votePoll(props.message, pollSelection.value);
  pollSelection.value = [];
}

function pollVotesLabel(count: number) {
  const key = `poll.votes.${new Intl.PluralRules(locale.value).select(count)}`;
  const value = t(key, { count: String(count) });
  return value === key ? t("poll.votes.other", { count: String(count) }) : value;
}

const bumped = ref(new Set<string>());

watch(
  () => props.message.reactions.map((reaction) => `${reaction.emoji}\u0000${reaction.count}`).join("|"),
  (_next, previous) => {
    const before = new Map<string, number>();
    for (const entry of String(previous || "").split("|")) {
      const [emoji, count] = entry.split("\u0000");
      if (emoji) before.set(emoji, Number(count) || 0);
    }
    const grown = props.message.reactions
      .filter((reaction) => before.has(reaction.emoji) && reaction.count > (before.get(reaction.emoji) || 0))
      .map((reaction) => reaction.emoji);
    if (!grown.length) return;
    bumped.value = new Set([...bumped.value, ...grown]);
    setTimeout(() => {
      const remaining = new Set(bumped.value);
      for (const emoji of grown) remaining.delete(emoji);
      bumped.value = remaining;
    }, 520);
  }
);

let chipPressTimer: ReturnType<typeof setTimeout> | null = null;
let chipPressFired = false;

function clearChipPress() {
  if (chipPressTimer) {
    clearTimeout(chipPressTimer);
    chipPressTimer = null;
  }
}

function onReactionPointerDown(event: PointerEvent, reaction: MessageReaction) {
  chipPressFired = false;
  clearChipPress();
  if (event.pointerType === "mouse") return;
  chipPressTimer = setTimeout(() => {
    chipPressFired = true;
    openReactionsViewer(reaction.emoji);
  }, LONG_PRESS_MS);
}

function onReactionContextMenu(event: MouseEvent) {
  if (isTouchDevice()) {
    event.preventDefault();
    return;
  }
  onMessageContextMenu(event);
}

const reactionsViewer = ref<string | null>(null);
const reactionsTotal = computed(() => props.message.reactions.reduce((sum, reaction) => sum + reaction.count, 0));
const reactionsViewerRows = computed(() =>
  props.message.reactions
    .filter((reaction) => !reactionsViewer.value || reaction.emoji === reactionsViewer.value)
    .flatMap((reaction) => reactionUsers(reaction).map((user) => ({ user, emoji: reaction.emoji })))
);

function openReactionsViewer(emoji = "") {
  closeContextMenu();
  reactionTooltip.value = null;
  reactionsViewer.value = emoji;
}

function closeReactionsViewer() {
  reactionsViewer.value = null;
}

function reactorAvatar(username: string) {
  return props.messenger.profileImageSrc?.(props.messenger.profileFor?.(username)?.avatar, "avatar") || "";
}

function openReactorProfile(username: string) {
  reactionsViewer.value = null;
  selectedProfile.value = username;
}

function onReactionClick(reaction: MessageReaction) {
  if (chipPressFired) {
    chipPressFired = false;
    return;
  }
  props.messenger.toggleReaction(props.message, reaction.emoji);
  if (reactionTooltipHideTimer) {
    window.clearTimeout(reactionTooltipHideTimer);
    reactionTooltipHideTimer = null;
  }
  reactionTooltip.value = null;
}

const renderDiscordEmoji = renderEmojiHtml;

function isKnownMention(username: string) {
  return validMentionUsers.value.has(String(username || "").trim().toLowerCase());
}

function markdown(value: unknown) {
  return renderMarkdown(value, {
    isKnownMention,
    labels: { copyCode: t("message.copyCode"), copy: t("message.copy"), spoilerHidden: t("message.spoilerHidden") },
  });
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function onCodeCopyClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const button = target?.closest?.("[data-code-copy]") as HTMLElement | null;
  if (!button) return false;

  event.preventDefault();
  event.stopPropagation();

  const block = button.closest(".codeblock");
  const text = block?.querySelector("code")?.textContent || "";
  if (!text) return true;

  const copied = await copyText(text);
  if (!copied) return true;

  const label = button.querySelector("span");
  if (!label) return true;
  label.textContent = "Copied";
  button.classList.add("is-copied");
  window.setTimeout(() => {
    label.textContent = "Copy";
    button.classList.remove("is-copied");
  }, 1200);
  return true;
}

/** Records where the pointer is, in the element's own coordinates, so the
 *  particle cloud can open its hole from there rather than from the middle. */
function setRevealOrigin(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--reveal-x", `${clientX - rect.left}px`);
  el.style.setProperty("--reveal-y", `${clientY - rect.top}px`);
}

/** Lifts the blur off one element; the CSS transition does the animation. */
function revealCover(el: HTMLElement) {
  el.classList.remove("is-peeking");
  el.classList.add("is-revealed");
  el.removeAttribute("aria-label");
}

/**
 * Hovering opens the blur for as long as the pointer stays, clicking latches
 * it open. Both are wanted: a glance costs nothing and closes itself, while a
 * message you actually want to read should not need the mouse held on it.
 */
function onCoverPointerMove(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  const cover = target?.closest?.(PEEKABLE_SELECTOR) as HTMLElement | null;
  if (peeking && peeking !== cover) {
    peeking.classList.remove("is-peeking");
    peeking = null;
  }
  if (!cover || cover.classList.contains("is-revealed")) return;
  setRevealOrigin(cover, event.clientX, event.clientY);
  if (peeking !== cover) {
    cover.classList.add("is-peeking");
    peeking = cover;
  }
}

function onCoverPointerLeave() {
  if (!peeking) return;
  peeking.classList.remove("is-peeking");
  peeking = null;
}

let peeking: HTMLElement | null = null;

function onSpoilerActivate(event: MouseEvent | KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const spoiler = target?.closest?.("[data-spoiler]") as HTMLElement | null;
  if (!spoiler || spoiler.classList.contains("is-revealed")) return false;
  event.preventDefault();
  event.stopPropagation();
  revealCover(spoiler);
  return true;
}

/** Each part needs the prefix; `"x " + "a, b"` would only scope `a`. */
const PEEKABLE_SELECTOR = [
  "[data-spoiler]",
  ...".msg__avatar, .reply-ref__avatar, .bubble__author > :is(span,button):first-child, .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text, .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph, .att-image-link, .audio-player, .video-player, .embed__media"
    .split(", ")
    .map((part) => `.msg.is-streamer-blur ${part}`)
].join(", ");

const COVERED_SELECTOR =
  ".msg__avatar, .reply-ref__avatar, .bubble__author > :is(span,button):first-child, .jumbo__author," +
  " .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text," +
  " .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph," +
  " .att-image-link, .audio-player, .video-player, .embed__media";

/**
 * In streamer mode a click opens the whole message, not just the part under
 * the pointer: every cover wipes from that same screen point, so the reveal
 * reads as one wave crossing the message instead of a dozen separate ones.
 * Capture phase, so it runs before links and reactions take the click.
 */
function onStreamerReveal(event: MouseEvent) {
  if (!streamerBlur.value) return;
  const root = event.currentTarget as HTMLElement | null;
  if (!root) return;
  const covers = root.querySelectorAll<HTMLElement>(COVERED_SELECTOR);
  let opened = false;
  for (const cover of covers) {
    if (cover.classList.contains("is-revealed")) continue;
    revealCover(cover);
    opened = true;
  }
  if (opened) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function onSpoilerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  onSpoilerActivate(event);
}

async function onMarkdownClick(event: MouseEvent) {
  if (onSpoilerActivate(event)) return;
  const target = event.target as HTMLElement | null;
  const mention = target?.closest?.("[data-mention]") as HTMLElement | null;
  const username = String(mention?.getAttribute?.("data-mention") || "").trim().toLowerCase();
  if (username && isKnownMention(username)) {
    event.preventDefault();
    event.stopPropagation();
    selectedProfile.value = username;
    return;
  }

  await onCodeCopyClick(event);
}

watch(
  () => props.messenger.state.activeRoom,
  () => {
    for (const el of document.querySelectorAll<HTMLElement>(".is-revealed, .is-peeking")) {
      el.classList.remove("is-revealed", "is-peeking");
      el.style.removeProperty("--reveal-x");
      el.style.removeProperty("--reveal-y");
    }
    peeking = null;
  }
);

const reactionPickerOpen = ref(false);
const reactionPickerStyle = ref<Record<string, string>>({});
/**
 * Narrow screens get a sheet, not a popover.
 *
 * A grid anchored to a 24px button is a pointer idea: on a phone the finger
 * covers the anchor, there is nowhere to flip to, and the grid ends up
 * against an edge whichever way it opens. The platform's answer at this width
 * is a sheet from the bottom, so that is what this is.
 */
const reactionSheet = ref(false);

/**
 * Anchors the grid to the button that opened it, flipping above when there is
 * no room below, and clamping so it never hangs off the side.
 */
const SHEET_MEDIA = "(max-width: 760px), (hover: none) and (pointer: coarse)";

function openReactionPicker(event: MouseEvent) {
  reactionSheet.value = window.matchMedia?.(SHEET_MEDIA).matches ?? false;
  if (reactionSheet.value) {
    reactionPickerStyle.value = {};
    reactionPickerOpen.value = true;
    return;
  }
  const button = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  if (!button) return;
  const width = 360;
  const height = 400;
  const left = Math.min(Math.max(8, button.left - width / 2), window.innerWidth - width - 8);
  const below = window.innerHeight - button.bottom;
  const style: Record<string, string> = { left: `${left}px` };
  if (below < height + 16 && button.top > below) style.bottom = `${window.innerHeight - button.top + 8}px`;
  else style.top = `${button.bottom + 8}px`;
  reactionPickerStyle.value = style;
  reactionPickerOpen.value = true;
}

function onMoreReactions() {
  closeContextMenu();
  reactionSheet.value = true;
  reactionPickerStyle.value = {};
  reactionPickerOpen.value = true;
}

function onReactionPicked(emoji: string) {
  reactionPickerOpen.value = false;
  props.messenger.toggleReaction(props.message, emoji);
}

function closeProfile() {
  selectedProfile.value = "";
}

function jumpToMessage(messageId: string) {
  const targetId = messageDomId(messageId);
  const element = document.getElementById(targetId);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.remove("is-jump-highlight");
  requestAnimationFrame(() => {
    element.classList.add("is-jump-highlight");
    window.setTimeout(() => element.classList.remove("is-jump-highlight"), 1200);
  });
}

function onReplyClick() {
  if (!repliedMessage.value?.messageId) return;
  jumpToMessage(repliedMessage.value.messageId);
}

function download() {
  if (!attachmentUrl.value || !props.message.attachment) return;
  if (isTextAttachment.value) {
    textViewerOpen.value = true;
    return;
  }
  const a = document.createElement("a");
  a.href = attachmentUrl.value;
  a.download = props.message.attachment.filename || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openImageViewer() {
  if (!attachmentUrl.value) return;
  imageViewerOpen.value = true;
}

function closeContextMenu() {
  contextMenuOpen.value = false;
}

async function positionContextMenu(clientX: number, clientY: number) {
  const padding = 16;
  // Event coords are visual (unzoomed) pixels but the fixed menu's left/top
  // live in zoomed CSS pixels: convert so the menu opens under the cursor.
  const zoom = currentWindowZoom();
  const x = clientX / zoom;
  const y = clientY / zoom;
  const vw = window.innerWidth / zoom;
  const vh = window.innerHeight / zoom;
  contextMenuStyle.value = {
    left: `${x}px`,
    top: `${y}px`
  };

  // Menu is rendered in a Teleport with conditional (v-if) content, so a
  // single nextTick is not enough for its final size to be measurable.
  await nextTick();
  await nextTick();

  let rect = contextMenuRef.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    await nextTick();
    rect = contextMenuRef.value?.getBoundingClientRect();
  }

  if (!rect || rect.width === 0 || rect.height === 0) {
    return;
  }

  // getBoundingClientRect() is also in visual pixels: convert to zoomed space.
  const menuW = rect.width / zoom;
  const menuH = rect.height / zoom;
  const maxLeft = Math.max(padding, vw - menuW - padding);
  const maxTop = Math.max(padding, vh - menuH - padding);

  let left = Math.min(Math.max(x, padding), maxLeft);
  const top = Math.min(Math.max(y, padding), maxTop);

  const rightThreshold = vw - menuW - padding * 2;
  if (x > rightThreshold) {
    left = Math.max(padding, x - menuW - padding);
  }

  contextMenuStyle.value = {
    left: `${left}px`,
    top: `${top}px`
  };
}

function onMessageContextMenu(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  contextMenuOpen.value = true;
  positionContextMenu(event.clientX, event.clientY);
}

function onGlobalPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(".msg__context-menu")) return;
  closeContextMenu();
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeContextMenu();
}

async function onCopyUserId() {
  const username = String(props.message.username || "").trim();
  const userId = String(props.messenger.userIdForUsername?.(username) || "").trim();
  if (!userId) {
    props.messenger.showToast?.("User ID unavailable.");
    closeContextMenu();
    return;
  }
  const copied = await copyText(userId);
  if (copied) props.messenger.showToast?.("User ID copied.");
  closeContextMenu();
}

async function onCopyMessageText() {
  const text = String(props.message.text || "").trim();
  if (!text) {
    props.messenger.showToast?.(t("message.nothingToCopy"));
    closeContextMenu();
    return;
  }
  const copied = await copyText(text);
  if (copied) props.messenger.showToast?.(t("message.copied"));
  closeContextMenu();
}

function onOpenProfile() {
  selectedProfile.value = String(props.message.username || "").trim().toLowerCase();
  closeContextMenu();
}

function openAuthorProfile() {
  if (deleted.value) return;
  const name = String(props.message.username || "").trim().toLowerCase();
  if (!name) return;
  selectedProfile.value = name;
}

function onStartReply() {
  if (deleted.value) return;
  props.messenger.startReply(props.message);
  closeContextMenu();
}

function onStartEdit() {
  if (!canEdit.value) return;
  props.messenger.startEditMessage(props.message);
  closeContextMenu();
}

function onToggleReaction(emoji: string) {
  props.messenger.toggleReaction(props.message, emoji);
  closeContextMenu();
}

async function onDelete() {
  if (!canDelete.value || deleted.value) return;
  const confirmed = await dialog.showConfirm(t("message.deleteConfirm"), "", {
    danger: true,
    confirmLabel: t("message.delete"),
  });
  if (!confirmed) return;
  props.messenger.deleteMessage(props.message);
  closeContextMenu();
}

onMounted(() => {
  window.addEventListener("pointerdown", onGlobalPointerDown);
  window.addEventListener("keydown", onGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onGlobalPointerDown);
  window.removeEventListener("keydown", onGlobalKeydown);
  if (reactionTooltipHideTimer) window.clearTimeout(reactionTooltipHideTimer);
  if (reactionTooltipFallbackTimer) window.clearTimeout(reactionTooltipFallbackTimer);
  clearChipPress();
});
</script>

<template>
  <article :id="messageDomId(message.messageId)" class="msg" :class="[
    { 'is-own': isOwn, 'is-jumbo': jumbo, 'is-deleted': deleted, 'is-system': isSystem },
    { 'is-mentioned': effectiveMentioned, 'is-discord': isDiscordStyle, 'is-streamer-blur': streamerBlur, 'is-streamer-leaving': messenger.state.streamerLeaving },
    {
      'has-reactions': visibleReactions.length && !deleted,
      'has-discord-reply': message.replyToMessageId && isDiscordStyle
    },
    runClass,
    { 'is-swiping': swipeX > 0, 'is-swipe-release': swipeReleasing }
  ]" :style="swipeStyle" @contextmenu.prevent.stop="onMessageContextMenu" @click.capture="onMessageClickCapture"
    @pointermove.passive="onCoverPointerMove" @pointerleave.passive="onCoverPointerLeave"
    @pointerdown="onMessagePointerDown" @pointermove="onMessagePointerMove"
    @pointerup="onMessagePointerUp" @pointercancel="onMessagePointerCancel">
    <span class="msg__time-reveal" aria-hidden="true">{{ messenger.formatTime(message.timestamp) }}</span>
    <span v-if="swipeX > 0 || swipeReleasing" class="msg__swipe-reply" :class="{ 'is-armed': swipeArmed }" aria-hidden="true">
      <Icon name="reply" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" />
    </span>
    <button v-if="showAvatar && !isSystem" type="button" class="msg__avatar" :class="avatarSrc ? 'msg__avatar--image' : `avatar--${avatarAccent}`"
      :aria-label="t('members.openProfile', { username: message.username })" @click="openAuthorProfile">
      <img v-if="avatarSrc" :src="avatarSrc" :alt="t('message.avatarOf', { name: message.username })" />
      <template v-else>{{ avatarInitials }}</template>
    </button>
    <span v-else class="msg__spacer"></span>

    <div v-if="jumbo" class="jumbo" :class="{ 'jumbo--discord': isDiscordStyle }"
      @contextmenu.prevent.stop="onMessageContextMenu">
      <button v-if="message.replyToMessageId && isDiscordStyle" type="button" class="reply-ref"
        :class="{ 'is-missing': !repliedMessage }" @click="onReplyClick"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <span class="reply-ref__hook" aria-hidden="true"></span>
        <span v-if="replyAvatarSrc" class="reply-ref__avatar reply-ref__avatar--image">
          <img :src="replyAvatarSrc" :alt="t('message.avatarOf', { name: replyLabel })" />
        </span>
        <span v-else class="reply-ref__avatar" :class="`avatar--${replyAvatarAccent}`">
          {{ replyAvatarInitials }}
        </span>
        <span class="reply-ref__username">{{ replyLabel }}</span>
        <span v-if="replyHasVisual" class="reply-ref__icon" aria-hidden="true">
          <Icon name="camera" viewBox="0 0 24 24" />
        </span>
        <span class="reply-ref__text" v-html="renderDiscordEmoji(replyText)"></span>
        <span v-if="replyEdited" class="reply-ref__edited">(edited)</span>
      </button>

      <button v-else-if="message.replyToMessageId" type="button" class="reply-card" @click="onReplyClick"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <span class="reply-card__author">{{ replyLabel }}</span>
        <span class="reply-card__text" v-html="renderDiscordEmoji(replyText)"></span>
      </button>

      <div v-if="showAuthor" class="jumbo__author">
        <button type="button" class="bubble__author-name" :aria-label="t('members.openProfile', { username: message.username })" @click="openAuthorProfile">{{ message.username }}</button>
        <span v-if="isDiscordStyle" class="bubble__author-time">{{ messenger.formatTime(message.timestamp) }}</span>
      </div>
      <div class="jumbo__glyph" v-html="renderDiscordEmoji(message.text)"></div>
      <span v-if="showTimestamp && !isDiscordStyle" class="jumbo__time">
        {{ messenger.formatTime(message.timestamp) }}<span v-if="edited"> · edited</span>
      </span>
      <Transition name="reactions-row">
        <div v-if="visibleReactions.length" class="reactions reactions--standalone"
          @contextmenu.prevent.stop="onMessageContextMenu">
          <TransitionGroup name="reaction-bloom">
            <button v-for="reaction in visibleReactions" :key="`${message.messageId}-${reaction.emoji}`" class="reaction"
              :class="{ 'is-mine': myReactions.has(reaction.emoji), 'is-bumped': bumped.has(reaction.emoji) }" type="button" :aria-pressed="myReactions.has(reaction.emoji)"
              @click="onReactionClick(reaction)" @mouseenter="showReactionTooltip($event, reaction)"
              @mouseleave="scheduleHideReactionTooltip" @pointerdown.stop="onReactionPointerDown($event, reaction)"
              @pointerup="clearChipPress" @pointercancel="clearChipPress" @pointerleave="clearChipPress"
              @contextmenu.stop="onReactionContextMenu">
              <span class="reaction__emoji" v-html="renderDiscordEmoji(reaction.emoji)"></span>
              <span>{{ reaction.count }}</span>
            </button>
          </TransitionGroup>
          <button type="button" class="reaction reaction--add" :aria-label="t('message.addReaction')"
            :title="t('message.addReaction')" @click.stop="openReactionPicker">
            <Icon name="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
        </div>
      </Transition>
      <div class="bubble-actions" :style="discordActionsStyle" @contextmenu.prevent.stop="onMessageContextMenu">
        <div class="pick">
          <button v-for="emoji in messenger.QUICK_REACTIONS" :key="`pick-${emoji}`" type="button"
            @click="messenger.toggleReaction(message, emoji)" v-html="renderDiscordEmoji(emoji)"></button>
          <button type="button" class="pick__more" :aria-label="t('message.moreReactions')"
            :title="t('message.moreReactions')" :aria-expanded="reactionPickerOpen" @click.stop="openReactionPicker">
            <Icon name="plus-circle" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
          <button v-if="!deleted" type="button" :aria-label="t('message.reply')" @click="messenger.startReply(message)">
            <Icon name="reply" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
          <button v-if="canEdit" type="button" class="pick__edit" :aria-label="t('message.edit')"
            @click="messenger.startEditMessage(message)">
            <Icon name="edit" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
          <button v-if="canDelete" type="button" class="pick__delete" :aria-label="t('message.delete')" @click="onDelete">
            <Icon name="trash" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
        </div>
      </div>
    </div>

    <div v-else class="bubble" :class="{
      'bubble--deleted': deleted
    }" @contextmenu.prevent.stop="onMessageContextMenu">
      <div class="bubble-actions" :style="discordActionsStyle" @contextmenu.prevent.stop="onMessageContextMenu">
        <div class="pick" role="group" :aria-label="t('message.react')">
          <button v-for="emoji in messenger.QUICK_REACTIONS" :key="`pick-${emoji}`" type="button"
            @click="messenger.toggleReaction(message, emoji)" v-html="renderDiscordEmoji(emoji)"></button>
          <button type="button" class="pick__more" :aria-label="t('message.moreReactions')"
            :title="t('message.moreReactions')" :aria-expanded="reactionPickerOpen" @click.stop="openReactionPicker">
            <Icon name="plus-circle" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
          <button v-if="!deleted" type="button" :aria-label="t('message.reply')" @click="messenger.startReply(message)">
            <Icon name="reply" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
          <button v-if="canEdit" type="button" class="pick__edit" :aria-label="t('message.edit')"
            @click="messenger.startEditMessage(message)">
            <Icon name="edit" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
          <button v-if="canDelete" type="button" class="pick__delete" :aria-label="t('message.delete')" @click="onDelete">
            <Icon name="trash" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
        </div>
      </div>

      <button v-if="message.replyToMessageId && isDiscordStyle" type="button" class="reply-ref"
        :class="{ 'is-missing': !repliedMessage }" @click="onReplyClick"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <span class="reply-ref__hook" aria-hidden="true"></span>
        <span v-if="replyAvatarSrc" class="reply-ref__avatar reply-ref__avatar--image">
          <img :src="replyAvatarSrc" :alt="t('message.avatarOf', { name: replyLabel })" />
        </span>
        <span v-else class="reply-ref__avatar" :class="`avatar--${replyAvatarAccent}`">
          {{ replyAvatarInitials }}
        </span>
        <span class="reply-ref__username">{{ replyLabel }}</span>
        <span v-if="replyHasVisual" class="reply-ref__icon" aria-hidden="true">
          <Icon name="camera" viewBox="0 0 24 24" />
        </span>
        <span class="reply-ref__text" v-html="renderDiscordEmoji(replyText)"></span>
        <span v-if="replyEdited" class="reply-ref__edited">(edited)</span>
      </button>

      <button v-else-if="message.replyToMessageId" type="button" class="reply-card" @click="onReplyClick"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <span class="reply-card__author">{{ replyLabel }}</span>
        <span class="reply-card__text" v-html="renderDiscordEmoji(replyText)"></span>
      </button>

      <div v-if="showAuthor && !isSystem" class="bubble__author">
        <button type="button" class="bubble__author-name" :aria-label="t('members.openProfile', { username: message.username })" @click="openAuthorProfile">{{ message.username }}</button>
        <span v-if="isDiscordStyle" class="bubble__author-time">{{ messenger.formatTime(message.timestamp) }}</span>
      </div>

      <div v-else-if="isSystem" class="bubble__system" :class="{ 'is-call': isSystemCall }">
        <button v-if="!isSystemPresenceEvent" type="button" class="bubble__system-author" @click="selectedProfile = 'system'">@system</button>
        <span v-if="callParts" class="bubble__system-line">{{ callParts.before
          }}<button type="button" class="bubble__system-user"
            @click="selectedProfile = callParts.user.toLowerCase()">{{ callParts.user }}</button>{{ callParts.after }}</span>
        <span v-else class="bubble__system-line">{{ message.text }}</span>
        <span class="bubble__system-time">{{ messenger.formatTime(message.timestamp) }}</span>
      </div>

      <template v-if="deleted">
        <div class="bubble__body">
          <div class="bubble__text bubble__text--deleted">{{ deletedLabel }}</div>
        </div>
      </template>

      <div v-else-if="attachmentKind === 'poll' && message.poll" class="poll" :class="{ 'is-voted': pollVoted }"
        role="group" :aria-label="message.poll.question">
        <div class="poll__head">
          <span class="poll__badge">{{ t('poll.label') }}</span>
        </div>
        <p class="poll__question">{{ message.poll.question }}</p>
        <template v-if="pollVoted">
          <div v-for="(option, index) in message.poll.options" :key="index" class="poll__option poll__option--result"
            :class="{ 'is-mine': pollMine.includes(index) }">
            <span class="poll__fill" :style="{ transform: `scaleX(${pollShare(index)})` }" aria-hidden="true"></span>
            <span class="poll__text">{{ option }}</span>
            <span class="poll__pct">{{ Math.round(pollShare(index) * 100) }}%</span>
          </div>
          <p class="poll__foot">{{ t('poll.youVoted') }} · {{ pollVotesLabel(message.pollState.total) }}</p>
        </template>
        <template v-else>
          <button v-for="(option, index) in message.poll.options" :key="index" type="button" class="poll__option"
            :class="{ 'is-selected': pollSelection.includes(index), 'is-multi': message.poll.multi }"
            :aria-pressed="pollSelection.includes(index)" @click="togglePollOption(index)">
            <span class="poll__check" aria-hidden="true"></span>
            <span class="poll__text">{{ option }}</span>
          </button>
          <div class="poll__actions">
            <span class="poll__foot">{{ pollVotesLabel(message.pollState.total) }} · {{ t('poll.final') }}</span>
            <button type="button" class="poll__vote" :disabled="!pollSelection.length" @click="submitPollVote">
              {{ t('poll.vote') }}
            </button>
          </div>
        </template>
      </div>

      <template v-else-if="attachmentKind === 'image'">
        <div v-if="attachmentUrl && isBrokenImage(attachmentUrl)" class="att-image-missing" role="img"
          :aria-label="t('message.imageUnavailable')" @contextmenu.prevent.stop="onMessageContextMenu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m21 16-4.5-4.5L8 20" />
            <path d="M3 3l18 18" />
          </svg>
          <span class="att-image-missing__text">
            <strong>{{ t('message.imageUnavailable') }}</strong>
            <small>{{ message.attachment.filename }}</small>
          </span>
        </div>
        <button v-else-if="attachmentUrl" type="button" class="att-image-link"
          :aria-label="t('imageViewer.openLabel', { name: String(message.attachment.filename || '') })" @click="openImageViewer"
          @contextmenu.prevent.stop="onMessageContextMenu">
          <img :src="attachmentUrl" :alt="message.attachment.filename" class="att-image" />
        </button>
        <div v-else class="att-expired" role="status">{{ t('message.attachmentExpired') }}</div>
        <ImageViewer v-if="imageViewerOpen" :src="attachmentUrl" :filename="message.attachment.filename"
          :mime-type="message.attachment.mimeType"
          :size-label="messenger.formatSize(message.attachment.size)" @close="imageViewerOpen = false" />
        <div v-if="message.text" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @keydown="onSpoilerKeydown"
            @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="attachmentKind === 'video'">
        <VideoPlayer v-if="attachmentUrl" :src="attachmentUrl" :filename="message.attachment.filename"
          :mime-type="message.attachment.mimeType"
          :size-label="messenger.formatSize(message.attachment.size)" />
        <div v-else class="att-expired" role="status">{{ t('message.attachmentExpired') }}</div>
        <div v-if="message.text" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @keydown="onSpoilerKeydown"
            @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="(attachmentKind === 'audio' || attachmentKind === 'voice') && attachmentUrl">
        <AudioPlayer :src="attachmentUrl" :filename="message.attachment.filename"
          :mime-type="message.attachment.mimeType"
          :size-label="messenger.formatSize(message.attachment.size)" :fallback-duration="message.voiceDuration || ''"
          :waveform="message.voiceWaveform || []"
          :resume-key="message.messageId || ''" :chain="attachmentKind === 'voice'"
          :messenger="messenger" />
        <div v-if="message.text && !message.text.startsWith('[voice:')" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @keydown="onSpoilerKeydown"
            @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible && message.text && !message.text.startsWith('[voice:')" type="button"
          class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="attachmentKind === 'audio' || attachmentKind === 'voice'">
        <div class="att-expired" role="status">
          {{ message.voiceDuration ? t('message.voiceMessageExpired') : t('message.attachmentExpired') }}
        </div>
      </template>

      <template v-else-if="attachmentKind === 'file' && message.attachment">
        <button class="att-file" type="button" @click="download" :disabled="!attachmentUrl"
          @contextmenu.prevent.stop="onMessageContextMenu">
          <span class="att-file-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
            </svg>
          </span>
          <span class="att-file-meta">
            <span class="att-file-name">{{ message.attachment.filename }}</span>
            <span class="att-file-sub">
              {{ messenger.formatSize(message.attachment.size) }}
              <span v-if="!attachmentUrl"> · expired</span>
            </span>
          </span>
          <span v-if="attachmentUrl" class="att-file-dl">
            <Icon name="download" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" />
          </span>
        </button>
        <TextFilePreview v-if="textViewerOpen && attachmentUrl" :src="attachmentUrl"
          :filename="message.attachment.filename" :size-label="messenger.formatSize(message.attachment.size)"
          @close="textViewerOpen = false" />
        <div v-if="message.text" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @keydown="onSpoilerKeydown"
            @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="!isSystem">
        <div class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @keydown="onSpoilerKeydown"
            @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited && !deleted" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <a v-if="preview && preview.url && !deleted" :href="preview.url" target="_blank" rel="noopener noreferrer"
        class="embed" @contextmenu.prevent.stop="onMessageContextMenu">
        <div v-if="preview.image && !isBrokenImage(preview.image)" class="embed__media">
          <img :src="preview.image" :alt="preview.title || preview.url" loading="lazy" referrerpolicy="no-referrer" />
        </div>
        <div class="embed__body">
          <div v-if="preview.siteName" class="embed__site">{{ preview.siteName }}</div>
          <div v-if="preview.title" class="embed__title">{{ preview.title }}</div>
          <div v-if="preview.description" class="embed__desc">{{ preview.description }}</div>
        </div>
      </a>

      <span v-if="showTimestamp && !deleted && !isDiscordStyle" class="bubble__time">
        {{ messenger.formatTime(message.timestamp) }}<span v-if="edited"> · edited</span>
      </span>

      <button v-if="threadInfo && !deleted" type="button" class="thread-pill" @click="onOpenThread">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
        <span>{{ threadLabel(threadInfo.count) }}</span>
        <span class="thread-pill__time">{{ messenger.formatTime(threadInfo.last) }}</span>
      </button>
      <Transition name="reactions-row">
        <div v-if="visibleReactions.length && !deleted" class="reactions" @contextmenu.prevent.stop="onMessageContextMenu">
          <TransitionGroup name="reaction-bloom">
            <button v-for="reaction in visibleReactions" :key="`${message.messageId}-${reaction.emoji}`" class="reaction"
              :class="{ 'is-mine': myReactions.has(reaction.emoji), 'is-bumped': bumped.has(reaction.emoji) }" type="button" :aria-pressed="myReactions.has(reaction.emoji)"
              @click="onReactionClick(reaction)" @mouseenter="showReactionTooltip($event, reaction)"
              @mouseleave="scheduleHideReactionTooltip" @pointerdown.stop="onReactionPointerDown($event, reaction)"
              @pointerup="clearChipPress" @pointercancel="clearChipPress" @pointerleave="clearChipPress"
              @contextmenu.stop="onReactionContextMenu">
              <span class="reaction__emoji" v-html="renderDiscordEmoji(reaction.emoji)"></span>
              <span>{{ reaction.count }}</span>
            </button>
          </TransitionGroup>
          <button type="button" class="reaction reaction--add" :aria-label="t('message.addReaction')"
            :title="t('message.addReaction')" @click.stop="openReactionPicker">
            <Icon name="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
        </div>
      </Transition>
    </div>
  </article>

  <Teleport to="body">
    <Transition name="qx-fade">
      <div v-if="reactionPickerOpen" class="react-pop__backdrop"
        :class="{ 'is-sheet': reactionSheet }" @click="reactionPickerOpen = false"
        @contextmenu.prevent="reactionPickerOpen = false"></div>
    </Transition>
    <Transition name="qx-sheet">
      <div v-if="reactionPickerOpen" v-sheet-dismiss="() => (reactionPickerOpen = false)" class="react-pop" :class="{ 'is-sheet': reactionSheet }"
        :style="reactionPickerStyle" @click.stop>
        <span v-if="reactionSheet" class="react-pop__grabber" aria-hidden="true"></span>
        <EmojiPicker @pick="onReactionPicked" />
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="qx-pop">
      <div v-if="contextMenuOpen" class="msg__context" @click="closeContextMenu" @contextmenu.prevent>
        <div ref="contextMenuRef" v-sheet-dismiss="closeContextMenu" class="msg__context-menu context-menu-base" :style="contextMenuStyle" role="menu" :aria-label="t('message.actions')" @click.stop>
          <!-- Header: user info + message preview (mobile only) -->
          <div class="msg__context-header">
            <span v-if="avatarSrc" class="msg__context-header-avatar msg__context-header-avatar--image">
              <img :src="avatarSrc" :alt="message.username" />
            </span>
            <span v-else class="msg__context-header-avatar" :class="`avatar--${avatarAccent}`">{{ avatarInitials }}</span>
            <div class="msg__context-header-text">
              <strong class="msg__context-header-name">@{{ message.username }}</strong>
              <span v-if="!deleted" class="msg__context-header-preview">{{ previewTextFor(message, message.messageId) }}</span>
              <span v-else class="msg__context-header-preview msg__context-header-preview--deleted">{{ previewTextFor(message, message.messageId) }}</span>
            </div>
          </div>
          <!-- Quick reactions row -->
          <div v-if="!deleted" class="msg__context-reactions" role="group" :aria-label="t('message.react')">
            <button v-for="emoji in messenger.QUICK_REACTIONS" :key="`context-reaction-${emoji}`" type="button"
              class="msg__context-reaction" :class="{ 'is-mine': myReactions.has(emoji) }"
              @click="onToggleReaction(emoji)" v-html="renderDiscordEmoji(emoji)"></button>
            <button type="button" class="msg__context-reaction msg__context-reaction--more"
              :aria-label="t('message.moreReactions')" :title="t('message.moreReactions')" @click="onMoreReactions">
              <Icon name="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </div>
          <div v-if="!deleted" class="msg__context-separator" aria-hidden="true"></div>
          <button v-if="message.reactions.length && !deleted" type="button" class="msg__context-item" role="menuitem"
            @click="openReactionsViewer()">
            <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><line x1="9" y1="10" x2="9.01" y2="10"/><line x1="15" y1="10" x2="15.01" y2="10"/></svg>
            <span>{{ t('message.viewReactions') }}</span>
            <span class="msg__context-item-count">{{ reactionsTotal }}</span>
          </button>
          <!-- Actions -->
          <button v-if="!deleted" type="button" class="msg__context-item" role="menuitem" @click="onStartReply">
            <Icon name="reply" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.reply') }}</span>
          </button>
          <button v-if="!deleted && !inThread && !message.threadRootId && !isSystem" type="button" class="msg__context-item"
            role="menuitem" @click="onOpenThread">
            <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
            <span>{{ t('threads.open') }}</span>
          </button>
          <button v-if="canEdit" type="button" class="msg__context-item" role="menuitem" @click="onStartEdit">
            <Icon name="edit" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.edit') }}</span>
          </button>
          <button type="button" class="msg__context-item" role="menuitem" @click="onOpenProfile">
            <Icon name="person" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.viewProfile') }}</span>
          </button>
          <button v-if="!deleted" type="button" class="msg__context-item" role="menuitem" @click="onCopyMessageText">
            <Icon name="copy" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.copyMessage') }}</span>
          </button>
          <button type="button" class="msg__context-item" role="menuitem" @click="onCopyUserId">
            <Icon name="copy" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.copyUserId') }}</span>
          </button>
          <button v-if="canDelete" type="button" class="msg__context-item is-danger" role="menuitem"
            @click="onDelete">
            <Icon name="trash" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.deleteMessage') }}</span>
          </button>
          <!-- Cancel button (mobile only) -->
          <div class="msg__context-separator" aria-hidden="true"></div>
          <button type="button" class="msg__context-item msg__context-cancel" role="menuitem" @click="closeContextMenu">
            <Icon name="close" class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <span>{{ t('message.cancel') }}</span>
          </button>
        </div>
      </div>
    </Transition>
    <div v-if="reactionTooltip" class="reaction-tooltip" :class="`is-${reactionTooltip.placement}`"
      :style="{ left: `${reactionTooltip.left}px`, top: `${reactionTooltip.top}px` }" role="tooltip"
      @mouseenter="keepReactionTooltip" @mouseleave="scheduleHideReactionTooltip">
      <div class="reaction-tooltip__head">
        <span v-html="renderDiscordEmoji(reactionTooltip.emoji)"></span>
        <span class="reaction-tooltip__count">{{ reactionTooltip.count }}</span>
      </div>
      <div class="reaction-tooltip__list">
        <span v-for="user in reactionTooltip.users" :key="user" class="reaction-tooltip__user">{{ user }}</span>
      </div>
    </div>
    <Transition name="qx-fade">
      <div v-if="reactionsViewer !== null" class="reactions-sheet__backdrop" @click="closeReactionsViewer"
        @contextmenu.prevent="closeReactionsViewer"></div>
    </Transition>
    <Transition name="qx-sheet">
      <div v-if="reactionsViewer !== null" v-sheet-dismiss="closeReactionsViewer" class="reactions-sheet" role="dialog"
        aria-modal="true" :aria-label="t('message.reactions')" @click.stop>
        <span class="reactions-sheet__grabber" aria-hidden="true"></span>
        <header class="reactions-sheet__head">
          <strong>{{ t('message.reactions') }}</strong>
          <button type="button" class="reactions-sheet__close" :aria-label="t('message.close')" @click="closeReactionsViewer">
            <Icon name="close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
          </button>
        </header>
        <div class="reactions-sheet__tabs" role="tablist">
          <button type="button" role="tab" class="reactions-sheet__tab" :class="{ 'is-active': reactionsViewer === '' }"
            :aria-selected="reactionsViewer === ''" @click="reactionsViewer = ''">
            {{ t('message.reactionsAll') }}<span class="reactions-sheet__tab-count">{{ reactionsTotal }}</span>
          </button>
          <button v-for="reaction in message.reactions" :key="`tab-${reaction.emoji}`" type="button" role="tab"
            class="reactions-sheet__tab" :class="{ 'is-active': reactionsViewer === reaction.emoji }"
            :aria-selected="reactionsViewer === reaction.emoji" @click="reactionsViewer = reaction.emoji">
            <span v-html="renderDiscordEmoji(reaction.emoji)"></span><span class="reactions-sheet__tab-count">{{ reaction.count }}</span>
          </button>
        </div>
        <TransitionGroup tag="ul" name="reactions-row" class="reactions-sheet__list">
          <li v-for="row in reactionsViewerRows" :key="`${row.emoji}-${row.user}`">
            <button type="button" class="reactions-sheet__row" @click="openReactorProfile(row.user)">
              <Avatar :name="row.user" :src="reactorAvatar(row.user)" :accent="messenger.accentFor(row.user)" size="md" />
              <span class="reactions-sheet__name">{{ row.user }}</span>
              <span class="reactions-sheet__emoji" v-html="renderDiscordEmoji(row.emoji)"></span>
            </button>
          </li>
        </TransitionGroup>
      </div>
    </Transition>
    <Transition name="qx-modal" :duration="{ enter: 340, leave: 220 }">
      <ProfileCard v-if="selectedProfile" :messenger="messenger" :username="selectedProfile" docked @close="closeProfile" />
    </Transition>
  </Teleport>
</template>

<style scoped>
@font-face {
  font-family: "Roboto";
  src: url("/fonts/roboto-400.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Roboto";
  src: url("/fonts/roboto-500.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Roboto";
  src: url("/fonts/roboto-700.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("/fonts/whitney-book.woff") format("woff");
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("/fonts/whitney-medium.woff") format("woff");
  font-weight: 500;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("/fonts/whitney-semibold.woff") format("woff");
  font-weight: 600;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("/fonts/whitney-bold.woff") format("woff");
  font-weight: 700;
  font-display: swap;
}

.msg__context {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.msg__context-menu {
  z-index: 140;
}

.msg__context-item {
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  cursor: pointer;
}

.msg__context-reactions,
.msg__context-separator {
  display: none;
}

.msg__context-reaction {
  border: 0;
  background: transparent;
  cursor: pointer;
}

.msg__context-header {
  display: none;
}

.msg__context-item-icon {
  display: block;
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--muted);
}

.msg__context-cancel {
  display: none;
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .bubble-actions {
    display: none;
  }

  .msg__context {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
  }

  .msg__context-menu {
    left: 0 !important;
    right: 0;
    bottom: 0;
    top: auto !important;
    width: 100%;
    max-width: 100%;
    max-height: min(80vh, 640px);
    overflow-y: auto;
    overflow-x: hidden;
    transform: none;
    display: flex;
    flex-direction: column;
    padding: 0 0 max(18px, var(--app-safe-bottom));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .msg__context-menu::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  /* ---- Header ---- */
  .msg__context-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 18px 14px;
    flex: none;
  }

  .msg__context-header-avatar {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    flex: none;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 18px;
    color: #fff;
  }

  .msg__context-header-avatar--image {
    overflow: hidden;
    background: var(--surface-2);
  }

  .msg__context-header-avatar--image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .msg__context-header-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow: hidden;
  }

  .msg__context-header-name {
    font-size: 16px;
    font-weight: 750;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .msg__context-header-preview {
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .msg__context-header-preview--deleted {
    font-style: italic;
  }

  /* ---- Reactions row ---- */
  .msg__context-reactions {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding: 6px 18px 8px;
    flex: none;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .msg__context-reactions::-webkit-scrollbar {
    display: none;
  }

  .msg__context-reaction {
    width: 44px !important;
    height: 44px;
    min-width: 44px;
    padding: 0 !important;
    border-radius: 16px;
    display: grid;
    place-items: center;
    color: var(--text);
    font-size: 24px;
    line-height: 1;
    background: var(--surface-2);
    transition: transform var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
    scroll-snap-align: start;
    flex-shrink: 0;
  }

  .msg__context-reaction:hover,
  .msg__context-reaction:focus-visible {
    transform: translateY(-2px) scale(1.08);
    background: var(--surface-hover);
  }

  .msg__context-reaction:active {
    transform: scale(0.94);
  }

  .msg__context-reaction.is-mine {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 70%, transparent);
  }

  .msg__context-reaction--more {
    color: var(--muted);
  }

  .msg__context-reaction--more svg {
    width: 22px;
    height: 22px;
  }

  /* ---- Separator ---- */
  .msg__context-separator {
    display: block;
    height: 1px;
    margin: 4px 18px;
    background: var(--line);
    flex: none;
  }

  /* ---- Action items ---- */
  .msg__context-item {
    min-height: 50px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    padding: 0 18px;
    gap: 14px;
    width: 100%;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .msg__context-item:hover,
  .msg__context-item:focus-visible {
    background: var(--surface-hover);
  }

  .msg__context-item:active {
    background: var(--surface-active);
  }

  .msg__context-item.is-danger {
    color: var(--red);
  }

  .msg__context-item.is-danger:hover,
  .msg__context-item.is-danger:focus-visible {
    background: rgba(255, 107, 112, 0.12);
  }

  /* ---- Icons ---- */
  .msg__context-item-icon {
    display: block;
    flex: none;
    width: 20px;
    height: 20px;
    color: var(--muted);
    transition: color var(--dur-fast) var(--ease-out);
  }

  .msg__context-item:hover .msg__context-item-icon,
  .msg__context-item:focus-visible .msg__context-item-icon {
    color: var(--text);
  }

  .msg__context-item.is-danger .msg__context-item-icon {
    color: var(--red);
  }

  /* ---- Cancel button ---- */
  .msg__context-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    font-weight: 700;
    color: var(--muted);
    margin-top: 2px;
  }

  .msg__context-cancel:hover,
  .msg__context-cancel:focus-visible {
    color: var(--text);
    background: var(--surface-hover);
  }

  /* ---- Hide hover tooltip on mobile ---- */
  .reaction-tooltip {
    display: none !important;
  }
}

.msg__avatar--image,
.reply-ref__avatar--image {
  overflow: hidden;
  background: var(--surface-2);
}

.msg__avatar--image img,
.reply-ref__avatar--image img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.reply-ref__avatar {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 8px;
  font-weight: 700;
  color: #fff;
  flex: none;
}

.bubble__body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  column-gap: 0.25rem;
  min-width: 0;
}

.bubble__text {
  user-select: none;
  -webkit-user-select: none;
}

.reply-ref__icon {
  width: 20px;
  height: 20px;
  margin-left: 4px;
  flex: none;
}

.reply-ref__icon svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.bubble__system-author {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  padding: 0;
}

.bubble__system-author:hover,
.bubble__system-author:focus-visible {
  text-decoration: underline;
}

:global(.mention[data-mention]) {
  cursor: pointer;
}

:global(.mention[data-mention]:hover) {
  filter: brightness(1.15);
  text-decoration: underline;
}

:global(:root[data-message-style="discord"] .feed) {
  gap: 0;
  padding: 0 0 0.5rem;
  background-color: transparent;
  color: var(--text);
  font-size: 16px;
  font-family: Whitney, "Source Sans Pro", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 170%;
}

:global(:root[data-message-style="discord"] .day) {
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.5rem 1rem 0.75rem;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
}

:global(:root[data-message-style="discord"] .day::before),
:global(:root[data-message-style="discord"] .day::after) {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line-strong);
}

:global(:root[data-message-style="discord"] .msg) {
  max-width: 100%;
  width: 100%;
  margin-top: 1.0625rem;
  padding: 0 1em;
  padding-right: 48px !important;
  gap: 16px;
  align-items: flex-start;
  border-left: 0;
  background: transparent;
  color: #dcddde;
  transition: background-color 50ms var(--ease-out);
}

:global(:root[data-message-style="discord"] .msg.is-run-mid),
:global(:root[data-message-style="discord"] .msg.is-run-end) {
  margin-top: 0;
}

:global(:root[data-message-style="discord"] .msg:hover) {
  background-color: color-mix(in srgb, var(--surface-2) 46%, transparent);
}

:global(:root[data-theme="light"][data-message-style="discord"] .msg:hover) {
  background-color: color-mix(in srgb, var(--surface-2) 72%, white 8%);
}

:global(:root[data-message-style="discord"] .msg.is-mentioned) {
  position: relative;
  background-color: rgba(250, 166, 26, 0.1);
}

:global(:root[data-message-style="discord"] .msg.is-mentioned:hover) {
  background-color: rgba(250, 166, 26, 0.08);
}

:global(:root[data-message-style="discord"] .msg.is-mentioned::before) {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background-color: #faa61a;
}

:global(:root[data-message-style="discord"] .msg.is-jump-highlight) {
  background-color: rgba(88, 101, 242, 0.16);
}

/* Streamer mode blurs the elements themselves rather than covering them with a
   box. An overlay always draws the element's rectangle, which on a block of
   text is the whole bubble width and reads as a grey slab; a filter follows
   the glyphs and the avatar's circle exactly. The particle cloud on top comes
   from SpoilerParticles.vue, which measures the same elements line by line. */
.msg.is-streamer-blur {
  --redact-tint: color-mix(in srgb, var(--text) 16%, var(--bg));
  --redact-blur: 5px;
}

.msg.is-streamer-blur :is(.bubble__author > :is(span,button):first-child, .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text, .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph) {
  filter: blur(var(--redact-blur)) saturate(0.85);
  cursor: pointer;
  transition: filter 460ms var(--ease-out);
}

.msg.is-streamer-blur :is(.att-image-link, .audio-player, .video-player, .embed__media) {
  filter: blur(14px) saturate(0.7);
  cursor: pointer;
  transition: filter 460ms var(--ease-out);
}

/* The avatar tint is derived from the username, so the hue has to go with the
   detail. `background` and not `background-color`: the accent classes set the
   shorthand, so a colour alone leaves their gradient in place. */
.msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar) {
  background: var(--redact-tint);
  overflow: hidden;
  cursor: pointer;
}

/* Blurring the children keeps the circle's edge crisp: a filter on the avatar
   itself would soften its outline into a blob. */
.msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar) > * {
  filter: blur(6px) grayscale(1);
  transition: filter 460ms var(--ease-out);
}

.msg.is-streamer-blur :is(.bubble__author > :is(span,button):first-child, .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text, .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph, .att-image-link, .audio-player, .video-player, .embed__media):is(.is-revealed, .is-peeking),
.msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar):is(.is-revealed, .is-peeking) > * {
  filter: none;
  cursor: auto;
}

.msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar):is(.is-revealed, .is-peeking) {
  background: none;
}

/* Leaving streamer mode lifts every blur at once instead of snapping. */
.msg.is-streamer-blur.is-streamer-leaving :is(.bubble__author > :is(span,button):first-child, .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text, .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph, .att-image-link, .audio-player, .video-player, .embed__media),
.msg.is-streamer-blur.is-streamer-leaving :is(.msg__avatar, .reply-ref__avatar) > * {
  filter: none;
}

.msg.is-streamer-blur.is-streamer-leaving :is(.msg__avatar, .reply-ref__avatar) {
  background: none;
}

@media (prefers-reduced-motion: reduce) {
  .msg.is-streamer-blur :is(.bubble__author > :is(span,button):first-child, .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text, .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph, .att-image-link, .audio-player, .video-player, .embed__media),
  .msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar) > * {
    transition: none;
  }
}

:global(:root[data-message-style="discord"] .msg__avatar) {
  width: 40px;
  height: 40px;
  margin-top: 5px;
  flex: none;
  align-self: flex-start;
}

:global(:root[data-message-style="discord"] .msg__spacer) {
  width: 40px;
  height: 0;
  margin-top: 0;
  flex: none;
  align-self: flex-start;
}

:global(:root[data-message-style="discord"] .msg.is-own) {
  flex-direction: row;
  margin-left: 0;
}

:global(:root[data-message-style="discord"] .msg.is-own .msg__avatar),
:global(:root[data-message-style="discord"] .msg.is-own .msg__spacer) {
  display: grid;
  align-self: flex-start;
}

:global(:root[data-message-style="discord"] .msg.has-discord-reply .msg__avatar) {
  margin-top: 24px;
}

:global(:root[data-message-style="discord"] .bubble) {
  position: static;
  width: 100%;
  min-width: 0;
  padding: 2px 0 0;
  background: transparent;
  color: #dcddde;
  border-radius: 0;
  font-family: Whitney, "Source Sans Pro", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

:global(:root[data-message-style="discord"] .msg.is-own .bubble) {
  color: #dcddde;
}

:global(:root[data-message-style="discord"] .bubble__author) {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 500;
  color: #fff;
}

:global(:root[data-message-style="discord"] .bubble__author-time) {
  margin-left: 3px;
  color: #72767d;
  font-size: 12px;
  font-weight: 500;
}

:global(:root[data-message-style="discord"] .bubble__body) {
  font-size: 1rem;
  font-weight: 400;
  word-break: break-word;
  position: relative;
}

:global(:root[data-message-style="discord"] .bubble__text) {
  display: inline;
  min-width: 0;
  font-size: 1rem;
  line-height: 1.375rem;
  white-space: pre-wrap;
  word-wrap: break-word;
  user-select: none;
  -webkit-user-select: none;
  font-weight: 400;
}

:global(:root[data-message-style="discord"] .bubble__text--deleted) {
  color: #72767d;
  font-style: italic;
}

:global(:root[data-message-style="discord"] .bubble__edited),
:global(:root[data-message-style="discord"] .reply-ref__edited) {
  margin-left: 0.25rem;
  color: #72767d;
  font-size: 10px;
  white-space: nowrap;
  flex: none;
}

:global(:root[data-message-style="discord"] .reply-ref) {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: fit-content;
  max-width: min(100%, 48rem);
  margin: 0 0 4px;
  padding-top: 2px;
  color: #b9bbbe;
  font-size: 0.875rem;
  line-height: 1.125rem;
  white-space: nowrap;
  user-select: none;
  text-align: left;
}

:global(:root[data-message-style="discord"] .reply-ref__hook) {
  width: 12px;
  height: 10px;
  margin-right: 4px;
  margin-left: 0;
  border-left: 2px solid #4f545c;
  border-top: 2px solid #4f545c;
  border-top-left-radius: 6px;
  flex: none;
  align-self: flex-end;
  pointer-events: none;
}

:global(:root[data-message-style="discord"] .reply-ref.is-missing) {
  cursor: default;
}

:global(:root[data-message-style="discord"] .reply-ref:not(.is-missing):hover .reply-ref__text) {
  color: #fff;
}

:global(:root[data-message-style="discord"] .reply-ref__username) {
  flex-shrink: 0;
  margin-right: 0.25rem;
  color: #fff;
  opacity: 0.64;
  font-weight: 500;
}

:global(:root[data-message-style="discord"] .reply-ref__text) {
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
}

:global(:root[data-message-style="discord"] .markdown a) {
  color: #00aff4;
  font-weight: 400;
  text-decoration: none;
}

:global(:root[data-message-style="discord"] .markdown a:hover) {
  text-decoration: underline;
}

:global(:root[data-message-style="discord"] .mention) {
  display: inline-block;
  padding: 0 2px;
  border-radius: 3px;
  background-color: hsla(235, 85.6%, 64.7%, 0.3);
  color: #e3e7f8;
  font-weight: 500;
  transition: background-color 50ms var(--ease-out), color 50ms var(--ease-out);
}

:global(:root[data-message-style="discord"] .mention:hover) {
  background-color: hsl(235, 85.6%, 64.7%);
  color: #fff;
  text-decoration: none;
  filter: none;
}

:global(:root[data-message-style="discord"] .markdown code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: #2f3136;
  font-family: Consolas, "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 0.875em;
}

:global(:root[data-message-style="discord"] .codeblock) {
  margin: 0.25rem 0;
  border: 1px solid #202225;
  border-radius: 4px;
  background: #2f3136;
  box-shadow: none;
}

:global(:root[data-message-style="discord"] .codeblock__head) {
  min-height: 32px;
  padding: 6px 10px;
  border-bottom: 1px solid #202225;
  color: #b9bbbe;
  font-family: Consolas, "Andale Mono WT", "Andale Mono", "Lucida Console", monospace;
  font-size: 11px;
}

:global(:root[data-message-style="discord"] .codeblock__copy) {
  background: rgba(255, 255, 255, 0.06);
  color: #b9bbbe;
}

:global(:root[data-message-style="discord"] .codeblock__copy:hover),
:global(:root[data-message-style="discord"] .codeblock__copy.is-copied) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

:global(:root[data-message-style="discord"] .codeblock pre) {
  padding: 10px;
}

:global(:root[data-message-style="discord"] .markdown .codeblock code) {
  background: transparent;
}

:global(:root[data-message-style="discord"] .embed) {
  margin-top: 0.35rem;
}

:global(:root[data-message-style="discord"] .msg .bubble-actions) {
  position: absolute;
  top: 0;
  right: 12px;
  left: auto;
  padding-top: 0;
}

:global(:root[data-message-style="discord"] .msg:not(.is-own) .bubble-actions),
:global(:root[data-message-style="discord"] .msg.is-own .bubble-actions) {
  right: 12px;
  left: auto;
}

:global(:root[data-message-style="discord"] .msg:hover > .bubble .bubble-actions),
:global(:root[data-message-style="discord"] .msg:hover > .jumbo .bubble-actions),
:global(:root[data-message-style="discord"] .msg .bubble-actions:hover) {
  opacity: 1;
  pointer-events: auto;
}

/* Voice messages: never surface the hover quick-actions bar — it would cover
   the waveform/play controls. All actions stay available via the context menu. */
:global(.msg:has(.voice-player) .bubble:hover > .bubble-actions),
:global(.msg:has(.voice-player) .bubble-actions:hover) {
  opacity: 0;
  pointer-events: none;
}

:global(:root[data-message-style="discord"] .jumbo) {
  position: static;
  min-width: 0;
}

:global(:root[data-message-style="discord"] .msg .jumbo) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

:global(:root[data-message-style="discord"] .jumbo__glyph) {
  display: inline-block;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1;
}

/* Discord jumbo : auteur sur une ligne avec timestamp inline, comme les vrais messages Discord */
:global(:root[data-message-style="discord"] .jumbo--discord .jumbo__author) {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 500;
  color: #fff;
}

/* Timestamp inline quand l'auteur est affiché (run-start / single) */
:global(:root[data-message-style="discord"] .jumbo--discord .jumbo__author .bubble__author-time) {
  margin-left: 3px;
  color: #72767d;
  font-size: 12px;
  font-weight: 500;
}

/* Timestamp flottant pour les messages own ou sans auteur (run-mid / run-end) */
:global(:root[data-message-style="discord"] .jumbo__time--discord) {
  display: inline-block;
  margin-left: 4px;
  color: #72767d;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  vertical-align: baseline;
}

:global(:root[data-theme="light"][data-message-style="discord"] .msg),
:global(:root[data-theme="light"][data-message-style="discord"] .bubble),
:global(:root[data-theme="light"][data-message-style="discord"] .msg.is-own .bubble) {
  color: var(--text);
}

:global(:root[data-theme="light"][data-message-style="discord"] .bubble__author),
:global(:root[data-theme="light"][data-message-style="discord"] .jumbo--discord .jumbo__author) {
  color: var(--text);
}

:global(:root[data-theme="light"][data-message-style="discord"] .bubble__author-time),
:global(:root[data-theme="light"][data-message-style="discord"] .bubble__text--deleted),
:global(:root[data-theme="light"][data-message-style="discord"] .bubble__edited),
:global(:root[data-theme="light"][data-message-style="discord"] .reply-ref__edited),
:global(:root[data-theme="light"][data-message-style="discord"] .jumbo__author .bubble__author-time),
:global(:root[data-theme="light"][data-message-style="discord"] .jumbo__time--discord) {
  color: var(--muted);
}

:global(:root[data-theme="light"][data-message-style="discord"] .reply-ref) {
  color: var(--muted);
}

:global(:root[data-theme="light"][data-message-style="discord"] .reply-ref__username) {
  color: var(--text);
  opacity: 0.78;
}

:global(:root[data-theme="light"][data-message-style="discord"] .reply-ref__hook) {
  border-left-color: var(--line-strong);
  border-top-color: var(--line-strong);
}

:global(:root[data-theme="light"][data-message-style="discord"] .mention) {
  background-color: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--text);
}

:global(:root[data-theme="light"][data-message-style="discord"] .mention:hover) {
  background-color: color-mix(in srgb, var(--accent) 82%, white 18%);
  color: #fff;
}

:global(:root[data-theme="light"][data-message-style="discord"] .reply-ref:not(.is-missing):hover .reply-ref__text) {
  color: var(--text);
}

:global(:root[data-theme="light"][data-message-style="discord"] .markdown a) {
  color: var(--accent);
}

:global(:root[data-theme="light"][data-message-style="discord"] .markdown code) {
  background: var(--discord-code-bg);
  color: var(--discord-text-strong);
}

:global(:root[data-theme="light"][data-message-style="discord"] .codeblock) {
  border-color: var(--discord-code-border);
  background: var(--discord-code-bg);
}

:global(:root[data-theme="light"][data-message-style="discord"] .codeblock__head) {
  border-bottom-color: var(--discord-code-border);
  color: var(--discord-code-button-text);
}

:global(:root[data-theme="light"][data-message-style="discord"] .codeblock__copy) {
  background: var(--discord-code-button-bg);
  color: var(--discord-code-button-text);
}

:global(:root[data-theme="light"][data-message-style="discord"] .codeblock__copy:hover),
:global(:root[data-theme="light"][data-message-style="discord"] .codeblock__copy.is-copied) {
  background: var(--discord-code-button-active-bg);
  color: var(--discord-text-strong);
}

:global(:root[data-message-style="discord"] .jumbo__glyph) {
  display: inline-block;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1;
}

:global(:root[data-message-style="discord"] .msg.is-own .jumbo__glyph) {
  margin-left: 0;
}

:deep(.twemoji) {
  display: inline-block;
  width: 1.12em;
  height: 1.12em;
  vertical-align: -0.18em;
  object-fit: contain;
}

:global(:root[data-message-style="discord"] .pick .twemoji),
:global(:root[data-message-style="discord"] .reaction .twemoji) {
  width: 1.05em;
  height: 1.05em;
}

.msg.is-jump-highlight {
  animation: msg-jump-highlight 2s var(--ease-out);
}

@keyframes msg-jump-highlight {
  0% { background: color-mix(in srgb, var(--accent) 25%, transparent); }
  100% { background: transparent; }
}

.msg__context-item-count {
  margin-left: auto;
  min-width: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.reactions-sheet__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: rgba(0, 0, 0, 0.4);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.reactions-sheet {
  position: fixed;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  z-index: calc(var(--z-sheet) + 1);
  display: flex;
  flex-direction: column;
  width: min(380px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  overflow: hidden;
  border-radius: 16px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--line-strong);
}

.reactions-sheet__grabber {
  display: none;
}

.reactions-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px 18px;
  flex: none;
}

.reactions-sheet__head strong {
  font-size: 15px;
  font-weight: 700;
}

.reactions-sheet__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--muted);
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.reactions-sheet__close:hover {
  background: color-mix(in srgb, var(--text) 14%, transparent);
  color: var(--text);
}

.reactions-sheet__close svg {
  width: 14px;
  height: 14px;
}

.reactions-sheet__tabs {
  display: flex;
  gap: 6px;
  padding: 0 14px 12px;
  overflow-x: auto;
  scrollbar-width: none;
  flex: none;
}

.reactions-sheet__tabs::-webkit-scrollbar {
  display: none;
}

.reactions-sheet__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  flex: none;
  border-radius: 999px;
  background: var(--reaction-bg);
  box-shadow: inset 0 0 0 1px var(--reaction-edge);
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-spring);
}

.reactions-sheet__tab:active {
  transform: scale(.94);
}

.reactions-sheet__tab.is-active {
  background: var(--accent);
  box-shadow: none;
  color: #fff;
}

.reactions-sheet__tab-count {
  font-variant-numeric: tabular-nums;
  opacity: .8;
}

.reactions-sheet__list {
  position: relative;
  margin: 0;
  padding: 0 8px 10px;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: 1px solid var(--line);
}

.reactions-sheet__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 6px 10px;
  border-radius: 10px;
  color: var(--text);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.reactions-sheet__row:active {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .reactions-sheet__row:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }
}

.reactions-sheet__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14.5px;
  font-weight: 600;
}

.reactions-sheet__emoji {
  flex: none;
  font-size: 20px;
}

.reactions-row-enter-active,
.reactions-row-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.reactions-row-leave-active {
  position: absolute;
  left: 8px;
  right: 8px;
}

.reactions-row-move {
  transition: transform var(--dur-base) var(--ease-out);
}

.reactions-row-enter-from,
.reactions-row-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .reactions-sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    translate: none;
    width: 100%;
    max-height: min(75vh, 620px);
    padding-bottom: max(10px, var(--app-safe-bottom));
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.45), 0 -1px 0 var(--line-strong);
  }

  .reactions-sheet__grabber {
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 10px auto 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .reactions-sheet__head {
    padding: 10px 16px 12px 20px;
  }

  .reactions-sheet__head strong {
    font-size: 17px;
  }

  .reactions-sheet__tabs {
    padding: 0 16px 14px;
  }

  .reactions-sheet__tab {
    height: 34px;
    font-size: 14px;
  }

  .reactions-sheet__row {
    min-height: 58px;
  }

  .reactions-sheet__name {
    font-size: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reactions-row-enter-active,
  .reactions-row-leave-active,
  .reactions-row-move {
    transition: none;
  }
}

.msg.is-swiping > :not(.msg__swipe-reply),
.msg.is-swipe-release > :not(.msg__swipe-reply) {
  transform: translateX(var(--swipe-x, 0px));
}

.msg.is-swipe-release > :not(.msg__swipe-reply) {
  transition: transform var(--dur-base) var(--ease-spring);
}

.msg__swipe-reply {
  position: absolute;
  top: 50%;
  left: 6px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-top: -15px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 10%, transparent);
  color: var(--muted);
  opacity: var(--swipe-p, 0);
  transform: scale(calc(0.5 + 0.5 * var(--swipe-p, 0)));
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  pointer-events: none;
}

.msg__swipe-reply.is-armed {
  background: var(--accent);
  color: #fff;
}

.msg__swipe-reply svg {
  width: 16px;
  height: 16px;
}

@media (hover: none) and (pointer: coarse) {
  .msg {
    touch-action: pan-y;
  }
}

@media (prefers-reduced-motion: reduce) {
  .msg.is-swipe-release > :not(.msg__swipe-reply) {
    transition: none;
  }
}

.msg__time-reveal {
  position: absolute;
  top: 50%;
  left: calc(100% + 10px);
  translate: 0 -50%;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: var(--reveal-p, 0);
  pointer-events: none;
}

.msg.is-swiping > .msg__time-reveal,
.msg.is-swipe-release > .msg__time-reveal {
  transform: none;
}

.poll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(320px, 72vw);
  padding: 2px 0;
}

.poll__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.poll__badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}

.poll__meta {
  font-size: 11.5px;
  opacity: 0.6;
}

.poll__question {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.poll__option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 8px 12px;
  overflow: hidden;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  box-shadow: inset 0 0 0 1px transparent;
  color: inherit;
  text-align: left;
  transition: box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

button.poll__option:active {
  transform: scale(.98);
}

.poll__option.is-selected {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

.poll__fill {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, currentColor 14%, transparent);
  transform-origin: left center;
  animation: poll-fill var(--dur-slow) var(--ease-out) both;
  transition: transform var(--dur-slow) var(--ease-out);
}

.poll__option.is-mine .poll__fill {
  background: color-mix(in srgb, var(--accent) 32%, transparent);
}

.poll__check {
  position: relative;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 45%, transparent);
  transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.poll__option.is-multi .poll__check {
  border-radius: 5px;
}

.poll__option.is-selected .poll__check {
  background: var(--accent);
  box-shadow: none;
}

.poll__option.is-selected .poll__check::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 3px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.poll__text {
  position: relative;
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.poll__option.is-mine .poll__text {
  font-weight: 650;
}

.poll__pct {
  position: relative;
  flex: none;
  font-size: 12.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.poll__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 2px;
}

.poll__foot {
  margin: 2px 0 0;
  font-size: 12px;
  opacity: 0.7;
}

.poll__vote {
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  transition: opacity var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out);
}

.poll__vote:disabled {
  opacity: 0.4;
}

.poll__vote:active {
  filter: brightness(.9);
}

:global(:root:not([data-message-style="discord"]) .msg.is-own .poll__vote) {
  background: #fff;
  color: var(--accent);
}

:global(:root:not([data-message-style="discord"]) .msg.is-own .poll__option.is-selected) {
  background: rgba(255, 255, 255, 0.24);
  box-shadow: inset 0 0 0 1.5px #fff;
}

@keyframes poll-fill {
  from { transform: scaleX(0); }
}

@media (prefers-reduced-motion: reduce) {
  .poll__fill {
    animation: none;
    transition: none;
  }
}

.thread-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 9%, transparent);
  color: inherit;
  font-size: 12.5px;
  font-weight: 600;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.thread-pill:hover {
  background: color-mix(in srgb, currentColor 15%, transparent);
}

.thread-pill svg {
  width: 14px;
  height: 14px;
}

.thread-pill__time {
  font-weight: 500;
  opacity: 0.65;
}

button.msg__avatar {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
}

button.msg__avatar.msg__avatar--image {
  background: var(--surface-2);
}

.bubble__author-name,
.jumbo__author .bubble__author-name {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
}

.bubble__author-name:hover,
.jumbo__author .bubble__author-name:hover {
  color: var(--accent);
  text-decoration: underline;
}
</style>
