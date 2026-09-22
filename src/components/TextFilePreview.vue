<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

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

const highlightedContent = computed(() => highlightSyntax(content.value, languageLabel.value));

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function spanToken(className: string, value: string) {
  return `<span class="syntax-${className}">${escapeHtml(value)}</span>`;
}

function highlightSyntax(value: string, extension: string) {
  const ext = String(extension || "txt").toLowerCase();
  const source = String(value || "");
  if (!source) return "";

  if (["html", "vue", "xml", "svelte"].includes(ext)) {
    return escapeHtml(source).replace(
      /(&lt;\/?)([\w:-]+)([^&]*?)(\/?&gt;)/g,
      (_match: string, open: string, tag: string, attrs: string, close: string) => `${open}${spanToken("tag", tag)}${attrs.replace(/([\w:-]+)(=)(&quot;.*?&quot;|&#39;.*?&#39;)/g, (_attr: string, name: string, eq: string, attrValue: string) => `${spanToken("attr", name)}${eq}${spanToken("string", attrValue.replace(/^&quot;|&quot;$/g, '"').replace(/^&#39;|&#39;$/g, "'"))}`)}${close}`
    );
  }

  if (["json"].includes(ext)) {
    return escapeHtml(source).replace(
      /(&quot;(?:\\.|[^&])*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g,
      (match, stringValue, colon, literal) => {
        if (stringValue) return `${spanToken(colon ? "key" : "string", stringValue.replace(/^&quot;|&quot;$/g, '"'))}${colon || ""}`;
        if (literal) return spanToken("literal", literal);
        return spanToken("number", match);
      }
    );
  }

  if (["css", "scss"].includes(ext)) {
    return escapeHtml(source).replace(
      /(\/\*[\s\S]*?\*\/)|(&quot;.*?&quot;|&#39;.*?&#39;)|(#(?:[0-9a-f]{3,8})\b)|\b([a-z-]+)(\s*:)|([{}])/gi,
      (match, comment, stringValue, color, property, colon, brace) => {
        if (comment) return spanToken("comment", comment);
        if (stringValue) return spanToken("string", stringValue.replace(/^&quot;|&quot;$/g, '"').replace(/^&#39;|&#39;$/g, "'"));
        if (color) return spanToken("number", color);
        if (property) return `${spanToken("key", property)}${colon}`;
        if (brace) return spanToken("punct", brace);
        return match;
      }
    );
  }

  if (["md", "markdown"].includes(ext)) {
    return escapeHtml(source).replace(
      /(^|\n)(#{1,6}\s.*)|(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g,
      (match, lineStart, heading, inlineCode, bold, link) => {
        if (heading) return `${lineStart || ""}${spanToken("tag", heading)}`;
        if (inlineCode) return spanToken("string", inlineCode);
        if (bold) return spanToken("keyword", bold);
        if (link) return spanToken("attr", link);
        return match;
      }
    );
  }

  const keywordExtensions = ["bat", "c", "cpp", "cs", "go", "java", "js", "jsx", "lua", "php", "py", "rb", "rs", "sh", "sql", "ts", "tsx"];
  if (!keywordExtensions.includes(ext)) return escapeHtml(source);

  const keywords = "abstract|and|as|async|await|break|case|catch|class|const|continue|def|default|defer|delete|do|else|enum|export|extends|false|final|finally|fn|for|from|func|function|go|if|implements|import|in|interface|let|match|mod|new|null|or|package|private|protected|public|return|self|static|struct|super|switch|this|throw|trait|true|try|type|typeof|use|var|void|while|yield";
  const codeRegex = new RegExp(`(//.*|#.*|/\\*[\\s\\S]*?\\*/)|(\\"(?:\\\\.|[^\\"])*\\"|'(?:\\\\.|[^'])*'|\`(?:\\\\.|[^\`])*\`)|(\\b(?:${keywords})\\b)|(-?\\b\\d+(?:\\.\\d+)?\\b)`, "g");
  return escapeHtml(source).replace(codeRegex, (match, comment, stringValue, keyword, numberValue) => {
    if (comment) return spanToken("comment", comment);
    if (stringValue) return spanToken("string", stringValue);
    if (keyword) return spanToken("keyword", keyword);
    if (numberValue) return spanToken("number", numberValue);
    return match;
  });
}

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

/**
 * Leaving starts the exit and the parent hears about it only once the exit
 * has played, so it can unmount us without cutting the motion off.
 */
const visible = ref(true);

function close() {
  visible.value = false;
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
    <Transition name="qx-viewer" :duration="{ enter: 340, leave: 220 }" appear
      @after-leave="emit('close')">
    <div v-if="visible" class="text-viewer" role="dialog" aria-modal="true" :aria-label="t('textPreview.dialogLabel', { name: filename })">
      <button class="text-viewer__scrim" type="button" :aria-label="t('textPreview.close')" @click="close"></button>

      <div class="text-viewer__toolbar" role="toolbar" :aria-label="t('textPreview.controls')">
        <span class="text-viewer__badge">{{ languageLabel }}</span>
        <button type="button" :aria-label="t('textPreview.download')" @click="downloadFile">
          <Icon name="download" viewBox="0 0 24 24" />
        </button>
        <button type="button" :aria-label="t('textPreview.openTab')" @click="openInNewTab">
          <Icon name="open-external" viewBox="0 0 24 24" />
        </button>
        <button class="text-viewer__close" type="button" :aria-label="t('textPreview.close')" @click="close">
          <Icon name="close" viewBox="0 0 24 24" />
        </button>
      </div>

      <figure class="text-viewer__stage" data-viewer-stage @click.self="close">
        <figcaption class="text-viewer__titlebar">
          <span class="text-viewer__title">{{ filename }}</span>
          <span class="text-viewer__size" v-if="sizeLabel">{{ sizeLabel }}</span>
        </figcaption>
        <div class="text-viewer__editor" role="region" :aria-label="t('textPreview.contentLabel', { name: filename })">
          <div v-if="loading" class="text-viewer__state">{{ t('textPreview.loading') }}</div>
          <div v-else-if="error" class="text-viewer__state">{{ error }}</div>
          <pre v-else class="text-viewer__code"><code v-html="highlightedContent"></code></pre>
        </div>
      </figure>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.text-viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: calc(76px + var(--app-safe-top)) 28px 32px;
  isolation: isolate;
}

.text-viewer__scrim {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(circle at 50% 44%, rgba(42, 42, 48, 0.72), rgba(0, 0, 0, 0.92) 62%),
    rgba(0, 0, 0, 0.86);
  backdrop-filter: blur(5px);
}

.text-viewer__toolbar {
  position: absolute;
  top: calc(18px + var(--app-safe-top) + var(--app-chrome-top, 0px));
  right: 20px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 16px;
  background: rgba(32, 30, 38, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.36);
}

.text-viewer__toolbar button,
.text-viewer__badge {
  min-width: 38px;
  height: 38px;
  display: inline-grid;
  place-items: center;
  padding: 0 10px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.76);
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
}

.text-viewer__toolbar button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  transform: translateY(-1px);
}

.text-viewer__toolbar svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.text-viewer__close {
  margin-left: 4px;
  background: rgba(255, 255, 255, 0.06);
}

.text-viewer__stage {
  position: relative;
  z-index: 1;
  width: min(92vw, 1100px);
  height: min(calc(var(--app-viewport-height) - 130px), 760px);
  margin: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  background: rgba(18, 18, 22, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.52);
}

.text-viewer__titlebar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 0 10px 0 14px;
  background: linear-gradient(180deg, rgba(49, 49, 55, 0.96), rgba(31, 31, 36, 0.96));
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.84);
  font-size: 12.5px;
}

.text-viewer__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.text-viewer__size {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.5);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.text-viewer__editor {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: rgba(10, 11, 14, 0.94);
}

.text-viewer__code {
  margin: 0;
  padding: 16px 18px;
  color: rgba(244, 247, 251, 0.9);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  tab-size: 2;
  white-space: pre;
}

.text-viewer__state {
  padding: 24px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12.5px;
}

@media (max-width: 760px) {
  .text-viewer {
      padding: calc(82px + var(--app-safe-top)) 14px 24px;
    }

  .text-viewer__toolbar {
      top: calc(12px + var(--app-safe-top) + var(--app-chrome-top, 0px));
      right: 12px;
      left: 12px;
      justify-content: flex-end;
      overflow-x: auto;
    }

  .text-viewer__stage {
      width: calc(100vw - 28px);
      height: calc(var(--app-viewport-height) - 150px - var(--app-safe-top));
    }
}
</style>
