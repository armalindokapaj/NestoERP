/**
 * The public origin every link NESTO sends is built from (PRD #14 §241,
 * PRD #38 §162).
 *
 * Configuration, never a request header: a spoofed `Host` must not be able to
 * point an invitation, a reset link or a notification email at somebody else's
 * site. `APP_URL` wins, then the validated `NEXT_PUBLIC_APP_URL`, then the
 * marketing origin, so an existing deployment keeps working whichever of the
 * three it set.
 */
export function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

/** An absolute link to an application path. Only same-origin paths are accepted. */
export function appLink(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("appLink accepts an application path, not a URL.");
  }
  return `${appUrl()}${path}`;
}
