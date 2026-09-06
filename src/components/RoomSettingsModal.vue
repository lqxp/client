<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import ImageCropModal from "@/components/ImageCropModal.vue";

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

const sections = computed(() => [
  { id: "general", label: t("rooms.sectionGeneral") },
  { id: "moderation", label: t("rooms.sectionModeration") },
  { id: "banned", label: t("rooms.sectionBanned") }
]);

const activeSectionLabel = computed(
  () => sections.value.find((section) => section.id === activeSection.value)?.label || ""
);

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
    activeSection.value = "general";
    mobileSectionOpen.value = false;
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
  props.messenger.setLocalRoomName?.(props.roomId, name.value);
}

function saveDescription() {
  props.messenger.updateRoomDescription?.(props.roomId, description.value);
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

          <nav class="room-settings__nav" aria-label="Room settings sections">
            <button
              v-for="section in sections"
              :key="section.id"
              type="button"
              class="room-settings__nav-item"
              :class="{ 'is-active': activeSection === section.id }"
              @click="selectSection(section.id)"
            >
              <svg v-if="section.id === 'general'" viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              <svg v-else-if="section.id === 'moderation'" viewBox="0 0 24 24">
                <path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 9.5 4.1-1.2 7-5.1 7-9.5V6l-7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <circle cx="9" cy="8" r="4" />
                <path d="M3 21a6 6 0 0 1 12 0M16 4l4 4M20 4l-4 4" />
              </svg>
              <span>{{ section.label }}</span>
            </button>
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
              <textarea id="room-settings-description" v-model="description" rows="4" maxlength="140" :placeholder="t('rooms.descriptionPlaceholder')"></textarea>
              <div class="room-settings__actions">
                <button type="button" class="btn--ghost" @click="saveDescription">{{ t('rooms.save') }}</button>
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
  height: min(700px, calc(100vh - 48px));
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
