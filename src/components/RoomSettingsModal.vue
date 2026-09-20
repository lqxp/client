<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import ImageCropModal from "@/components/ImageCropModal.vue";
import CreateChannelModal from "@/components/CreateChannelModal.vue";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = useDialog();

const props = defineProps({
  messenger: { type: Object, required: true },
  open: { type: Boolean, default: false },
  roomId: { type: String, default: "" }
});
const emit = defineEmits(["close"]);

const name = ref("");
const description = ref("");
const chatLocked = ref(false);
const callsEnabled = ref(true);
const avatarPreview = ref("");
const avatarFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const crop = ref<{ open: boolean; src: string; mimeType: string } | null>(null);
const busy = ref(false);

const activeSection = ref("general");
const mobileSectionOpen = ref(false);

const permissions = ref({
  canBan: true,
  canKick: true,
  canMute: true,
  canDelete: true
});

const banned = computed(() => props.messenger.bannedMembers?.(props.roomId) || []);
const canConfigurePermissions = computed(() => props.messenger.canConfigureModeratorPermissions?.(props.roomId) === true);
const isCommunity = computed(() => props.messenger.isCommunityRoom?.(props.roomId) === true);
const channels = computed(() => props.messenger.serverChannels?.(props.roomId) || []);
const categories = computed(() => props.messenger.serverCategories?.(props.roomId) || []);
const serverAvatar = computed(() => props.messenger.roomIcon?.(props.roomId) || avatarPreview.value || "");
const serverTitle = computed(() => props.messenger.displayRoomName?.(props.roomId) || name.value || props.roomId);
const myUsername = computed(() => String(props.messenger.state.username || ""));
const isOwner = computed(() => props.messenger.isRoomOwner?.(props.roomId) === true);
const canManage = computed(() => props.messenger.canManageRoom?.(props.roomId) === true);
const ownerId = computed(() => String(props.messenger.roomOwnerId?.(props.roomId) || ""));

const channelCreateOpen = ref(false);
const channelCreatePreset = ref("");
const channelEdit = ref<any | null>(null);

const savedName = ref("");
const savedDescription = ref("");
const nameDirty = computed(() => name.value.trim() !== savedName.value.trim());
const descriptionDirty = computed(() => description.value.trim() !== savedDescription.value.trim());
const descriptionCount = computed(() => description.value.trim().length);

function roleOf(username: string) {
  return props.messenger.roleForUsername?.(props.roomId, username) || "member";
}

function userIdOf(username: string) {
  return String(props.messenger.userIdForUsername?.(username) || "");
}

function isSelf(username: string) {
  return !!username && username === myUsername.value;
}

function isUserOwner(username: string) {
  const id = userIdOf(username);
  return !!id && !!ownerId.value && id === ownerId.value;
}

const roleGroups = computed(() => {
  const buckets: Record<string, string[]> = {
    administrator: [],
    subAdmin: [],
    moderator: [],
    member: [],
  };
  const roster = [...(props.messenger.memberRoster?.value || [])].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
  for (const username of roster) {
    const role = roleOf(username);
    (buckets[role] || buckets.member).push(username);
  }
  // Le propriétaire toujours en tête des administrateurs.
  buckets.administrator.sort((a, b) => Number(isUserOwner(b)) - Number(isUserOwner(a)));
  return [
    { id: "administrator", label: t("rooms.roleAdmin"), desc: t("rooms.roleDescAdmin"), members: buckets.administrator },
    { id: "subAdmin", label: t("rooms.roleSubAdmin"), desc: t("rooms.roleDescSubAdmin"), members: buckets.subAdmin },
    { id: "moderator", label: t("rooms.roleModerator"), desc: t("rooms.roleDescModerator"), members: buckets.moderator },
    { id: "member", label: t("rooms.roleMember"), desc: t("rooms.roleDescMember"), members: buckets.member },
  ];
});

const channelGroups = computed(() => {
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

const sections = computed(() => [
  {
    group: t("rooms.groupServer"),
    items: [
      { id: "general", label: t("rooms.sectionGeneral"), icon: "general", count: 0 },
      ...(isCommunity.value
        ? [{ id: "channels", label: t("rooms.sectionChannels"), icon: "channels", count: channels.value.length }]
        : []),
    ],
  },
  {
    group: t("rooms.groupModeration"),
    items: [
      ...(isCommunity.value
        ? [{ id: "roles", label: t("rooms.sectionRoles"), icon: "roles", count: 0 }]
        : []),
      { id: "moderation", label: t("rooms.sectionModeration"), icon: "moderation", count: 0 },
      { id: "banned", label: t("rooms.sectionBanned"), icon: "banned", count: banned.value.length },
    ],
  },
]);

const activeSectionLabel = computed(() => {
  for (const group of sections.value) {
    const found = group.items.find((section) => section.id === activeSection.value);
    if (found) return found.label;
  }
  return "";
});

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    name.value = props.messenger.displayRoomName?.(props.roomId) || props.roomId;
    savedName.value = name.value;
    description.value = props.messenger.roomDescription?.(props.roomId) || "";
    savedDescription.value = description.value;
    chatLocked.value = props.messenger.roomChatLocked?.(props.roomId) === true;
    callsEnabled.value = props.messenger.roomCallsEnabled?.(props.roomId) !== false;
    avatarPreview.value = props.messenger.roomIcon?.(props.roomId) || "";
    avatarFile.value = null;
    activeSection.value = "general";
    mobileSectionOpen.value = false;
    channelCreateOpen.value = false;
    channelEdit.value = null;
    const perms = props.messenger.roomModPermissions?.(props.roomId) || {};
    permissions.value = {
      canBan: perms.canBan !== false,
      canKick: perms.canKick !== false,
      canMute: perms.canMute !== false,
      canDelete: perms.canDelete !== false
    };
  }
);

function close() {
  if (busy.value) return;
  emit("close");
}

function selectSection(sectionId: string) {
  activeSection.value = sectionId;
  mobileSectionOpen.value = true;
}

function backToList() {
  mobileSectionOpen.value = false;
}

function saveName() {
  if (!nameDirty.value || !name.value.trim()) return;
  props.messenger.setLocalRoomName?.(props.roomId, name.value);
  savedName.value = name.value;
}

function saveDescription() {
  if (!descriptionDirty.value) return;
  props.messenger.updateRoomDescription?.(props.roomId, description.value);
  savedDescription.value = description.value;
}

function toggleChatLock() {
  chatLocked.value = !chatLocked.value;
  props.messenger.setChatLocked?.(props.roomId, chatLocked.value);
}

function toggleCalls() {
  callsEnabled.value = !callsEnabled.value;
  props.messenger.setCallsEnabled?.(props.roomId, callsEnabled.value);
}

function setPermission(key: "canBan" | "canKick" | "canMute" | "canDelete", value: boolean) {
  permissions.value[key] = value;
  props.messenger.setModeratorPermissions?.(props.roomId, permissions.value);
}

function pickAvatar() {
  fileInputRef.value?.click();
}

function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] || null;
  if (!file) return;
  if (input) input.value = "";
  openCrop(file);
}

function openCrop(file: File) {
  if (file.type && !String(file.type).startsWith("image/")) {
    props.messenger.state.lastError = t("rooms.avatarMustBeImage");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  if (Number(file.size) > 5 * 1024 * 1024) {
    props.messenger.state.lastError = t("rooms.avatarTooLarge");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  crop.value = {
    open: true,
    src: URL.createObjectURL(file),
    mimeType: String(file.type || "")
  };
}

function onCropCancel() {
  if (crop.value?.src) URL.revokeObjectURL(crop.value.src);
  crop.value = null;
}

async function onCropConfirm(file: File) {
  const src = crop.value?.src;
  crop.value = null;
  if (src) URL.revokeObjectURL(src);
  avatarFile.value = file;
  avatarPreview.value = URL.createObjectURL(file);
  busy.value = true;
  await props.messenger.setLocalRoomIconFromFile?.(props.roomId, file);
  busy.value = false;
}

function unban(userId: string) {
  props.messenger.unbanMember?.(props.roomId, userId);
}

function promoteMember(username: string, role: "moderator" | "subAdmin") {
  const id = userIdOf(username);
  if (!id || isSelf(username)) return;
  props.messenger.setMemberRole?.(props.roomId, id, role);
}

function demoteMember(username: string) {
  const id = userIdOf(username);
  if (!id || isSelf(username)) return;
  props.messenger.setMemberRole?.(props.roomId, id, "member");
}

async function transferTo(username: string) {
  const id = userIdOf(username);
  if (!id || isSelf(username)) return;
  const ok = await dialog.showConfirm(t("rooms.transferConfirm", { name: username }));
  if (!ok) return;
  props.messenger.transferOwnership?.(props.roomId, id);
}

function channelKindLabel(kind: string) {
  if (kind === "voice") return t("channels.typeVoice");
  if (kind === "announce") return t("channels.typeAnnounce");
  return t("channels.typeText");
}

function openChannelCreate(presetCategoryId = "") {
  channelCreatePreset.value = presetCategoryId;
  channelEdit.value = null;
  channelCreateOpen.value = true;
}

function openChannelEdit(channel: any) {
  if (!channel) return;
  channelCreatePreset.value = "";
  channelEdit.value = channel;
  channelCreateOpen.value = true;
}

async function askDeleteChannel(channelId: string, name: string) {
  const ok = await dialog.showConfirm(t("channels.menuDeleteConfirm", { name }));
  if (!ok) return;
  props.messenger.deleteChannel?.(props.roomId, channelId);
}

async function askNewCategory() {
  const next = await dialog.showPrompt(t("channels.menuCategoryName"), "");
  if (next === null) return;
  const err = props.messenger.validateCategoryName?.(next);
  if (err) {
    props.messenger.state.lastError = err;
    props.messenger.showToast?.(err);
    return;
  }
  props.messenger.createCategory?.(props.roomId, String(next).trim());
}

async function askRenameCategory(categoryId: string, currentName: string) {
  const next = await dialog.showPrompt(t("channels.menuRenameCategoryPrompt"), currentName || "");
  if (next === null) return;
  const err = props.messenger.validateCategoryName?.(next);
  if (err) {
    props.messenger.state.lastError = err;
    props.messenger.showToast?.(err);
    return;
  }
  props.messenger.renameCategory?.(props.roomId, categoryId, String(next).trim());
}

async function askDeleteCategory(categoryId: string, name: string) {
  const ok = await dialog.showConfirm(t("channels.menuDeleteCategoryConfirm", { name }));
  if (!ok) return;
  props.messenger.deleteCategory?.(props.roomId, categoryId);
}

function channelNeighbor(channelId: string, direction: number) {
  return props.messenger.neighborChannel?.(props.roomId, channelId, direction) || null;
}

function moveChannelRow(channelId: string, direction: number) {
  props.messenger.moveChannel?.(props.roomId, channelId, direction);
}

function categoryNeighbor(categoryId: string, direction: number) {
  return props.messenger.neighborCategory?.(props.roomId, categoryId, direction) || null;
}

function moveCategoryRow(categoryId: string, direction: number) {
  props.messenger.moveCategory?.(props.roomId, categoryId, direction);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="room-settings-backdrop" @click.self="close">
      <div
        class="room-settings"
        :class="{ 'room-settings--section-open': mobileSectionOpen }"
        role="dialog"
        :aria-label="t('rooms.settings')"
      >
        <aside class="room-settings__side">
          <header class="room-settings__side-head">
            <h2 class="room-settings__title">{{ t('rooms.settings') }}</h2>
            <button class="icon-btn" type="button" :aria-label="t('message.cancel')" @click="close">
              <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>

          <div class="room-settings__server">
            <span class="avatar avatar--md room-settings__server-avatar">
              <img v-if="serverAvatar" :src="serverAvatar" alt="" />
              <template v-else>{{ String(serverTitle || "?").trim().slice(0, 2).toUpperCase() }}</template>
            </span>
            <strong class="room-settings__server-name">{{ serverTitle }}</strong>
          </div>

          <nav class="room-settings__nav" aria-label="Room settings sections">
            <template v-for="group in sections" :key="group.group">
              <div class="room-settings__nav-group">{{ group.group }}</div>
              <button
                v-for="section in group.items"
                :key="section.id"
                type="button"
                class="room-settings__nav-item"
                :class="{ 'is-active': activeSection === section.id }"
                @click="selectSection(section.id)"
              >
                <svg v-if="section.icon === 'general'" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
                <svg v-else-if="section.icon === 'channels'" viewBox="0 0 24 24">
                  <path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17" />
                </svg>
                <svg v-else-if="section.icon === 'roles'" viewBox="0 0 24 24">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M19 8v6M16 11h6" />
                </svg>
                <svg v-else-if="section.icon === 'moderation'" viewBox="0 0 24 24">
                  <path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 9.5 4.1-1.2 7-5.1 7-9.5V6l-7-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <svg v-else viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                <span>{{ section.label }}</span>
                <span v-if="section.count" class="room-settings__nav-count">{{ section.count > 99 ? "99+" : section.count }}</span>
              </button>
            </template>
          </nav>
        </aside>

        <main class="room-settings__main">
          <header class="room-settings__main-head">
            <button class="icon-btn room-settings__back" type="button" :aria-label="t('rooms.back')" @click="backToList">
              <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <h3 class="room-settings__section-title">{{ activeSectionLabel }}</h3>
          </header>

          <section v-if="activeSection === 'general'" class="room-settings-page">
            <div class="room-settings__field">
              <label class="room-settings__label" for="room-settings-name">{{ t('rooms.name') }}</label>
              <div class="room-settings__row">
                <input id="room-settings-name" v-model="name" type="text" maxlength="64" autocomplete="off" />
                <button type="button" class="btn--ghost" :disabled="!nameDirty || !name.trim()" @click="saveName">{{ t('rooms.save') }}</button>
              </div>
            </div>

            <div class="room-settings__field">
              <span class="room-settings__label">{{ t('rooms.avatar') }}</span>
              <div class="room-settings__avatar-row">
                <button type="button" class="avatar avatar--lg room-settings__avatar" :disabled="busy" @click="pickAvatar" :aria-label="t('rooms.chooseAvatar')">
                  <img v-if="avatarPreview" :src="avatarPreview" alt="" />
                  <template v-else>+</template>
                </button>
                <button type="button" class="btn--ghost" :disabled="busy" @click="pickAvatar">{{ busy ? "…" : t('rooms.chooseAvatar') }}</button>
              </div>
              <input ref="fileInputRef" type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" class="room-settings__file-input" @change="onAvatarChange" />
            </div>

            <div class="room-settings__field">
              <label class="room-settings__label" for="room-settings-description">{{ t('rooms.description') }}</label>
              <textarea id="room-settings-description" v-model="description" rows="4" maxlength="140" :placeholder="t('rooms.descriptionPlaceholder')"></textarea>
              <div class="room-settings__actions">
                <span class="room-settings__counter">{{ descriptionCount }} / 140</span>
                <button type="button" class="btn--ghost" :disabled="!descriptionDirty" @click="saveDescription">{{ t('rooms.save') }}</button>
              </div>
            </div>
          </section>

          <section v-else-if="activeSection === 'channels'" class="room-settings-page">
            <div class="room-settings__field">
              <span class="room-settings__label">{{ t('rooms.channelsRules') }}</span>
              <div class="room-settings__actions" style="margin-bottom: 8px">
                <button type="button" class="btn--ghost" @click="() => openChannelCreate()">{{ t('rooms.addChannel') }}</button>
                <button type="button" class="btn--ghost" @click="askNewCategory">{{ t('rooms.addCategory') }}</button>
              </div>
              <div v-for="group in channelGroups" :key="group.id || 'none'" class="room-settings__chan-group">
                <div v-if="group.id" class="room-settings__chan-cat">
                  <span>{{ group.name }}</span>
                  <span class="room-settings__chan-cat-actions">
                    <button type="button" class="btn--ghost btn--xs" :disabled="!categoryNeighbor(group.id, -1)" :aria-label="t('channels.menuMoveUp')" @click="moveCategoryRow(group.id, -1)">↑</button>
                    <button type="button" class="btn--ghost btn--xs" :disabled="!categoryNeighbor(group.id, 1)" :aria-label="t('channels.menuMoveDown')" @click="moveCategoryRow(group.id, 1)">↓</button>
                    <button type="button" class="btn--ghost btn--xs" @click="askRenameCategory(group.id, group.name)">{{ t('channels.menuRenameCategory') }}</button>
                    <button type="button" class="btn--ghost btn--xs btn--danger" @click="askDeleteCategory(group.id, group.name)">{{ t('channels.menuDeleteCategory') }}</button>
                  </span>
                </div>
                <div v-else-if="group.channels.length" class="room-settings__chan-cat">
                  <span>{{ t('rooms.noCategoryLabel') }}</span>
                </div>
                <div v-if="group.channels.length" class="room-settings__banned">
                  <div v-for="ch in group.channels" :key="ch.id" class="room-settings__banned-row">
                    <span class="room-settings__banned-name room-settings__channel">
                      <svg v-if="ch.kind === 'voice'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
                      <svg v-else-if="ch.kind === 'announce'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
                      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17" /></svg>
                      <span>{{ ch.name }} <small>({{ channelKindLabel(ch.kind) }})</small></span>
                    </span>
                    <span class="room-settings__row-actions">
                      <button type="button" class="btn--ghost btn--xs" :disabled="!channelNeighbor(ch.id, -1)" :aria-label="t('channels.menuMoveUp')" @click="moveChannelRow(ch.id, -1)">↑</button>
                      <button type="button" class="btn--ghost btn--xs" :disabled="!channelNeighbor(ch.id, 1)" :aria-label="t('channels.menuMoveDown')" @click="moveChannelRow(ch.id, 1)">↓</button>
                      <button type="button" class="btn--ghost btn--xs" @click="openChannelEdit(ch)">{{ t('channels.menuEdit') }}</button>
                      <button type="button" class="btn--ghost btn--xs btn--danger" @click="askDeleteChannel(ch.id, ch.name)">{{ t('channels.menuDelete') }}</button>
                    </span>
                  </div>
                </div>
              </div>
              <div v-if="!channels.length" class="room-settings__empty">{{ t('rooms.noChannels') }}</div>
              <div class="room-settings__hint">{{ t('rooms.channelsHint') }}</div>
            </div>

            <CreateChannelModal
              :messenger="messenger"
              :open="channelCreateOpen"
              :room-id="props.roomId"
              :channel="channelEdit"
              :preset-category-id="channelCreatePreset"
              @close="channelCreateOpen = false"
            />
          </section>

          <section v-else-if="activeSection === 'roles'" class="room-settings-page">
            <p class="room-settings__hint">{{ t('rooms.rolesHint') }}</p>
            <div v-for="group in roleGroups" :key="group.id" class="room-settings__role">
              <header class="room-settings__role-head">
                <strong>{{ group.label }}</strong>
                <span class="room-settings__nav-count">{{ group.members.length }}</span>
              </header>
              <p class="room-settings__role-desc">{{ group.desc }}</p>
              <div v-if="group.members.length" class="room-settings__banned">
                <div v-for="username in group.members" :key="username" class="room-settings__banned-row">
                  <span class="room-settings__banned-name">
                    @{{ username }}
                    <span v-if="isUserOwner(username)" class="room-settings__mini-badge is-owner">{{ t('rooms.ownerBadge') }}</span>
                    <span v-else-if="isSelf(username)" class="room-settings__mini-badge">{{ t('rooms.youBadge') }}</span>
                  </span>
                  <span v-if="canManage && !isSelf(username) && group.id !== 'administrator'" class="room-settings__row-actions">
                    <button
                      v-if="group.id === 'member'"
                      type="button" class="btn--ghost btn--xs" @click="promoteMember(username, 'moderator')"
                    >{{ t('rooms.promoteModerator') }}</button>
                    <button
                      v-if="group.id === 'member' || group.id === 'moderator'"
                      type="button" class="btn--ghost btn--xs" @click="promoteMember(username, 'subAdmin')"
                    >{{ t('rooms.promoteSubAdmin') }}</button>
                    <button
                      v-if="group.id === 'moderator' || group.id === 'subAdmin'"
                      type="button" class="btn--ghost btn--xs" @click="demoteMember(username)"
                    >{{ t('rooms.demote') }}</button>
                    <button
                      v-if="isOwner && (group.id === 'moderator' || group.id === 'subAdmin')"
                      type="button" class="btn--ghost btn--xs btn--danger" @click="transferTo(username)"
                    >{{ t('rooms.transferOwnership') }}</button>
                  </span>
                </div>
              </div>
              <div v-else class="room-settings__empty">{{ t('rooms.noMembersInRole') }}</div>
            </div>

            <div v-if="canConfigurePermissions" class="room-settings__field">
              <span class="room-settings__label">{{ t('rooms.moderatorPermissions') }}</span>
              <div class="room-settings__perms">
                <label class="room-settings__switch">
                  <input type="checkbox" :checked="permissions.canBan" @change="setPermission('canBan', ($event.target as HTMLInputElement).checked)" />
                  <span class="room-settings__switch-track"></span>
                  <span class="room-settings__switch-label">{{ t('rooms.permCanBan') }}</span>
                </label>
                <label class="room-settings__switch">
                  <input type="checkbox" :checked="permissions.canKick" @change="setPermission('canKick', ($event.target as HTMLInputElement).checked)" />
                  <span class="room-settings__switch-track"></span>
                  <span class="room-settings__switch-label">{{ t('rooms.permCanKick') }}</span>
                </label>
                <label class="room-settings__switch">
                  <input type="checkbox" :checked="permissions.canMute" @change="setPermission('canMute', ($event.target as HTMLInputElement).checked)" />
                  <span class="room-settings__switch-track"></span>
                  <span class="room-settings__switch-label">{{ t('rooms.permCanMute') }}</span>
                </label>
                <label class="room-settings__switch">
                  <input type="checkbox" :checked="permissions.canDelete" @change="setPermission('canDelete', ($event.target as HTMLInputElement).checked)" />
                  <span class="room-settings__switch-track"></span>
                  <span class="room-settings__switch-label">{{ t('rooms.permCanDelete') }}</span>
                </label>
              </div>
            </div>
          </section>

          <section v-else-if="activeSection === 'moderation'" class="room-settings-page">
            <div class="room-settings__field">
              <span class="room-settings__label">{{ t('rooms.chat') }}</span>
              <label class="room-settings__switch">
                <input type="checkbox" :checked="chatLocked" @change="toggleChatLock" />
                <span class="room-settings__switch-track"></span>
                <span class="room-settings__switch-label">{{ t('rooms.lockChat') }}</span>
              </label>
            </div>

            <div class="room-settings__field">
              <span class="room-settings__label">{{ t('rooms.calls') }}</span>
              <label class="room-settings__switch">
                <input type="checkbox" :checked="callsEnabled" @change="toggleCalls" />
                <span class="room-settings__switch-track"></span>
                <span class="room-settings__switch-label">{{ t('rooms.callsAllowLabel') }}</span>
              </label>
            </div>
          </section>

          <section v-else-if="activeSection === 'banned'" class="room-settings-page">
            <div class="room-settings__field">
              <span class="room-settings__label">{{ t('rooms.bannedMembers') }}</span>
              <div v-if="banned.length" class="room-settings__banned">
                <div v-for="entry in banned" :key="entry.userId" class="room-settings__banned-row">
                  <span class="room-settings__banned-name">@{{ entry.username }}</span>
                  <button type="button" class="btn--ghost" @click="unban(entry.userId)">{{ t('rooms.unban') }}</button>
                </div>
              </div>
              <div v-else class="room-settings__empty">{{ t('rooms.noBanned') }}</div>
            </div>
          </section>
        </main>
      </div>
    </div>
  </Teleport>

  <ImageCropModal
    :open="crop?.open || false"
    :src="crop?.src || ''"
    :title="t('crop.titleRoomIcon')"
    :aspect="1"
    :mime-type="crop?.mimeType || 'image/png'"
    :max-width="1024"
    :max-height="1024"
    @cancel="onCropCancel"
    @confirm="onCropConfirm"
  />
</template>

<style scoped>
.room-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(4px);
}

.room-settings {
  width: 100%;
  max-width: 900px;
  height: min(700px, calc(var(--app-viewport-height) - 48px));
  display: grid;
  grid-template-columns: 290px 1fr;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 20px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  font-family: var(--font);
}

.room-settings__side {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 22px 18px;
  background: var(--surface);
  border-right: 1px solid var(--line-strong);
}

.room-settings__side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 6px 22px;
}

.room-settings__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.room-settings__nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.room-settings__nav-item {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 46px;
  padding: 0 14px;
  border-radius: 12px;
  color: var(--text);
  font-size: 15px;
  text-align: left;
  min-width: 0;
}

.room-settings__nav-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-settings__nav-item svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: none;
}

.room-settings__nav-item:hover,
.room-settings__nav-item.is-active {
  background: rgba(255, 255, 255, 0.12);
}

.room-settings__nav-item span:first-of-type {
  flex: 1;
}

.room-settings__server {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-bottom: 18px;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.room-settings__server-avatar {
  flex: none;
  overflow: hidden;
}

.room-settings__server-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.room-settings__server-name {
  min-width: 0;
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-settings__nav-group {
  margin: 14px 6px 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.room-settings__nav-group:first-of-type {
  margin-top: 0;
}

.room-settings__nav-count {
  flex: none !important;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.room-settings__hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
}

.room-settings__counter {
  margin-right: auto;
  font-size: 11px;
  color: var(--muted);
}

.room-settings .btn--ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

.room-settings .btn--ghost.btn--xs {
  padding: 6px 10px;
  font-size: 12.5px;
  border-radius: 8px;
  white-space: nowrap;
}

.room-settings .btn--ghost.btn--danger {
  color: var(--red);
}

.room-settings .btn--ghost.btn--danger:hover {
  background: color-mix(in srgb, var(--red) 14%, transparent);
  color: var(--red);
}

.room-settings__row-actions {
  display: flex;
  gap: 6px;
  flex: none;
  margin-left: auto;
}

.room-settings__chan-group {
  margin-top: 14px;
}

.room-settings__chan-group:first-of-type {
  margin-top: 4px;
}

.room-settings__chan-cat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.room-settings__chan-cat > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-settings__chan-cat-actions {
  display: flex;
  gap: 6px;
  flex: none;
  text-transform: none;
  letter-spacing: 0;
}

.room-settings__role {
  margin-top: 16px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface-2);
}

.room-settings__role:first-of-type {
  margin-top: 4px;
}

.room-settings__role-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
}

.room-settings__role-desc {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
}

.room-settings__role .room-settings__banned {
  margin-top: 10px;
}

.room-settings__mini-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
  white-space: nowrap;
  vertical-align: 1px;
}

.room-settings__mini-badge.is-owner {
  background: color-mix(in srgb, #e4b231 30%, transparent);
  color: #e4b231;
}

.room-settings__main {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 26px clamp(24px, 5vw, 48px) 48px;
}

.room-settings__main-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}

.room-settings__section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.room-settings__back {
  display: none;
}

.room-settings-page {
  max-width: 560px;
  margin: 0 auto;
}

.room-settings__field {
  margin-top: 24px;
}

.room-settings__field:first-child {
  margin-top: 0;
}

.room-settings__label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.room-settings__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.room-settings input[type="text"],
.room-settings textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  padding: 11px 13px;
  font-size: 14px;
  resize: vertical;
}

.room-settings input[type="text"]:focus,
.room-settings textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.room-settings__actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.room-settings__avatar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.room-settings__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 22px;
  color: var(--muted);
  border: 0;
  padding: 0;
  font-family: inherit;
  cursor: pointer;
}

.room-settings__avatar:disabled {
  cursor: default;
}

.room-settings__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.room-settings__file-input {
  display: none;
}

.room-settings__switch {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  user-select: none;
  padding: 6px 0;
}

.room-settings__switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.room-settings__switch-track {
  position: relative;
  flex: none;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--line-strong);
  transition: background 140ms ease;
}

.room-settings__switch-track::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: transform 140ms ease;
}

.room-settings__switch input:checked + .room-settings__switch-track {
  background: var(--accent);
}

.room-settings__switch input:checked + .room-settings__switch-track::after {
  transform: translateX(18px);
}

.room-settings__switch-label {
  font-size: 14px;
  line-height: 1.4;
}

.room-settings__perms {
  display: grid;
  gap: 4px;
}

.room-settings__banned {
  display: grid;
  gap: 8px;
}

.room-settings__banned-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
}

.room-settings__banned-name {
  font-size: 14px;
}

.room-settings__channel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.room-settings__channel svg {
  width: 15px;
  height: 15px;
  color: var(--muted);
  flex: none;
}

.room-settings__empty {
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 700px) {
  .room-settings-backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: room-settings-backdrop-in 160ms ease-out;
  }

  .room-settings {
    display: flex;
    flex-direction: column;
    max-width: 100%;
    height: auto;
    max-height: 92vh;
    border: 0;
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding-bottom: max(18px, env(safe-area-inset-bottom));
    animation: room-settings-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
  }

  .room-settings::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 75%, var(--surface));
  }

  .room-settings__side {
    flex: none;
    border-right: 0;
    padding: 8px 18px 18px;
    overflow: visible;
  }

  .room-settings__side-head {
    padding: 0 6px 18px;
  }

  .room-settings__side-head .icon-btn,
  .room-settings__back {
    width: 44px;
    height: 44px;
  }

  .room-settings__title {
    font-size: 22px;
  }

  .room-settings__nav-item {
    height: 52px;
    padding: 0 16px;
    font-size: 16px;
  }

  .room-settings__main {
    flex: none;
    display: none;
    overflow: visible;
    padding: 8px 18px 18px;
  }

  .room-settings--section-open .room-settings__side {
    display: none;
  }

  .room-settings--section-open .room-settings__main {
    display: block;
  }

  .room-settings__back {
    display: inline-grid;
    place-items: center;
    flex: none;
  }

  .room-settings__section-title {
    font-size: 20px;
  }

  .room-settings input[type="text"],
  .room-settings textarea {
    font-size: 16px;
    padding: 14px 16px;
  }

  .room-settings__switch {
    min-height: 48px;
  }

  .room-settings__switch-track {
    width: 46px;
    height: 28px;
  }

  .room-settings__switch-track::after {
    top: 4px;
    left: 4px;
    width: 20px;
    height: 20px;
  }

  .room-settings__switch input:checked + .room-settings__switch-track::after {
    transform: translateX(18px);
  }

  .room-settings__switch-label {
    font-size: 15px;
  }

  .room-settings__row .btn--ghost {
    flex: none;
    height: 48px;
    padding: 0 16px;
  }

  .room-settings__banned-row {
    padding: 12px 14px;
  }

  .room-settings__banned-row .btn--ghost {
    min-height: 44px;
  }

  .room-settings__field {
    margin-top: 18px;
  }
}

@keyframes room-settings-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes room-settings-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
