<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  open: { type: Boolean, default: false },
  roomId: { type: String, default: "" },
  channel: { type: Object, default: null },
  presetCategoryId: { type: String, default: "" },
});
const emit = defineEmits(["close", "created"]);

const name = ref("");
const kind = ref<"text" | "announce" | "voice">("text");
const topic = ref("");
const categoryId = ref("");
const newCategory = ref("");
const error = ref("");
const busy = ref(false);

const categories = computed(() => props.messenger.serverCategories?.(props.roomId) || []);
const preview = computed(() => props.messenger.normalizeChannelName?.(name.value) || "");
const isEdit = computed(() => !!props.channel);
const editKind = computed(() => String(props.channel?.kind || "text"));

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    error.value = "";
    busy.value = false;
    if (props.channel) {
      name.value = String(props.channel.name || "");
      kind.value = props.channel.kind === "announce" ? "announce" : props.channel.kind === "voice" ? "voice" : "text";
      topic.value = String(props.channel.topic || "");
      categoryId.value = String(props.channel.categoryId || "");
      newCategory.value = "";
    } else {
      name.value = "";
      kind.value = "text";
      topic.value = "";
      categoryId.value = String(props.presetCategoryId || "");
      newCategory.value = "";
    }
  },
);

function waitForCategory(label: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    const match = () =>
      (categories.value.find((c) => String(c.name) === label)?.id as string) || "";
    const done = (id: string) => {
      stop();
      clearTimeout(timer);
      resolve(id);
    };
    const stop = watch(categories, () => {
      const id = match();
      if (id) done(id);
    });
    const timer = setTimeout(() => done(""), timeoutMs);
    const immediate = match();
    if (immediate) done(immediate);
  });
}

async function submit() {
  if (busy.value) return;
  error.value = "";
  if (isEdit.value && props.channel) {
    const cid = String(props.channel.id || "");
    if (!cid) return;
    const err = props.messenger.validateChannelName?.(name.value);
    if (err) {
      error.value = err;
      return;
    }
    busy.value = true;
    try {
      props.messenger.renameChannel?.(props.roomId, cid, {
        name: name.value,
        topic: topic.value.trim(),
        categoryId: categoryId.value || null,
      });
    } finally {
      busy.value = false;
    }
    emit("created");
    emit("close");
    return;
  }
  const err = props.messenger.validateChannelName?.(name.value);
  if (err) {
    error.value = err;
    return;
  }
  busy.value = true;
  try {
    let cat = categoryId.value;
    const label = newCategory.value.trim().slice(0, 64);
    if (label) {
      props.messenger.createCategory?.(props.roomId, label);
      // Attend le snapshot (broadcast op 64) pour créer le salon DANS la
      // nouvelle catégorie plutôt qu'orphelin.
      const found = await waitForCategory(label);
      cat = found || "";
      if (!found) {
        props.messenger.showToast?.(t("channels.createdWithoutCategory"));
      }
    }
    props.messenger.createChannel?.(props.roomId, {
      name: name.value,
      kind: kind.value,
      categoryId: cat || undefined,
      topic: kind.value === "voice" ? undefined : topic.value.trim() || undefined,
    });
  } finally {
    busy.value = false;
  }
  emit("created");
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="chan-modal__backdrop" @click.self="$emit('close')">
      <div class="chan-modal" role="dialog" aria-modal="true" :aria-label="isEdit ? t('channels.editTitle') : t('channels.createTitle')">
        <header class="chan-modal__head">
          <div>
            <h2>{{ isEdit ? t("channels.editTitle") : t("channels.createTitle") }}</h2>
            <p class="chan-modal__subtitle">{{ isEdit ? t("channels.editSubtitle") : t("channels.createSubtitle") }}</p>
          </div>
          <button class="icon-btn chan-modal__close" type="button" :aria-label="t('channels.close')" @click="$emit('close')">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="chan-modal__body">
          <div class="chan-modal__columns">
            <div class="chan-modal__col">
              <label class="chan-modal__field">
                <span class="chan-modal__label">{{ t("channels.name") }} <em>({{ t("channels.nameHint") }})</em></span>
                <div class="chan-modal__name-row">
                  <span class="chan-modal__hash" aria-hidden="true">#</span>
                  <input
                    v-model="name" maxlength="100" :placeholder="t('channels.namePlaceholder')"
                    spellcheck="false" autocomplete="off" :aria-invalid="!!error"
                    :class="{ 'is-invalid': !!error }"
                  />
                </div>
                <small v-if="!isEdit && preview && preview !== name.trim().toLowerCase()">{{ t("channels.previewCreated") }} <strong>#{{ preview }}</strong></small>
              </label>

              <label v-if="!isEdit || editKind !== 'voice'" class="chan-modal__field">
                <span class="chan-modal__label">{{ t("channels.topic") }}</span>
                <input v-model="topic" maxlength="256" :placeholder="t('channels.topicPlaceholder')" spellcheck="false" autocomplete="off" />
                <div class="chan-modal__counter">{{ topic.trim().length }} / 256</div>
              </label>

              <label class="chan-modal__field">
                <span class="chan-modal__label">{{ t("channels.category") }}</span>
                <select v-model="categoryId">
                  <option value="">{{ t("channels.noCategory") }}</option>
                  <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                </select>
              </label>

              <label v-if="!isEdit" class="chan-modal__field">
                <span class="chan-modal__label">{{ t("channels.newCategory") }}</span>
                <input v-model="newCategory" maxlength="64" :placeholder="t('channels.newCategoryPlaceholder')" spellcheck="false" autocomplete="off" />
              </label>
            </div>

            <div class="chan-modal__col">
              <div v-if="!isEdit" class="chan-modal__field">
                <span class="chan-modal__label">{{ t("channels.type") }}</span>
                <div class="chan-modal__types">
                  <button type="button" :class="{ 'is-active': kind === 'text' }" @click="kind = 'text'">
                    <span class="chan-modal__type-head">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17" /></svg>
                      <strong>{{ t("channels.typeText") }}</strong>
                    </span>
                    <small>{{ t("channels.typeTextHint") }}</small>
                  </button>
                  <button type="button" :class="{ 'is-active': kind === 'announce' }" @click="kind = 'announce'">
                    <span class="chan-modal__type-head">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
                      <strong>{{ t("channels.typeAnnounce") }}</strong>
                    </span>
                    <small>{{ t("channels.typeAnnounceHint") }}</small>
                  </button>
                  <button type="button" :class="{ 'is-active': kind === 'voice' }" @click="kind = 'voice'">
                    <span class="chan-modal__type-head">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
                      <strong>{{ t("channels.typeVoice") }}</strong>
                    </span>
                    <small>{{ t("channels.typeVoiceHint") }}</small>
                  </button>
                </div>
              </div>
              <div v-else class="chan-modal__field">
                <span class="chan-modal__label">{{ t("channels.type") }}</span>
                <div class="chan-modal__kind-locked">
                  <svg v-if="editKind === 'voice'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
                  <svg v-else-if="editKind === 'announce'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17" /></svg>
                  <strong v-if="editKind === 'voice'">{{ t("channels.typeVoice") }}</strong>
                  <strong v-else-if="editKind === 'announce'">{{ t("channels.typeAnnounce") }}</strong>
                  <strong v-else>{{ t("channels.typeText") }}</strong>
                  <small>{{ t("channels.kindLocked") }}</small>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p v-if="error" class="chan-modal__error" role="alert">{{ error }}</p>

        <footer class="chan-modal__foot">
          <button type="button" class="chan-modal__btn chan-modal__btn--secondary" @click="$emit('close')">{{ t("channels.cancel") }}</button>
          <button type="button" class="chan-modal__btn chan-modal__btn--primary" :disabled="busy || !name.trim()" @click="submit">
            {{ busy ? "…" : isEdit ? t("channels.save") : t("channels.create") }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chan-modal__backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  padding: 28px;
  animation: chan-modal-backdrop-in 160ms ease-out;
}
.chan-modal {
  width: 100%;
  max-width: 460px;
  max-height: calc(var(--app-viewport-height) - 56px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 20px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: var(--font);
  color: var(--text);
  animation: chan-modal-in 180ms ease-out;
}
.chan-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 12px 0;
}
.chan-modal__head h2 {
  margin: 0;
  font-family: var(--font);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
}
.chan-modal__subtitle {
  margin: 6px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--muted);
}
.chan-modal__close {
  flex: none;
}
.chan-modal__body {
  padding: 4px 12px 0;
}
.chan-modal__columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}
.chan-modal__col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.chan-modal__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}
.chan-modal__label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.chan-modal__label em {
  font-style: normal;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
.chan-modal__field input,
.chan-modal__field select {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 12px 14px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.chan-modal__field input:focus,
.chan-modal__field select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}
.chan-modal__field input.is-invalid {
  border-color: var(--red);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 16%, transparent);
}
.chan-modal__field select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8a90' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px 16px;
  padding-right: 38px;
  cursor: pointer;
}
.chan-modal__field small {
  font-size: 12px;
  color: var(--muted);
}
.chan-modal__field small strong {
  color: var(--text);
}
.chan-modal__counter {
  text-align: right;
  font-size: 11px;
  color: var(--muted);
}
.chan-modal__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chan-modal__name-row input {
  flex: 1;
  min-width: 0;
}
.chan-modal__hash {
  flex: none;
  font-weight: 800;
  font-size: 16px;
  color: var(--muted);
}
.chan-modal__types {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chan-modal__types button {
  text-align: left;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  border-radius: 14px;
  padding: 14px 16px;
  color: var(--text);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: border-color 120ms ease, background 120ms ease;
}
.chan-modal__types button:hover {
  background: var(--surface-hover);
}
.chan-modal__types button.is-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.chan-modal__type-head {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
.chan-modal__type-head svg {
  width: 18px;
  height: 18px;
  color: var(--muted);
  flex: none;
}
.chan-modal__types button.is-active .chan-modal__type-head svg {
  color: var(--text);
}
.chan-modal__types small {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.45;
}
.chan-modal__error {
  margin: 0 12px;
  font-size: 13px;
  color: var(--red);
}
.chan-modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 4px 12px 12px;
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.chan-modal__btn {
  height: 40px;
  padding: 0 22px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
}
.chan-modal__btn--secondary {
  background: transparent;
  color: var(--muted);
}
.chan-modal__btn--secondary:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.chan-modal__btn--primary {
  background: var(--accent);
  color: #fff;
}
.chan-modal__btn--primary:hover {
  background: color-mix(in srgb, var(--accent) 82%, #000 18%);
}
.chan-modal__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chan-modal__kind-locked {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.chan-modal__kind-locked svg {
  width: 18px;
  height: 18px;
  color: var(--muted);
  flex: none;
}
.chan-modal__kind-locked small {
  margin-left: auto;
  font-weight: 400;
  font-size: 12px;
  color: var(--muted);
  text-align: right;
}

@keyframes chan-modal-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes chan-modal-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

@keyframes chan-modal-sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

/* Desktop large : 720px, 2 colonnes (nom/sujet/catégorie | type). */
@media (min-width: 701px) {
  .chan-modal {
    max-width: 720px;
    padding: 28px;
  }
  .chan-modal__head {
    padding: 0 0 6px;
  }
  .chan-modal__body {
    padding: 12px 0 16px;
  }
  .chan-modal__columns {
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    align-items: start;
  }
  .chan-modal__error {
    margin: 0;
  }
  .chan-modal__foot {
    padding: 16px 0 0;
  }
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .chan-modal__backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
  }
  .chan-modal {
    max-width: 100%;
    max-height: 92vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    border-radius: 22px 22px 0 0;
    border: 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    padding-bottom: max(16px, var(--app-safe-bottom));
    animation: chan-modal-sheet-in 220ms cubic-bezier(0.16, 0.8, 0.2, 1);
  }
  .chan-modal::before {
    content: "";
    display: block;
    flex: none;
    width: 40px;
    height: 5px;
    margin: 0 auto 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }
  .chan-modal__head {
    padding: 8px 6px 0;
  }
  .chan-modal__head h2 {
    font-size: 20px;
  }
  .chan-modal__body {
    padding: 4px 6px 0;
  }
  .chan-modal input,
  .chan-modal select {
    font-size: 16px;
    padding: 14px 16px;
  }
  .chan-modal__foot {
    padding: 12px 6px calc(12px + var(--app-safe-bottom));
  }
  .chan-modal__foot .chan-modal__btn {
    flex: 1;
    height: 48px;
  }
  .chan-modal__error {
    margin: 0 6px;
  }
}
</style>
