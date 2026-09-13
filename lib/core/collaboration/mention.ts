/**
 * Mention markup (PRD #38 §31).
 *
 * The composer writes a mention as `@[Display name](memberId)`. The label is
 * cosmetic and never trusted: the server re-reads each member and renders the
 * name from the membership, so editing the markup cannot put words in
 * somebody's mouth. The id is not trusted either — every one is validated
 * against the company and the record before a mention exists.
 */

const MENTION_PATTERN = /@\[([^\]\n]{1,120})\]\(([A-Za-z0-9_-]{1,64})\)/g;

export const MAX_MENTIONS_PER_COMMENT = 20;

export function parseMentionIds(body: string): string[] {
  const ids: string[] = [];
  for (const match of body.matchAll(MENTION_PATTERN)) {
    if (!ids.includes(match[2])) ids.push(match[2]);
  }
  return ids;
}

export type CommentSegment =
  | { type: "text"; text: string }
  | { type: "mention"; memberId: string; name: string };

/**
 * Splits a body into text and mentions for rendering. A mention of somebody the
 * server does not recognise renders as its label text, not as a mention.
 */
export function segmentComment(body: string, names: ReadonlyMap<string, string>): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let cursor = 0;
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ type: "text", text: body.slice(cursor, start) });
    const name = names.get(match[2]);
    segments.push(name ? { type: "mention", memberId: match[2], name } : { type: "text", text: `@${match[1]}` });
    cursor = start + match[0].length;
  }
  if (cursor < body.length) segments.push({ type: "text", text: body.slice(cursor) });
  return segments;
}

/** The body as plain text, for a notification preview or a screen reader. */
export function plainText(body: string): string {
  return body.replace(MENTION_PATTERN, (_whole, label: string) => `@${label}`);
}
