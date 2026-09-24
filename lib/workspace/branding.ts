/**
 * The tenant's identity mark in the shell (OW §12, §44, §51).
 *
 * Pure and dependency-free: the server resolves which logo the shell shows,
 * the browser draws initials when there is none or it fails to load, and the
 * platform console validates what may be stored, all with these rules.
 */

/** The largest inline logo accepted, in characters of its data URI: a small mark, not a banner. */
export const LOGO_DATA_URI_MAX = 96_000;

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
/** A path on this deployment: one leading slash (never `//host`), no backslash, whitespace or scheme. */
const SAME_ORIGIN_PATH = /^\/(?![/\\])[^\s\\]*$/;

/**
 * Whether the shell may draw this logo. The content security policy admits
 * images from this origin and inline data only, so an address elsewhere would
 * be blocked and leave a broken image; it is refused here instead (OW §51).
 * API routes are refused too: an image request carries the viewer's cookies.
 */
export function isShellLogoSource(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value.startsWith("data:")) return value.length <= LOGO_DATA_URI_MAX && DATA_IMAGE.test(value);
  return value.length <= 500 && SAME_ORIGIN_PATH.test(value) && !/^\/api(?:\/|$)/i.test(value);
}

/** What the audit trail records for a logo: its path, or the kind and size of an inline image — never the image. */
export function describeLogo(value: string | null | undefined): string | null {
  if (!value) return null;
  const inline = /^data:(image\/[a-z+]+);base64,/.exec(value);
  return inline ? `inline ${inline[1]}, ${Math.ceil(((value.length - inline[0].length) * 3) / 4 / 1024)} KB` : value;
}

/**
 * Which logo stands for the workspace (OW §12): the group's, then — in a
 * company workspace — the company's, then none, and the mark shows initials.
 * The Group workspace is the group's own, so a company's logo never stands for it.
 */
export function resolveShellLogo(input: { groupLogoUrl: string | null; companyLogoUrl: string | null; inGroup: boolean }): string | null {
  if (isShellLogoSource(input.groupLogoUrl)) return input.groupLogoUrl;
  if (!input.inGroup && isShellLogoSource(input.companyLogoUrl)) return input.companyLogoUrl;
  return null;
}

/**
 * Up to two initials for an organization's name (OW §12: "Northwind Group" →
 * "NG"). Words are letter-or-digit runs, so "Nord - Ndërtim" gives "NN"; one
 * word gives its first letter. Accents are kept ("Ëndërr" → "Ë").
 */
export function organizationInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words.slice(0, 2).map((word) => [...word][0]!.toLocaleUpperCase());
  return initials.join("") || "?";
}
