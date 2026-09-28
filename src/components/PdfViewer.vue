<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Document" },
  mimeType: { type: String, default: "" },
  sizeLabel: { type: String, default: "" }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const emit = defineEmits(["close"]);

/**
 * Leaving starts the exit and the parent hears about it only once the exit
 * has played, so it can unmount us without cutting the motion off.
 */
const visible = ref(true);

function close() {
  visible.value = false;
}

function download() {
  const a = document.createElement("a");
  a.href = props.src;
  a.download = downloadFilename.value;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const downloadFilename = computed(() => {
  const raw = String(props.filename || "Document").trim() || "Document";
  if (/\.pdf$/i.test(raw)) return raw;
  return `${raw}.pdf`;
});

/**
 * A PDF can embed scriptable content, so it must never sit in a sandboxed
 * frame: tests show `sandbox` (even with `allow-same-origin`) leaves every
 * desktop viewer on a blank page — Firefox's pdf.js needs scripts, Chrome
 * refuses the viewer plugin inside a sandbox. `<object>` renders with the
 * browser's native viewer and, where none exists (some mobile WebViews),
 * falls back to the download panel instead of a white page.
 */
function openInNewTab() {
  if (/^blob:/i.test(props.src)) {
    // A blob: URL opened top-level would run on this very origin: offer the
    // download instead (same rule as images).
    download();
    return;
  }
  window.open(props.src, "_blank", "noopener,noreferrer");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
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
    <div v-if="visible" class="pdf-viewer" role="dialog" aria-modal="true" :aria-label="t('pdfViewer.dialogLabel', { name: filename })">
      <button class="pdf-viewer__scrim" type="button" :aria-label="t('pdfViewer.close')" @click="close"></button>

      <div class="pdf-viewer__toolbar" role="toolbar" :aria-label="t('pdfViewer.controls')">
        <button type="button" :aria-label="t('pdfViewer.download')" @click="download">
          <Icon name="download" viewBox="0 0 24 24" />
        </button>
        <button type="button" :aria-label="t('pdfViewer.openTab')" @click="openInNewTab">
          <Icon name="open-external" viewBox="0 0 24 24" />
        </button>
        <button class="pdf-viewer__close" type="button" :aria-label="t('pdfViewer.close')" @click="close">
          <Icon name="close" viewBox="0 0 24 24" />
        </button>
      </div>

      <figure class="pdf-viewer__stage" data-viewer-stage @click.self="close">
        <object
          class="pdf-viewer__frame"
          :data="src"
          type="application/pdf"
          :aria-label="t('pdfViewer.dialogLabel', { name: filename })"
        >
          <div class="pdf-viewer__fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6" />
              <path d="M9 17h4" />
            </svg>
            <p>{{ t('pdfViewer.noPreview') }}</p>
            <button type="button" class="pdf-viewer__fallback-btn" @click="download">
              {{ t('pdfViewer.download') }}
            </button>
          </div>
        </object>
        <figcaption class="pdf-viewer__caption">
          <span>{{ filename }}</span>
          <span v-if="sizeLabel">{{ sizeLabel }}</span>
        </figcaption>
      </figure>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pdf-viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 76px 28px 32px;
  isolation: isolate;
}

.pdf-viewer__scrim {
  position: absolute;
  inset: 0;
  z-index: 0;
  cursor: zoom-out;
  background: rgba(0, 0, 0, 0.86);
  backdrop-filter: blur(5px);
}

.pdf-viewer__toolbar {
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

.pdf-viewer__toolbar button {
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

.pdf-viewer__toolbar button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transform: translateY(-1px);
}

.pdf-viewer__toolbar svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pdf-viewer__close {
  margin-left: 4px;
  background: rgba(255, 255, 255, 0.06);
}

.pdf-viewer__stage {
  position: relative;
  z-index: 1;
  width: min(96vw, 1100px);
  height: 100%;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

.pdf-viewer__frame {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  border: 0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
}

.pdf-viewer__fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
  min-height: 240px;
  padding: 32px;
  text-align: center;
  color: #3a3a40;
}

.pdf-viewer__fallback svg {
  width: 44px;
  height: 44px;
  color: #8a8a93;
}

.pdf-viewer__fallback p {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.pdf-viewer__fallback-btn {
  padding: 10px 20px;
  border: 0;
  border-radius: 999px;
  background: var(--accent, #2090ea);
  color: #fff;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.pdf-viewer__caption {
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

.pdf-viewer__caption span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pdf-viewer__caption span+span {
  flex: none;
  color: rgba(255, 255, 255, 0.54);
}

@media (max-width: 760px) {
  .pdf-viewer {
      padding: calc(82px + var(--app-safe-top)) 14px 24px;
    }

  .pdf-viewer__toolbar {
      top: calc(12px + var(--app-safe-top) + var(--app-chrome-top, 0px));
      right: 12px;
      overflow-x: auto;
    }

  .pdf-viewer__stage {
      width: 100%;
    }

  .pdf-viewer__caption {
      max-width: calc(100vw - 28px);
    }
}
</style>
