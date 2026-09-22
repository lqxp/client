<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Image" },
  mimeType: { type: String, default: "" },
  sizeLabel: { type: String, default: "" }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const emit = defineEmits(["close"]);

const scale = ref(1);

const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`);

const downloadFilename = computed(() => {
  const raw = String(props.filename || "Image").trim() || "Image";
  if (/\.[a-z0-9]{2,8}$/i.test(raw)) return raw;
  const src = String(props.src || "");
  const cleanPath = src.split("?")[0]?.split("#")[0] || "";
  const extFromPath = cleanPath.match(/\.([a-z0-9]{2,8})$/i)?.[1];
  if (extFromPath) return `${raw}.${extFromPath}`;
  if (src.startsWith("data:image/")) {
    const extFromData = src.match(/^data:image\/([a-z0-9+.-]+);/i)?.[1]?.replace("jpeg", "jpg");
    if (extFromData) return `${raw}.${extFromData}`;
  }
  return `${raw}.png`;
});

/**
 * Leaving starts the exit and the parent hears about it only once the exit
 * has played, so it can unmount us without cutting the motion off.
 */
const visible = ref(true);

function close() {
  visible.value = false;
}

function zoomIn() {
  scale.value = Math.min(3, Number((scale.value + 0.25).toFixed(2)));
}

function zoomOut() {
  scale.value = Math.max(0.5, Number((scale.value - 0.25).toFixed(2)));
}

function resetZoom() {
  scale.value = 1;
}

function download() {
  const a = document.createElement("a");
  a.href = props.src;
  a.download = downloadFilename.value;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Opening a blob: URL makes a top-level document on this very origin, so a
 * scriptable payload would run with full access to local storage. The viewer
 * only ever shows rasters, but this is the door that would let one out, so it
 * checks rather than trusts what it was handed.
 */
function openInNewTab() {
  if (/^blob:/i.test(props.src) && !/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(props.mimeType)) {
    download();
    return;
  }
  window.open(props.src, "_blank", "noopener,noreferrer");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
  if ((event.ctrlKey || event.metaKey) && event.key === "+") {
    event.preventDefault();
    zoomIn();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "-") {
    event.preventDefault();
    zoomOut();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "0") {
    event.preventDefault();
    resetZoom();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="qx-viewer" :duration="{ enter: 340, leave: 220 }" appear
      @after-leave="emit('close')">
    <div v-if="visible" class="image-viewer" role="dialog" aria-modal="true" :aria-label="t('imageViewer.dialogLabel', { name: filename })">
      <button class="image-viewer__scrim" type="button" :aria-label="t('imageViewer.close')" @click="close"></button>

      <div class="image-viewer__toolbar" role="toolbar" :aria-label="t('imageViewer.controls')">
        <button type="button" :aria-label="t('imageViewer.zoomOut')" @click="zoomOut">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M16.5 16.5 21 21"/></svg>
        </button>
        <button type="button" :aria-label="t('imageViewer.resetZoom')" @click="resetZoom">{{ scaleLabel }}</button>
        <button type="button" :aria-label="t('imageViewer.zoomIn')" @click="zoomIn">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M16.5 16.5 21 21"/></svg>
        </button>
        <button type="button" :aria-label="t('imageViewer.download')" @click="download">
          <Icon name="download" viewBox="0 0 24 24" />
        </button>
        <button type="button" :aria-label="t('imageViewer.openTab')" @click="openInNewTab">
          <Icon name="open-external" viewBox="0 0 24 24" />
        </button>
        <button class="image-viewer__close" type="button" :aria-label="t('imageViewer.close')" @click="close">
          <Icon name="close" viewBox="0 0 24 24" />
        </button>
      </div>

      <figure class="image-viewer__stage" data-viewer-stage @click.self="close">
        <img
          :src="src"
          :alt="filename"
          class="image-viewer__image"
          :style="{ transform: `scale(${scale})` }"
        />
        <figcaption class="image-viewer__caption">
          <span>{{ filename }}</span>
          <span v-if="sizeLabel">{{ sizeLabel }}</span>
        </figcaption>
      </figure>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 76px 28px 32px;
  isolation: isolate;
}

.image-viewer__scrim {
  position: absolute;
  inset: 0;
  z-index: 0;
  cursor: zoom-out;
  background: rgba(0, 0, 0, 0.86);
  backdrop-filter: blur(5px);
}

.image-viewer__toolbar {
  position: absolute;
  top: calc(18px + var(--app-safe-top) + var(--app-chrome-top, 0px));
  right: 20px;
  left: auto;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 16px;
  background: rgba(32, 30, 38, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.36);
}

.image-viewer__toolbar button {
  min-width: 38px;
  height: 38px;
  display: inline-grid;
  place-items: center;
  padding: 0 10px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.76);
  font-size: 12px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.image-viewer__toolbar button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transform: translateY(-1px);
}

.image-viewer__toolbar svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.image-viewer__close {
  margin-left: 4px;
  background: rgba(255, 255, 255, 0.06);
}

.image-viewer__stage {
  position: relative;
  z-index: 1;
  max-width: 100%;
  max-height: 100%;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.image-viewer__image {
  max-width: min(92vw, 1400px);
  max-height: calc(var(--app-viewport-height) - 150px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
  transform-origin: center;
  transition: transform var(--dur-fast) var(--ease-out);
}

.image-viewer__caption {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(92vw, 720px);
  padding: 8px 13px;
  border-radius: 999px;
  background: rgba(18, 18, 21, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
  font-size: 12.5px;
  white-space: nowrap;
}

.image-viewer__caption span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.image-viewer__caption span+span {
  flex: none;
  color: rgba(255, 255, 255, 0.54);
}

@media (max-width: 760px) {
  .image-viewer {
      padding: calc(82px + var(--app-safe-top)) 14px 24px;
    }

  .image-viewer__toolbar {
      top: calc(12px + var(--app-safe-top) + var(--app-chrome-top, 0px));
      right: 12px;
      overflow-x: auto;
    }

  .image-viewer__image {
      max-height: calc(var(--app-viewport-height) - 170px - var(--app-safe-top));
    }

  .image-viewer__caption {
      max-width: calc(100vw - 28px);
    }
}
</style>
