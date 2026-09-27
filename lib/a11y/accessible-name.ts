import * as React from "react";

/**
 * Icon-only controls must carry a name (AUD-11 §3, AV-06).
 *
 * A pure check the shared Button runs in development: an icon-size button with
 * no `aria-label`, `aria-labelledby` or `title` and no text anywhere in its
 * children (an `sr-only` span counts — it is text) is announced as just
 * "button". Production renders skip the check entirely.
 */
type Labelled = {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  title?: string;
  children?: React.ReactNode;
};

export function hasTextContent(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (typeof node === "number" || typeof node === "bigint") return true;
  if (Array.isArray(node)) return node.some(hasTextContent);
  if (React.isValidElement(node)) {
    const props = node.props as Labelled & { "aria-hidden"?: boolean | "true" | "false" };
    if (props["aria-hidden"] === true || props["aria-hidden"] === "true") return false;
    if (props["aria-label"]?.trim() || props["aria-labelledby"]?.trim()) return true;
    return hasTextContent(props.children);
  }
  // Iterables and anything opaque (a lazy or async child): assume it may name itself.
  return true;
}

export function hasAccessibleName(props: Labelled): boolean {
  return Boolean(props["aria-label"]?.trim() || props["aria-labelledby"]?.trim() || props.title?.trim() || hasTextContent(props.children));
}

const warned = new Set<string>();

/** Development-only warning, once per call site signature; never throws. */
export function warnUnnamedIconControl(component: string, props: Labelled): void {
  if (process.env.NODE_ENV === "production" || hasAccessibleName(props)) return;
  const key = `${component}:${new Error().stack?.split("\n")[3] ?? ""}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[a11y] <${component}> is icon-only and has no accessible name. Pass aria-label (a contextual name, e.g. "Remove Jane Doe"), aria-labelledby, or visible/sr-only text (AUD-11 AV-06).`,
  );
}
