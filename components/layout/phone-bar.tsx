"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Home, Layers3, Menu, NestoProjects, Plus, X, type IconComponent } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { usePanelOpen } from "@/lib/navigation/panel-host";
import { PHONE_HOME, PHONE_MENU, SALES_UNITS, placeOf, projectIdFrom, projectsHref, readLastProject, rememberLastProject, type PhonePlace } from "@/lib/navigation/phone";
import { cn } from "@/lib/utils/cn";

/**
 * The event New raises; Quick Create listens for it (components/layout/quick-create.tsx)
 * and opens — or, when it is already open, closes. Its `detail.opener` is the
 * button pressed, so focus can go back to it.
 */
export const OPEN_QUICK_CREATE_EVENT = "nesto:open-quick-create";

/**
 * The phone's bar, below `lg` (docs/ui/UI-04-navigation-layouts.md):
 *
 *   Home · Projects · New · Sales units · Menu
 *
 * Places, not actions: Home is your day; Projects the project you were last in
 * (the list when there is none); Sales units every unit with its status, price
 * and buyer, each opening its sales page (/sales/units), for everyone who may
 * see units; Menu the five departments, search and you.
 * New is the one action, set apart in ink: it opens Quick Create, the field's
 * four first, and reads Close while open. Inbox is in the top bar, beside
 * search (components/layout/phone-inbox.tsx).
 *
 * Glass like the top bar (82% of the page and a 14px blur), equal cells
 * divided by lines, the place you are in marked by a 2px gold line on top.
 * One height, 64px, whatever the page does: it never changes size while
 * scrolling. Content keeps clear of it by `--nesto-bottom-nav-space`
 * (styles/globals.css), so no page pads itself; it steps aside for the
 * keyboard there too.
 */
export function PhoneBar({ canCreate, canSeeUnits }: { canCreate: boolean; canSeeUnits: boolean }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const place = placeOf(pathname);
  const workspace = useRecordNavigation()?.workspace.key ?? null;

  // Projects goes to the project you were last in. Read after mount: storage is the
  // browser's, and the first render matches the server's.
  const [lastProject, setLastProject] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!workspace) return;
    const current = projectIdFrom(pathname);
    if (current) rememberLastProject(workspace, current);
    setLastProject(current ?? readLastProject(workspace));
  }, [pathname, workspace]);

  return (
    <nav
      aria-label={t("phone.label")}
      data-mobile-bottom-nav="bar"
      data-testid="phone-navigation"
      className="fixed inset-x-0 bottom-0 z-(--nesto-z-shell-tabs) border-t border-line-strong pb-(--nesto-safe-bottom) lg:hidden"
    >
      {/* Glass on a layer behind the bar, as the top bar's: a backdrop filter on the bar would trap New's sheet inside it. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/82 backdrop-blur-[14px] backdrop-saturate-[1.3]" />
      <ul className="mx-auto grid h-16 max-w-xl grid-flow-col auto-cols-fr">
        <Place place="home" here={place} href={PHONE_HOME} icon={Home} label={t("phone.home")} />
        <Place place="projects" here={place} href={projectsHref(lastProject)} icon={NestoProjects} label={t("phone.projects")} />
        {canCreate ? <NewButton /> : null}
        {canSeeUnits ? <Place place="units" here={place} href={SALES_UNITS} icon={Layers3} label={t("phone.units")} /> : null}
        <Place place="menu" here={place} href={PHONE_MENU} icon={Menu} label={t("phone.menu")} />
      </ul>
    </nav>
  );
}

/** One cell: an icon over a 12px label, the whole cell the target. */
const cell =
  "relative flex h-full w-full flex-col items-center justify-center gap-1.5 text-meta font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function Place({ place, here, href, icon: Icon, label }: { place: PhonePlace; here: PhonePlace; href: string; icon: IconComponent; label: string }) {
  const current = place === here;
  const pending = usePendingDestination(href);
  return (
    <li className="min-w-0 border-l border-line first:border-l-0">
      <Link
        href={href}
        navSource="mobile"
        intent
        aria-current={current ? "page" : undefined}
        data-pending={pending || undefined}
        data-testid={`phone-place-${place}`}
        onNavigate={() => emitNavigationEvent("navigation_destination_opened", { module: place, source: "phone_bar" })}
        className={cn(
          cell,
          current
            ? "text-fg before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-accent"
            : "text-fg-subtle hover:bg-hover hover:text-fg",
        )}
      >
        <Icon aria-hidden="true" className="size-[22px] shrink-0" />
        <span className="max-w-full truncate px-1">{label}</span>
        {pending ? <PendingDot className="absolute right-2 top-2 text-accent" /> : null}
      </Link>
    </li>
  );
}

/** New, in ink: opens Quick Create; while it is open the same cell closes it. */
function NewButton() {
  const t = useTranslations("shell");
  const [open] = usePanelOpen("quick_create");
  const Icon = open ? X : Plus;
  return (
    <li data-new="" className="min-w-0">
      <button
        type="button"
        aria-label={open ? t("phone.closeNew") : t("phone.new")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="phone-create"
        onClick={(event) => {
          // One event either way: Quick Create opens on it, and closes when it is already open.
          if (!open) emitNavigationEvent("quick_create_opened", { source: "phone_bar" });
          window.dispatchEvent(new CustomEvent(OPEN_QUICK_CREATE_EVENT, { detail: { opener: event.currentTarget } }));
        }}
        className={cn(cell, "bg-primary text-primary-fg hover:bg-primary-hover")}
      >
        <Icon aria-hidden="true" className="size-6 shrink-0" />
        <span aria-hidden="true">{open ? t("phone.close") : t("phone.new")}</span>
      </button>
    </li>
  );
}
