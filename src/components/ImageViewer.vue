<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Image" },
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

function close() {
  emit("close");
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

function openInNewTab() {
  window.open(props.src, "_blank", "noopener,noreferrer");
}

function onKeydown(event) {
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
    <div class="image-viewer" role="dialog" aria-modal="true" :aria-label="`Image preview: ${filename}`">
      <button class="image-viewer__scrim" type="button" :aria-label="t('imageViewer.close')" @click="close"></button>

      <div class="image-viewer__toolbar" role="toolbar" aria-label="Image preview controls">
        <button type="button" :aria-label="t('imageViewer.zoomOut')" @click="zoomOut">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M16.5 16.5 21 21"/></svg>
        </button>
        <button type="button" :aria-label="t('imageViewer.resetZoom')" @click="resetZoom">{{ scaleLabel }}</button>
        <button type="button" :aria-label="t('imageViewer.zoomIn')" @click="zoomIn">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M16.5 16.5 21 21"/></svg>
        </button>
        <button type="button" :aria-label="t('imageViewer.download')" @click="download">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        </button>
        <button type="button" :aria-label="t('imageViewer.openTab')" @click="openInNewTab">
          <svg viewBox="0 0 24 24"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
        </button>
        <button class="image-viewer__close" type="button" :aria-label="t('imageViewer.close')" @click="close">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <figure class="image-viewer__stage" @click.self="close">
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
  </Teleport>
</template>
