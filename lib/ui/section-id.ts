/**
 * A section's stable anchor from a configuration key (UI-02 §26.3): the
 * route-local kebab-case id a page section registers under and its link points
 * at ("needsAttention" → "needs-attention"). It names the section, never its
 * place in the visible order, so a reader whose page has fewer sections lands
 * on the same anchor.
 */
export function sectionAnchorId(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
