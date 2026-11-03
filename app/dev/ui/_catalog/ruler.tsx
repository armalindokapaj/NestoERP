import { CatalogEntry, Specimen, SpecimenGroup } from "./frame";
import { RulerLabelSpecimen, RulerListSpecimen, RulerSwitch } from "./live";

/**
 * The Architectural Scroll Ruler (UI-02 §8). It cannot be shown in a box: it
 * measures the page it is on. So this page mounts it, with the entries above
 * as its sections, and this entry says where to find it and what to try.
 */
export function RulerEntry({ version }: { version: "1" | "2" }) {
  return (
    <CatalogEntry
      id="ruler"
      order={9}
      title="Scroll ruler"
      source="components/ui/scroll-ruler.tsx · page-sections.tsx · components/layout/page-sections.tsx · lib/ui/ruler-math.ts"
      summary="Where a long page is scrolled to, and its sections as places to go. A rail at the right edge of a wide window with a mouse; everywhere else the same links under an On this page button. It adds to the page's own scrolling and replaces none of it."
      notes={{
        props: "PageSections (server): template, rulerPolicy (eligible, never). PageSection: id (the stable anchor), label, order, availability. PageSectionLinks: none; it marks where On this page goes.",
        role: "The rail is a scrollbar: named, vertical, 0 to 100, with its value as words and the region it controls. At its head is a button, On this page, that opens the list of sections as a popover. The list, the label panel and the compact On this page are navigation landmarks holding real links.",
        keyboard: "On the rail: Up and Down move 40px, Page Up and Page Down one viewport, Home and End the ends. Enter on On this page opens the list at the section being read; Enter on a link scrolls there and focuses the heading. Escape closes the list and returns focus to what opened it; on the rail it hides the label, and focus stays.",
        events: "None to a caller. A section link scrolls the document and replaces the URL's hash; nothing is sent to the server and nothing is written to history.",
        precedence: "Off (the preference, or the kill switch) removes the rail. A blocking dialog hides it. Fewer than three sections, or a page that does not scroll, shows neither rail nor links. One overlay at a time: the open list hides the label and the panel. A drag wins over hover; Escape cancels it and puts the page back.",
        nesting: "Around a page's content, once. Each PageSection goes inside its section's heading. Never on a grid, a board, a timeline, a viewer or an endless list.",
        responsive: "The rail needs 1280px, a fine pointer and a page longer than 1.5 viewports. It stands in 44px the page keeps clear, or in the margin a window wider than the page already leaves, so it covers no content and moves nothing. Hover and focus show the panel of labels only over an empty gutter of 160px or more; with less, one label beside the marker. Otherwise On this page, at 44px targets under touch.",
        data: "The page owns its sections: each registers on mount and leaves on unmount, so a section the reader was not given never reaches the registry. The ruler reads the registry and the document's scroll position. When the page is left it remembers the section being read and the distance into it, for this tab, and Back returns there.",
        notApplicable: "Selected, loading, error, read-only, empty. A page with nothing to measure shows no ruler at all.",
        avoid: "A rail on a page whose main surface scrolls on its own, a section id taken from the visible order, a percentage shown on a page that does not scroll, or a panel of labels opened over the content being read.",
      }}
    >
      <SpecimenGroup title="On this page — live" hint="This page is the specimen. The sections are the entries above." className="block">
        {version === "2" ? (
          <div className="space-y-4 text-body text-fg-muted">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Resting, at 1280px and wider with a mouse: the rail is at the right edge of the window — a scale, the gold marker, and a list icon at its head.</li>
              <li>Hover it, or focus it from the keyboard: one label, for the section being read, beside the marker, and the position as a percentage.</li>
              <li>Press the list icon at its head, On this page: every section, in a popover. Escape closes it and focus returns.</li>
              <li>Widen the window past about 1640px: this page then leaves an empty gutter, and hover or focus opens the panel of labels over it instead.</li>
              <li>Narrower, on touch, or with the ruler off: an On this page button sits at the top of the entries, with the same links.</li>
              <li>From the keyboard: Tab from the entry links reaches On this page, which opens the rail&apos;s list.</li>
              <li>Scroll down, follow a link away, and come Back: the page returns to the section it was left in.</li>
            </ul>
            <RulerSwitch />
          </div>
        ) : (
          <p className="text-body text-fg-muted">Version 1 has no ruler. Switch the design to New at the top of the page to see it.</p>
        )}
      </SpecimenGroup>

      {version === "2" ? (
        <SpecimenGroup title="States" hint="The two things the rail shows beside itself, out of their place so they can be seen at any width. The sections are samples.">
          <Specimen label="Hover or focus, no gutter: the compact label">
            <RulerLabelSpecimen />
          </Specimen>
          <Specimen label="On this page, open: the list">
            <RulerListSpecimen />
          </Specimen>
        </SpecimenGroup>
      ) : null}
    </CatalogEntry>
  );
}
