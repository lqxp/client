<script setup lang="ts">
import { inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  open: { type: Boolean, default: false }
});
const emit = defineEmits(["close"]);

const roomType = ref("community");
const name = ref("");
const description = ref("");
const avatarFile = ref<File | null>(null);
const avatarPreview = ref("");
const busy = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const permissions = ref({
  canBan: true,
  canKick: true,
  canMute: true,
  canDelete: true
});

const descriptionLength = () => description.value.trim().length;

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    roomType.value = "community";
    name.value = "";
    description.value = "";
    avatarFile.value = null;
    avatarPreview.value = "";
    busy.value = false;
    permissions.value = { canBan: true, canKick: true, canMute: true, canDelete: true };
  }
);

function pickAvatar() {
  fileInputRef.value?.click();
}

function onAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] || null;
  if (file && !String(file.type || "").startsWith("image/")) {
    props.messenger.state.lastError = t("rooms.avatarMustBeImage");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  if (file && Number(file.size) > 5 * 1024 * 1024) {
    props.messenger.state.lastError = t("rooms.avatarTooLarge");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  avatarFile.value = file;
  avatarPreview.value = file ? URL.createObjectURL(file) : "";
  if (input) input.value = "";
}

function close() {
  if (busy.value) return;
  emit("close");
}

async function submit() {
  if (busy.value) return;
  if (roomType.value === "classic") {
    close();
    props.messenger.createRandomRoom();
    return;
  }

  busy.value = true;
  const result = await props.messenger.createCommunityRoom({
    title: name.value,
    description: description.value,
    file: avatarFile.value,
    modPermissions: permissions.value
  });
  busy.value = false;
  if (result) emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="create-room-backdrop" @click.self="close">
      <div class="create-room" role="dialog" :aria-label="t('rooms.createTitle')">
        <header class="create-room__head">
          <div>
            <h2 class="create-room__title">{{ t('rooms.createTitle') }}</h2>
            <p class="create-room__subtitle">{{ t('rooms.createSubtitle') }}</p>
          </div>
          <button class="icon-btn create-room__close" type="button" :aria-label="t('message.cancel')" @click="close">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="create-room__body">
          <div class="create-room__field create-room__field--type">
            <span class="create-room__label">{{ t('rooms.type') }}</span>
            <div class="create-room__segmented">
              <button
                type="button"
                class="create-room__segment"
                :class="{ 'is-active': roomType === 'community' }"
                @click="roomType = 'community'"
              >
                <strong>{{ t('rooms.typeCommunity') }}</strong>
                <small>{{ t('rooms.typeCommunityHint') }}</small>
              </button>
              <button
                type="button"
                class="create-room__segment"
                :class="{ 'is-active': roomType === 'classic' }"
                @click="roomType = 'classic'"
              >
                <strong>{{ t('rooms.typeClassic') }}</strong>
                <small>{{ t('rooms.typeClassicHint') }}</small>
              </button>
            </div>
          </div>

          <template v-if="roomType === 'community'">
            <div class="create-room__columns">
              <div class="create-room__col">
                <div class="create-room__field">
                  <label class="create-room__label" for="create-room-name">{{ t('rooms.name') }}</label>
                  <input
                    id="create-room-name"
                    v-model="name"
                    type="text"
                    maxlength="64"
                    :placeholder="t('rooms.namePlaceholder')"
                    autocomplete="off"
                  />
                </div>

                <div class="create-room__field">
                  <span class="create-room__label">{{ t('rooms.avatar') }}</span>
                  <div class="create-room__avatar-row">
                    <span class="avatar avatar--lg create-room__avatar">
                      <img v-if="avatarPreview" :src="avatarPreview" alt="" />
                      <template v-else>+</template>
                    </span>
                    <button type="button" class="create-room__btn create-room__btn--secondary" @click="pickAvatar">{{ t('rooms.chooseAvatar') }}</button>
                  </div>
                  <input
                    ref="fileInputRef"
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                    class="create-room__file-input"
                    @change="onAvatarChange"
                  />
                </div>

                <div class="create-room__field">
                  <label class="create-room__label" for="create-room-description">{{ t('rooms.description') }}</label>
                  <textarea
                    id="create-room-description"
                    v-model="description"
                    rows="4"
                    maxlength="140"
                    :placeholder="t('rooms.descriptionPlaceholder')"
                  ></textarea>
                  <div class="create-room__counter">{{ descriptionLength() }} / 140</div>
                </div>
              </div>

              <div class="create-room__col">
                <div class="create-room__field">
                  <span class="create-room__label">{{ t('rooms.moderatorPermissions') }}</span>
                  <div class="create-room__perms">
                    <label class="create-room__perm">
                      <input v-model="permissions.canBan" type="checkbox" />
                      <span>{{ t('rooms.permCanBan') }}</span>
                    </label>
                    <label class="create-room__perm">
                      <input v-model="permissions.canKick" type="checkbox" />
                      <span>{{ t('rooms.permCanKick') }}</span>
                    </label>
                    <label class="create-room__perm">
                      <input v-model="permissions.canMute" type="checkbox" />
                      <span>{{ t('rooms.permCanMute') }}</span>
                    </label>
                    <label class="create-room__perm">
                      <input v-model="permissions.canDelete" type="checkbox" />
                      <span>{{ t('rooms.permCanDelete') }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <p v-else class="create-room__note">{{ t('rooms.classicNote') }}</p>
        </div>

        <footer class="create-room__foot">
          <button type="button" class="create-room__btn create-room__btn--secondary" @click="close">{{ t('message.cancel') }}</button>
          <button type="button" class="create-room__btn create-room__btn--primary" :disabled="busy" @click="submit">
            {{ t('rooms.create') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.create-room-backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.create-room {
  width: 100%;
  max-width: 720px;
  max-height: calc(100vh - 56px);
  font-family: var(--font);
  overflow-y: auto;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
}

.create-room__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 28px 28px 6px;
}

.create-room__title {
  margin: 0;
  font-family: var(--font);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.create-room__subtitle {
  margin: 6px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--muted);
}

.create-room__close {
  flex: none;
}

.create-room__body {
  padding: 12px 28px 28px;
}

.create-room__field {
  margin-top: 22px;
}

.create-room__label {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}

.create-room__segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.create-room__columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
  margin-top: 22px;
}

.create-room__col {
  min-width: 0;
}

.create-room__col .create-room__field:first-child {
  margin-top: 0;
}

.create-room__segment {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}

.create-room__segment strong {
  font-size: 15px;
  font-weight: 600;
}

.create-room__segment small {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.45;
}

.create-room__segment.is-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.create-room input[type="text"],
.create-room textarea {
  width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  padding: 12px 14px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.create-room input[type="text"]:focus,
.create-room textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.create-room input[type="checkbox"] {
  accent-color: var(--accent);
}

.create-room__avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.create-room__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
  font-size: 24px;
  color: var(--muted);
  background: var(--surface-2);
}

.create-room__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.create-room__file-input {
  display: none;
}

.create-room__counter {
  margin-top: 6px;
  text-align: right;
  font-size: 11px;
  color: var(--muted);
}

.create-room__perms {
  display: grid;
  gap: 8px;
}

.create-room__perm {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--surface-2);
  font-size: 14px;
  cursor: pointer;
  transition: background 120ms ease;
}

.create-room__perm:hover {
  background: var(--surface-hover);
}

.create-room__note {
  margin-top: 20px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}

.create-room__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 28px 28px;
  border-top: 1px solid var(--line);
}

.create-room__btn {
  height: 40px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
}

.create-room__btn--secondary {
  background: transparent;
  color: var(--muted);
}

.create-room__btn--secondary:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.create-room__btn--primary {
  background: var(--accent);
  color: #fff;
}

.create-room__btn--primary:hover {
  background: color-mix(in srgb, var(--accent) 82%, #000 18%);
}

.create-room__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes create-room-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes create-room-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .create-room-backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
    animation: create-room-backdrop-in 160ms ease-out;
  }

  .create-room {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    padding-bottom: max(18px, env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    animation: create-room-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
  }

  .create-room::before {
    content: "";
    display: block;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .create-room__head {
    padding: 8px 18px 6px;
  }

  .create-room__title {
    font-size: 20px;
  }

  .create-room__body {
    padding: 10px 18px 18px;
  }

  .create-room__columns {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .create-room__field {
    margin-top: 18px;
  }

  .create-room input[type="text"],
  .create-room textarea {
    font-size: 16px;
    padding: 14px 16px;
  }

  .create-room__segment {
    padding: 16px;
  }

  .create-room__foot {
    padding: 12px 18px calc(12px + env(safe-area-inset-bottom));
  }

  .create-room__btn {
    flex: 1;
    height: 48px;
  }
}
</style>
