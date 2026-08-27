<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps<{ messenger: any; phantom: any; open: boolean }>();
const emit = defineEmits(["close"]);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const tab = ref<"context" | "username" | "ghost">("context");
const username = ref("");
const roomId = ref("");
const intro = ref("");
const busy = ref(false);
const error = ref("");
const sent = ref(false);

const mutualRooms = computed(() => {
  if (!username.value.trim()) return [];
  return (props.messenger?.mutualRoomsWith?.(username.value.trim()) || []).slice(0, 8);
});

function reset() {
  tab.value = "context";
  username.value = "";
  roomId.value = "";
  intro.value = "";
  busy.value = false;
  error.value = "";
  sent.value = false;
}

watch(() => props.open, (isOpen) => {
  if (isOpen) reset();
});

watch(tab, () => {
  sent.value = false;
  error.value = "";
});

async function send() {
  if (busy.value) return;
  error.value = "";
  const name = username.value.trim();
  if (!name) {
    error.value = t("phantom.noRequests");
    return;
  }
  const own = String(props.messenger?.state?.username || "").trim().toLowerCase();
  if (name.toLowerCase() === own) {
    error.value = t("phantom.selfRequest");
    return;
  }
  busy.value = true;
  try {
    let ok = false;
    if (tab.value === "username") {
      ok = await props.phantom.sendIntroByUsername(name, intro.value.trim() || "Hi!");
    } else {
      const targetRoom = roomId.value || mutualRooms.value[0]?.roomId || "";
      ok = await props.phantom.sendIntroByContext(name, targetRoom, intro.value.trim() || "Hi!");
    }
    if (!ok) error.value = props.phantom.state.lastError || "Could not send friend request.";
    else sent.value = true;
  } finally {
    busy.value = false;
  }
}

async function createLink() {
  await props.phantom.createGhostLink();
}

async function copyGhostUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="phantom-modal-backdrop" @click.self="emit('close')">
      <div class="phantom-modal" role="dialog" aria-modal="true">
        <header class="phantom-modal__head">
          <strong>{{ t("phantom.send") }}</strong>
          <button class="icon-btn" type="button" @click="emit('close')">✕</button>
        </header>

        <nav class="phantom-tabs">
          <button type="button" :class="{ 'is-active': tab === 'context' }" @click="tab = 'context'">
            {{ t("phantom.byContext") }}
          </button>
          <button type="button" :class="{ 'is-active': tab === 'username' }" @click="tab = 'username'">
            {{ t("phantom.byUsername") }}
          </button>
          <button type="button" :class="{ 'is-active': tab === 'ghost' }" @click="tab = 'ghost'">
            {{ t("phantom.ghostLink") }}
          </button>
        </nav>

        <div class="phantom-modal__body">
          <div v-if="sent" class="phantom-sent">
            <div class="phantom-sent__check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <strong class="phantom-sent__title">{{ t("phantom.sent") }}</strong>
            <button class="btn--primary phantom-submit" type="button" @click="emit('close')">{{ t("phantom.close") }}</button>
          </div>

          <template v-else>
          <template v-if="tab !== 'ghost'">
            <label class="phantom-field">
              <span>{{ t("phantom.byUsername") }}</span>
              <input v-model="username" type="text" :placeholder="t('phantom.byUsername')" />
            </label>

            <div v-if="tab === 'context' && mutualRooms.length" class="phantom-field">
              <span>{{ t("phantom.byContext") }}</span>
              <select v-model="roomId">
                <option v-for="room in mutualRooms" :key="room.roomId" :value="room.roomId">
                  {{ room.name || room.roomId }}
                </option>
              </select>
            </div>

            <p v-if="tab === 'username'" class="phantom-warning">{{ t("phantom.usernameWarning") }}</p>

            <label v-if="tab === 'context'" class="phantom-field">
              <span>{{ t("phantom.introMessage") }}</span>
              <textarea v-model="intro" rows="2" placeholder="…"></textarea>
            </label>

            <button class="btn--primary phantom-submit" type="button" :disabled="busy" @click="send">
              {{ busy ? "…" : t("phantom.send") }}
            </button>
          </template>

          <template v-else>
            <button class="btn--primary phantom-submit" type="button" @click="createLink">
              {{ t("phantom.createGhostLink") }}
            </button>
            <ul v-if="props.phantom.state.ghostCodes.length" class="phantom-ghost-list">
              <li v-for="(code, i) in props.phantom.state.ghostCodes" :key="i">
                <code>{{ code.url }}</code>
                <button type="button" @click="copyGhostUrl(code.url)">⧉</button>
              </li>
            </ul>
          </template>

          <p v-if="error" class="phantom-error">{{ error }}</p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.phantom-modal-backdrop {
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
.phantom-modal {
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  font-family: var(--font);
  color: var(--text);
}
.phantom-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 6px;
}
.phantom-modal__head strong {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.phantom-tabs {
  display: flex;
  gap: 4px;
  padding: 14px 16px 0;
}
.phantom-tabs button {
  flex: 1;
  padding: 8px 6px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  transition: background 120ms ease, color 120ms ease;
}
.phantom-tabs button:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.phantom-tabs button.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.phantom-modal__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 24px 24px;
}
.phantom-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.phantom-field input,
.phantom-field select,
.phantom-field textarea {
  padding: 9px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
}
.phantom-field input:focus,
.phantom-field select:focus,
.phantom-field textarea:focus {
  border-color: var(--accent);
  outline: none;
}
.phantom-warning {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted);
}
.phantom-submit {
  align-self: flex-start;
  padding: 9px 16px;
  border-radius: var(--radius-md);
  border: 0;
  cursor: pointer;
  color: #fff;
  background: var(--accent);
  font-size: 14px;
  font-weight: 600;
  transition: background 120ms ease;
}
.phantom-submit:hover {
  background: color-mix(in srgb, var(--accent) 85%, black 15%);
}
.phantom-submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.phantom-sent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px 0 4px;
  text-align: center;
}
.phantom-sent__check {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.16);
  color: #22c55e;
}
.phantom-sent__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.phantom-sent .phantom-submit {
  align-self: center;
}
.phantom-error {
  margin: 0;
  font-size: 12.5px;
  color: var(--red);
}
.phantom-ghost-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.phantom-ghost-list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.phantom-ghost-list code {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
  background: var(--surface-2);
  border: 1px solid var(--line);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
}
.phantom-ghost-list button {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .phantom-modal-backdrop {
    padding: 0;
    align-items: flex-end;
  }
  .phantom-modal {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
  }
}
</style>
