import { escapeHtml, renderEmojiHtml } from "@/utils/twemoji";

export interface MarkdownOptions {
  isKnownMention: (username: string) => boolean;
  labels: { copyCode: string; copy: string; spoilerHidden: string };
  origin?: string;
}

interface ListLevel {
  level: number;
  liOpen: boolean;
}

const DEFAULT_ORIGIN = typeof window !== "undefined" ? window.location.origin : "http://localhost";

export function safeHref(value: unknown, origin = DEFAULT_ORIGIN): string {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw, origin);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return escapeHtml(raw);
  } catch {
    return "";
  }
  return "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

function unescapeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name]);
}

export function codeBlockLabel(value: unknown): string {
  return String(value || "").trim().replace(/^```+/, "").replace(/[`<>]/g, "").slice(0, 40);
}

export function renderMarkdownLists(value: unknown): string {
  const lines = String(value || "").split("\n");
  const stack: ListLevel[] = [];
  let html = "";

  const openList = (level: number) => {
    if (!stack.length && html && !html.endsWith("\n")) html += "\n";
    html += '<ul class="markdown__list">';
    stack.push({ level, liOpen: false });
  };
  const closeItem = (entry: ListLevel | undefined) => {
    if (!entry?.liOpen) return;
    html += "</li>";
    entry.liOpen = false;
  };
  const closeList = () => {
    closeItem(stack.pop());
    html += "</ul>";
  };

  for (const line of lines) {
    const match = /^([ \t]*)-\s+(.+)$/.exec(line);
    if (!match) {
      while (stack.length) closeList();
      if (html) html += "\n";
      html += line;
      continue;
    }

    let level = Math.floor(match[1].replace(/\t/g, "  ").length / 2);
    if (!stack.length) openList(0);

    let top = stack[stack.length - 1];
    if (level > top.level && !top.liOpen) level = top.level;
    if (level > top.level + 1) level = top.level + 1;

    while (stack.length && level < stack[stack.length - 1].level) closeList();
    while (level > stack[stack.length - 1].level) openList(stack[stack.length - 1].level + 1);

    top = stack[stack.length - 1];
    closeItem(top);
    html += `<li>${match[2].trim()}`;
    top.liOpen = true;
  }

  while (stack.length) closeList();
  return html;
}

// Discord quotes: "> " quotes a line, ">>> " quotes the rest of the message.
function markQuotes(html: string, open: () => string, close: () => string): string {
  const out: string[] = [];
  const quote: string[] = [];
  let quoting = false;
  const flush = () => {
    if (!quoting) return;
    out.push(`${open()}\n${quote.join("\n")}\n${close()}`);
    quote.length = 0;
    quoting = false;
  };
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const rest = /^&gt;&gt;&gt; (.*)$/.exec(lines[i]);
    if (rest) {
      quote.push(rest[1], ...lines.slice(i + 1));
      quoting = true;
      break;
    }
    const line = /^&gt; (.*)$/.exec(lines[i]);
    if (line) {
      quote.push(line[1]);
      quoting = true;
    } else {
      flush();
      out.push(lines[i]);
    }
  }
  flush();
  return out.join("\n");
}

// Placeholders use a control character no inline rule can match or a user can type.
const MARK = "\u0001";

export function renderMarkdown(value: unknown, options: MarkdownOptions): string {
  const tokens: [string, string][] = [];
  const hold = (html: string) => {
    const token = `${MARK}${tokens.length}${MARK}`;
    tokens.push([token, html]);
    return token;
  };
  const { labels } = options;

  let html = escapeHtml(String(value ?? "").replaceAll(MARK, ""));
  html = html.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, rawLabel: string, code: string) => {
    const label = codeBlockLabel(rawLabel);
    const title = label ? `<span class="codeblock__label">${escapeHtml(label)}</span>` : "<span></span>";
    const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const copyButton = `<button class="codeblock__copy" type="button" data-code-copy aria-label="${escapeHtml(labels.copyCode)}">${copyIcon}<span>${escapeHtml(labels.copy)}</span></button>`;
    return hold(`<div class="codeblock"><div class="codeblock__head">${title}${copyButton}</div><pre><code>${code.replace(/\n$/, "")}</code></pre></div>`);
  });
  const quoteOpens: string[] = [];
  const quoteCloses: string[] = [];
  html = markQuotes(
    html,
    () => {
      const token = hold('<blockquote class="markdown__quote">');
      quoteOpens.push(token);
      return token;
    },
    () => {
      const token = hold("</blockquote>");
      quoteCloses.push(token);
      return token;
    },
  );
  html = html.replace(/^(#{1,4})[ \t]+(.+)$/gm, (_, marks: string, title: string) =>
    `${hold(`<h${marks.length} class="markdown__h markdown__h${marks.length}">`)}${title.trim()}${hold(`</h${marks.length}>`)}`
  );
  html = renderMarkdownLists(html).replace(/<\/?(?:ul|li)(?: class="markdown__list")?>/g, hold);
  html = html.replace(/``([^`\n]*)``/g, (_, code: string) => hold(`<code>${code}</code>`));
  html = html.replace(/`([^`\n]*)`/g, (_, code: string) => hold(`<code>${code}</code>`));
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match: string, label: string, href: string) => {
    // The text is escaped already; the href is checked and escaped from its real value.
    const safe = safeHref(unescapeHtml(href), options.origin);
    if (!safe) return match;
    return hold(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });
  html = html
    .replace(/(^|[^a-zA-Z0-9_.])@([a-z0-9_.]{2,32})(?=$|[^a-zA-Z0-9_.])/gi, (match: string, prefix: string, username: string) =>
      options.isKnownMention(username)
        ? `${prefix}<span class="mention" data-mention="${escapeHtml(username)}" role="button" tabindex="0">@${username}</span>`
        : match
    )
    .replace(
      /\|\|([^\n|]+)\|\|/g,
      `<span class="spoiler" data-spoiler role="button" tabindex="0" aria-label="${escapeHtml(labels.spoilerHidden)}">$1</span>`
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");

  for (const token of quoteOpens) html = html.replaceAll(`${token}<br>`, token);
  for (const token of quoteCloses) html = html.replaceAll(`<br>${token}<br>`, token).replaceAll(`<br>${token}`, token);
  for (const [token, held] of tokens.reverse()) html = html.replaceAll(token, held);
  return renderEmojiHtml(html, { assumeHtml: true });
}
