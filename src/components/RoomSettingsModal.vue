<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

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
const busy = ref(false);

const permissions = ref({
  canBan: true,
  canKick: true,
  canMute: true,
  canDelete: true
});

const banned = computed(() => props.messenger.bannedMembers?.(props.roomId) || []);
const canConfigurePermissions = computed(() => props.messenger.canConfigureModeratorPermissions?.(props.roomId) === true);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    name.value = props.messenger.displayRoomName?.(props.roomId) || props.roomId;
    description.value = props.messenger.roomDescription?.(props.roomId) || "";
    chatLocked.value = props.messenger.roomChatLocked?.(props.roomId) === true;
    callsEnabled.value = props.messenger.roomCallsEnabled?.(props.roomId) !== false;
    avatarPreview.value = props.messenger.roomIcon?.(props.roomId) || "";
    avatarFile.value = null;
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

function saveName() {
  props.messenger.setLocalRoomName?.(props.roomId, name.value);
}

function saveDescription() {
  props.messenger.updateRoomDescription?.(props.roomId, description.value);
}

function toggleChatLock() {
  props.messenger.setChatLocked?.(props.roomId, !chatLocked.value);
}

function toggleCalls() {
  props.messenger.setCallsEnabled?.(props.roomId, !callsEnabled.value);
}

function setPermission(key: "canBan" | "canKick" | "canMute" | "canDelete", value: boolean) {
  permissions.value[key] = value;
  props.messenger.setModeratorPermissions?.(props.roomId, permissions.value);
}

function pickAvatar() {
  fileInputRef.value?.click();
}

async function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] || null;
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    props.messenger.state.lastError = t("rooms.avatarMustBeImage");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  if (Number(file.size) > 5 * 1024 * 1024) {
    props.messenger.state.lastError = t("rooms.avatarTooLarge");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  avatarFile.value = file;
  avatarPreview.value = URL.createObjectURL(file);
  busy.value = true;
  await props.messenger.setLocalRoomIconFromFile?.(props.roomId, file);
  busy.value = false;
  if (input) input.value = "";
}

function unban(userId: string) {
  props.messenger.unbanMember?.(props.roomId, userId);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="room-settings-backdrop" @click.self="close">
      <div class="room-settings" role="dialog" :aria-label="t('rooms.settings')">
        <header class="room-settings__head">
          <h2 class="room-settings__title">{{ t('rooms.settings') }}</h2>
          <button class="icon-btn" type="button" :aria-label="t('message.cancel')" @click="close">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="room-settings__body">
          <div class="room-settings__field">
            <label class="room-settings__label" for="room-settings-name">{{ t('rooms.name') }}</label>
            <div class="room-settings__row">
              <input id="room-settings-name" v-model="name" type="text" maxlength="64" autocomplete="off" />
              <button type="button" class="btn--ghost" @click="saveName">{{ t('rooms.save') }}</button>
            </div>
          </div>

          <div class="room-settings__field">
            <span class="room-settings__label">{{ t('rooms.avatar') }}</span>
            <div class="room-settings__avatar-row">
              <span class="avatar avatar--lg room-settings__avatar">
                <img v-if="avatarPreview" :src="avatarPreview" alt="" />
                <template v-else>+</template>
              </span>
              <button type="button" class="btn--ghost" :disabled="busy" @click="pickAvatar">{{ t('rooms.chooseAvatar') }}</button>
            </div>
            <input ref="fileInputRef" type="file" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" class="room-settings__file-input" @change="onAvatarChange" />
          </div>

          <div class="room-settings__field">
            <label class="room-settings__label" for="room-settings-description">{{ t('rooms.description') }}</label>
            <textarea id="room-settings-description" v-model="description" rows="3" maxlength="140" :placeholder="t('rooms.descriptionPlaceholder')"></textarea>
            <div class="room-settings__actions">
              <button type="button" class="btn--ghost" @click="saveDescription">{{ t('rooms.save') }}</button>
            </div>
          </div>

          <div class="room-settings__field">
            <span class="room-settings__label">{{ t('rooms.chat') }}</span>
            <label class="room-settings__toggle">
              <input type="checkbox" :checked="chatLocked" @change="toggleChatLock" />
              <span>{{ chatLocked ? t('rooms.lockChat') : t('rooms.unlockChat') }}</span>
            </label>
          </div>

          <div class="room-settings__field">
            <span class="room-settings__label">{{ t('rooms.calls') }}</span>
            <label class="room-settings__toggle">
              <input type="checkbox" :checked="callsEnabled" @change="toggleCalls" />
              <span>{{ callsEnabled ? t('rooms.callsEnabled') : t('rooms.callsDisabled') }}</span>
            </label>
          </div>

          <div v-if="canConfigurePermissions" class="room-settings__field">
            <span class="room-settings__label">{{ t('rooms.moderatorPermissions') }}</span>
            <div class="room-settings__perms">
              <label class="room-settings__perm">
                <input type="checkbox" :checked="permissions.canBan" @change="setPermission('canBan', ($event.target as HTMLInputElement).checked)" />
                <span>{{ t('rooms.permCanBan') }}</span>
              </label>
              <label class="room-settings__perm">
                <input type="checkbox" :checked="permissions.canKick" @change="setPermission('canKick', ($event.target as HTMLInputElement).checked)" />
                <span>{{ t('rooms.permCanKick') }}</span>
              </label>
              <label class="room-settings__perm">
                <input type="checkbox" :checked="permissions.canMute" @change="setPermission('canMute', ($event.target as HTMLInputElement).checked)" />
                <span>{{ t('rooms.permCanMute') }}</span>
              </label>
              <label class="room-settings__perm">
                <input type="checkbox" :checked="permissions.canDelete" @change="setPermission('canDelete', ($event.target as HTMLInputElement).checked)" />
                <span>{{ t('rooms.permCanDelete') }}</span>
              </label>
            </div>
          </div>

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
        </div>

        <footer class="room-settings__foot">
          <button type="button" class="btn--ghost" @click="close">{{ t('message.cancel') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.room-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
}

.room-settings {
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}

.room-settings__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 12px;
}

.room-settings__title {
  margin: 0;
  font-size: 18px;
}

.room-settings__body {
  padding: 4px 20px 20px;
}

.room-settings__field {
  margin-top: 16px;
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
  gap: 8px;
}

.room-settings input[type="text"],
.room-settings textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  padding: 10px 12px;
  font-size: 14px;
  resize: vertical;
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

.room-settings__toggle,
.room-settings__perm {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.room-settings__perms {
  display: grid;
  gap: 8px;
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
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-2);
}

.room-settings__empty {
  font-size: 13px;
  color: var(--muted);
}

.room-settings__foot {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px 20px;
}
</style>
