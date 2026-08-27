<script setup lang="ts">
import { computed, inject, ref } from "vue";
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
}

async function send() {
  if (busy.value) return;
  error.value = "";
  const name = username.value.trim();
  if (!name) {
    error.value = t("phantom.noRequests");
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
    else emit("close");
  } finally {
    busy.value = false;
  }
}

async function createLink() {
  props.phantom.createGhostLink();
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

            <label class="phantom-field">
              <span>{{ t("phantom.requests") }}</span>
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
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.phantom-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}
.phantom-modal {
  width: min(420px, calc(100vw - 32px));
  max-height: 80vh;
  overflow: auto;
  border-radius: 12px;
  background: var(--surface, #1c1f24);
  color: var(--text-primary, #e6e8ec);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.phantom-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border, #2a2d33);
}
.phantom-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #2a2d33);
}
.phantom-tabs button {
  flex: 1;
  padding: 7px 6px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: var(--text-secondary, #a7abb3);
  cursor: pointer;
}
.phantom-tabs button.is-active {
  background: var(--accent, #4f7cff);
  color: #fff;
}
.phantom-modal__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}
.phantom-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary, #a7abb3);
}
.phantom-field input,
.phantom-field select,
.phantom-field textarea {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #2a2d33);
  background: var(--input, #121418);
  color: var(--text-primary, #e6e8ec);
}
.phantom-warning {
  margin: 0;
  font-size: 12px;
  color: var(--warning, #e6a23c);
}
.phantom-submit {
  align-self: flex-start;
  padding: 8px 14px;
  border-radius: 8px;
  border: 0;
  cursor: pointer;
  color: #fff;
  background: var(--accent, #4f7cff);
}
.phantom-submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.phantom-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #e5534b);
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
  font-size: 11px;
  color: var(--text-secondary, #a7abb3);
}
</style>
