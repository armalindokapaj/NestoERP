import type { FullViewCopy } from "@/lib/i18n/site/full-view";

/** The Full View's sections, in page order; each id is an anchor on the page. */
export const FULL_VIEW_SECTIONS = [
  "overview",
  "problem",
  "modules",
  "roles",
  "lifecycle",
  "group",
  "experience",
  "security",
  "rozaris",
  "pricing",
  "faq",
] as const;

type SectionKey = (typeof FULL_VIEW_SECTIONS)[number];

/**
 * The Full View's section navigator (Landing + Full View PRD §65): sticky under
 * the site header, one row of anchors that scrolls sideways on a phone rather
 * than opening a menu. Plain links — no script, so it works before hydration
 * and for crawlers alike.
 */
export function FullViewSectionNav({
  labels,
  sections,
}: {
  labels: FullViewCopy["nav"];
  sections: readonly SectionKey[];
}) {
  return (
    <nav aria-label={labels.label} className="sticky top-16 z-20 border-b border-line bg-canvas/90 backdrop-blur-md" data-testid="full-view-nav">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
        <ul className="-mx-1 flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {sections.map((key) => (
            <li key={key} className="shrink-0">
              <a href={`#${key}`} className="block rounded-md px-3 py-1.5 text-table text-fg-muted hover:bg-hover hover:text-fg">
                {labels[key]}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
