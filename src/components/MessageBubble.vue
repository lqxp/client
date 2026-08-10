<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import AudioPlayer from "@/components/AudioPlayer.vue";
import ImageViewer from "@/components/ImageViewer.vue";
import ProfileCard from "@/components/ProfileCard.vue";
import TextFilePreview from "@/components/TextFilePreview.vue";
import VideoPlayer from "@/components/VideoPlayer.vue";
import { TEXT_ATTACHMENT_EXTENSIONS } from "@/composables/useMessenger";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

const props = defineProps({
  message: { type: Object, required: true },
  messenger: { type: Object, required: true },
  position: { type: String, default: "single" },
  showAuthor: { type: Boolean, default: true },
  showAvatar: { type: Boolean, default: true }
});

function initialsFor(username) {
  const name = String(username || "?").trim();
  const parts = name.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function messageDomId(messageId) {
  return `msg-${String(messageId || "")}`;
}

function previewTextFor(target, fallbackId = "") {
  if (!target) return fallbackId ? t("message.originalNotLoaded") : "";
  if (target.deleted) return t("message.messageDeleted");
  if (target.kind === "image") return t("message.photo");
  if (target.kind === "video") return t("message.video");
  if (target.kind === "audio" || target.kind === "voice") return t("message.voiceMessage");
  if (target.kind === "file") return target.attachment?.filename || t("message.fileAttachment");
  return target.text || t("composer.placeholder");
}

const isOwn = computed(() => props.messenger.isOwnMessage(props.message));
const isSystem = computed(() => Boolean(props.message.system));
const isSystemPresenceEvent = computed(() =>
  String(props.message.systemKind || "") === "presence" ||
  /^msg-system-(join|leave)-/.test(String(props.message.id || props.message.messageId || "")) ||
  /^system-(join|leave)-/.test(String(props.message.messageId || ""))
);
const isDiscordStyle = computed(() => props.messenger.state.messageStyle === "discord");
const streamerBlur = computed(() => Boolean(props.messenger.state.streamerMode) && !props.message.deleted && !isSystem.value);
const showTimestamp = computed(() => props.position === "end" || props.position === "single");
const keepBubbleReactions = computed(() => isDiscordStyle.value && props.position === "mid");
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

const avatarInitials = computed(() => initialsFor(props.message.username));
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
const showReactionsSubmenu = ref(false);
const contextMenuStyle = ref<Record<string, string>>({ top: "0px", left: "0px" });
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
const replyAvatarInitials = computed(() => initialsFor(repliedMessage.value?.username || replyLabel.value || "?"));
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

function reactionUsers(reaction) {
  return (Array.isArray(reaction?.users) ? reaction.users : [])
    .map((user) => String(user || "").trim())
    .filter(Boolean);
}

function showReactionTooltip(event: MouseEvent, reaction) {
  const users = reactionUsers(reaction);
  if (!users.length) return;
  if (reactionTooltipHideTimer) {
    window.clearTimeout(reactionTooltipHideTimer);
    reactionTooltipHideTimer = null;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = 220;
  const height = 220;
  const padding = 8;
  const styles = getComputedStyle(document.documentElement);
  const mobileStatusOffset = Number.parseFloat(styles.getPropertyValue("--mobile-status-offset")) || 0;
  const topPadding = mobileStatusOffset + padding;
  const left = Math.min(Math.max(rect.left, padding), window.innerWidth - width - padding);
  const placement: "top" | "bottom" = rect.top - height - 10 < topPadding ? "bottom" : "top";
  reactionTooltip.value = {
    emoji: reaction.emoji,
    count: reaction.count,
    users,
    left,
    top: placement === "top" ? rect.top - 10 : Math.max(rect.bottom + 10, topPadding),
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

function onReactionClick(reaction) {
  props.messenger.toggleReaction(props.message, reaction.emoji);
  if (reactionTooltipHideTimer) {
    window.clearTimeout(reactionTooltipHideTimer);
    reactionTooltipHideTimer = null;
  }
  reactionTooltip.value = null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value) {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw, window.location.origin);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return escapeHtml(raw);
  } catch {
    return "";
  }
  return "";
}

function codeBlockLabel(value) {
  const label = String(value || "").trim().replace(/^```+/, "").replace(/[`<>]/g, "");
  return label.slice(0, 40);
}

function twemojiSvgUrl(emoji) {
  const codepoints = [];
  for (const symbol of Array.from(String(emoji || ""))) {
    const cp = symbol.codePointAt(0);
    if (!cp) continue;
    // Twemoji filenames generally strip the emoji-variation selector FE0F.
    if (cp === 0xfe0f) continue;
    codepoints.push(cp.toString(16));
  }
  if (!codepoints.length) return "";
  const key = codepoints.join("-");
  const base = String(import.meta.env.BASE_URL || "./");
  return `${base}twemoji/svg/${key}.svg`;
}

function renderDiscordEmoji(value, options: { assumeHtml?: boolean } = {}) {
  const raw = String(value || "");
  const assumeHtml = Boolean(options.assumeHtml);
  if (!raw) return "";
  const source = assumeHtml ? raw : escapeHtml(raw);
  const emojiRegex = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;
  return source.replace(emojiRegex, (emoji) => {
    const url = twemojiSvgUrl(emoji);
    if (!url) return emoji;
    const safeAlt = escapeHtml(emoji);
    return `<img class="twemoji" data-twemoji="1" draggable="false" alt="${safeAlt}" src="${url}" onerror="this.replaceWith(document.createTextNode('${safeAlt}'))"/>`;
  });
}

function isKnownMention(username) {
  return validMentionUsers.value.has(String(username || "").trim().toLowerCase());
}

function renderMarkdownLists(value) {
  const lines = String(value || "").split("\n");
  const stack = [];
  let html = "";

  const openList = (level) => {
    if (!stack.length && html && !html.endsWith("\n")) html += "\n";
    html += '<ul class="markdown__list">';
    stack.push({ level, liOpen: false });
  };
  const closeItem = (entry) => {
    if (!entry?.liOpen) return;
    html += "</li>";
    entry.liOpen = false;
  };
  const closeList = () => {
    const entry = stack.pop();
    closeItem(entry);
    html += "</ul>";
  };
  const appendTextLine = (line) => {
    while (stack.length) closeList();
    if (html) html += "\n";
    html += line;
  };

  for (const line of lines) {
    const match = /^([ \t]*)-\s+(.+)$/.exec(line);
    if (!match) {
      appendTextLine(line);
      continue;
    }

    let level = Math.floor(match[1].replace(/\t/g, "  ").length / 2);
    if (!stack.length) openList(0);

    let top = stack[stack.length - 1];
    if (level > top.level && !top.liOpen) level = top.level;
    if (level > top.level + 1) level = top.level + 1;

    while (stack.length && level < stack[stack.length - 1].level) closeList();
    while (level > stack[stack.length - 1].level) openList(stack[stack.length - 1].level + 1);

    top = stack[stack.length - 1];
    closeItem(top);
    html += `<li>${match[2].trim()}`;
    top.liOpen = true;
  }

  while (stack.length) closeList();
  return html;
}

function markdown(value) {
  const tokens = [];
  const hold = (html) => {
    const token = `@@md-${tokens.length}@@`;
    tokens.push([token, html]);
    return token;
  };

  let html = escapeHtml(value);
  html = html.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, rawLabel, code) => {
    const label = codeBlockLabel(rawLabel);
    const title = label ? `<span class="codeblock__label">${escapeHtml(label)}</span>` : "<span></span>";
    const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const copyButton = `<button class="codeblock__copy" type="button" data-code-copy aria-label="Copy code">${copyIcon}<span>Copy</span></button>`;
    return hold(`<div class="codeblock"><div class="codeblock__head">${title}${copyButton}</div><pre><code>${code.replace(/\n$/, "")}</code></pre></div>`);
  });
  html = html.replace(/^(#{1,4})[ \t]+(.+)$/gm, (_, marks, title) => (
    `<h${marks.length} class="markdown__h markdown__h${marks.length}">${title.trim()}</h${marks.length}>`
  ));
  html = renderMarkdownLists(html);
  html = html.replace(/``([^`\n]*)``/g, (_, code) => hold(`<code>${code}</code>`));
  html = html.replace(/`([^`\n]*)`/g, (_, code) => hold(`<code>${code}</code>`));
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safe = safeHref(href);
    if (!safe) return match;
    return hold(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });
  html = html
    .replace(/(^|[^a-zA-Z0-9_.])@([a-z0-9_.]{2,32})(?=$|[^a-zA-Z0-9_.])/gi, (match, prefix, username) => (
      isKnownMention(username) ? `${prefix}<span class="mention" data-mention="${escapeHtml(username)}" role="button" tabindex="0">@${username}</span>` : match
    ))
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");

  for (const [token, value] of tokens) html = html.replaceAll(token, value);
  return renderDiscordEmoji(html, { assumeHtml: true });
}

async function copyText(text) {
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

async function onCodeCopyClick(event) {
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

async function onMarkdownClick(event) {
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

function closeProfile() {
  selectedProfile.value = "";
}

function jumpToMessage(messageId) {
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
  showReactionsSubmenu.value = false;
}

async function positionContextMenu(clientX: number, clientY: number) {
  const padding = 12;
  contextMenuStyle.value = {
    left: `${clientX}px`,
    top: `${clientY}px`
  };
  await nextTick();
  const rect = contextMenuRef.value?.getBoundingClientRect();
  if (!rect) return;
  const left = Math.min(Math.max(clientX, padding), Math.max(padding, window.innerWidth - rect.width - padding));
  const top = Math.min(Math.max(clientY, padding), Math.max(padding, window.innerHeight - rect.height - padding));
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
  if (!isOwn.value || deleted.value) return;
  const confirmed = await dialog.showConfirm(t("message.deleteConfirm"));
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
});
</script>

<template>
  <article :id="messageDomId(message.messageId)" class="msg" :class="[
    { 'is-own': isOwn, 'is-jumbo': jumbo, 'is-deleted': deleted, 'is-system': isSystem },
    { 'is-mentioned': effectiveMentioned, 'is-discord': isDiscordStyle, 'is-streamer-blur': streamerBlur },
    {
      'has-reactions': message.reactions.length && !deleted,
      'has-discord-reply': message.replyToMessageId && isDiscordStyle
    },
    runClass
  ]" @contextmenu.prevent.stop="onMessageContextMenu">
    <span v-if="showAvatar && !isSystem" class="msg__avatar" :class="avatarSrc ? 'msg__avatar--image' : `avatar--${avatarAccent}`">
      <img v-if="avatarSrc" :src="avatarSrc" :alt="`${message.username} avatar`" />
      <template v-else>{{ avatarInitials }}</template>
    </span>
    <span v-else class="msg__spacer"></span>

    <div v-if="jumbo" class="jumbo" :class="{ 'jumbo--discord': isDiscordStyle }"
      @contextmenu.prevent.stop="onMessageContextMenu">
      <button v-if="message.replyToMessageId && isDiscordStyle" type="button" class="reply-ref"
        :class="{ 'is-missing': !repliedMessage }" @click="onReplyClick"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <span class="reply-ref__hook" aria-hidden="true"></span>
        <span v-if="replyAvatarSrc" class="reply-ref__avatar reply-ref__avatar--image">
          <img :src="replyAvatarSrc" :alt="`${replyLabel} avatar`" />
        </span>
        <span v-else class="reply-ref__avatar" :class="`avatar--${replyAvatarAccent}`">
          {{ replyAvatarInitials }}
        </span>
        <span class="reply-ref__username">{{ replyLabel }}</span>
        <span v-if="replyHasVisual" class="reply-ref__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
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
        {{ message.username }}
        <span v-if="isDiscordStyle" class="bubble__author-time">{{ messenger.formatTime(message.timestamp) }}</span>
      </div>
      <div class="jumbo__glyph" v-html="renderDiscordEmoji(message.text)"></div>
      <span v-if="showTimestamp && !isDiscordStyle" class="jumbo__time">
        {{ messenger.formatTime(message.timestamp) }}<span v-if="edited"> · edited</span>
      </span>
      <div v-if="message.reactions.length" class="reactions reactions--standalone"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <button v-for="reaction in message.reactions" :key="`${message.messageId}-${reaction.emoji}`" class="reaction"
          type="button" @click="onReactionClick(reaction)" @mouseenter="showReactionTooltip($event, reaction)"
          @mouseleave="scheduleHideReactionTooltip">
          <span v-html="renderDiscordEmoji(reaction.emoji)"></span>
          <span v-if="reaction.count > 1">{{ reaction.count }}</span>
        </button>
      </div>
      <div class="bubble-actions" :style="discordActionsStyle" @contextmenu.prevent.stop="onMessageContextMenu">
        <div class="pick">
          <button v-for="emoji in messenger.QUICK_REACTIONS" :key="`pick-${emoji}`" type="button"
            @click="messenger.toggleReaction(message, emoji)" v-html="renderDiscordEmoji(emoji)"></button>
          <button v-if="!deleted" type="button" aria-label="Reply" @click="messenger.startReply(message)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 17 4 12l5-5" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
          <button v-if="canEdit" type="button" class="pick__edit" aria-label="Edit"
            @click="messenger.startEditMessage(message)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button v-if="isOwn && !deleted" type="button" class="pick__delete" aria-label="Delete" @click="onDelete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="bubble" :class="{
      'bubble--deleted': deleted
    }" @contextmenu.prevent.stop="onMessageContextMenu">
      <div class="bubble-actions" :style="discordActionsStyle" @contextmenu.prevent.stop="onMessageContextMenu">
        <div class="pick" role="group" aria-label="React">
          <button v-for="emoji in messenger.QUICK_REACTIONS" :key="`pick-${emoji}`" type="button"
            @click="messenger.toggleReaction(message, emoji)" v-html="renderDiscordEmoji(emoji)"></button>
          <button v-if="!deleted" type="button" aria-label="Reply" @click="messenger.startReply(message)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 17 4 12l5-5" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
          <button v-if="canEdit" type="button" class="pick__edit" aria-label="Edit"
            @click="messenger.startEditMessage(message)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          <button v-if="isOwn && !deleted" type="button" class="pick__delete" aria-label="Delete" @click="onDelete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      <button v-if="message.replyToMessageId && isDiscordStyle" type="button" class="reply-ref"
        :class="{ 'is-missing': !repliedMessage }" @click="onReplyClick"
        @contextmenu.prevent.stop="onMessageContextMenu">
        <span class="reply-ref__hook" aria-hidden="true"></span>
        <span v-if="replyAvatarSrc" class="reply-ref__avatar reply-ref__avatar--image">
          <img :src="replyAvatarSrc" :alt="`${replyLabel} avatar`" />
        </span>
        <span v-else class="reply-ref__avatar" :class="`avatar--${replyAvatarAccent}`">
          {{ replyAvatarInitials }}
        </span>
        <span class="reply-ref__username">{{ replyLabel }}</span>
        <span v-if="replyHasVisual" class="reply-ref__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
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
        <span>{{ message.username }}</span>
        <span v-if="isDiscordStyle" class="bubble__author-time">{{ messenger.formatTime(message.timestamp) }}</span>
      </div>

      <div v-else-if="isSystem" class="bubble__system">
        <button v-if="!isSystemPresenceEvent" type="button" class="bubble__system-author" @click="selectedProfile = 'system'">@system</button>
        <span class="bubble__system-line">{{ message.text }}</span>
        <span class="bubble__system-time">{{ messenger.formatTime(message.timestamp) }}</span>
      </div>

      <template v-if="deleted">
        <div class="bubble__body">
          <div class="bubble__text bubble__text--deleted">{{ t('message.deleted') }}</div>
        </div>
      </template>

      <template v-else-if="attachmentKind === 'image'">
        <button v-if="attachmentUrl" type="button" class="att-image-link"
          :aria-label="`Open image preview: ${message.attachment.filename}`" @click="openImageViewer"
          @contextmenu.prevent.stop="onMessageContextMenu">
          <img :src="attachmentUrl" :alt="message.attachment.filename" class="att-image" />
        </button>
        <div v-else class="att-expired" role="status">{{ t('message.attachmentExpired') }}</div>
        <ImageViewer v-if="imageViewerOpen" :src="attachmentUrl" :filename="message.attachment.filename"
          :size-label="messenger.formatSize(message.attachment.size)" @close="imageViewerOpen = false" />
        <div v-if="message.text" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="attachmentKind === 'video'">
        <VideoPlayer v-if="attachmentUrl" :src="attachmentUrl" :filename="message.attachment.filename"
          :size-label="messenger.formatSize(message.attachment.size)" />
        <div v-else class="att-expired" role="status">{{ t('message.attachmentExpired') }}</div>
        <div v-if="message.text" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="(attachmentKind === 'audio' || attachmentKind === 'voice') && attachmentUrl">
        <AudioPlayer :src="attachmentUrl" :filename="message.attachment.filename"
          :size-label="messenger.formatSize(message.attachment.size)" :fallback-duration="message.voiceDuration || ''"
          :messenger="messenger" />
        <div v-if="message.text && !message.text.startsWith('[voice:')" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible && message.text && !message.text.startsWith('[voice:')" type="button"
          class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <template v-else-if="attachmentKind === 'audio' || attachmentKind === 'voice'">
        <div class="att-expired" role="status">{{ t('message.voiceMessageExpired') }}</div>
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
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </span>
        </button>
        <TextFilePreview v-if="textViewerOpen && attachmentUrl" :src="attachmentUrl"
          :filename="message.attachment.filename" :size-label="messenger.formatSize(message.attachment.size)"
          @close="textViewerOpen = false" />
        <div v-if="message.text" class="bubble__body">
          <div class="bubble__text markdown" :class="{ 'bubble__text--collapsed': isTextCollapsible && !expandedText }"
            @click="onMarkdownClick" @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
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
            @click="onMarkdownClick" @contextmenu.prevent.stop="onMessageContextMenu" v-html="markdown(message.text)">
          </div>
          <span v-if="isDiscordStyle && edited && !deleted" class="bubble__edited">(edited)</span>
        </div>
        <button v-if="isTextCollapsible" type="button" class="bubble__more" @click="expandedText = !expandedText">
          {{ expandedText ? t('message.seeLess') : t('message.seeMore') }}
        </button>
      </template>

      <a v-if="preview && preview.url && !deleted" :href="preview.url" target="_blank" rel="noopener noreferrer"
        class="embed" @contextmenu.prevent.stop="onMessageContextMenu">
        <div v-if="preview.image" class="embed__media">
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

      <div v-if="message.reactions.length && !deleted" class="reactions"
        :class="{ 'reactions--bubble-mode': keepBubbleReactions }" @contextmenu.prevent.stop="onMessageContextMenu">
        <button v-for="reaction in message.reactions" :key="`${message.messageId}-${reaction.emoji}`" class="reaction"
          type="button" @click="onReactionClick(reaction)" @mouseenter="showReactionTooltip($event, reaction)"
          @mouseleave="scheduleHideReactionTooltip">
          <span v-html="renderDiscordEmoji(reaction.emoji)"></span>
          <span v-if="reaction.count > 1">{{ reaction.count }}</span>
        </button>
      </div>
    </div>
  </article>

  <Teleport to="body">
    <div v-if="contextMenuOpen" class="msg__context" @click="closeContextMenu" @contextmenu.prevent>
      <div ref="contextMenuRef" class="msg__context-menu context-menu-base" :style="contextMenuStyle" role="menu" :aria-label="t('message.actions')" @click.stop>
        <!-- Header: user info + message preview (mobile only) -->
        <div class="msg__context-header">
          <span v-if="avatarSrc" class="msg__context-header-avatar msg__context-header-avatar--image">
            <img :src="avatarSrc" :alt="message.username" />
          </span>
          <span v-else class="msg__context-header-avatar" :class="`avatar--${avatarAccent}`">{{ avatarInitials }}</span>
          <div class="msg__context-header-text">
            <strong class="msg__context-header-name">@{{ message.username }}</strong>
            <span v-if="!deleted" class="msg__context-header-preview">{{ previewTextFor(message, message.messageId) }}</span>
            <span v-else class="msg__context-header-preview msg__context-header-preview--deleted">{{ t('message.messageDeleted') }}</span>
          </div>
        </div>
        <!-- Quick reactions row -->
        <div v-if="!deleted" class="msg__context-reactions" role="group" aria-label="React">
          <button v-for="emoji in messenger.QUICK_REACTIONS" :key="`context-reaction-${emoji}`" type="button"
            class="msg__context-reaction" @click="onToggleReaction(emoji)" v-html="renderDiscordEmoji(emoji)"></button>
        </div>
        <div v-if="!deleted" class="msg__context-separator" aria-hidden="true"></div>
        <!-- Reactions submenu entry -->
        <button v-if="message.reactions.length" type="button" class="msg__context-item" role="menuitem" @click="showReactionsSubmenu = true">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="10" x2="9.01" y2="10"/><line x1="15" y1="10" x2="15.01" y2="10"/></svg>
          <span>Reactions</span>
          <svg class="msg__context-item-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <!-- Actions -->
        <button v-if="!deleted" type="button" class="msg__context-item" role="menuitem" @click="onStartReply">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          <span>{{ t('message.reply') }}</span>
        </button>
        <button v-if="canEdit" type="button" class="msg__context-item" role="menuitem" @click="onStartEdit">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          <span>{{ t('message.edit') }}</span>
        </button>
        <button type="button" class="msg__context-item" role="menuitem" @click="onOpenProfile">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>{{ t('message.viewProfile') }}</span>
        </button>
        <button v-if="!deleted" type="button" class="msg__context-item" role="menuitem" @click="onCopyMessageText">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>{{ t('message.copyMessage') }}</span>
        </button>
        <button type="button" class="msg__context-item" role="menuitem" @click="onCopyUserId">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>{{ t('message.copyUserId') }}</span>
        </button>
        <button v-if="isOwn && !deleted" type="button" class="msg__context-item is-danger" role="menuitem"
          @click="onDelete">
          <svg class="msg__context-item-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>{{ t('message.deleteMessage') }}</span>
        </button>
        <!-- Cancel button (mobile only) -->
        <div class="msg__context-separator" aria-hidden="true"></div>
        <button type="button" class="msg__context-item msg__context-cancel" role="menuitem" @click="closeContextMenu">
          <span>{{ t('message.cancel') }}</span>
        </button>
      </div>
    </div>
    <div v-if="reactionTooltip" class="reaction-tooltip" :class="`is-${reactionTooltip.placement}`"
      :style="{ left: `${reactionTooltip.left}px`, top: `${reactionTooltip.top}px` }" role="tooltip"
      @mouseenter="keepReactionTooltip" @mouseleave="scheduleHideReactionTooltip">
      <div class="reaction-tooltip__head">
        <span v-html="renderDiscordEmoji(reactionTooltip.emoji)"></span>
        <strong>{{ reactionTooltip.count }}</strong>
      </div>
      <div class="reaction-tooltip__list">
        <span v-for="user in reactionTooltip.users" :key="user" class="reaction-tooltip__user">{{ user }}</span>
      </div>
    </div>
    <!-- Reactions submenu -->
    <div v-if="showReactionsSubmenu" class="msg__context" @click="showReactionsSubmenu = false" @contextmenu.prevent>
      <div class="msg__context-menu context-menu-base msg__context-submenu" role="menu" :aria-label="'Reactions'" @click.stop>
        <div class="msg__context-submenu-head">
          <button type="button" class="msg__context-back" @click="showReactionsSubmenu = false">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <strong>Reactions</strong>
        </div>
        <div class="msg__context-reactions-detail">
          <div v-for="reaction in message.reactions" :key="`sub-${reaction.emoji}`" class="msg__context-reaction-detail">
            <span class="msg__context-reaction-detail-emoji" v-html="renderDiscordEmoji(reaction.emoji)"></span>
            <span class="msg__context-reaction-detail-users">{{ reactionUsers(reaction).join(', ') }}</span>
          </div>
        </div>
      </div>
    </div>
    <ProfileCard v-if="selectedProfile" :messenger="messenger" :username="selectedProfile" @close="closeProfile" />
  </Teleport>
</template>

<style scoped>
@import url("https://fonts.bunny.net/css?family=roboto:400,500,700");

@font-face {
  font-family: "Whitney";
  src: url("https://cdn.jsdelivr.net/gh/ItzDerock/discord-components@master/assets/fonts/Book.woff") format("woff");
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("https://cdn.jsdelivr.net/gh/ItzDerock/discord-components@master/assets/fonts/Medium.woff") format("woff");
  font-weight: 500;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("https://cdn.jsdelivr.net/gh/ItzDerock/discord-components@master/assets/fonts/Semibold.woff") format("woff");
  font-weight: 600;
  font-display: swap;
}

@font-face {
  font-family: "Whitney";
  src: url("https://cdn.jsdelivr.net/gh/ItzDerock/discord-components@master/assets/fonts/Bold.woff") format("woff");
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
  display: none;
}

.msg__context-cancel {
  display: none;
}

.msg__context-reactions-detail {
  display: none;
}

.msg__context-item-chevron {
  display: none;
}

.msg__context-submenu {
  display: none;
}

.msg__context-submenu-head {
  display: none;
}

.msg__context-back {
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
    animation: msg-context-backdrop-in 160ms ease-out;
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
    padding: 0 0 max(18px, env(safe-area-inset-bottom));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    animation: msg-context-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
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
    transition: transform 120ms ease, background 120ms ease;
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
    transition: background 120ms ease;
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
    color: var(--muted);
    transition: color 120ms ease;
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
    justify-content: center;
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

  /* ---- Chevron for submenu items ---- */
  .msg__context-item-chevron {
    display: block;
    flex: none;
    margin-left: auto;
    color: var(--dim);
  }

  /* ---- Submenu ---- */
  .msg__context-submenu {
    display: flex;
    flex-direction: column;
  }

  .msg__context-submenu-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 18px 14px;
    flex: none;
  }

  .msg__context-submenu-head strong {
    font-size: 17px;
    font-weight: 750;
    color: var(--text);
  }

  .msg__context-back {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    flex: none;
  }

  .msg__context-back:hover {
    background: var(--surface-hover);
  }

  /* ---- Reactions detail (inside submenu) ---- */
  .msg__context-reactions-detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 18px 12px;
  }

  .msg__context-reaction-detail {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 14px;
    line-height: 1.4;
  }

  .msg__context-reaction-detail-emoji {
    font-size: 20px;
    flex: none;
    margin-top: 1px;
  }

  .msg__context-reaction-detail-users {
    color: var(--muted);
    word-break: break-word;
  }

  /* ---- Hide hover tooltip on mobile ---- */
  .reaction-tooltip {
    display: none !important;
  }
}

@keyframes msg-context-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes msg-context-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
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
  transition: background-color 50ms ease-out;
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

.msg.is-streamer-blur {
  contain: layout paint style;
  content-visibility: auto;
  contain-intrinsic-size: 0 88px;
}

.msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar, .bubble__author > span:first-child, .jumbo__author, .reply-ref__username, .reply-ref__text, .reply-card__author, .reply-card__text, .bubble__text, .att-file-meta, .embed__body, .reactions, .jumbo__glyph) {
  filter: blur(8px);
  opacity: 0.72;
  transition: filter 120ms ease, opacity 120ms ease;
}

.msg.is-streamer-blur :is(.bubble__author > span:first-child, .jumbo__author, .bubble__text, .reactions, .jumbo__glyph):hover,
.msg.is-streamer-blur :is(.bubble__author > span:first-child, .jumbo__author, .bubble__text, .reactions, .jumbo__glyph):focus-within,
.msg.is-streamer-blur .msg__avatar:hover,
.msg.is-streamer-blur .reply-ref:hover :is(.reply-ref__avatar, .reply-ref__username, .reply-ref__text),
.msg.is-streamer-blur .reply-card:hover :is(.reply-card__author, .reply-card__text),
.msg.is-streamer-blur .att-file:hover .att-file-meta {
  filter: none;
  opacity: 1;
}

.msg.is-streamer-blur :is(.att-image-link, .audio-player, .video-player, .embed__media) {
  filter: blur(24px);
  opacity: 0.72;
}

.msg.is-streamer-blur :is(.msg__avatar, .reply-ref__avatar) {
  filter: blur(22px);
}

.msg.is-streamer-blur :is(.att-image-link, .audio-player, .video-player, .embed__media) {
  overflow: hidden;
  transform: translateZ(0);
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
  user-select: text;
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
  transition: background-color 50ms ease-out, color 50ms ease-out;
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

:global(:root[data-message-style="discord"] .reactions) {
  position: static;
  width: fit-content;
  margin-top: 6px;
  padding: 2px 6px;
  border-radius: 8px;
}

:global(:root[data-message-style="discord"] .reactions.reactions--bubble-mode) {
  display: inline-flex;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line-strong);
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

:global(:root[data-message-style="discord"] .msg:not(.is-own) .jumbo .reactions.reactions--standalone) {
  align-self: flex-start;
  margin-top: 6px;
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
  animation: msg-jump-highlight 2s ease-out;
}

@keyframes msg-jump-highlight {
  0% { background: color-mix(in srgb, var(--accent) 25%, transparent); }
  100% { background: transparent; }
}
</style>
