"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Home, Inbox, Menu, NestoProjects, Plus, X, type IconComponent } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useUnreadActivity } from "@/components/layout/activity-bell";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { usePanelOpen } from "@/lib/navigation/panel-host";
import { PHONE_HOME, PHONE_INBOX, PHONE_MENU, placeOf, projectIdFrom, projectsHref, readLastProject, rememberLastProject, type PhonePlace } from "@/lib/navigation/phone";
import { cn } from "@/lib/utils/cn";

/**
 * The event New raises; Quick Create listens for it (components/layout/quick-create.tsx)
 * and opens — or, when it is already open, closes. Its `detail.opener` is the
 * button pressed, so focus can go back to it.
 */
export const OPEN_QUICK_CREATE_EVENT = "nesto:open-quick-create";

/**
 * The phone's bar of five places, below `lg` (docs/ui/UI-04-navigation-layouts.md):
 *
 *   Home · Projects · New · Inbox · Menu
 *
 * Places, not actions: Home is your day; Projects the project you were last in
 * (the list when there is none); Inbox your approvals and alerts; Menu the
 * five departments, search and you. New is the one action, set apart in ink:
 * it opens Quick Create, the field's four first, and reads Close while open.
 *
 * Glass like the top bar (82% of the page and a 14px blur), five equal cells
 * divided by lines, the place you are in marked by a 2px gold line on top.
 * It folds to its icons, 48px, while you scroll down, and comes back as soon
 * as you scroll up. Content keeps clear of it by `--nesto-bottom-nav-space`
 * (styles/globals.css), so no page pads itself; it steps aside for the
 * keyboard there too.
 */
export function PhoneBar({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const place = placeOf(pathname);
  const workspace = useRecordNavigation()?.workspace.key ?? null;
  const folded = useFoldOnScroll();
  const unread = useUnreadActivity();

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
      data-folded={folded || undefined}
      data-testid="phone-navigation"
      className="fixed inset-x-0 bottom-0 z-(--nesto-z-shell-tabs) border-t border-line-strong pb-(--nesto-safe-bottom) lg:hidden"
    >
      {/* Glass on a layer behind the bar, as the top bar's: a backdrop filter on the bar would trap New's sheet inside it. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-canvas/82 backdrop-blur-[14px] backdrop-saturate-[1.3]" />
      <ul className={cn("mx-auto grid max-w-xl transition-[height] duration-200", canCreate ? "grid-cols-5" : "grid-cols-4", folded ? "h-12" : "h-16")}>
        <Place place="home" here={place} href={PHONE_HOME} icon={Home} label={t("phone.home")} folded={folded} />
        <Place place="projects" here={place} href={projectsHref(lastProject)} icon={NestoProjects} label={t("phone.projects")} folded={folded} />
        {canCreate ? <NewButton folded={folded} /> : null}
        <Place
          place="inbox"
          here={place}
          href={PHONE_INBOX}
          icon={Inbox}
          label={t("phone.inbox")}
          folded={folded}
          count={unread && unread > 0 ? unread : null}
          countLabel={unread ? t("phone.inboxCount", { count: unread }) : undefined}
        />
        <Place place="menu" here={place} href={PHONE_MENU} icon={Menu} label={t("phone.menu")} folded={folded} />
      </ul>
    </nav>
  );
}

/** One cell: an icon over a 12px label, the whole cell the target; the label goes while the bar is folded. */
const cell =
  "relative flex h-full w-full flex-col items-center justify-center gap-1.5 text-meta font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function Place({
  place,
  here,
  href,
  icon: Icon,
  label,
  folded,
  count = null,
  countLabel,
}: {
  place: PhonePlace;
  here: PhonePlace;
  href: string;
  icon: IconComponent;
  label: string;
  folded: boolean;
  count?: number | null;
  countLabel?: string;
}) {
  const current = place === here;
  const pending = usePendingDestination(href);
  return (
    <li className="min-w-0 border-l border-line first:border-l-0">
      <Link
        href={href}
        navSource="mobile"
        intent
        aria-current={current ? "page" : undefined}
        aria-label={countLabel ? `${label}, ${countLabel}` : undefined}
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
        {/* Folded, the label is still the cell's name, only no longer drawn. */}
        <span className={folded ? "sr-only" : "max-w-full truncate px-1"}>{label}</span>
        {count !== null ? (
          <span aria-hidden="true" data-testid="phone-inbox-count" className={cn("absolute left-[calc(50%+4px)] grid h-5 min-w-5 place-items-center bg-accent px-1 font-mono text-meta font-semibold tabular-nums text-accent-fg", folded ? "top-1" : "top-2")}>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
        {pending ? <PendingDot className="absolute right-2 top-2 text-accent" /> : null}
      </Link>
    </li>
  );
}

/** New, in ink: opens Quick Create; while it is open the same cell closes it. */
function NewButton({ folded }: { folded: boolean }) {
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
        {folded ? null : <span aria-hidden="true">{open ? t("phone.close") : t("phone.new")}</span>}
      </button>
    </li>
  );
}

/**
 * Folded while the page scrolls down, open again as soon as it scrolls up or
 * reaches its top. A few pixels either way are not a direction, so a resting
 * thumb does not make the bar flicker.
 */
function useFoldOnScroll(): boolean {
  const pathname = usePathname();
  const [folded, setFolded] = React.useState(false);
  React.useEffect(() => {
    setFolded(false);
    let last = window.scrollY;
    let frame = 0;
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      if (y <= 48) setFolded(false);
      else if (y > last + 6) setFolded(true);
      else if (y < last - 6) setFolded(false);
      if (Math.abs(y - last) > 6 || y <= 48) last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);
  return folded;
}
