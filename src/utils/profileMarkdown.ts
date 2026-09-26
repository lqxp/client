import { escapeHtml } from "@/utils/twemoji";
import { safeHref } from "@/utils/markdown";

// Marqueur de fragment : un caractère de contrôle que l'utilisateur ne peut
// pas saisir, retiré de l'entrée (même garde que utils/markdown.ts, K1).
const MARK = "\u0001";

/** Markdown léger de la description de profil : gras, italique, citation `>`, lien. */
export function renderProfileMarkdown(value: unknown, origin?: string): string {
  const tokens: Array<[string, string]> = [];
  const hold = (html: string) => {
    const token = `${MARK}${tokens.length}${MARK}`;
    tokens.push([token, html]);
    return token;
  };

  let text = String(value ?? "").replaceAll(MARK, "");

  text = text.replace(/(^|\n)((?:>[^\n]*(?:\n|$))+)/g, (_match, prefix: string, block: string) => {
    const inner = String(block)
      .split("\n")
      .filter(Boolean)
      .map((line) => escapeHtml(line.replace(/^>\s?/, "").trim()))
      .join("<br>");
    return `${prefix}${hold(`<blockquote>${inner}</blockquote>`)}`;
  });

  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match: string, label: string, href: string) => {
    if (href.includes(MARK) || label.includes(MARK)) return match;
    const safe = safeHref(href, origin);
    if (!safe) return match;
    return hold(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
  });

  let html = escapeHtml(text);
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");

  for (const [token, held] of tokens) html = html.replaceAll(token, held);
  return html.replaceAll(MARK, "");
}
