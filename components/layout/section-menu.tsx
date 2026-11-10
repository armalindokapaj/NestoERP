"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, ExternalLink } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useSectionLevels } from "@/components/navigation/section-registry";
import { hasCurrentSection, menuLevels, pageNameFrom, pillFor, type SectionItem, type SectionLevel } from "@/components/navigation/section-store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { cn } from "@/lib/utils/cn";

/**
 * The section pill: the top right of the top bar on phones and tablets (below
 * `lg`), where a page's tab rows are not drawn. It names the section the page
 * is on — "Sales ▾" — and opens the page's sections as one menu, the current
 * one marked. On a record inside a tabbed page (a unit inside its project) the
 * menu holds both levels, each under its own name, and the pill names the
 * innermost. A page without sections shows nothing here.
 *
 * Its sections are what the page's tab rows registered (section-registry.tsx):
 * already filtered by permission, so the menu offers nothing the row would not
 * have. From `lg` the rows are drawn and this is not rendered at all.
 *
 * The pill always names the page the person is on. A page reachable from its
 * context but in none of its rows (a project's Media) is marked by no level;
 * the pill then carries the page's own name (`usePageName`), never the row's.
 */
export function SectionMenu() {
  const levels = menuLevels(useSectionLevels());
  const pageName = usePageName(levels.length > 0 && !hasCurrentSection(levels));
  const pill = pillFor(levels, pageName);
  if (!pill) {
    // Before the page has hydrated its rows have not registered yet; a page that has sections keeps the pill's
    // place meanwhile (`data-section-level`, styles/globals.css), so the bar does not shift when it arrives.
    return (
      <span aria-hidden="true" data-section-pill-placeholder className="hidden h-11 shrink-0 place-items-center pl-1 lg:hidden">
        <span className="h-9 w-24 rounded-full border border-accent/30 bg-accent-soft/40 look2:border-line look2:bg-surface" />
      </span>
    );
  }
  return <SectionPill levels={levels} label={pill.label} current={pill.item} />;
}

function SectionPill({ levels, label, current }: { levels: SectionLevel[]; label: string; current: SectionItem | null }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  // Set when the menu closes because a section was chosen: focus then goes to the new page, not back to the pill.
  const navigated = React.useRef(false);
  const headingBase = React.useId();

  // A completed navigation closes it, so nothing is left over the new page.
  React.useEffect(() => setOpen(false), [pathname]);

  // So does turning a tablet to landscape (1024px and up), where the pill is not drawn and the tab rows are.
  React.useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  const grouped = levels.length > 1;
  const choose = (item: SectionItem) => {
    emitNavigationEvent("navigation_destination_opened", { section: item.key, source: "section_menu" });
    navigated.current = !item.newTab;
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          navigated.current = false;
          emitNavigationEvent("section_menu_opened", { levels: levels.length, section: current?.key ?? null });
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("sectionMenu.trigger", { section: label })}
          data-testid="section-menu-trigger"
          className="group grid h-11 min-w-11 shrink-0 place-items-center pl-1 focus-visible:outline-none lg:hidden"
        >
          <span
            className={cn(
              "inline-flex h-9 max-w-[min(11rem,40vw)] items-center gap-1.5 rounded-full border border-accent/35 bg-accent-soft/60 pl-3.5 pr-2.5 text-table font-semibold text-fg shadow-sm transition-[background-color,color,border-color,transform] duration-150",
              // Theme 2: a white pill with a hairline, ink while its menu is open.
              "look2:border-line look2:bg-surface look2:font-medium look2:shadow-none look2:group-hover:border-line-strong look2:group-aria-expanded:border-primary look2:group-aria-expanded:bg-primary look2:group-aria-expanded:text-primary-fg",
              "group-hover:border-accent/60 group-active:scale-[0.97] group-focus-visible:ring-2 group-focus-visible:ring-ring",
              "group-aria-expanded:border-accent group-aria-expanded:bg-accent group-aria-expanded:text-accent-fg",
            )}
          >
            <span className="min-w-0 truncate" data-testid="section-menu-current">
              {label}
            </span>
            <ChevronDown aria-hidden="true" strokeWidth={2} className="size-4 shrink-0 transition-transform duration-200 group-aria-expanded:rotate-180" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        aria-label={grouped ? t("sectionMenu.title") : levels[0]!.label}
        data-testid="section-menu"
        className="w-[min(18rem,calc(100vw-1.5rem))] p-1.5 lg:hidden"
        // Opens on the section the page is on, so the arrow keys start from where the person is.
        onOpenAutoFocus={(event) => {
          const root = event.target as HTMLElement | null;
          const target = root?.querySelector<HTMLElement>('a[aria-current="page"]') ?? root?.querySelector<HTMLElement>("a[href]");
          if (!target) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          if (!navigated.current) return;
          // The route's own focus handling takes the person to the new page (components/layout/route-focus.tsx).
          navigated.current = false;
          event.preventDefault();
        }}
      >
        <div onKeyDown={moveFocus} className="space-y-1">
          {levels.map((level, index) => {
            const headingId = `${headingBase}-${index}`;
            return (
              <div
                key={level.id}
                role={grouped ? "group" : undefined}
                aria-labelledby={grouped ? headingId : undefined}
                className={cn(grouped && index > 0 && "border-t border-line/70 pt-1")}
                data-testid="section-menu-level"
              >
                {grouped ? (
                  <p id={headingId} className="nesto-eyebrow truncate px-3 pb-1 pt-2 text-accent-strong look2:text-fg-subtle">
                    {level.label}
                  </p>
                ) : null}
                <ul>
                  {level.items.map((item) => (
                    <li key={item.key}>
                      <SectionLink item={item} onChoose={() => choose(item)} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SectionLink({ item, onChoose }: { item: SectionItem; onChoose: () => void }) {
  const pending = usePendingDestination(item.newTab ? null : item.href);
  return (
    <Link
      href={item.href}
      navSource="tab"
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
      aria-current={item.active ? "page" : undefined}
      data-active={item.active || undefined}
      data-pending={pending || undefined}
      onClick={onChoose}
      className={cn(
        "relative flex min-h-11 items-center gap-3 rounded-2xl px-3 text-body font-medium transition-colors look2:rounded-[9px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        item.active ? "bg-accent-soft text-accent-strong look2:bg-primary look2:text-primary-fg" : "text-fg hover:bg-hover active:bg-hover",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.count ? <span className="shrink-0 rounded-full bg-surface-muted px-1.5 text-meta tabular-nums text-fg-muted">{item.count}</span> : null}
      {pending ? <PendingDot className="text-accent" /> : null}
      {item.newTab ? <ExternalLink aria-hidden="true" strokeWidth={1.6} className="size-4 shrink-0 text-fg-subtle" /> : null}
      {item.active ? <Check aria-hidden="true" strokeWidth={2.2} className="size-4 shrink-0" /> : null}
    </Link>
  );
}

/**
 * The page's own name (section-store.ts, `pageNameFrom`), read while `enabled`
 * — only when no level marks the page — and again as the page streams in or
 * its title changes, so it follows a navigation without a reload.
 */
function usePageName(enabled: boolean): string | null {
  const pathname = usePathname();
  const [name, setName] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) {
      setName(null);
      return;
    }
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setName(pageNameFrom(document.getElementById("nesto-main"), document.title)));
    };
    read();
    const observer = new MutationObserver(read);
    const main = document.getElementById("nesto-main");
    if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, pathname]);
  return enabled ? name : null;
}

/** Up and Down move between the sections, Home and End to the first and the last; Tab still works as ever. */
function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const links = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href]")];
  if (links.length === 0) return;
  const index = links.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : event.key === "ArrowDown" ? (index + 1) % links.length : (index - 1 + links.length) % links.length;
  event.preventDefault();
  links[next]?.focus();
}
