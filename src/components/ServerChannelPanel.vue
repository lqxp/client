<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import CreateChannelModal from "@/components/CreateChannelModal.vue";
import { currentWindowZoom } from "@/utils/windowZoom";

const dialog = useDialog();
const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true }
});
const emit = defineEmits(["channel-selected", "back", "open-room-menu"]);

const createOpen = ref(false);
const createPresetCategory = ref("");
const editChannel = ref<any | null>(null);
const ctxOpen = ref(false);
const ctxKind = ref<"channel" | "category">("channel");
const ctxId = ref("");
const ctxMenuRef = ref<HTMLElement | null>(null);
const ctxPos = ref({ x: 0, y: 0 });

const roomId = computed(() => String(props.messenger.state.activeRoom || ""));
const serverName = computed(() => props.messenger.displayRoomNameBeautified(roomId.value));
const channels = computed(() => props.messenger.serverChannels?.(roomId.value) || []);
const categories = computed(() => props.messenger.serverCategories?.(roomId.value) || []);
const activeChannelId = computed(() => String(props.messenger.activeChannelId?.(roomId.value) || ""));
const canManage = computed(() => props.messenger.canManageRoom?.(roomId.value) === true);
const liveVoiceChannelId = computed(() => {
  if (!props.messenger.state.inCall || props.messenger.state.callRoom !== roomId.value) return "";
  return String(props.messenger.activeVoiceChannel?.(roomId.value)?.id || "");
});

// Voice members per channel: { channelId: [username, ...] }
const voiceMembersByChannel = computed(() => {
  return props.messenger.state.voiceMembersByChannel?.[roomId.value] || {};
});

// Expand state for voice channels (override utilisateur ; défaut = déplié
// quand du monde est présent, façon Discord).
const voiceExpanded = ref<Record<string, boolean>>({});

function toggleVoiceExpand(channelId: string) {
  voiceExpanded.value[channelId] = !isVoiceExpanded(channelId);
}

function voiceMembers(channelId: string): string[] {
  return voiceMembersByChannel.value[channelId] || [];
}

function isVoiceExpanded(channelId: string): boolean {
  const explicit = voiceExpanded.value[channelId];
  if (explicit !== undefined) return explicit;
  return voiceMembers(channelId).length > 0;
}

const grouped = computed(() => {
  const cats = categories.value;
  const chans = channels.value;
  const groups: Array<{ id: string; name: string; channels: any[] }> = [];
  for (const cat of cats) {
    groups.push({
      id: cat.id,
      name: cat.name,
      channels: chans.filter((c) => c.categoryId === cat.id),
    });
  }
  const orphans = chans.filter((c) => !c.categoryId || !cats.some((cat) => cat.id === c.categoryId));
  if (orphans.length) groups.unshift({ id: "", name: "", channels: orphans });
  return groups;
});

function channelUnread(channelId) {
  const key = props.messenger.messageKeyFor?.(roomId.value, channelId) || roomId.value;
  return Number(props.messenger.state.unreadByRoom?.[key] || 0);
}

function isLiveVoice(channelId) {
  return !!channelId && channelId === liveVoiceChannelId.value;
}

// Membres visibles sous un salon vocal (sans ouvrir le panneau membres).
// (Implémentation unique : avatar image + mute + accent par utilisateur.)
function voiceAvatarSrc(username: string) {
  return props.messenger.profileImageSrc?.(props.messenger.profileFor?.(username)?.avatar, "avatar") || "";
}

function voiceMuted(username: string) {
  const me = String(props.messenger.state.username || "");
  const media = username && username === me
    ? props.messenger.state.localCallMedia
    : props.messenger.state.remoteCallMediaByUser?.[username];
  return !!media && media.audio === false;
}

function displayUsername(username: string): string {
  return props.messenger.state.profilesByUser?.[username]?.displayName
    || props.messenger.state.profilesByUser?.[username]?.username
    || username;
}

function initialsFor(username: string): string {
  const name = displayUsername(username);
  const parts = name.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function accentForUser(username: string): string {
  return props.messenger.accentFor?.(username) || "slate";
}

function openCreate(presetCategoryId = "") {
  createPresetCategory.value = presetCategoryId;
  editChannel.value = null;
  createOpen.value = true;
}

function openEdit(channel) {
  if (!channel) return;
  createPresetCategory.value = "";
  editChannel.value = channel;
  createOpen.value = true;
}

function canSpeak(channelId) {
  return props.messenger.canSpeakInChannel?.(roomId.value, channelId) !== false;
}

function openChannel(channelId) {
  props.messenger.selectChannel?.(roomId.value, channelId);
  emit("channel-selected", channelId);
}

// Drag & drop desktop uniquement (souris) : attraper un salon pour le
// déplacer dans sa catégorie ou vers une autre. Tactile exclu : le swipe
// mobile et le scroll doivent rester prioritaires.
const desktopDnd =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const dragChannelId = ref("");
const dropTarget = ref<{ id: string; before: boolean } | null>(null);
const dropCategoryId = ref("");

function onDragStart(event: DragEvent, channelId: string) {
  if (!canManage.value) {
    event.preventDefault();
    return;
  }
  closeCtx();
  dragChannelId.value = channelId;
  dropTarget.value = null;
  dropCategoryId.value = "";
  if (event.dataTransfer) {
    event.dataTransfer.setData("text/plain", channelId);
    event.dataTransfer.effectAllowed = "move";
  }
}

function onDragEnd() {
  dragChannelId.value = "";
  dropTarget.value = null;
  dropCategoryId.value = "";
}

function groupOf(channelId: string) {
  return grouped.value.find((g) => g.channels.some((c) => c.id === channelId)) || null;
}

function onRowDragOver(event: DragEvent, channelId: string) {
  if (!dragChannelId.value || dragChannelId.value === channelId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  const before = rect ? event.clientY - rect.top < rect.height / 2 : true;
  const current = dropTarget.value;
  if (!current || current.id !== channelId || current.before !== before) {
    dropTarget.value = { id: channelId, before };
  }
  dropCategoryId.value = "";
}

function onCatDragOver(event: DragEvent, categoryId: string) {
  if (!dragChannelId.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dropTarget.value = null;
  dropCategoryId.value = categoryId;
}

function onDropOnRow(event: DragEvent, channelId: string) {
  event.preventDefault();
  const dragged = dragChannelId.value;
  const target = groupOf(channelId);
  onDragEnd();
  if (!dragged || !target || dragged === channelId) return;
  const ids = target.channels.map((c) => c.id).filter((id) => id !== dragged);
  const at = ids.indexOf(channelId);
  if (at < 0) return;
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
  const before = rect ? event.clientY - rect.top < rect.height / 2 : true;
  ids.splice(before ? at : at + 1, 0, dragged);
  props.messenger.reorderChannels?.(roomId.value, target.id || null, ids);
}

function onDropOnCategory(event: DragEvent, categoryId: string) {
  event.preventDefault();
  const dragged = dragChannelId.value;
  const target = grouped.value.find((g) => g.id === categoryId);
  onDragEnd();
  if (!dragged || !target) return;
  const ids = target.channels.map((c) => c.id).filter((id) => id !== dragged);
  ids.push(dragged);
  props.messenger.reorderChannels?.(roomId.value, target.id || null, ids);
}

// Clic sur l'en-tête : même menu serveur que le clic droit sur l'icône du
// rail (renommer, image, paramètres, quitter…).
function onHeadClick(event: MouseEvent) {
  // Stoppe la remontée : le handler document de MessengerSidebar refermerait
  // aussitôt le menu qu'on vient d'ouvrir (même motif que toggleAccountMenu).
  event.stopPropagation();
  emit("open-room-menu", { x: event.clientX, y: event.clientY });
}

// Double-slide mobile : swipe droit → liste des conversations,
// swipe gauche → conversation (salon actif).
let panelTouchStartX = 0;
let panelTouchStartY = 0;

function isNarrowView() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 760px)").matches;
}

function onPanelTouchStart(event: TouchEvent) {
  if (!isNarrowView()) return;
  panelTouchStartX = event.touches[0].clientX;
  panelTouchStartY = event.touches[0].clientY;
}

function onPanelTouchEnd(event: TouchEvent) {
  if (!isNarrowView()) return;
  const dx = (event.changedTouches[0]?.clientX || 0) - panelTouchStartX;
  const dy = (event.changedTouches[0]?.clientY || 0) - panelTouchStartY;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return; // pas assez horizontal
  if (dx > 60) emit("back");
  else if (dx < -60) emit("channel-selected", activeChannelId.value || "");
}

async function positionMenu(clientX: number, clientY: number) {
  const padding = 16;
  const zoom = currentWindowZoom();
  const cursorX = clientX / zoom;
  const cursorY = clientY / zoom;
  const vw = window.innerWidth / zoom;
  const vh = window.innerHeight / zoom;
  ctxPos.value = { x: cursorX, y: cursorY };
  await nextTick();
  await nextTick();
  const rect = ctxMenuRef.value?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return;
  const menuW = rect.width / zoom;
  const menuH = rect.height / zoom;
  const maxX = Math.max(padding, vw - menuW - padding);
  const maxY = Math.max(padding, vh - menuH - padding);
  ctxPos.value = {
    x: Math.min(Math.max(cursorX, padding), maxX),
    y: Math.min(Math.max(cursorY, padding), maxY),
  };
}

function onChannelContext(event: MouseEvent, channelId: string) {
  event.preventDefault();
  event.stopPropagation();
  if (!canManage.value) return;
  ctxKind.value = "channel";
  ctxId.value = channelId;
  ctxOpen.value = true;
  void positionMenu(event.clientX, event.clientY);
}

function onCategoryContext(event: MouseEvent, categoryId: string) {
  event.preventDefault();
  event.stopPropagation();
  if (!canManage.value) return;
  ctxKind.value = "category";
  ctxId.value = categoryId;
  ctxOpen.value = true;
  void positionMenu(event.clientX, event.clientY);
}

function closeCtx() {
  ctxOpen.value = false;
  ctxKind.value = "channel";
  ctxId.value = "";
}

function editFromCtx() {
  const ch = props.messenger.channelById?.(roomId.value, ctxId.value);
  closeCtx();
  openEdit(ch);
}

async function deleteFromCtx() {
  const cid = ctxId.value;
  const ch = props.messenger.channelById?.(roomId.value, cid);
  closeCtx();
  if (!ch) return;
  const ok = await dialog.showConfirm(t("channels.menuDeleteConfirm", { name: ch.name }));
  if (!ok) return;
  props.messenger.deleteChannel?.(roomId.value, cid);
}

async function createCategory() {
  const next = await dialog.showPrompt(t("channels.menuCategoryName"), "");
  closeCtx();
  if (next === null) return;
  const err = props.messenger.validateCategoryName?.(next);
  if (err) {
    props.messenger.state.lastError = err;
    props.messenger.showToast?.(err);
    return;
  }
  props.messenger.createCategory?.(roomId.value, String(next).trim());
}

async function renameCategoryFromCtx() {
  const cid = ctxId.value;
  const cat = categories.value.find((c) => c.id === cid);
  const next = await dialog.showPrompt(t("channels.menuRenameCategoryPrompt"), cat?.name || "");
  closeCtx();
  if (next === null) return;
  const err = props.messenger.validateCategoryName?.(next);
  if (err) {
    props.messenger.state.lastError = err;
    props.messenger.showToast?.(err);
    return;
  }
  props.messenger.renameCategory?.(roomId.value, cid, String(next).trim());
}

async function deleteCategoryFromCtx() {
  const cid = ctxId.value;
  const cat = categories.value.find((c) => c.id === cid);
  closeCtx();
  if (!cat) return;
  const ok = await dialog.showConfirm(t("channels.menuDeleteCategoryConfirm", { name: cat.name }));
  if (!ok) return;
  props.messenger.deleteCategory?.(roomId.value, cid);
}

function createChannelHere() {
  const cid = ctxId.value;
  closeCtx();
  openCreate(cid);
}

function canMoveCtx(direction: number) {
  if (!canManage.value) return false;
  if (ctxKind.value === "category") {
    return !!props.messenger.neighborCategory?.(roomId.value, ctxId.value, direction);
  }
  return !!props.messenger.neighborChannel?.(roomId.value, ctxId.value, direction);
}

function moveCtx(direction: number) {
  if (ctxKind.value === "category") {
    props.messenger.moveCategory?.(roomId.value, ctxId.value, direction);
  } else {
    props.messenger.moveChannel?.(roomId.value, ctxId.value, direction);
  }
  closeCtx();
}

function onDocumentClick() {
  closeCtx();
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <aside class="chanpanel" :aria-label="t('channels.panelLabel')" @touchstart="onPanelTouchStart" @touchend="onPanelTouchEnd">
    <header class="chanpanel__head chanpanel__head--clickable" :title="t('channels.serverMenu')" @click="onHeadClick">
      <button class="icon-btn chanpanel__back" type="button" :aria-label="t('channels.back')" @click.stop="emit('back')">
        <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <span class="chanpanel__title">{{ serverName }}</span>
      <button v-if="canManage" class="icon-btn" type="button"
        :title="t('channels.createChannel')" :aria-label="t('channels.createChannel')" @click.stop="openCreate()">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </header>

    <div class="chanpanel__list">
      <div v-for="group in grouped" :key="group.id || 'none'" class="chanpanel__group">
        <div
          v-if="group.name" class="chanpanel__cat"
          :class="{ 'is-drop-target': dropCategoryId === group.id }"
          @contextmenu="onCategoryContext($event, group.id)"
          @dragover="onCatDragOver($event, group.id)"
          @drop="onDropOnCategory($event, group.id)"
        >
          <span>{{ group.name }}</span>
          <button v-if="canManage" class="icon-btn chanpanel__cat-add" type="button"
            :title="t('channels.createInCategory')" :aria-label="t('channels.createInCategory')" @click="openCreate(group.id)">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        <template v-for="ch in group.channels" :key="ch.id">
        <button
          class="chanpanel__row"
          :class="{
            'is-active': ch.id === activeChannelId && ch.kind !== 'voice',
            'is-voice': ch.kind === 'voice',
            'is-live': isLiveVoice(ch.id),
            'is-dragging': dragChannelId === ch.id,
            'is-drop-before': dropTarget?.id === ch.id && dropTarget.before,
            'is-drop-after': dropTarget?.id === ch.id && !dropTarget.before,
          }"
          type="button"
          :draggable="desktopDnd && canManage"
          @click="openChannel(ch.id)"
          @contextmenu="onChannelContext($event, ch.id)"
          @dragstart="onDragStart($event, ch.id)"
          @dragend="onDragEnd"
          @dragover="onRowDragOver($event, ch.id)"
          @drop="onDropOnRow($event, ch.id)">
          <span v-if="ch.kind === 'voice'" class="chanpanel__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
          </span>
          <span v-else-if="ch.kind === 'announce'" class="chanpanel__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
          </span>
          <span v-else class="chanpanel__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17" /></svg>
          </span>
          <span class="chanpanel__name" :title="ch.topic || ch.name">{{ ch.name }}</span>
          <template v-if="ch.kind === 'voice' && voiceMembers(ch.id).length">
            <span class="chanpanel__voice-count">{{ voiceMembers(ch.id).length }}</span>
            <span role="button" tabindex="0" class="chanpanel__voice-toggle"
              :class="{ 'is-expanded': isVoiceExpanded(ch.id) }"
              :aria-label="t('channels.toggleVoiceMembers')"
              :aria-expanded="isVoiceExpanded(ch.id)"
              @click.stop="toggleVoiceExpand(ch.id)"
              @keydown.enter.stop.prevent="toggleVoiceExpand(ch.id)"
              @keydown.space.stop.prevent="toggleVoiceExpand(ch.id)">
              <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
            </span>
          </template>
          <span v-if="isLiveVoice(ch.id)" class="chanpanel__live">{{ t("channels.live") }}</span>
          <span v-else-if="channelUnread(ch.id) > 0" class="chanpanel__badge">
            {{ channelUnread(ch.id) > 99 ? "99+" : channelUnread(ch.id) }}
          </span>
          <span v-if="ch.kind === 'announce' && !canSpeak(ch.id)" class="chanpanel__lock" :title="t('channels.readOnly')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </span>
        </button>
        <!-- Voice member sub-rows -->
        <div v-if="ch.kind === 'voice' && voiceMembers(ch.id).length && isVoiceExpanded(ch.id)" class="chanpanel__voice-users">
          <div v-for="member in voiceMembers(ch.id)" :key="member"
            class="chanpanel__voice-member"
            :title="member"
            @click="openChannel(ch.id)">
            <span v-if="voiceAvatarSrc(member)" class="chanpanel__voice-avatar chanpanel__voice-avatar--image">
              <img :src="voiceAvatarSrc(member)" alt="" />
            </span>
            <span v-else class="chanpanel__voice-avatar" :class="`avatar--${accentForUser(member)}`">
              {{ initialsFor(member) }}
            </span>
            <span class="chanpanel__voice-name">{{ displayUsername(member) }}</span>
            <span v-if="voiceMuted(member)" class="chanpanel__voice-muted" :title="t('members.muted')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
            </span>
          </div>
        </div>
        </template>
      </div>
    </div>

    <CreateChannelModal :messenger="messenger" :open="createOpen" :room-id="roomId"
      :channel="editChannel" :preset-category-id="createPresetCategory" @close="createOpen = false" />

    <Teleport to="body">
      <div v-if="ctxOpen" class="room-context-backdrop" @click="closeCtx">
        <div ref="ctxMenuRef" class="room-context context-menu-base" role="menu"
          :style="{ left: `${ctxPos.x}px`, top: `${ctxPos.y}px` }" @click.stop>
          <template v-if="ctxKind === 'category'">
            <button type="button" role="menuitem" @click="createChannelHere">
              <span>{{ t("channels.menuCreateChannelHere") }}</span>
            </button>
            <button type="button" role="menuitem" @click="renameCategoryFromCtx">
              <span>{{ t("channels.menuRenameCategory") }}</span>
            </button>
            <button v-if="canMoveCtx(-1)" type="button" role="menuitem" @click="moveCtx(-1)">
              <span>{{ t("channels.menuMoveUp") }}</span>
            </button>
            <button v-if="canMoveCtx(1)" type="button" role="menuitem" @click="moveCtx(1)">
              <span>{{ t("channels.menuMoveDown") }}</span>
            </button>
            <button class="room-context__danger context-menu-danger" type="button" role="menuitem"
              @click="deleteCategoryFromCtx">
              <span>{{ t("channels.menuDeleteCategory") }}</span>
            </button>
          </template>
          <template v-else>
            <button type="button" role="menuitem" @click="editFromCtx">
              <span>{{ t("channels.menuEdit") }}</span>
            </button>
            <button v-if="canMoveCtx(-1)" type="button" role="menuitem" @click="moveCtx(-1)">
              <span>{{ t("channels.menuMoveUp") }}</span>
            </button>
            <button v-if="canMoveCtx(1)" type="button" role="menuitem" @click="moveCtx(1)">
              <span>{{ t("channels.menuMoveDown") }}</span>
            </button>
            <button type="button" role="menuitem" @click="createCategory">
              <span>{{ t("channels.menuCreateCategory") }}</span>
            </button>
            <button class="room-context__danger context-menu-danger" type="button" role="menuitem"
              @click="deleteFromCtx">
              <span>{{ t("channels.menuDelete") }}</span>
            </button>
          </template>
          <div class="room-context__separator" aria-hidden="true"></div>
          <button type="button" class="room-context__cancel" role="menuitem" @click="closeCtx">
            <span>{{ t("message.cancel") }}</span>
          </button>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.chanpanel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: color-mix(in srgb, var(--surface) 88%, black 12%);
  border-right: 1px solid var(--line);
}
.chanpanel__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 10px 10px;
  border-bottom: 1px solid var(--line);
  min-height: 57px;
}
.chanpanel__head--clickable {
  cursor: pointer;
  border-radius: 0;
  transition: background 120ms ease;
}
.chanpanel__head--clickable:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.chanpanel__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chanpanel__back {
  display: none;
}
.chanpanel__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chanpanel__group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.chanpanel__cat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 4px 4px 2px;
}
.chanpanel__cat-add {
  width: 20px;
  height: 20px;
}
.chanpanel__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
}
.chanpanel__row:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text);
}
.chanpanel__row.is-active {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
  font-weight: 700;
}
.chanpanel__row.is-live {
  color: #22c55e;
}
.chanpanel__row[draggable="true"] {
  cursor: grab;
}
.chanpanel__row[draggable="true"]:active {
  cursor: grabbing;
}
.chanpanel__row.is-dragging {
  opacity: 0.4;
}
.chanpanel__row.is-drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}
.chanpanel__row.is-drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.chanpanel__cat.is-drop-target {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 8px;
}
.chanpanel__icon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.chanpanel__icon svg {
  width: 16px;
  height: 16px;
}
.chanpanel__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chanpanel__badge {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #f04747;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}
.chanpanel__live {
  flex: none;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: color-mix(in srgb, #22c55e 25%, transparent);
  color: #22c55e;
  border-radius: 999px;
  padding: 2px 8px;
}
.chanpanel__lock {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  opacity: 0.8;
}
.chanpanel__lock svg {
  width: 13px;
  height: 13px;
}

/* Voice channel member sub-rows (Discord-style) */
.chanpanel__voice-count {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  margin-left: 2px;
}
.chanpanel__voice-toggle {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
  transition: transform 0.15s ease;
}
.chanpanel__voice-toggle:hover,
.chanpanel__voice-toggle:focus-visible {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  outline: none;
}
.chanpanel__voice-toggle svg {
  width: 14px;
  height: 14px;
}
.chanpanel__voice-toggle.is-expanded {
  transform: rotate(90deg);
}

.chanpanel__voice-member {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 9px 4px 38px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}
.chanpanel__voice-member:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--text);
}
.chanpanel__voice-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-size: 10px;
  font-weight: 700;
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  color: var(--text);
}
.chanpanel__voice-avatar.avatar--emerald { background: color-mix(in srgb, #22c55e 25%, transparent); color: #22c55e; }
.chanpanel__voice-avatar.avatar--rose { background: color-mix(in srgb, #f43f5e 25%, transparent); color: #f43f5e; }
.chanpanel__voice-avatar.avatar--amber { background: color-mix(in srgb, #f59e0b 25%, transparent); color: #f59e0b; }
.chanpanel__voice-avatar.avatar--sky { background: color-mix(in srgb, #0ea5e9 25%, transparent); color: #0ea5e9; }
.chanpanel__voice-avatar.avatar--violet { background: color-mix(in srgb, #8b5cf6 25%, transparent); color: #8b5cf6; }
.chanpanel__voice-avatar--image {
  overflow: hidden;
  background: transparent;
}
.chanpanel__voice-avatar--image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.chanpanel__voice-muted {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--red);
}
.chanpanel__voice-muted svg {
  width: 14px;
  height: 14px;
}
.chanpanel__voice-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .chanpanel__back {
    display: inline-flex;
  }
}

/* ===== Channel context menu ===== */
/* Mêmes classes que .room-context, mais le style scopé de MessengerSidebar
   ne s'applique pas ici (autre data-v-*) : base desktop + bottom sheet. */
.room-context {
  z-index: 120;
}

.room-context__separator,
.room-context__cancel {
  display: none;
}

.room-context button {
  display: flex;
  align-items: center;
  gap: 10px;
}

.room-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 115;
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .room-context-backdrop {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: chanpanel-ctx-backdrop-in 160ms ease-out;
  }

  .room-context {
    left: 0 !important;
    right: 0;
    bottom: 0;
    top: auto !important;
    width: 100% !important;
    max-width: 100% !important;
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
    animation: chanpanel-ctx-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .room-context::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .room-context button {
    display: flex;
    align-items: center;
    min-height: 50px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    padding: 0 18px;
    gap: 14px;
    width: 100%;
    text-align: left;
    transition: background 120ms ease;
  }

  .room-context button:hover,
  .room-context button:focus-visible {
    background: var(--surface-hover);
  }

  .room-context button:active {
    background: var(--surface-active);
  }

  .room-context__separator {
    display: block;
    height: 1px;
    margin: 4px 18px;
    background: var(--line);
    flex: none;
  }

  .room-context__cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
    font-weight: 700;
    color: var(--muted) !important;
    margin-top: 2px;
  }

  .room-context__cancel:hover,
  .room-context__cancel:focus-visible {
    color: var(--text) !important;
    background: var(--surface-hover) !important;
  }
}

@keyframes chanpanel-ctx-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes chanpanel-ctx-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
