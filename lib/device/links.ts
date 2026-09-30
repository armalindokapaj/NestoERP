/**
 * Link classification and deep-link resolution (MOB-08 §30, §31, §52, §53).
 * Pure functions: no DOM, no Capacitor, so they are unit-tested and shared by
 * the web and native adapters.
 */
export type LinkKind = "internal" | "external-web" | "tel" | "mailto" | "blocked";

export function classifyLink(rawUrl: string, appOrigin: string): LinkKind {
  let url: URL;
  try {
    url = new URL(rawUrl, appOrigin);
  } catch {
    return "blocked";
  }
  if (url.protocol === "tel:") return "tel";
  if (url.protocol === "mailto:") return "mailto";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "blocked";
  if (url.origin === new URL(appOrigin).origin) return "internal";
  return url.protocol === "https:" ? "external-web" : "blocked";
}

/**
 * The in-app path for a URL the OS opened the app with, or null. It resolves
 * only URLs on the NESTO origin and only to a path + query: a deep link is a
 * request to navigate, never a grant of access — the route's own auth and
 * `requireModule()` decide what is shown (§31).
 */
export function resolveDeepLink(rawUrl: string, appOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(appOrigin).origin) return null;
  // Never bounce through the auth or API surface from a link.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A push payload's `path`, accepted only when it is a same-app absolute path. */
export function safePushPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (value.startsWith("/api/") || value.startsWith("/_next/")) return null;
  return value;
}
