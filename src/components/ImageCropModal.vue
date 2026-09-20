<script setup lang="ts">
/**
 * Framing a picture before it becomes an avatar or a banner.
 *
 * Presented like the image viewer rather than as a dialog box: the picture
 * gets the whole surface and the controls float over it. The frame is fixed
 * by the caller's aspect and the picture moves behind it, which is the only
 * arrangement where the result is never a surprise.
 *
 * Animated images never reach this screen. A canvas holds one frame, so
 * cropping a GIF would silently flatten it; the caller sends those through
 * untouched instead.
 */
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import { currentWindowZoom } from "@/utils/windowZoom";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  src: { type: String, default: "" },
  title: { type: String, default: "" },
  aspect: { type: Number, default: 1 },
  mimeType: { type: String, default: "image/png" },
  maxWidth: { type: Number, default: 1024 },
  maxHeight: { type: Number, default: 1024 },
});

const emit = defineEmits<{ cancel: []; confirm: [file: File] }>();

const stageEl = ref<HTMLDivElement | null>(null);
const imageEl = ref<HTMLImageElement | null>(null);

const loading = ref(false);
const confirming = ref(false);
const error = ref("");
const naturalW = ref(0);
const naturalH = ref(0);

/** The hole the picture is framed through, in stage coordinates. */
const viewport = reactive({ x: 0, y: 0, w: 0, h: 0 });
/** Where the picture sits behind that hole. */
const imageRect = reactive({ x: 0, y: 0, w: 0, h: 0 });
const zoomPct = ref(100);

const ZOOM_MIN = 100;
const ZOOM_MAX = 800;
const NUDGE_PX = 12;

const drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
let resizeObserver: ResizeObserver | null = null;

const ready = computed(() => Boolean(naturalW.value && naturalH.value && !error.value));
const canApply = computed(() => ready.value && !loading.value && !confirming.value);
/** A square frame is an avatar, so the mask is drawn round. */
const roundFrame = computed(() => Math.abs(props.aspect - 1) < 0.01);

/** The smallest scale that still fills the frame, so no gap can ever show. */
const coverScale = computed(() => {
  if (!naturalW.value || !naturalH.value || !viewport.w || !viewport.h) return 1;
  return Math.max(viewport.w / naturalW.value, viewport.h / naturalH.value);
});

/**
 * getBoundingClientRect reports visual pixels while the styles below are in
 * zoomed CSS pixels. Everything downstream (fit, clamp, drag, export) stays in
 * the latter, so the conversion happens once, here.
 */
function measureViewport() {
  const el = stageEl.value;
  if (!el) return;
  const zoom = currentWindowZoom();
  const rect = el.getBoundingClientRect();
  const pad = 32;
  const availW = Math.max(60, rect.width / zoom - pad * 2);
  const availH = Math.max(60, rect.height / zoom - pad * 2);

  let w = availW;
  let h = w / props.aspect;
  if (h > availH) {
    h = availH;
    w = h * props.aspect;
  }
  viewport.w = Math.round(w);
  viewport.h = Math.round(h);
  viewport.x = (rect.width / zoom - viewport.w) / 2;
  viewport.y = (rect.height / zoom - viewport.h) / 2;
}

/** Keeps the frame covered: the picture can never be dragged off its edge. */
function clampImage() {
  if (!imageRect.w || !imageRect.h) return;
  const minX = viewport.x + viewport.w - imageRect.w;
  const minY = viewport.y + viewport.h - imageRect.h;
  imageRect.x = Math.min(viewport.x, Math.max(minX, imageRect.x));
  imageRect.y = Math.min(viewport.y, Math.max(minY, imageRect.y));
}

function resetImage() {
  if (!naturalW.value || !naturalH.value || !viewport.w || !viewport.h) return;
  const scale = coverScale.value;
  imageRect.w = naturalW.value * scale;
  imageRect.h = naturalH.value * scale;
  imageRect.x = viewport.x + (viewport.w - imageRect.w) / 2;
  imageRect.y = viewport.y + (viewport.h - imageRect.h) / 2;
  zoomPct.value = ZOOM_MIN;
}

/** Zooms about the centre of the frame, so the framed subject stays put. */
function applyZoomPct(nextRaw: number) {
  if (!naturalW.value || !naturalH.value) return;
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextRaw));
  const oldScale = imageRect.w / naturalW.value;
  const newScale = coverScale.value * (next / 100);

  const cx = viewport.x + viewport.w / 2;
  const cy = viewport.y + viewport.h / 2;
  const u = (cx - imageRect.x) / oldScale;
  const v = (cy - imageRect.y) / oldScale;

  imageRect.w = naturalW.value * newScale;
  imageRect.h = naturalH.value * newScale;
  imageRect.x = cx - u * newScale;
  imageRect.y = cy - v * newScale;
  zoomPct.value = next;
  clampImage();
}

function zoomBy(step: number) {
  applyZoomPct(zoomPct.value + step);
}

function nudge(dx: number, dy: number) {
  if (!ready.value) return;
  imageRect.x += dx;
  imageRect.y += dy;
  clampImage();
}

function onWheel(event: WheelEvent) {
  if (!ready.value) return;
  applyZoomPct(zoomPct.value * Math.exp(-event.deltaY * 0.0015));
}

function onSliderInput(event: Event) {
  applyZoomPct(Number((event.target as HTMLInputElement).value));
}

function onPointerDown(event: PointerEvent) {
  if (!ready.value) return;
  drag.active = true;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.origX = imageRect.x;
  drag.origY = imageRect.y;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!drag.active) return;
  // Pointer deltas arrive in visual pixels; imageRect is in zoomed ones, so
  // the picture follows the cursor one to one at any window scale.
  const zoom = currentWindowZoom();
  imageRect.x = drag.origX + (event.clientX - drag.startX) / zoom;
  imageRect.y = drag.origY + (event.clientY - drag.startY) / zoom;
  clampImage();
}

function onPointerEnd(event: PointerEvent) {
  if (!drag.active) return;
  drag.active = false;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  } catch {
    /* the pointer may already be gone */
  }
}

function onImageLoad() {
  const img = imageEl.value;
  if (!img) return;
  naturalW.value = img.naturalWidth || 0;
  naturalH.value = img.naturalHeight || 0;
  loading.value = false;
  if (!naturalW.value || !naturalH.value) {
    error.value = t("crop.loadError");
    return;
  }
  error.value = "";
  measureViewport();
  resetImage();
}

function onImageError() {
  loading.value = false;
  naturalW.value = 0;
  naturalH.value = 0;
  error.value = t("crop.loadError");
}

/** Only two encoders are worth keeping: JPEG for photos, PNG for the rest. */
function outputMimeType() {
  const mime = String(props.mimeType || "").toLowerCase();
  return mime === "image/jpeg" || mime === "image/jpg" ? "image/jpeg" : "image/png";
}

/**
 * Applying without having reframed anything used to still go through the
 * canvas, which re-encodes: a JPEG came back softer than it went in for no
 * reason at all. When the frame already holds the whole picture and no
 * downscale is needed, the original bytes are sent instead.
 */
async function passThroughOriginal(): Promise<boolean> {
  try {
    const response = await fetch(props.src);
    const blob = await response.blob();
    if (!blob.size) return false;
    const ext = (props.mimeType.split("/")[1] || "png").replace("jpeg", "jpg").split("+")[0];
    emit("confirm", new File([blob], `crop-${Date.now()}.${ext}`, { type: props.mimeType }));
    return true;
  } catch {
    return false;
  }
}

async function confirmCrop() {
  if (!canApply.value) return;
  const img = imageEl.value;
  if (!img) return;

  // From frame coordinates back to source pixels.
  const scale = imageRect.w / naturalW.value;
  let sx = (viewport.x - imageRect.x) / scale;
  let sy = (viewport.y - imageRect.y) / scale;
  let sw = viewport.w / scale;
  let sh = viewport.h / scale;

  sx = Math.max(0, Math.min(naturalW.value - 1, sx));
  sy = Math.max(0, Math.min(naturalH.value - 1, sy));
  sw = Math.min(sw, naturalW.value - sx);
  sh = Math.min(sh, naturalH.value - sy);
  if (sw <= 0 || sh <= 0) return;

  const outputMime = outputMimeType();
  const factor = Math.min(1, props.maxWidth / sw, props.maxHeight / sh);

  // Whole picture, no downscale: nothing to redraw.
  const whole =
    factor === 1 &&
    sx < 1 &&
    sy < 1 &&
    sw >= naturalW.value - 1 &&
    sh >= naturalH.value - 1;
  if (whole) {
    confirming.value = true;
    const reused = await passThroughOriginal();
    confirming.value = false;
    if (reused) return;
  }

  const ow = Math.max(1, Math.round(sw * factor));
  const oh = Math.max(1, Math.round(sh * factor));

  const canvas = document.createElement("canvas");
  canvas.width = ow;
  canvas.height = oh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // JPEG has no alpha, so transparency would come out black without this.
  if (outputMime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ow, oh);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh);

  confirming.value = true;
  canvas.toBlob(
    (blob) => {
      confirming.value = false;
      if (!blob) return;
      const ext = outputMime === "image/jpeg" ? "jpg" : "png";
      emit("confirm", new File([blob], `crop-${Date.now()}.${ext}`, { type: outputMime }));
    },
    outputMime,
    outputMime === "image/jpeg" ? 0.92 : undefined,
  );
}

function cancel() {
  emit("cancel");
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case "Escape":
      cancel();
      break;
    case "Enter":
      event.preventDefault();
      confirmCrop();
      break;
    case "ArrowLeft":
      event.preventDefault();
      nudge(NUDGE_PX, 0);
      break;
    case "ArrowRight":
      event.preventDefault();
      nudge(-NUDGE_PX, 0);
      break;
    case "ArrowUp":
      event.preventDefault();
      nudge(0, NUDGE_PX);
      break;
    case "ArrowDown":
      event.preventDefault();
      nudge(0, -NUDGE_PX);
      break;
    case "+":
    case "=":
      event.preventDefault();
      zoomBy(25);
      break;
    case "-":
      event.preventDefault();
      zoomBy(-25);
      break;
    default:
      break;
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      window.removeEventListener("keydown", onKeydown);
      resizeObserver?.disconnect();
      resizeObserver = null;
      return;
    }

    loading.value = Boolean(props.src);
    confirming.value = false;
    error.value = "";
    naturalW.value = 0;
    naturalH.value = 0;
    imageRect.x = 0;
    imageRect.y = 0;
    imageRect.w = 0;
    imageRect.h = 0;
    zoomPct.value = ZOOM_MIN;

    window.addEventListener("keydown", onKeydown);
    await nextTick();
    measureViewport();

    if (stageEl.value && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        measureViewport();
        resetImage();
      });
      resizeObserver.observe(stageEl.value);
    }
  },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  resizeObserver?.disconnect();
});

const imageStyle = computed(() => ({
  left: `${imageRect.x}px`,
  top: `${imageRect.y}px`,
  width: `${imageRect.w}px`,
  height: `${imageRect.h}px`,
}));

const frameStyle = computed(() => ({
  left: `${viewport.x}px`,
  top: `${viewport.y}px`,
  width: `${viewport.w}px`,
  height: `${viewport.h}px`,
}));
</script>

<template>
  <Teleport to="body">
    <Transition name="crop">
      <div v-if="open" class="crop" role="dialog" aria-modal="true" :aria-label="title">
        <div ref="stageEl" class="crop__stage" @wheel.prevent="onWheel" @pointerdown="onPointerDown"
          @pointermove="onPointerMove" @pointerup="onPointerEnd" @pointercancel="onPointerEnd">
          <img v-show="ready" ref="imageEl" class="crop__image" :src="src" :style="imageStyle"
            draggable="false" alt="" @load="onImageLoad" @error="onImageError" />

          <!-- One element does the dimming and the outline: a huge spread
               shadow darkens everything outside the frame. -->
          <div v-show="ready" class="crop__frame" :class="{ 'is-round': roundFrame }"
            :style="frameStyle" aria-hidden="true"></div>

          <p v-if="loading" class="crop__state">{{ t('crop.loading') }}</p>
          <p v-else-if="error" class="crop__state crop__state--error" role="alert">{{ error }}</p>
        </div>

        <header class="crop__top">
          <span class="crop__title">{{ title }}</span>
          <button type="button" class="crop__chip" :aria-label="t('message.cancel')"
            :title="t('message.cancel')" @click="cancel">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <footer class="crop__bar">
          <div class="crop__zoom">
            <button type="button" class="crop__chip crop__chip--sm" :disabled="!ready"
              :aria-label="t('crop.zoomOut')" :title="t('crop.zoomOut')" @click="zoomBy(-25)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 12h12" />
              </svg>
            </button>
            <input class="crop__slider" type="range" :min="ZOOM_MIN" :max="ZOOM_MAX" step="1"
              :value="zoomPct" :disabled="!ready" :aria-label="t('crop.zoom')"
              @input="onSliderInput" />
            <button type="button" class="crop__chip crop__chip--sm" :disabled="!ready"
              :aria-label="t('crop.zoomIn')" :title="t('crop.zoomIn')" @click="zoomBy(25)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 6v12M6 12h12" />
              </svg>
            </button>
          </div>

          <div class="crop__actions">
            <button type="button" class="crop__ghost" :disabled="!ready" @click="resetImage">
              {{ t('crop.reset') }}
            </button>
            <button type="button" class="crop__ghost" @click="cancel">{{ t('message.cancel') }}</button>
            <button type="button" class="crop__apply" :disabled="!canApply" @click="confirmCrop">
              {{ t('crop.apply') }}
            </button>
          </div>
        </footer>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.crop {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: grid;
  background: #000;
  color: #fff;
  font-family: var(--font);
  user-select: none;
}

.crop__stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}

.crop__stage:active {
  cursor: grabbing;
}

.crop__image {
  position: absolute;
  max-width: none;
  -webkit-user-drag: none;
}

/* The spread shadow is the mask: it covers the whole stage except the frame,
   so no second element has to be kept in sync with it. */
.crop__frame {
  position: absolute;
  border-radius: 14px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, .62), inset 0 0 0 1px rgba(255, 255, 255, .9);
  pointer-events: none;
}

.crop__frame.is-round {
  border-radius: 50%;
}

.crop__state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  font-size: 14px;
  color: rgba(255, 255, 255, .72);
}

.crop__state--error {
  color: var(--red);
}

.crop__top {
  position: absolute;
  top: calc(max(14px, var(--app-safe-top)) + var(--app-chrome-top, 0px));
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
}

.crop__title {
  font-size: 14px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(0, 0, 0, .7);
}

.crop__chip {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, .45);
  color: #fff;
  cursor: pointer;
  transition: background-color 140ms ease-out, transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.crop__chip--sm {
  width: 30px;
  height: 30px;
  background: rgba(255, 255, 255, .12);
}

.crop__chip svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.crop__chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, .22);
}

.crop__chip:active:not(:disabled) {
  transform: scale(.92);
}

.crop__chip:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.crop__bar {
  position: absolute;
  left: 50%;
  bottom: max(22px, var(--app-safe-bottom));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 18px;
  max-width: calc(100vw - 28px);
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(22, 22, 24, .86);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .08), 0 16px 40px rgba(0, 0, 0, .5);
}

.crop__zoom {
  display: flex;
  align-items: center;
  gap: 10px;
}

.crop__slider {
  width: clamp(90px, 22vw, 190px);
  height: 20px;
  margin: 0;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.crop__slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .22);
}

.crop__slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .22);
}

.crop__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45);
  transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.crop__slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45);
}

.crop__slider:active::-webkit-slider-thumb {
  transform: scale(1.15);
}

.crop__slider:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.crop__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.crop__ghost,
.crop__apply {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 140ms ease-out, transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.crop__ghost {
  background: transparent;
  color: rgba(255, 255, 255, .78);
}

.crop__ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, .12);
  color: #fff;
}

.crop__apply {
  padding: 0 18px;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}

.crop__apply:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 86%, #000 14%);
}

.crop__ghost:active:not(:disabled),
.crop__apply:active:not(:disabled) {
  transform: scale(.96);
}

.crop__ghost:disabled,
.crop__apply:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.crop-enter-active {
  transition: opacity 200ms ease-out;
}

.crop-leave-active {
  transition: opacity 160ms ease-in;
}

.crop-enter-active .crop__bar,
.crop-enter-active .crop__top {
  transition: transform 340ms cubic-bezier(0.34, 1.26, 0.64, 1), opacity 220ms ease-out;
}

.crop-enter-from,
.crop-leave-to {
  opacity: 0;
}

.crop-enter-from .crop__bar {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}

.crop-enter-from .crop__top {
  opacity: 0;
  transform: translateY(-12px);
}

@media (max-width: 640px) {
  .crop__bar {
    flex-direction: column;
    gap: 12px;
    border-radius: 20px;
  }

  .crop__slider {
    width: min(58vw, 220px);
  }
}

@media (prefers-reduced-motion: reduce) {

  .crop-enter-active,
  .crop-leave-active,
  .crop-enter-active .crop__bar,
  .crop-enter-active .crop__top,
  .crop__chip,
  .crop__ghost,
  .crop__apply {
    transition-duration: .01ms;
  }

  .crop-enter-from .crop__bar {
    transform: translateX(-50%);
  }

  .crop-enter-from .crop__top {
    transform: none;
  }

  .crop__chip:active:not(:disabled),
  .crop__ghost:active:not(:disabled),
  .crop__apply:active:not(:disabled),
  .crop__slider:active::-webkit-slider-thumb {
    transform: none;
  }
}
</style>
