/**
 * The install id cookie (MOB-11 §7, §11).
 *
 * The native shell generates a random id for its own install, keeps it in
 * secure storage and writes it to this cookie before sign-in, so the server can
 * tie a new session to the device row it belongs to. It is an identifier, not a
 * credential: knowing it grants nothing, and it can only ever be used to
 * restrict (a revoked install stays refused). Not HttpOnly on purpose — the
 * page has to write it — and never read for authorization.
 */
export const INSTALL_COOKIE = "nesto-install";

const INSTALL_ID = /^[A-Za-z0-9-]{16,64}$/;

export function isInstallId(value: unknown): value is string {
  return typeof value === "string" && INSTALL_ID.test(value);
}

export function installIdFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === INSTALL_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return isInstallId(value) ? value : null;
    }
  }
  return null;
}
