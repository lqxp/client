<script setup lang="ts">
import { ref, computed } from "vue";
import { apiUrl } from "@/config/runtime";
import { solveVdf } from "@/crypto/vdf";
import { computeNullifier } from "@/crypto/rln";
import { encapsulatePqcSecret } from "@/crypto/pqc";

const props = withDefaults(
  defineProps<{
    scope?: string;
    target?: string;
  }>(),
  {
    scope: "register",
    target: "",
  }
);

const emit = defineEmits<{
  (e: "solve", payload: { token: string }): void;
  (e: "error", payload: { message: string }): void;
  (e: "reset"): void;
}>();

type CapState = "idle" | "verifying" | "done" | "error";

const state = ref<CapState>("idle");
const progress = ref(0);
const errorMessage = ref("");
const token = ref<string | null>(null);

let startTime = 0;
let pointerMetrics = {
  isTrusted: true,
  pointerType: "mouse",
};

const isSolved = computed(() => state.value === "done");
const isVerifying = computed(() => state.value === "verifying");

function onPointerDown(e: PointerEvent) {
  startTime = Date.now();
  pointerMetrics.isTrusted = e.isTrusted;
  pointerMetrics.pointerType = e.pointerType || "mouse";
}

async function startSolve() {
  if (state.value === "verifying" || state.value === "done") return;

  state.value = "verifying";
  progress.value = 0;
  errorMessage.value = "";
  if (!startTime) startTime = Date.now();

  try {
    const query = new URLSearchParams({
      scope: props.scope,
      target: props.target,
    });
    const challengeRes = await fetch(apiUrl(`/api/auth/cap/challenge?${query.toString()}`), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!challengeRes.ok) {
      throw new Error(`Challenge error (${challengeRes.status})`);
    }

    const challengeData = await challengeRes.json();
    if (!challengeData?.vdf || !challengeData?.quotaToken || !challengeData?.pqcKey) {
      throw new Error("Invalid challenge received from server.");
    }

    const vdfProof = await solveVdf(
      challengeData.vdf.x,
      challengeData.vdf.t,
      challengeData.vdf.modulus,
      (pct) => {
        progress.value = Math.min(95, pct);
      }
    );

    const nullifier = await computeNullifier(
      challengeData.quotaToken.ticket,
      challengeData.quotaToken.epoch,
      props.scope
    );

    const pqcRes = await encapsulatePqcSecret(challengeData.pqcKey);

    const interactionTimeMs = Math.max(Date.now() - startTime, 300);

    const redeemPayload = {
      challengeId: challengeData.challengeId,
      scope: props.scope,
      challenge: challengeData,
      vdfProof,
      nullifier,
      pqcCiphertext: pqcRes.ciphertext,
      instrumentation: {
        interactionTimeMs,
        webdriver: !!(navigator as any).webdriver,
        entropy: 0.98,
      },
    };

    const redeemRes = await fetch(apiUrl("/api/auth/cap/redeem"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(redeemPayload),
    });

    if (!redeemRes.ok) {
      const errJson = await redeemRes.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.message || `Redeem failed (${redeemRes.status})`);
    }

    const redeemData = await redeemRes.json();
    if (!redeemData.success || !redeemData.capToken) {
      throw new Error("Invalid response from server.");
    }

    progress.value = 100;
    state.value = "done";
    token.value = redeemData.capToken;
    emit("solve", { token: redeemData.capToken });
  } catch (err: any) {
    state.value = "error";
    errorMessage.value = err?.message || "Error. Try again.";
    emit("error", { message: errorMessage.value });
  }
}

function reset() {
  state.value = "idle";
  progress.value = 0;
  errorMessage.value = "";
  token.value = null;
  startTime = 0;
  emit("reset");
}

defineExpose({
  solve: startSolve,
  reset,
  isSolved,
  token,
});
</script>

<template>
  <div
    class="captcha"
    :data-state="state !== 'idle' ? state : undefined"
    role="group"
    aria-label="Cap verification"
  >
    <div
      class="captcha-trigger"
      part="trigger"
      role="button"
      tabindex="0"
      :aria-label="
        state === 'idle'
          ? 'Click to verify you\'re a human'
          : state === 'verifying'
          ? 'Verifying you\'re a human, please wait'
          : state === 'done'
          ? 'We verified you\'re human'
          : 'An error occurred, please try again'
      "
      aria-live="polite"
      @pointerdown="onPointerDown"
      @click="startSolve"
      @keydown.enter.prevent="startSolve"
      @keydown.space.prevent="startSolve"
    >
      <div class="checkbox" part="checkbox" aria-hidden="true">
        <svg class="progress-ring" viewBox="0 0 32 32" aria-hidden="true">
          <circle class="progress-ring-bg" cx="16" cy="16" r="14" />
          <circle
            class="progress-ring-circle"
            cx="16"
            cy="16"
            r="14"
            :style="{ strokeDashoffset: `${87.96 - (87.96 * progress) / 100}` }"
          />
        </svg>
      </div>

      <p part="label" class="label-wrapper">
        <span v-if="state === 'idle'" class="label active">Verify you're human</span>
        <span v-else-if="state === 'verifying'" class="label active">Verifying ({{ progress }}%)...</span>
        <span v-else-if="state === 'done'" class="label active">You're human</span>
        <span v-else class="label active">{{ errorMessage || 'Error. Try again.' }}</span>
      </p>
    </div>

    <a
      class="credits"
      aria-label="Secured by Cap"
      href="https://trycap.dev"
      target="_blank"
      rel="noopener noreferrer"
      title="Secured by Cap: The self-hosted CAPTCHA for the modern web."
      @click.stop
    >
      Cap
    </a>
  </div>
</template>

<style scoped>
/* Official Cap CAPTCHA CSS Style with Full Width */
.captcha,
.captcha * {
  box-sizing: border-box;
}

.captcha {
  position: relative;
  display: block;
  width: 100%;
  height: 58px;
  background-color: var(--cap-background, #18181b);
  border: 1px solid var(--cap-border-color, #27272a);
  border-radius: var(--cap-border-radius, 14px);
  user-select: none;
  cursor: pointer;
  transition:
    filter 0.2s,
    transform 0.2s,
    height 0.2s,
    border-color 0.2s,
    background-color 0.2s;
  -webkit-tap-highlight-color: rgba(255, 255, 255, 0);
  overflow: hidden;
  color: var(--cap-color, #f4f4f5);
  font-family: var(
    --cap-font,
    system,
    -apple-system,
    "BlinkMacSystemFont",
    ".SFNSText-Regular",
    "San Francisco",
    "Roboto",
    "Segoe UI",
    "Helvetica Neue",
    "Lucida Grande",
    "Ubuntu",
    "arial",
    sans-serif
  );
  margin: 10px 0;
}

:global(:root[data-theme="light"] .captcha) {
  --cap-background: #fdfdfd;
  --cap-border-color: #dddddd8f;
  --cap-color: #212121;
}

.captcha:not([data-state]):active {
  transform: scale(0.98);
}

.captcha:hover:not([data-state="done"]) {
  border-color: #3f3f46;
  filter: brightness(108%);
}

.captcha-trigger {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 14px 16px;
  gap: 15px;
  border-radius: inherit;
  transition: inset 0.2s;
}

.captcha-trigger:focus-visible {
  outline: 2px solid var(--cap-focus-ring, #3b82f6);
  outline-offset: -2px;
}

.checkbox {
  width: 25px;
  height: 25px;
  border: 1.5px solid #52525b;
  border-radius: 6px;
  background-color: #27272a;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: opacity 0.2s, transform 0.2s, border-color 0.2s, background-color 0.2s;
  flex-shrink: 0;
}

:global(:root[data-theme="light"] .checkbox) {
  border-color: #aaaaaad1;
  background-color: #fafafa91;
}

.captcha:hover .checkbox:not(.captcha[data-state="done"] .checkbox):not(.captcha[data-state="error"] .checkbox) {
  border-color: #3b82f6;
  transform: scale(1.05);
}

.captcha p {
  margin: 0;
  font-weight: 500;
  font-size: 15px;
  user-select: none;
}

.label-wrapper {
  position: relative;
  height: 2em;
  overflow: hidden;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.label-wrapper::before,
.label-wrapper::after {
  content: "";
  pointer-events: none;
  position: absolute;
  inset-inline-start: 0;
  width: 100%;
  height: 0.6em;
  z-index: 1;
}

.label-wrapper::before {
  top: 0;
  background: linear-gradient(
    to bottom,
    var(--cap-background, #18181b),
    transparent
  );
}

.label-wrapper::after {
  bottom: 0;
  background: linear-gradient(
    to top,
    var(--cap-background, #18181b),
    transparent
  );
}

:global(:root[data-theme="light"] .label-wrapper::before) {
  background: linear-gradient(to bottom, #fdfdfd, transparent);
}

:global(:root[data-theme="light"] .label-wrapper::after) {
  background: linear-gradient(to top, #fdfdfd, transparent);
}

.label {
  position: absolute;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(100%);
  transition:
    transform 0.5s cubic-bezier(0.25, 1, 0.5, 1),
    opacity 0.5s ease,
    filter 0.5s ease;
  filter: blur(2px);
}

.label.active {
  opacity: 1;
  transform: translateY(0);
  filter: none;
}

.label.exit {
  opacity: 0;
  transform: translateY(-100%);
  filter: blur(2px);
}

.checkbox .progress-ring {
  display: none;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.checkbox .progress-ring-bg {
  fill: none;
  stroke: var(--cap-spinner-background-color, rgba(255, 255, 255, 0.15));
  stroke-width: 3;
}

:global(:root[data-theme="light"] .checkbox .progress-ring-bg) {
  stroke: #eee;
}

.checkbox .progress-ring-circle {
  fill: none;
  stroke: var(--cap-spinner-color, #3b82f6);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 87.96;
  stroke-dashoffset: 87.96;
  transition: stroke-dashoffset 0.3s ease;
}

:global(:root[data-theme="light"] .checkbox .progress-ring-circle) {
  stroke: #000;
}

.captcha[data-state="verifying"] .checkbox {
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: scale(1.1);
  border: none;
  border-radius: 50%;
  background-color: transparent;
  box-shadow: none;
}

.captcha[data-state="verifying"] .checkbox .progress-ring {
  display: block;
}

.captcha[data-state="done"] {
  cursor: default;
  border-color: #27272a;
}

.captcha[data-state="done"] .checkbox {
  border: 1px solid transparent;
  background-image: var(
    --cap-checkmark,
    url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cstyle%3E%40keyframes%20anim%7B0%25%7Bstroke-dashoffset%3A23.21320343017578px%7Dto%7Bstroke-dashoffset%3A0%7D%7D%3C%2Fstyle%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22%2300a67d%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22m5%2012%205%205L20%207%22%20style%3D%22stroke-dashoffset%3A0%3Bstroke-dasharray%3A23.21320343017578px%3Banimation%3Aanim%20.5s%20ease%22%2F%3E%3C%2Fsvg%3E")
  );
  background-size: cover;
  box-shadow: none;
  transform: none;
}

.captcha[data-state="done"] .checkbox .progress-ring {
  display: none;
}

.captcha[data-state="error"] {
  border-color: #f55b50;
}

.captcha[data-state="error"] .checkbox {
  border: 1px solid transparent;
  background-image: var(
    --cap-error-cross,
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 24 24'%3E%3Cpath fill='%23f55b50' d='M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.47 2 2 6.5 2 12a10 10 0 0 0 10 10a10 10 0 0 10-10A10 10 0 0 0 12 2m0 18a8 8 0 0 1-8-8a8 8 0 0 1 8-8a8 8 0 0 1 8 8a8 8 0 0 1-8 8'/%3E%3C%2Fsvg%3E")
  );
  background-size: cover;
  box-shadow: none;
}

.captcha[data-state="error"] .checkbox .progress-ring {
  display: none;
}

.credits {
  position: absolute;
  inset-block-end: 4px;
  inset-inline-end: 8px;
  font-size: 12px !important;
  color: var(--cap-color, #a1a1aa);
  opacity: 0.8 !important;
  text-decoration: underline;
  text-underline-offset: 0.18em;
  text-decoration-thickness: 0.08em;
  z-index: 2;
  min-width: 24px;
  min-height: 24px;
  padding: 4px 6px;
  display: inline-flex !important;
  align-items: center;
  justify-content: flex-end;
  border-radius: 4px;
  font-weight: 500;
}

.credits:hover {
  opacity: 1 !important;
}

.credits:focus-visible {
  outline: 2px solid var(--cap-focus-ring, #0066cc);
  outline-offset: 2px;
  opacity: 1 !important;
}
</style>
