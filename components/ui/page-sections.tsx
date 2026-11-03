"use client";

import * as React from "react";

import { PAGE_SCROLL_REGION, type PageTemplate, type RulerPolicy } from "@/lib/ui/page-contract";
import { cn } from "@/lib/utils/cn";

/**
 * The page/section registry (UI-02 §26.3).
 *
 * A page that has sections worth navigating mounts one provider and marks each
 * section's heading with `PageSection`. The Architectural Scroll Ruler and the
 * "On this page" links (components/ui/scroll-ruler.tsx) read the registry; they
 * never search the page for headings, and they never guess which container
 * scrolls — the page declares it.
 *
 * A section registers when it mounts and leaves when it unmounts, so the
 * registry holds exactly what the reader was given: a section the server did
 * not render — no permission, not planned for this role — never reaches it,
 * its labels or the DOM (§8.6), and a route change takes the old route's
 * sections with it.
 */

/** Decided per route in lib/ui/page-contract.ts, which the route register is checked against. */
export type { PageTemplate } from "@/lib/ui/page-contract";

export type UiSection = {
  /** Stable, route-local, kebab-case: the anchor in the URL. Never the visible ordinal. */
  id: string;
  /** The heading as the reader sees it, already in their language. */
  label: string;
  order: number;
  /** The heading: what the ruler measures and what keyboard activation focuses. */
  element: HTMLElement | null;
  /** The empty element that carries the id; it stands in while the heading is not laid out (a heading hidden at this width). */
  anchor: HTMLElement | null;
  availability: "visible" | "loading" | "unavailable";
};

export type PageUiContract = {
  template: PageTemplate;
  /** The element the ruler says it controls. Its scroller is the document in every shell today. */
  scrollRegionId: string;
  rulerPolicy: RulerPolicy;
  /** Only sections the reader was given, in page order. */
  registeredSections: UiSection[];
  /** Where the page puts its "On this page" links (`PageSectionLinks`); `null` is the top of the page. */
  linksSlot: HTMLElement | null;
};

type Registry = { register: (section: UiSection) => () => void; setLinksSlot: (element: HTMLElement | null) => void };

const RegistryContext = React.createContext<Registry | null>(null);
const ContractContext = React.createContext<PageUiContract | null>(null);

/** Mounted once by a page (through components/layout/page-sections.tsx, which keeps it out of version 1). */
export function PageSectionsProvider({
  template,
  scrollRegionId = PAGE_SCROLL_REGION,
  rulerPolicy = "eligible",
  children,
}: {
  template: PageTemplate;
  scrollRegionId?: string;
  rulerPolicy?: PageUiContract["rulerPolicy"];
  children: React.ReactNode;
}) {
  const [sections, setSections] = React.useState<UiSection[]>([]);
  const [linksSlot, setLinksSlot] = React.useState<HTMLElement | null>(null);

  // Stable for the provider's life, so a section registers once, not on every change to the list.
  const registry = React.useMemo<Registry>(
    () => ({
      register(section) {
        setSections((current) => [...current.filter((entry) => entry.id !== section.id), section].sort((a, b) => a.order - b.order));
        return () => setSections((current) => current.filter((entry) => entry !== section));
      },
      setLinksSlot,
    }),
    [],
  );

  const contract = React.useMemo<PageUiContract>(
    () => ({ template, scrollRegionId, rulerPolicy, registeredSections: sections, linksSlot }),
    [template, scrollRegionId, rulerPolicy, sections, linksSlot],
  );

  return (
    <RegistryContext.Provider value={registry}>
      <ContractContext.Provider value={contract}>{children}</ContractContext.Provider>
    </RegistryContext.Provider>
  );
}

/** The page's contract, or `null` on a page that mounted no provider. */
export function usePageSections(): PageUiContract | null {
  return React.useContext(ContractContext);
}

/**
 * Marks one section. Put it inside the section's heading; anywhere else it
 * stands for the place it is put (the top of a page whose title sits lower).
 *
 * Under a provider it renders the section's anchor — an empty element carrying
 * the stable id, so `#id` is a real target for a link opened in a new tab — and
 * registers the heading. Without one (version 1, or a page that is not wired)
 * it renders nothing at all.
 */
export function PageSection({
  id,
  label,
  order,
  availability = "visible",
}: {
  id: string;
  label: string;
  order: number;
  availability?: UiSection["availability"];
}) {
  const registry = React.useContext(RegistryContext);
  const anchor = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!registry) return;
    const span = anchor.current;
    const parent = span?.parentElement ?? null;
    const element = parent?.matches("h1, h2, h3, h4, h5, h6") ? parent : span;
    return registry.register({ id, label, order, element, anchor: span, availability });
  }, [registry, id, label, order, availability]);

  if (!registry) return null;
  // Out of flow, so it takes no room and no gap wherever it is put: in a heading, a flex row, a spaced stack.
  //
  // Inside a heading it is never focused: the heading is. Standing for a place of its own it is what
  // keyboard activation focuses (§8.5), and an empty box can show no focus and say nothing — so while
  // it has keyboard focus it carries the section's name, drawn as a small label with the focus ring.
  return (
    <span
      ref={anchor}
      id={id}
      data-page-section=""
      data-label={label}
      className={cn(
        "pointer-events-none absolute outline-none",
        "focus-visible:z-(--nesto-z-sticky) focus-visible:rounded-sm focus-visible:bg-surface focus-visible:px-2 focus-visible:py-1 focus-visible:text-meta focus-visible:font-semibold focus-visible:text-fg",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:before:content-[attr(data-label)]",
      )}
    />
  );
}

/**
 * Where the "On this page" links go on a page whose title should come first:
 * put it under the page's heading. Without it the links open the page. It
 * takes no room of its own, and — like `PageSection` — renders nothing without
 * a provider.
 */
export function PageSectionLinks() {
  const registry = React.useContext(RegistryContext);
  if (!registry) return null;
  return <div ref={registry.setLinksSlot} data-page-links="" className="contents" />;
}
