/**
 * Safe rich text for announcements (PRD #45 §17). Pure and client-safe.
 *
 * A body is plain text with a small, fixed vocabulary — headings (`#`, `##`,
 * `###`), paragraphs, `**bold**`, `*italic*`, bulleted (`-`) and numbered
 * (`1.`) lists, `> ` callouts and `[links](https://…)`. It is parsed into a
 * tree that is rendered as React elements; nothing is ever inserted as HTML,
 * and a link whose target is not http, https, mailto or an in-app path is
 * shown as its text.
 */

export type Inline = { type: "text"; text: string } | { type: "strong"; children: Inline[] } | { type: "em"; children: Inline[] } | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "callout"; children: Inline[] };

const SAFE_LINK = /^(https?:\/\/[^\s]+|mailto:[^\s]+|\/(?!\/)[^\s]*)$/i;

export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return SAFE_LINK.test(trimmed) ? trimmed : null;
}

export function parseInline(source: string): Inline[] {
  const result: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) result.push({ type: "text", text });
    text = "";
  };
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const strong = /^\*\*(.+?)\*\*/.exec(rest);
    if (strong) {
      flush();
      result.push({ type: "strong", children: parseInline(strong[1]) });
      index += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?!\s)(.+?)(?<!\s)\1/.exec(rest);
    if (em) {
      flush();
      result.push({ type: "em", children: parseInline(em[2]) });
      index += em[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flush();
      const href = safeHref(link[2]);
      if (href) result.push({ type: "link", href, children: parseInline(link[1]) });
      else result.push({ type: "text", text: link[1] });
      index += link[0].length;
      continue;
    }
    text += source[index];
    index += 1;
  }
  flush();
  return result;
}

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let callout: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    if (callout.length) blocks.push({ type: "callout", children: parseInline(callout.join(" ")) });
    paragraph = [];
    list = null;
    callout = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2].trim()) });
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered && !bullet);
      if (paragraph.length || callout.length || (list && list.ordered !== ordered)) flush();
      list = list ?? { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1].trim());
    } else if (quote) {
      if (paragraph.length || list) flush();
      callout.push(quote[1].trim());
    } else {
      if (list || callout.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

function inlineText(nodes: Inline[]): string {
  return nodes.map((node) => (node.type === "text" ? node.text : inlineText(node.children))).join("");
}

/** The words of a body with the markup gone, for excerpts, search and notifications. */
export function plainText(body: string): string {
  return parseBody(body)
    .map((block) => (block.type === "list" ? block.items.map(inlineText).join("; ") : inlineText(block.children)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(body: string, length = 220): string {
  // Headings are signposts, not the message: an excerpt reads the text itself.
  const blocks = parseBody(body).filter((block) => block.type !== "heading");
  const text = (blocks.length ? blocks : parseBody(body))
    .map((block) => (block.type === "list" ? block.items.map(inlineText).join("; ") : inlineText(block.children)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), length - 20)).trimEnd()}…`;
}
