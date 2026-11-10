/**
 * Which look the product is drawn in (docs/ui/UI-03-vertical-look.md).
 *
 * The interface calls these "Theme 1" and "Theme 2". In code a theme is
 * already the colour scheme (theme-state.ts), so this is the "look": 1 is the
 * original — warm ivory, gold, serif titles — and 2 is the Vertical look,
 * declared in styles/look-2.css under `:root[data-look="2"]`. Look 1 renders
 * no attribute, so nothing in look-2.css can reach it. Each look has a light
 * and a dark scheme.
 *
 * A cookie, like the colour scheme beside this file and for the same reason:
 * the server renders the attribute in the first byte of HTML, so a page never
 * paints one look and then jumps to the other. It is a per-browser choice.
 *
 * Pure on purpose — no `next/headers` — so the client control, the server
 * reader (look-server.ts) and the tests share one rule.
 */

export const LOOK_COOKIE = "nesto.look";

export const LOOKS = ["1", "2"] as const;

export type Look = (typeof LOOKS)[number];

/** Anything but "2" is look 1: an absent, stale or tampered cookie gets the default. */
export function readLook(value: string | undefined): Look {
  return value === "2" ? "2" : "1";
}

/** The value for `data-look` on <html>. Look 1 deliberately renders nothing. */
export function lookAttribute(look: Look): "2" | undefined {
  return look === "2" ? "2" : undefined;
}
