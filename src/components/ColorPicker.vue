<script setup lang="ts">
import { computed, inject, ref, watch, type PropType } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  modelValue: { type: String, required: true },
  swatches: { type: Array as PropType<string[]>, default: () => [] }
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const HEX = /^#[0-9a-f]{6}$/i;
const hue = ref(210);
const sat = ref(0.8);
const val = ref(0.9);
const hexInput = ref(props.modelValue);

function hexToHsv(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function syncFrom(hex: string) {
  if (!HEX.test(hex)) return;
  const hsv = hexToHsv(hex);
  if (hsv.s > 0 && hsv.v > 0) hue.value = hsv.h;
  sat.value = hsv.s;
  val.value = hsv.v;
  hexInput.value = hex.toLowerCase();
}

const current = computed(() => hsvToHex(hue.value, sat.value, val.value));
const hueColor = computed(() => hsvToHex(hue.value, 1, 1));

watch(() => props.modelValue, (value) => {
  if (value.toLowerCase() !== current.value) syncFrom(value);
}, { immediate: true });

function commit() {
  hexInput.value = current.value;
  emit("update:modelValue", current.value);
}

function track(event: PointerEvent, apply: (x: number, y: number) => void) {
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    const rect = target.getBoundingClientRect();
    apply(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)));
    commit();
  };
  move(event);
  const stop = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", stop);
    target.removeEventListener("pointercancel", stop);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", stop);
  target.addEventListener("pointercancel", stop);
}

function onArea(event: PointerEvent) {
  track(event, (x, y) => {
    sat.value = x;
    val.value = 1 - y;
  });
}

function onHue(event: PointerEvent) {
  track(event, (x) => (hue.value = x * 359.9));
}

function nudge(event: KeyboardEvent, kind: "area" | "hue") {
  const step = event.shiftKey ? 0.1 : 0.02;
  const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const delta = keys[event.key];
  if (!delta) return;
  event.preventDefault();
  if (kind === "hue") hue.value = (hue.value + (delta[0] || delta[1]) * 360 + 360) % 360;
  else {
    sat.value = Math.min(1, Math.max(0, sat.value + delta[0]));
    val.value = Math.min(1, Math.max(0, val.value + delta[1]));
  }
  commit();
}

function onHexInput() {
  const raw = hexInput.value.trim();
  const value = raw.startsWith("#") ? raw : `#${raw}`;
  if (!HEX.test(value)) return;
  syncFrom(value);
  emit("update:modelValue", value.toLowerCase());
}

function pick(swatch: string) {
  syncFrom(swatch);
  emit("update:modelValue", swatch.toLowerCase());
}
</script>

<template>
  <div class="color-picker">
    <div class="color-picker__area" :style="{ background: hueColor }" role="slider" tabindex="0"
      :aria-label="t('colorPicker.shade')" :aria-valuetext="current" @pointerdown="onArea" @keydown="nudge($event, 'area')">
      <span class="color-picker__knob" :style="{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%`, background: current }"></span>
    </div>
    <div class="color-picker__hue" role="slider" tabindex="0" :aria-label="t('colorPicker.hue')"
      :aria-valuenow="Math.round(hue)" aria-valuemin="0" aria-valuemax="360" @pointerdown="onHue" @keydown="nudge($event, 'hue')">
      <span class="color-picker__hue-knob" :style="{ left: `${(hue / 360) * 100}%`, background: hueColor }"></span>
    </div>
    <div class="color-picker__row">
      <span class="color-picker__preview" :style="{ background: current }" aria-hidden="true"></span>
      <input v-model="hexInput" class="color-picker__hex" maxlength="7" spellcheck="false" :aria-label="t('colorPicker.hex')"
        @change="onHexInput" @keydown.enter.prevent="onHexInput" />
    </div>
    <div v-if="swatches.length" class="color-picker__swatches">
      <button v-for="swatch in swatches" :key="swatch" type="button" class="color-picker__swatch"
        :class="{ 'is-active': swatch.toLowerCase() === current }" :style="{ background: swatch }" :aria-label="swatch"
        @click="pick(swatch)"></button>
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.color-picker__area {
  position: relative;
  height: 150px;
  border-radius: 10px;
  touch-action: none;
  cursor: crosshair;
  background-image:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, transparent) !important;
  background-blend-mode: normal;
}

.color-picker__area,
.color-picker__hue {
  outline: none;
}

.color-picker__area:focus-visible,
.color-picker__hue:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
}

.color-picker__knob,
.color-picker__hue-knob {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px #fff, 0 2px 8px rgba(0, 0, 0, 0.4);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.color-picker__hue {
  position: relative;
  height: 14px;
  border-radius: 999px;
  touch-action: none;
  cursor: pointer;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}

.color-picker__hue-knob {
  top: 50%;
}

.color-picker__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-picker__preview {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--line-strong);
}

.color-picker__hex {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--field-bg);
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  text-transform: lowercase;
  outline: none;
  box-shadow: inset 0 0 0 1px var(--field-edge, var(--line));
}

.color-picker__hex:focus {
  box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.color-picker__swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px;
}

.color-picker__swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.color-picker__swatch:hover {
  transform: scale(1.1);
}

.color-picker__swatch.is-active {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text);
}
</style>
