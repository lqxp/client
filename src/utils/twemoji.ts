export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ZWJ = 0x200d;
const VARIATION_SELECTOR = 0xfe0f;

export function twemojiSvgUrl(emoji: string): string {
  const symbols = Array.from(String(emoji || ""));
  const joined = symbols.some((symbol) => symbol.codePointAt(0) === ZWJ);
  const codepoints: string[] = [];
  for (const symbol of symbols) {
    const cp = symbol.codePointAt(0);
    if (!cp) continue;
    if (cp === VARIATION_SELECTOR && !joined) continue;
    codepoints.push(cp.toString(16));
  }
  if (!codepoints.length) return "";
  const base = String(import.meta.env?.BASE_URL || "./");
  return `${base}twemoji/svg/${codepoints.join("-")}.svg`;
}

const EMOJI_PATTERN = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)/gu;

function emojiToImages(text: string): string {
  return text.replace(EMOJI_PATTERN, (emoji) => {
    const url = twemojiSvgUrl(emoji);
    if (!url) return emoji;
    const safeAlt = escapeHtml(emoji);
    return `<img class="twemoji" data-twemoji="1" draggable="false" alt="${safeAlt}" src="${url}" onerror="this.replaceWith(document.createTextNode('${safeAlt}'))"/>`;
  });
}

export function renderEmojiHtml(value: unknown, options: { assumeHtml?: boolean } = {}): string {
  const raw = String(value || "");
  if (!raw) return "";
  if (!options.assumeHtml) return emojiToImages(escapeHtml(raw));
  return raw.replace(/<[^>]*>|[^<]+/g, (chunk) => (chunk.startsWith("<") ? chunk : emojiToImages(chunk)));
}
