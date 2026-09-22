<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, type PropType } from "vue";
import Icon from "@/components/Icon.vue";
import ModalShell from "@/components/ModalShell.vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import { targetChecked } from "@/utils/inputEvent";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const open = computed(() =>
  Boolean(props.messenger.state.recoveryNotice) && props.messenger.state.recoveryWords.length > 0
);
const isRecovery = computed(() => props.messenger.state.recoveryNotice === "recover");
const fileName = computed(() => props.messenger.recoveryFileName());
const revealed = ref(false);
const saved = ref(false);
const nudging = ref(false);

const tips = [
  { icon: "lock", title: "recoveryNotice.onlyWayTitle", body: "recoveryNotice.onlyWay" },
  { icon: "edit", title: "recoveryNotice.offlineTitle", body: "recoveryNotice.offline" },
  { icon: "eye-off", title: "recoveryNotice.neverShareTitle", body: "recoveryNotice.neverShare" },
];

const QUIZ_SIZE = 3;
const step = ref<"save" | "verify" | "done">("save");
const quizIndexes = ref<number[]>([]);
const answers = ref<string[]>([]);
const wrong = ref<boolean[]>([]);
const firstAnswerRef = ref<HTMLInputElement | null>(null);

watch(open, (value) => {
  if (!value) return;
  step.value = "save";
  revealed.value = false;
  saved.value = false;
});

function nudge() {
  nudging.value = false;
  requestAnimationFrame(() => (nudging.value = true));
}

function attemptClose() {
  if (step.value === "done") finish();
  else nudge();
}

function pickQuiz() {
  const total = props.messenger.state.recoveryWords.length;
  const picked = new Set<number>();
  const random = new Uint32Array(1);
  while (picked.size < Math.min(QUIZ_SIZE, total)) {
    crypto.getRandomValues(random);
    picked.add(random[0] % total);
  }
  quizIndexes.value = [...picked].sort((a, b) => a - b);
  answers.value = quizIndexes.value.map(() => "");
  wrong.value = quizIndexes.value.map(() => false);
}

async function startVerify() {
  if (!saved.value) {
    nudge();
    return;
  }
  revealed.value = false;
  pickQuiz();
  step.value = "verify";
  await nextTick();
  setTimeout(() => firstAnswerRef.value?.focus(), 360);
}

function setAnswerRef(element: unknown, index: number) {
  if (index === 0) firstAnswerRef.value = element instanceof HTMLInputElement ? element : null;
}

function verify() {
  const words = props.messenger.state.recoveryWords;
  wrong.value = quizIndexes.value.map(
    (wordIndex, i) => answers.value[i].trim().toLowerCase() !== String(words[wordIndex] || "").toLowerCase()
  );
  if (wrong.value.some(Boolean)) {
    nudge();
    return;
  }
  step.value = "done";
}

function backToWords() {
  step.value = "save";
  revealed.value = true;
}

function finish() {
  revealed.value = false;
  step.value = "save";
  props.messenger.dismissRecoveryNotice();
}
</script>

<template>
  <Teleport to="body">
    <ModalShell :open="open" backdrop-class="recovery-notice-backdrop" @close="attemptClose">
      <div class="recovery-notice" role="alertdialog" aria-modal="true" aria-labelledby="recovery-notice-title">
        <Transition name="notice-step" mode="out-in">
          <div v-if="step === 'save'" key="save" class="recovery-notice__step">
            <span class="recovery-notice__glyph" aria-hidden="true">
              <Icon name="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" />
            </span>
            <h2 id="recovery-notice-title" class="recovery-notice__title">
              {{ isRecovery ? t('recoveryNotice.titleRecover') : t('recoveryNotice.title') }}
            </h2>
            <p class="recovery-notice__lead">{{ t('recoveryNotice.lead') }}</p>

            <div class="recovery-notice__file">
              <span class="recovery-notice__file-icon" aria-hidden="true">TXT</span>
              <span class="recovery-notice__file-text">
                <strong>{{ fileName }}</strong>
                <small>{{ t('recoveryNotice.folder') }}</small>
              </span>
              <button type="button" class="recovery-notice__file-action" :aria-label="t('recoveryNotice.download')"
                :title="t('recoveryNotice.download')" @click="messenger.downloadRecoveryWords()">
                <Icon name="download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round" />
              </button>
            </div>

            <ul class="recovery-notice__tips">
              <li v-for="tip in tips" :key="tip.icon" class="recovery-notice__tip">
                <span class="recovery-notice__tip-icon" aria-hidden="true">
                  <Icon :name="tip.icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round" />
                </span>
                <span class="recovery-notice__tip-text">
                  <strong>{{ t(tip.title) }}</strong>
                  <span>{{ t(tip.body) }}</span>
                </span>
              </li>
            </ul>

            <div class="recovery-notice__words" :class="{ 'is-revealed': revealed }">
              <ol :aria-label="t('recoveryNotice.wordsLabel')">
                <li v-for="(word, index) in messenger.state.recoveryWords" :key="index">
                  <span class="recovery-notice__word-index">{{ index + 1 }}</span>
                  <span class="recovery-notice__word">{{ revealed ? word : '••••••' }}</span>
                </li>
              </ol>
              <button type="button" class="recovery-notice__reveal" :aria-pressed="revealed" @click="revealed = !revealed">
                <Icon :name="revealed ? 'eye-off' : 'eye'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                {{ revealed ? t('recoveryNotice.hide') : t('recoveryNotice.reveal') }}
              </button>
            </div>

            <label class="recovery-notice__confirm" :class="{ 'is-nudging': nudging }" @animationend="nudging = false">
              <input type="checkbox" :checked="saved" @change="saved = targetChecked($event)" />
              <span class="recovery-notice__check" aria-hidden="true"></span>
              <span>{{ t('recoveryNotice.confirm') }}</span>
            </label>

            <div class="recovery-notice__actions">
              <button type="button" class="recovery-notice__btn" @click="messenger.downloadRecoveryWords()">
                {{ t('recoveryNotice.download') }}
              </button>
              <button type="button" class="recovery-notice__btn recovery-notice__btn--primary" :disabled="!saved"
                @click="startVerify">
                {{ t('recoveryNotice.done') }}
              </button>
            </div>
          </div>

          <form v-else-if="step === 'verify'" key="verify" class="recovery-notice__step" @submit.prevent="verify">
            <span class="recovery-notice__glyph" aria-hidden="true">
              <Icon name="edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" />
            </span>
            <h2 id="recovery-notice-title" class="recovery-notice__title">{{ t('recoveryNotice.verifyTitle') }}</h2>
            <p class="recovery-notice__lead">{{ t('recoveryNotice.verifyLead') }}</p>

            <div class="recovery-notice__quiz" :class="{ 'is-nudging': nudging }" @animationend="nudging = false">
              <label v-for="(wordIndex, i) in quizIndexes" :key="wordIndex" class="recovery-notice__quiz-field"
                :class="{ 'is-wrong': wrong[i] }">
                <span class="recovery-notice__quiz-label">{{ t('recoveryNotice.wordNumber', { n: String(wordIndex + 1) }) }}</span>
                <input :ref="(el) => setAnswerRef(el, i)" v-model="answers[i]" class="qx-field" type="text"
                  autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
                  :aria-invalid="wrong[i]" @input="wrong[i] = false" />
              </label>
            </div>
            <p class="recovery-notice__quiz-error" :class="{ 'is-visible': wrong.some(Boolean) }" role="alert">
              {{ wrong.some(Boolean) ? t('recoveryNotice.wrong') : '' }}
            </p>

            <div class="recovery-notice__actions">
              <button type="button" class="recovery-notice__btn" @click="backToWords">
                {{ t('recoveryNotice.back') }}
              </button>
              <button type="submit" class="recovery-notice__btn recovery-notice__btn--primary"
                :disabled="answers.some((answer) => !answer.trim())">
                {{ t('recoveryNotice.verify') }}
              </button>
            </div>
          </form>

          <div v-else key="done" class="recovery-notice__step recovery-notice__step--done">
            <span class="recovery-notice__success" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
                stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </span>
            <h2 id="recovery-notice-title" class="recovery-notice__title">{{ t('recoveryNotice.doneTitle') }}</h2>
            <p class="recovery-notice__lead">{{ t('recoveryNotice.doneLead') }}</p>
            <div class="recovery-notice__actions recovery-notice__actions--single">
              <button type="button" class="recovery-notice__btn recovery-notice__btn--primary" @click="finish">
                {{ t('recoveryNotice.finish') }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </ModalShell>
  </Teleport>
</template>

<style scoped>
.recovery-notice-backdrop {
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

.recovery-notice {
  width: 100%;
  max-width: 420px;
  max-height: calc(var(--app-viewport-height) - 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26px 24px 20px;
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42), 0 0 0 1px var(--line-strong);
  font-family: var(--font);
  text-align: center;
}

.recovery-notice__glyph {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.recovery-notice__glyph svg {
  width: 26px;
  height: 26px;
}

.recovery-notice__title {
  margin: 14px 0 6px;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

.recovery-notice__lead {
  margin: 0;
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.45;
}

.recovery-notice__file {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 16px;
  padding: 10px 10px 10px 12px;
  border-radius: 12px;
  background: var(--field-bg);
  box-shadow: inset 0 0 0 1px var(--line);
  text-align: left;
}

.recovery-notice__file-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 40px;
  flex: none;
  border-radius: 6px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line-strong);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.recovery-notice__file-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.recovery-notice__file-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 600;
}

.recovery-notice__file-text small {
  color: var(--muted);
  font-size: 12px;
}

.recovery-notice__file-action {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 8px;
  color: var(--accent);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.recovery-notice__file-action:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.recovery-notice__file-action svg {
  width: 18px;
  height: 18px;
}

.recovery-notice__tips {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  text-align: left;
}

.recovery-notice__tip {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.recovery-notice__tip-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text) 7%, transparent);
  color: var(--text);
}

.recovery-notice__tip-icon svg {
  width: 16px;
  height: 16px;
}

.recovery-notice__tip-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--muted);
}

.recovery-notice__tip-text strong {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
}

.recovery-notice__words {
  position: relative;
  width: 100%;
  margin-top: 18px;
  padding: 12px;
  border-radius: 12px;
  background: var(--field-bg);
  box-shadow: inset 0 0 0 1px var(--line);
}

.recovery-notice__words ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recovery-notice__words li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface);
  text-align: left;
}

.recovery-notice__word-index {
  flex: none;
  min-width: 14px;
  color: var(--dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.recovery-notice__word {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
  transition: color var(--dur-base) var(--ease-out);
}

.recovery-notice__words.is-revealed .recovery-notice__word {
  color: var(--text);
  user-select: all;
}

.recovery-notice__reveal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: 10px;
  height: 30px;
  border-radius: 8px;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.recovery-notice__reveal:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.recovery-notice__reveal svg {
  width: 16px;
  height: 16px;
}

.recovery-notice__confirm {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px var(--line);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.recovery-notice__confirm:has(input:checked) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

.recovery-notice__confirm input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.recovery-notice__check {
  position: relative;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1.5px var(--line-strong);
  background: var(--surface);
  transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.recovery-notice__check::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 2.5px;
  width: 4px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) scale(0);
  transition: transform var(--dur-base) var(--ease-spring);
}

.recovery-notice__confirm input:checked + .recovery-notice__check {
  background: var(--accent);
  box-shadow: none;
}

.recovery-notice__confirm input:checked + .recovery-notice__check::after {
  transform: rotate(45deg) scale(1);
}

.recovery-notice__confirm input:focus-visible + .recovery-notice__check {
  outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
  outline-offset: 2px;
}

.recovery-notice__confirm.is-nudging {
  animation: recovery-nudge 420ms var(--ease-out);
}

@keyframes recovery-nudge {
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}

.recovery-notice__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
  margin-top: 18px;
}

.recovery-notice__btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text) 9%, transparent);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 500;
  transition: background-color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out);
}

.recovery-notice__btn:hover {
  background: color-mix(in srgb, var(--text) 14%, transparent);
}

.recovery-notice__btn:active {
  filter: brightness(.9);
}

.recovery-notice__btn--primary {
  background: var(--accent);
  color: #fff;
}

.recovery-notice__btn--primary:hover {
  background: color-mix(in srgb, #fff 8%, var(--accent));
}

.recovery-notice__btn--primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .recovery-notice-backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
  }

  .recovery-notice {
    max-width: 100%;
    max-height: 94vh;
    padding: 22px 18px max(18px, var(--app-safe-bottom));
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    overscroll-behavior: contain;
  }

  .recovery-notice__words ol {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .recovery-notice__actions {
    grid-template-columns: 1fr;
  }

  .recovery-notice__btn {
    height: 46px;
    border-radius: 12px;
    font-size: 15px;
  }

  .recovery-notice__btn--primary {
    order: -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .recovery-notice__confirm.is-nudging {
    animation: none;
  }

  .recovery-notice__check::after {
    transition: none;
  }
}

.recovery-notice__step {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.notice-step-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-slow) var(--ease-out);
}

.notice-step-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}

.notice-step-enter-from {
  opacity: 0;
  transform: translateX(18px);
}

.notice-step-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}

.recovery-notice__quiz {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin-top: 18px;
}

.recovery-notice__quiz.is-nudging {
  animation: recovery-nudge 420ms var(--ease-out);
}

.recovery-notice__quiz-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
}

.recovery-notice__quiz-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.recovery-notice__quiz-field input {
  font-family: var(--mono);
}

.recovery-notice__quiz-field.is-wrong input {
  box-shadow: inset 0 0 0 1px var(--red), 0 0 0 3px color-mix(in srgb, var(--red) 18%, transparent);
}

.recovery-notice__quiz-error {
  min-height: 18px;
  margin: 8px 0 0;
  color: var(--red);
  font-size: 12.5px;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.recovery-notice__quiz-error.is-visible {
  opacity: 1;
}

.recovery-notice__actions--single {
  grid-template-columns: 1fr;
}

.recovery-notice__success {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--green);
  color: #fff;
  animation: recovery-success var(--dur-slow) var(--ease-spring) both;
}

.recovery-notice__success svg {
  width: 28px;
  height: 28px;
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  animation: recovery-check 320ms var(--ease-out) 140ms forwards;
}

@keyframes recovery-success {
  from { opacity: 0; transform: scale(.6); }
}

@keyframes recovery-check {
  to { stroke-dashoffset: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .notice-step-enter-from,
  .notice-step-leave-to {
    transform: none;
  }

  .recovery-notice__quiz.is-nudging,
  .recovery-notice__success {
    animation: none;
  }

  .recovery-notice__success svg {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>
