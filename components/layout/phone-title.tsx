"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight, Search, X } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRegisteredBreadcrumbs } from "@/components/navigation/breadcrumb-registry";
import Link from "@/components/navigation/nav-link";
import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import { pageNameFrom } from "@/components/navigation/section-store";
import type { Crumb, CrumbSwitcher } from "@/components/ui/breadcrumbs";
import { isPlaceRoot, PROJECTS_ROOT } from "@/lib/navigation/phone";
import { cn } from "@/lib/utils/cn";

/**
 * The top bar's start below `lg` (docs/ui/UI-04-navigation-layouts.md §Phone):
 * where you are, and nothing else but search, which follows it.
 *
 * - The title: inside a project, the project's name, which drops your other
 *   projects from the bar when tapped (the layout's own switcher, so only
 *   projects this person may open); elsewhere, the page's own name.
 * - Back, in a cell of its own, on any page that is not one of the five
 *   places' first pages: there the bar is the way out.
 */
export function PhoneTitle({ up, backLabel }: { /** A shell without record history (the Admin Console): where Back goes, null on a first page. */ up?: string | null; backLabel?: string } = {}) {
  const pathname = usePathname();
  const navigation = useRecordNavigation();
  const t = useTranslations("shell");
  const crumbs = useRegisteredBreadcrumbs();
  const project = projectCrumb(crumbs);
  const pageName = usePageName();
  const back = up !== undefined ? Boolean(up) : navigation?.canGoBack && !isPlaceRoot(pathname);
  const backClass = "grid w-14 shrink-0 place-items-center border-r border-line-strong text-fg transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <div className="flex h-full min-w-0 flex-1 items-stretch self-stretch lg:hidden" data-testid="phone-title">
      {back && up ? (
        <Link href={up} navSource="mobile" aria-label={backLabel ?? t("phone.back")} data-testid="phone-back" className={backClass}>
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
      ) : back ? (
        <button type="button" onClick={() => navigation?.goBack()} aria-label={t("phone.back")} data-testid="phone-back" className={backClass}>
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
      ) : null}
      {project ? (
        <ProjectSwitcher name={project.label} switcher={project.switcher} />
      ) : (
        <span className="flex min-w-0 flex-1 items-center px-4 font-display text-[1.625rem] font-medium leading-none tracking-(--nesto-tracking-display) text-fg sm:px-6" data-testid="phone-page-title">
          <span className="truncate">
            {pageName ?? " "}
            {pageName ? <TitleSquare /> : null}
          </span>
        </span>
      )}
    </div>
  );
}

/** The project crumb the project layout registered, with its switcher; null outside a project. */
function projectCrumb(crumbs: Crumb[] | null): (Crumb & { switcher?: CrumbSwitcher }) | null {
  if (!crumbs) return null;
  for (let index = crumbs.length - 1; index >= 0; index -= 1) {
    const crumb = crumbs[index]!;
    if (crumb.switcher) return crumb;
  }
  return null;
}

/**
 * Your projects, dropped from the bar as glass, the one you are on marked
 * Here, a field above them once there are enough to look for, every project
 * one tap below. Closed by its own button, a tap beside it, Escape or Back,
 * and by any navigation.
 */
function ProjectSwitcher({ name, switcher }: { name: string; switcher?: CrumbSwitcher }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const items = switcher?.items ?? [];
  const choice = items.length > 1;

  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!choice) {
    return (
      <span className="flex min-w-0 flex-1 items-center px-4 font-display text-[1.625rem] font-medium leading-none tracking-(--nesto-tracking-display) text-fg sm:px-6" data-testid="phone-page-title">
        <span className="truncate">
          {name}
          <TitleSquare />
        </span>
      </span>
    );
  }

  const text = query.trim().toLowerCase();
  const shown = text ? items.filter((item) => item.label.toLowerCase().includes(text)) : items;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("phone.switchProject", { name })}
        data-testid="phone-project-switch"
        className="flex min-w-0 flex-1 items-center gap-2 px-4 text-left font-display text-[1.625rem] font-medium leading-none tracking-(--nesto-tracking-display) text-fg transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
      >
        <span className="truncate">
          {name}
          <TitleSquare />
        </span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <>
          <button type="button" tabIndex={-1} aria-label={t("phone.close")} onClick={() => setOpen(false)} className="fixed inset-x-0 bottom-0 top-(--nesto-topbar-row-h) z-40 bg-[rgb(15_20_26/0.28)]" />
          <div
            id={panelId}
            role="dialog"
            aria-label={switcher?.label ?? t("phone.projects")}
            data-testid="phone-project-list"
            className="fixed inset-x-0 top-(--nesto-topbar-row-h) z-50 flex max-h-[min(72dvh,40rem)] flex-col border-b border-line-strong"
          >
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/86 backdrop-blur-[16px] backdrop-saturate-[1.3]" />
            {items.length > 6 ? (
              <label className="mx-4 mt-4 flex h-12 shrink-0 items-center gap-3 border border-line-strong bg-surface px-4 focus-within:ring-2 focus-within:ring-ring">
                <Search aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
                <span className="sr-only">{t("phone.findProject")}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("phone.findProject")}
                  className="h-full min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:appearance-none"
                />
              </label>
            ) : null}
            <p className="nesto-eyebrow shrink-0 px-4 pb-2.5 pt-4 text-fg-subtle sm:px-6">{t("phone.yourProjects")}</p>
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
              {shown.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    navSource="mobile"
                    aria-current={item.current ? "page" : undefined}
                    className={cn("flex min-h-14 items-center gap-3 border-b border-line px-4 text-body transition-colors hover:bg-hover sm:px-6", item.current ? "font-semibold text-fg" : "text-fg")}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.current ? (
                      <span className="inline-flex h-6 shrink-0 items-center border border-accent bg-accent-soft px-2 font-mono text-meta font-medium uppercase tracking-[0.06em] text-accent-strong">{t("phone.here")}</span>
                    ) : (
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    )}
                  </Link>
                </li>
              ))}
              {shown.length === 0 ? (
                <li role="status" className="px-4 py-6 text-center text-table text-fg-muted sm:px-6">
                  {t("phone.noProject")}
                </li>
              ) : null}
            </ul>
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-1 sm:px-6">
              <Link href={PROJECTS_ROOT} navSource="mobile" className="inline-flex min-h-12 items-center gap-1.5 font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg hover:text-accent-strong">
                {t("phone.allProjects")}
                <ChevronRight aria-hidden="true" className="size-3.5" />
              </Link>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("phone.close")} className="grid size-12 place-items-center text-fg-muted hover:bg-hover hover:text-fg">
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/**
 * The page's own name (section-store.ts, `pageNameFrom`): its title, else the
 * first part of the document's title. Read again as the page streams in or
 * its title changes, so it follows a navigation without a reload.
 */
function usePageName(): string | null {
  const pathname = usePathname();
  const [name, setName] = React.useState<string | null>(null);
  React.useEffect(() => {
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
  }, [pathname]);
  return name;
}

/** The gold square a title ends on, as the page titles on a desktop and the site's headings (UI-07). */
function TitleSquare() {
  return <span aria-hidden="true" className="ml-[0.06em] inline-block size-[0.15em] bg-accent" />;
}
