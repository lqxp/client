<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, type PropType } from "vue";
import Icon from "@/components/Icon.vue";
import ModalShell from "@/components/ModalShell.vue";
import { MAX_POLL_OPTIONS, type Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import { targetChecked } from "@/utils/inputEvent";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const open = computed(() => props.messenger.state.pollCreatorOpen);
const question = ref("");
const options = ref(["", ""]);
const multi = ref(false);
const questionRef = ref<HTMLInputElement | null>(null);
const filled = computed(() => options.value.map((option) => option.trim()).filter(Boolean));
const canCreate = computed(() => question.value.trim().length > 0 && filled.value.length >= 2);

watch(open, async (value) => {
  if (!value) return;
  question.value = "";
  options.value = ["", ""];
  multi.value = false;
  await nextTick();
  questionRef.value?.focus();
});

function close() {
  props.messenger.state.pollCreatorOpen = false;
}

function addOption() {
  if (options.value.length < MAX_POLL_OPTIONS) options.value.push("");
}

function removeOption(index: number) {
  if (options.value.length > 2) options.value.splice(index, 1);
}

function create() {
  if (!canCreate.value) return;
  if (props.messenger.sendPoll(question.value, filled.value, multi.value)) close();
}
</script>

<template>
  <Teleport to="body">
    <ModalShell :open="open" backdrop-class="poll-create-backdrop" @close="close">
      <form v-sheet-dismiss="close" class="poll-create" role="dialog" :aria-label="t('poll.create')" @submit.prevent="create">
        <header class="poll-create__head">
          <h2>{{ t('poll.create') }}</h2>
          <button type="button" class="icon-btn" :aria-label="t('message.cancel')" @click="close">
            <Icon name="close" viewBox="0 0 24 24" />
          </button>
        </header>
        <label class="poll-create__label" for="poll-question">{{ t('poll.question') }}</label>
        <input id="poll-question" ref="questionRef" v-model="question" class="qx-field" maxlength="200"
          :placeholder="t('poll.questionPlaceholder')" />
        <span class="poll-create__label">{{ t('poll.options') }}</span>
        <TransitionGroup tag="div" name="poll-option" class="poll-create__options">
          <div v-for="(option, index) in options" :key="index" class="poll-create__option">
            <span class="poll-create__mark" :class="{ 'is-multi': multi }" aria-hidden="true"></span>
            <input v-model="options[index]" class="qx-field" maxlength="80"
              :aria-label="t('poll.optionN', { n: String(index + 1) })"
              :placeholder="t('poll.optionN', { n: String(index + 1) })" />
            <button v-if="options.length > 2" type="button" class="poll-create__remove"
              :aria-label="t('poll.removeOption')" @click="removeOption(index)">
              <Icon name="close" viewBox="0 0 24 24" />
            </button>
          </div>
        </TransitionGroup>
        <button v-if="options.length < MAX_POLL_OPTIONS" type="button" class="poll-create__add" @click="addOption">
          <Icon name="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          {{ t('poll.addOption') }}
        </button>
        <label class="settings-check poll-create__multi">
          <span>{{ t('poll.allowMultiple') }}</span>
          <input type="checkbox" :checked="multi" @change="multi = targetChecked($event)" />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </label>
        <p class="poll-create__note">{{ t('poll.visibilityNote') }}</p>
        <div class="poll-create__actions">
          <button type="button" class="poll-create__btn" @click="close">{{ t('message.cancel') }}</button>
          <button type="submit" class="poll-create__btn poll-create__btn--primary" :disabled="!canCreate">
            {{ t('poll.send') }}
          </button>
        </div>
      </form>
    </ModalShell>
  </Teleport>
</template>

<style scoped>
.poll-create-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.poll-create {
  width: 100%;
  max-width: 420px;
  max-height: calc(var(--app-viewport-height) - 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 22px 18px;
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42), 0 0 0 1px var(--line-strong);
}

.poll-create__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.poll-create__head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}

.poll-create__label {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.poll-create__options {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.poll-create__option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.poll-create__mark {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px var(--line-strong);
  transition: border-radius var(--dur-base) var(--ease-out);
}

.poll-create__mark.is-multi {
  border-radius: 4px;
}

.poll-create__remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  color: var(--muted);
}

.poll-create__remove:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.poll-create__remove svg,
.poll-create__add svg {
  width: 14px;
  height: 14px;
}

.poll-create__add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 8px;
  border-radius: 8px;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
}

.poll-create__add:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.poll-create__multi {
  margin-top: 4px;
}

.poll-create__note {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.poll-create__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.poll-create__btn {
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text) 9%, transparent);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 500;
}

.poll-create__btn--primary {
  background: var(--accent);
  color: #fff;
}

.poll-create__btn:disabled {
  opacity: 0.45;
}

.poll-option-enter-active,
.poll-option-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.poll-option-enter-from,
.poll-option-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .poll-create-backdrop {
    padding: 0;
    align-items: flex-end;
  }

  .poll-create {
    max-width: 100%;
    max-height: 92vh;
    padding-bottom: max(18px, var(--app-safe-bottom));
    border-radius: 22px 22px 0 0;
  }

  .poll-create__btn {
    height: 46px;
    border-radius: 12px;
    font-size: 15px;
  }
}
</style>
