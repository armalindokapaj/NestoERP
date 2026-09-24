/**
 * The Projects gallery's shape and words, shared by the cards, the page and the
 * route's loading skeleton — which is a server component, so none of this may
 * live in a client module.
 */

/**
 * One card a row on a phone, two on a tablet, three on a desktop and four on a
 * large one (Projects Workspace Grid §39, §40, §143). Never more than four: with
 * the shell's content width capped, a card stays a card on an ultra-wide
 * screen (§157).
 */
export const GALLERY_GRID = "grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 sm:gap-x-5 sm:gap-y-8 lg:grid-cols-3 lg:gap-x-6 min-[1440px]:grid-cols-4";

/**
 * The portrait render from two columns up (§41). A phone's one full-width
 * column shows it landscape, so a screen holds more than one project (§152).
 */
export const COVER_ASPECT = "aspect-[4/3] sm:aspect-[3/4]";

/** "1 project", "11 projects". */
export function projectCountLabel(count: number): string {
  return `${count} ${count === 1 ? "project" : "projects"}`;
}
