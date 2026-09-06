<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

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

const emit = defineEmits<{
  cancel: [];
  confirm: [file: File];
}>();

const stageEl = ref<HTMLDivElement | null>(null);
const imageEl = ref<HTMLImageElement | null>(null);

const loading = ref(false);
const confirming = ref(false);
const error = ref("");
const naturalW = ref(0);
const naturalH = ref(0);

const viewport = reactive({ x: 0, y: 0, w: 0, h: 0 });
const imageRect = reactive({ x: 0, y: 0, w: 0, h: 0 });
const zoomPct = ref(100);

const drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
let resizeObserver: ResizeObserver | null = null;

const coverScale = computed(() => {
  if (!naturalW.value || !naturalH.value || !viewport.w || !viewport.h) return 1;
  return Math.max(viewport.w / naturalW.value, viewport.h / naturalH.value);
});

function measureViewport() {
  const el = stageEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const pad = 28;
  const availW = Math.max(60, rect.width - pad * 2);
  const availH = Math.max(60, rect.height - pad * 2);
  let w = availW;
  let h = w / props.aspect;
  if (h > availH) {
    h = availH;
    w = h * props.aspect;
  }
  viewport.w = Math.round(w);
  viewport.h = Math.round(h);
  viewport.x = (rect.width - viewport.w) / 2;
  viewport.y = (rect.height - viewport.h) / 2;
}

function clampImage() {
  if (!naturalW.value || !naturalH.value || !viewport.w || !viewport.h) return;
  const iw = imageRect.w;
  const ih = imageRect.h;
  if (!iw || !ih) return;
  const minX = viewport.x + viewport.w - iw;
  const minY = viewport.y + viewport.h - ih;
  imageRect.x = Math.min(viewport.x, Math.max(minX, imageRect.x));
  imageRect.y = Math.min(viewport.y, Math.max(minY, imageRect.y));
}

function resetImage() {
  if (!naturalW.value || !naturalH.value || !viewport.w || !viewport.h) return;
  const s = coverScale.value;
  imageRect.w = naturalW.value * s;
  imageRect.h = naturalH.value * s;
  imageRect.x = viewport.x + (viewport.w - imageRect.w) / 2;
  imageRect.y = viewport.y + (viewport.h - imageRect.h) / 2;
  zoomPct.value = 100;
}

function applyZoomPct(nextRaw: number) {
  if (!naturalW.value || !naturalH.value) return;
  const next = Math.max(100, Math.min(800, nextRaw));
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

function onWheel(event: WheelEvent) {
  if (!naturalW.value || !naturalH.value) return;
  const factor = Math.exp(-event.deltaY * 0.0015);
  applyZoomPct(zoomPct.value * factor);
}

function onSliderInput(event: Event) {
  applyZoomPct(Number((event.target as HTMLInputElement).value));
}

function onPointerDown(event: PointerEvent) {
  if (!naturalW.value || !naturalH.value) return;
  drag.active = true;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.origX = imageRect.x;
  drag.origY = imageRect.y;
  const target = event.currentTarget as HTMLElement;
  if (target.setPointerCapture) target.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!drag.active) return;
  imageRect.x = drag.origX + (event.clientX - drag.startX);
  imageRect.y = drag.origY + (event.clientY - drag.startY);
  clampImage();
}

function onPointerEnd(event: PointerEvent) {
  if (!drag.active) return;
  drag.active = false;
  const target = event.currentTarget as HTMLElement;
  if (target.releasePointerCapture) {
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
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

function outputMimeType() {
  const mime = String(props.mimeType || "").toLowerCase();
  return mime === "image/jpeg" || mime === "image/jpg" ? "image/jpeg" : "image/png";
}

function confirmCrop() {
  if (loading.value || confirming.value || error.value || !naturalW.value || !naturalH.value) return;
  const img = imageEl.value;
  if (!img) return;

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
  const scaleFactor = Math.min(1, props.maxWidth / sw, props.maxHeight / sh);
  const ow = Math.max(1, Math.round(sw * scaleFactor));
  const oh = Math.max(1, Math.round(sh * scaleFactor));

  const canvas = document.createElement("canvas");
  canvas.width = ow;
  canvas.height = oh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

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
      const file = new File([blob], `crop-${Date.now()}.${ext}`, { type: outputMime });
      emit("confirm", file);
    },
    outputMime,
    outputMime === "image/jpeg" ? 0.92 : undefined,
  );
}

function cancel() {
  emit("cancel");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") cancel();
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      loading.value = Boolean(props.src);
      confirming.value = false;
      error.value = "";
      naturalW.value = 0;
      naturalH.value = 0;
      imageRect.x = 0;
      imageRect.y = 0;
      imageRect.w = 0;
      imageRect.h = 0;
      zoomPct.value = 100;
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
    } else {
      window.removeEventListener("keydown", onKeydown);
      resizeObserver?.disconnect();
      resizeObserver = null;
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
      <div v-if="open" class="crop-backdrop" @click.self="cancel">
        <div class="crop-modal" role="dialog" :aria-label="title">
          <header class="crop-head">
            <h2 class="crop-title">{{ title }}</h2>
            <button class="icon-btn" type="button" :aria-label="t('message.cancel')" @click="cancel">
              <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>

          <div
            ref="stageEl"
            class="crop-stage"
            @wheel.prevent="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerEnd"
            @pointercancel="onPointerEnd"
          >
            <img
              v-show="naturalW"
              ref="imageEl"
              class="crop-image"
              :src="src"
              draggable="false"
              :style="imageStyle"
              @load="onImageLoad"
              @error="onImageError"
              alt=""
            />
            <div v-show="naturalW" class="crop-frame" :style="frameStyle"></div>
            <div v-if="loading" class="crop-status">{{ t('crop.loading') }}</div>
            <div v-else-if="error" class="crop-status crop-status--error">{{ error }}</div>
          </div>

          <div class="crop-controls">
            <button type="button" class="btn--ghost" @click="resetImage">{{ t('crop.reset') }}</button>
            <div class="crop-zoom">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5M8.5 11h5M11 8.5v5" />
              </svg>
              <input :value="zoomPct" type="range" min="100" max="800" step="1"
                @input="onSliderInput" />
            </div>
          </div>

          <footer class="crop-foot">
            <button type="button" class="btn--ghost" @click="cancel">{{ t('message.cancel') }}</button>
            <button type="button" class="btn crop-confirm" :disabled="loading || confirming || !!error" @click="confirmCrop">
              {{ t('crop.apply') }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.crop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.62);
}

.crop-modal {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: var(--font);
}

.crop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 8px;
}

.crop-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.crop-stage {
  position: relative;
  height: min(52vh, 460px);
  min-height: 260px;
  margin: 8px 18px;
  overflow: hidden;
  border-radius: 12px;
  background: #000;
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.crop-stage:active {
  cursor: grabbing;
}

.crop-image {
  position: absolute;
  left: 0;
  top: 0;
  will-change: left, top, width, height;
  -webkit-user-drag: none;
}

.crop-frame {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.58);
  outline: 1px solid rgba(255, 255, 255, 0.92);
}

.crop-status {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.82);
  font-size: 14px;
  background: rgba(0, 0, 0, 0.35);
}

.crop-status--error {
  color: #ff8a8a;
}

.crop-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 18px 4px;
}

.crop-zoom {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.crop-zoom svg {
  flex: none;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: var(--muted);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.crop-zoom input[type="range"] {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.crop-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 18px 18px;
}

.crop-confirm {
  height: 36px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}

.crop-confirm:hover {
  background: color-mix(in srgb, var(--accent) 84%, #000 16%);
}

.crop-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.crop-enter-active,
.crop-leave-active {
  transition: opacity 160ms ease;
}

.crop-enter-active .crop-modal,
.crop-leave-active .crop-modal {
  transition: transform 180ms ease;
}

.crop-enter-from,
.crop-leave-to {
  opacity: 0;
}

.crop-enter-from .crop-modal,
.crop-leave-to .crop-modal {
  transform: translateY(12px) scale(0.98);
}

@media (max-width: 640px) {
  .crop-backdrop {
    padding: 0;
    align-items: flex-end;
  }

  .crop-modal {
    max-width: 100%;
    border-radius: 22px 22px 0 0;
  }

  .crop-stage {
    height: 48vh;
    margin: 6px 14px;
  }

  .crop-foot .btn--ghost {
    flex: 1;
    height: 46px;
  }

  .crop-confirm {
    flex: 1;
    height: 46px;
  }
}
</style>
