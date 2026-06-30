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
          <span class="text-viewer__title">{{ filename }}</span>
          <span class="text-viewer__size" v-if="sizeLabel">{{ sizeLabel }}</span>
        </figcaption>
        <div class="text-viewer__editor" role="region" :aria-label="`Text file content: ${filename}`">
          <div v-if="loading" class="text-viewer__state">Loading preview…</div>
          <div v-else-if="error" class="text-viewer__state">{{ error }}</div>
          <pre v-else class="text-viewer__code"><code v-html="highlightedContent"></code></pre>
        </div>
      </figure>
    </div>
  </Teleport>
</template>
