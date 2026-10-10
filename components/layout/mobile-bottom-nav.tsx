"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AlarmClock, CalendarClock, ListChecks, LogOut, MoreHorizontal, Plus, Settings, UserCheck, X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { usePhone } from "@/components/layout/use-phone";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { Avatar } from "@/components/ui/avatar";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { resolveMobileNavigation } from "@/lib/navigation/mobile";
import { usePanelOpen } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";

/**
 * The event the Create button raises; Quick Create listens for it (components/layout/quick-create.tsx)
 * and opens — or, when it is already open, closes. Its `detail.opener` is the button pressed, so the
 * panel's pointer can aim at it.
 */
export const OPEN_QUICK_CREATE_EVENT = "nesto:open-quick-create";

/** The phone's hamburger in the top bar raises this; the More sheet below opens (components/layout/mobile-menu-button.tsx). */
export const OPEN_MORE_EVENT = "nesto:open-more";

export type MobileAccount = {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  roleLabel: string;
  workspaceName: string;
};

/**
 * The phone and tablet-portrait shell's bottom navigation (MOB-02 §10-§15).
 *
 * Presentation only. It renders what `resolveMobileNavigation` places from the
 * groups the one navigation resolver produced for this person, so a
 * destination they cannot open is not in its input and cannot appear. The bar
 * shows up to three of those, then Create (when Quick Create has anything for
 * them) and More; with little access it simply has fewer buttons, never dead
 * ones (§58).
 *
 * Its layer is the lowest shell layer (`--nesto-z-shell-tabs`, 28), under the
 * top bar (30): the Create, Search and Activity panels live inside the top
 * bar's stacking context and must cover the bar, as sheets and dialogs do (§49, §80).
 *
 * It lives below `lg`, where the desktop rail is not drawn. Content clearance,
 * the safe area, the keyboard and a form's own action bar are handled in CSS
 * (`.nesto-bottom-nav` and the `html:has(...)` rules in styles/globals.css), so
 * no page adds bottom padding of its own (§15).
 */
export function MobileBottomNav({
  navigation,
  canCreate,
  account,
  footer,
  activity,
}: {
  navigation: NavigationGroup[];
  canCreate: boolean;
  account: MobileAccount;
  /** Extra controls for the More sheet's foot (the development user switcher). */
  footer?: React.ReactNode;
  /** The notification bell, which takes the last place on a phone, where the hamburger now carries More. */
  activity?: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const phone = usePhone();
  const pathname = usePathname();
  const { primary, more } = React.useMemo(() => resolveMobileNavigation(navigation), [navigation]);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [createOpen] = usePanelOpen("quick_create");
  const moreButton = React.useRef<HTMLButtonElement>(null);
  // Set when More closes because a destination was chosen: focus then goes to the new page, not back to the bar.
  const navigated = React.useRef(false);

  // The hamburger asks for More; focus goes back to it on close.
  const opener = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const onOpen = (event: Event) => {
      opener.current = (event as CustomEvent<{ opener?: HTMLElement }>).detail?.opener ?? null;
      navigated.current = false;
      setMoreOpen(true);
    };
    window.addEventListener(OPEN_MORE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MORE_EVENT, onOpen);
  }, []);

  // A completed navigation closes More, so no sheet is left over the new page.
  React.useEffect(() => setMoreOpen(false), [pathname]);

  const moreActive = more.some((group) => group.items.some((item) => isNavigationItemActive(item, pathname)));

  // Create sits in the middle of the destinations; the split is for rendering only (Premium Mobile §6.1).
  const left = primary.slice(0, Math.ceil(primary.length / 2));
  const right = primary.slice(left.length);
  const renderLink = (item: NavigationItem) => (
    <li key={item.key} className="min-w-0 flex-1 px-0.5">
      {/* Tasks opens its own small menu — the views people go to most, and the whole module. */}
      {item.key === "tasks" ? <TasksMenu item={item} active={isNavigationItemActive(item, pathname)} /> : <BarLink item={item} active={isNavigationItemActive(item, pathname)} />}
    </li>
  );

  return (
    <nav
      aria-label={t("mobile.barLabel")}
      data-mobile-bottom-nav
      className="nesto-bottom-nav fixed inset-x-[max(0.75rem,var(--nesto-safe-left))] bottom-[calc(0.875rem+var(--nesto-safe-bottom))] z-[var(--nesto-z-shell-tabs)] mx-auto h-[68px] max-w-xl rounded-[24px] border border-line bg-surface/85 px-1.5 shadow-menu backdrop-blur-xl lg:hidden"
    >
      <ul className="flex h-full items-center">
        {left.map(renderLink)}
        {canCreate ? (
          // Tablet portrait keeps Create in the top bar; the bar carries it on a phone (MOB-02 §16, §44).
          <li className="flex min-w-0 flex-1 justify-center md:hidden">
            <button
              type="button"
              aria-label={t("mobile.create")}
              aria-haspopup="dialog"
              aria-expanded={createOpen}
              data-testid="mobile-create"
              onClick={(event) => {
                // One event either way: Quick Create opens on it, and closes when it is already open.
                if (!createOpen) emitNavigationEvent("quick_create_opened", { source: "bottom_nav" });
                window.dispatchEvent(new CustomEvent(OPEN_QUICK_CREATE_EVENT, { detail: { opener: event.currentTarget } }));
              }}
              className="-mt-[26px] grid size-[54px] place-items-center rounded-full border-4 border-canvas bg-accent text-accent-fg shadow-menu transition-transform active:scale-95"
            >
              {/* The plus turns to a cross while its panel is open: the same button closes it. */}
              <Plus aria-hidden="true" className={cn("size-[22px] transition-transform duration-200", createOpen && "rotate-45")} strokeWidth={2.2} />
            </button>
          </li>
        ) : null}
        {right.map(renderLink)}
        {/* Phone: the bell, with More in the top bar's hamburger. Tablet keeps More here. */}
        {activity ? <li className="flex min-w-0 flex-1 md:hidden">{activity}</li> : null}
        {phone === true && activity ? null : (
        <li className={cn("min-w-0 flex-1 px-0.5", activity && "max-md:hidden")}>
          <BarButton
            icon={MoreHorizontal}
            label={t("mobile.more")}
            active={moreActive}
            expanded={moreOpen}
            haspopup="dialog"
            testId="mobile-more"
            buttonRef={moreButton}
            onClick={() => {
              emitNavigationEvent("more_opened");
              navigated.current = false;
              setMoreOpen(true);
            }}
          />
        </li>
        )}
      </ul>

      {/* The hamburger's menu slides in from the right and closes the same ways a dialog does.
          On a phone it takes two thirds of the screen, so the page it was opened from stays in view beside it. */}
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent
          side="right"
          className="w-[66.667vw] max-w-none bg-canvas sm:max-w-[480px]"
          data-testid="mobile-more-drawer"
          onCloseAutoFocus={(event) => {
            if (navigated.current) {
              navigated.current = false;
              event.preventDefault();
              document.getElementById("nesto-main")?.focus({ preventScroll: true });
              return;
            }
            event.preventDefault();
            (opener.current ?? moreButton.current)?.focus({ preventScroll: true });
            opener.current = null;
          }}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-accent/25 pl-4 pr-2">
            <DrawerTitle className="font-serif text-[1.375rem] font-normal text-fg">{t("mobile.moreTitle")}</DrawerTitle>
            <DrawerClose
              aria-label={t("closeNavigation")}
              className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={1.6} />
            </DrawerClose>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <MoreBody
              groups={more}
              account={account}
              footer={footer}
              onDone={() => {
                navigated.current = true;
                setMoreOpen(false);
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}

/* A bar cell: icon over label, the whole cell the target. The destination the app is at is filled with
   the accent colour — the cell itself, not just its ink — and carries aria-current; the icon weight stays even. */
const cellClass =
  "relative flex h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-[18px] px-1 text-micro font-semibold leading-tight text-fg-subtle transition-colors hover:text-fg data-[active=true]:bg-accent data-[active=true]:text-accent-fg data-[active=true]:shadow-sm data-[active=true]:hover:text-accent-fg";

function BarLink({ item, active }: { item: NavigationItem; active: boolean }) {
  const t = useTranslations("modules");
  const shell = useTranslations("shell");
  const Icon = getIcon(item.icon);
  const label = item.module === "dashboard" ? shell("mobile.home") : t(`${item.key}.label`);
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="mobile"
      // Primary destinations are prepared on deliberate intent, never in bulk (MOB-02 §52).
      intent
      onNavigate={() => emitNavigationEvent("navigation_destination_opened", { module: item.key, source: "bottom_nav" })}
      aria-current={active ? "page" : undefined}
      data-active={active}
      data-pending={pending || undefined}
      className={cellClass}
    >
      <Icon aria-hidden="true" strokeWidth={1.6} className="size-[22px] shrink-0" />
      <span className="max-w-full truncate">{label}</span>
      {pending ? <PendingDot className="absolute right-3 top-2 text-accent" /> : null}
    </Link>
  );
}

/**
 * Tasks, from the bar: a small popup — glass, with its pointer on the button —
 * of the views people go to most, closed by "All tasks", the module itself
 * (where the button used to go directly). Every row is a tab of the Tasks
 * module, so anybody who has the button may open each of them.
 */
function TasksMenu({ item, active }: { item: NavigationItem; active: boolean }) {
  const t = useTranslations("shell");
  const modules = useTranslations("modules");
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  // A completed navigation closes it, so nothing is left over the new page.
  React.useEffect(() => setOpen(false), [pathname]);
  const Icon = getIcon(item.icon);
  const label = modules(`${item.key}.label`);
  const rows = [
    { key: "mine", href: `${item.href}/my-tasks`, icon: UserCheck },
    { key: "today", href: `${item.href}/all?due=today`, icon: CalendarClock },
    { key: "overdue", href: `${item.href}/overdue`, icon: AlarmClock },
  ] as const;
  const row = "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-body font-medium text-fg transition-colors hover:bg-hover active:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const opened = (target: string) => {
    emitNavigationEvent("navigation_destination_opened", { module: item.key, source: "bottom_nav" });
    void target;
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-active={active} aria-current={active ? "page" : undefined} aria-haspopup="dialog" data-testid="mobile-tasks" className={cellClass}>
          <Icon aria-hidden="true" strokeWidth={1.6} className="size-[22px] shrink-0" />
          <span className="max-w-full truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={10} collisionPadding={12} aria-label={label} className="w-64 p-1.5" data-testid="mobile-tasks-menu">
        <ul>
          {rows.map((entry) => (
            <li key={entry.key}>
              <Link href={entry.href} navSource="mobile" onNavigate={() => opened(entry.href)} className={row}>
                <entry.icon aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0 text-accent-strong" />
                <span className="min-w-0 flex-1 truncate">{t(`mobile.tasksMenu.${entry.key}`)}</span>
              </Link>
            </li>
          ))}
          <li className="mt-1 border-t border-line/70 pt-1">
            <Link href={item.href} navSource="mobile" intent onNavigate={() => opened(item.href)} className={row} data-testid="mobile-tasks-all">
              <ListChecks aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0 text-accent-strong" />
              <span className="min-w-0 flex-1 truncate">{t("mobile.tasksMenu.all")}</span>
            </Link>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function BarButton({
  icon: Icon,
  label,
  active = false,
  expanded,
  haspopup,
  testId,
  onClick,
  onPointerDown,
  buttonRef,
}: {
  buttonRef?: React.Ref<HTMLButtonElement>;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: "true" }>;
  label: string;
  active?: boolean;
  expanded: boolean;
  haspopup: "dialog";
  testId: string;
  onClick: () => void;
  onPointerDown?: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-active={active}
      aria-haspopup={haspopup}
      aria-expanded={expanded}
      data-testid={testId}
      onClick={onClick}
      onPointerDown={onPointerDown}
      className={cellClass}
    >
      <Icon aria-hidden="true" strokeWidth={1.6} className="size-[22px] shrink-0" />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* More                                                                        */
/* -------------------------------------------------------------------------- */

function MoreBody({ groups, account, footer, onDone }: { groups: NavigationGroup[]; account: MobileAccount; footer?: React.ReactNode; onDone: () => void }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { signOut, signingOut } = useSignOut(onDone);
  const shown = groups;
  const name = `${account.firstName} ${account.lastName}`.trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mobile-more-body">
      {/* Pinned: the profile stays put while the modules scroll. */}
      <div className="shrink-0 space-y-3 px-4 pb-3 pt-4">
      <Link href="/settings/profile" navSource="mobile" onNavigate={onDone} className="flex min-h-14 items-center gap-3 rounded-[18px] border border-line bg-surface px-3 py-2 transition-colors active:border-accent active:bg-accent-soft">
        <Avatar firstName={account.firstName} lastName={account.lastName} src={account.avatarUrl} size="md" className="border-transparent bg-accent font-serif font-normal text-accent-fg" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-body font-semibold text-fg">{name}</span>
          <span className="block truncate text-meta text-fg-muted">{[account.roleLabel, account.workspaceName].filter(Boolean).join(" · ")}</span>
          <span className="sr-only">{t("myProfile")}</span>
        </span>
      </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-2">
      {shown.length === 0 ? (
        <p role="status" className="px-1 py-4 text-center text-table text-fg-muted">{t("mobile.noModules")}</p>
      ) : (
        shown.map((group) => (
          <section key={group.group} aria-labelledby={`more-${group.group}`}>
            <h3 id={`more-${group.group}`} className="nesto-eyebrow mb-1.5 px-1 text-accent-strong">
              {group.group === "primary" ? t("mobile.general") : t(`groups.${group.group}`)}
            </h3>
            <ul className="overflow-hidden rounded-[18px] border border-line bg-surface">
              {group.items.map((item) => (
                <li key={item.key} className="border-b border-line last:border-b-0">
                  <MoreLink item={item} active={pathname === item.href || pathname.startsWith(`${item.href}/`)} onDone={onDone} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      </div>

      {/* Pinned: Settings, the theme and Logout stay at the foot. */}
      <div className="shrink-0 space-y-3 border-t border-accent/25 px-4 pb-4 pt-3">
      <section aria-label={t("mobile.account")} className="overflow-hidden rounded-[18px] border border-line bg-surface">
        <Link href="/settings" navSource="mobile" onNavigate={onDone} className="flex min-h-12 items-center gap-3 border-b border-line px-3 text-body font-medium text-fg hover:bg-hover">
          <Settings aria-hidden="true" strokeWidth={1.6} className="size-[18px] text-accent-strong" />
          {t("settings")}
        </Link>
        <ThemeToggle variant="row" />
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
          className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-body font-medium text-danger-strong hover:bg-danger-soft disabled:opacity-60"
        >
          <LogOut aria-hidden="true" strokeWidth={1.6} className="size-[18px]" />
          {signingOut ? t("signingOut") : t("logout")}
        </button>
      </section>

      {footer}
      </div>
    </div>
  );
}

function MoreLink({ item, active, onDone }: { item: NavigationItem; active: boolean; onDone: () => void }) {
  const modules = useTranslations("modules");
  const Icon = getIcon(item.icon);
  const pending = usePendingDestination(item.href);
  return (
    <Link
      href={item.href}
      navSource="mobile"
      onNavigate={() => {
        emitNavigationEvent("navigation_destination_opened", { module: item.key, source: "more" });
        onDone();
      }}
      aria-current={active ? "page" : undefined}
      data-pending={pending || undefined}
      className={cn("relative flex min-h-12 items-center gap-3 px-3 text-body font-medium hover:bg-hover", active ? "bg-accent-soft text-accent-strong" : "text-fg active:bg-accent-soft")}
    >
      <Icon aria-hidden="true" strokeWidth={1.6} className="size-[18px] shrink-0 text-accent-strong" />
      <span className="min-w-0 flex-1 truncate">{modules(`${item.key}.label`)}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}
