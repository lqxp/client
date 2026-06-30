<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Text file" },
  sizeLabel: { type: String, default: "" }
});

const emit = defineEmits(["close"]);

const content = ref("");
const loading = ref(false);
const error = ref("");

const languageLabel = computed(() => {
  const ext = String(props.filename || "").split(".").pop()?.toLowerCase() || "txt";
  return ext === props.filename ? "txt" : ext;
});

async function loadText() {
  if (!props.src) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch(props.src);
    if (!response.ok) throw new Error("Could not load file preview.");
    content.value = await response.text();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not load file preview.";
    content.value = "";
  } finally {
    loading.value = false;
  }
}

function close() {
  emit("close");
}

function downloadFile() {
  const a = document.createElement("a");
  a.href = props.src;
  a.download = props.filename || "file.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openInNewTab() {
  window.open(props.src, "_blank", "noopener,noreferrer");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(() => props.src, loadText);

onMounted(() => {
  loadText();
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="text-viewer" role="dialog" aria-modal="true" :aria-label="`Text file preview: ${filename}`">
      <button class="text-viewer__scrim" type="button" aria-label="Close text preview" @click="close"></button>

      <div class="text-viewer__toolbar" role="toolbar" aria-label="Text file preview controls">
        <span class="text-viewer__badge">{{ languageLabel }}</span>
        <button type="button" aria-label="Download text file" @click="downloadFile">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        </button>
        <button type="button" aria-label="Open text file in new tab" @click="openInNewTab">
          <svg viewBox="0 0 24 24"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
        </button>
        <button class="text-viewer__close" type="button" aria-label="Close text preview" @click="close">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <figure class="text-viewer__stage" @click.self="close">
        <figcaption class="text-viewer__titlebar">
          <span class="text-viewer__traffic" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span class="text-viewer__title">{{ filename }}</span>
          <span class="text-viewer__size" v-if="sizeLabel">{{ sizeLabel }}</span>
        </figcaption>
        <div class="text-viewer__editor" role="region" :aria-label="`Text file content: ${filename}`">
          <div v-if="loading" class="text-viewer__state">Loading preview…</div>
          <div v-else-if="error" class="text-viewer__state">{{ error }}</div>
          <pre v-else class="text-viewer__code"><code>{{ content }}</code></pre>
        </div>
      </figure>
    </div>
  </Teleport>
</template>
