"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { LogOut, MoreHorizontal, Plus, Search, Settings } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { getIcon } from "@/components/layout/nav-icon";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { PendingDot, usePendingDestination } from "@/components/navigation/navigation-feedback";
import { Avatar } from "@/components/ui/avatar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { filterMoreGroups, MORE_SEARCH_THRESHOLD, resolveMobileNavigation } from "@/lib/navigation/mobile";
import { usePanelOpen } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";

/** The event the Create button raises; Quick Create listens for it (components/layout/quick-create.tsx). */
export const OPEN_QUICK_CREATE_EVENT = "nesto:open-quick-create";

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
}: {
  navigation: NavigationGroup[];
  canCreate: boolean;
  account: MobileAccount;
  /** Extra controls for the More sheet's foot (the development user switcher). */
  footer?: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { primary, more } = React.useMemo(() => resolveMobileNavigation(navigation), [navigation]);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [createOpen] = usePanelOpen("quick_create");
  // A tap that closed Create (the panel closes on any outside press) must not reopen it.
  const createWasOpen = React.useRef(false);
  const moreButton = React.useRef<HTMLButtonElement>(null);
  // Set when More closes because a destination was chosen: focus then goes to the new page, not back to the bar.
  const navigated = React.useRef(false);

  // A completed navigation closes More, so no sheet is left over the new page.
  React.useEffect(() => setMoreOpen(false), [pathname]);

  const moreActive = more.some((group) => group.items.some((item) => isNavigationItemActive(item, pathname)));

  return (
    <nav
      aria-label={t("mobile.barLabel")}
      data-mobile-bottom-nav
      className="nesto-bottom-nav fixed inset-x-0 bottom-0 z-[var(--nesto-z-shell-tabs)] border-t border-line bg-surface pb-[var(--nesto-safe-bottom)] pl-[var(--nesto-safe-left)] pr-[var(--nesto-safe-right)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch">
        {primary.map((item) => (
          <li key={item.key} className="min-w-0 flex-1">
            <BarLink item={item} active={isNavigationItemActive(item, pathname)} />
          </li>
        ))}
        {canCreate ? (
          // Tablet portrait keeps Create in the top bar; the bar carries it on a phone (MOB-02 §16, §44).
          <li className="min-w-0 flex-1 md:hidden">
            <BarButton
              icon={Plus}
              label={t("mobile.create")}
              expanded={createOpen}
              haspopup="dialog"
              testId="mobile-create"
              onPointerDown={() => {
                createWasOpen.current = createOpen;
              }}
              onClick={() => {
                if (createWasOpen.current) {
                  createWasOpen.current = false;
                  return;
                }
                emitNavigationEvent("quick_create_opened", { source: "bottom_nav" });
                window.dispatchEvent(new Event(OPEN_QUICK_CREATE_EVENT));
              }}
            />
          </li>
        ) : null}
        <li className="min-w-0 flex-1">
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
      </ul>

      <BottomSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title={t("mobile.moreTitle")}
        className="max-h-[min(90dvh,calc(100dvh-var(--nesto-safe-top)-1rem))]"
        onCloseAutoFocus={(event) => {
          if (navigated.current) {
            navigated.current = false;
            event.preventDefault();
            document.getElementById("nesto-main")?.focus({ preventScroll: true });
            return;
          }
          event.preventDefault();
          moreButton.current?.focus({ preventScroll: true });
        }}
      >
        <MoreBody
          groups={more}
          account={account}
          footer={footer}
          onDone={() => {
            navigated.current = true;
            setMoreOpen(false);
          }}
        />
      </BottomSheet>
    </nav>
  );
}

/* A bar cell: icon over label, 56px tall, the whole cell the target. Active is
   the accent, a bar above the icon, a filled icon weight and aria-current. */
const cellClass =
  "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-micro font-medium leading-tight text-fg-muted transition-colors hover:text-fg data-[active=true]:text-accent-strong";

function ActiveMark() {
  return <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-accent" />;
}

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
      {active ? <ActiveMark /> : null}
      <Icon aria-hidden="true" className={cn("size-5 shrink-0", active && "stroke-[2.5]")} />
      <span className="max-w-full truncate">{label}</span>
      {pending ? <PendingDot className="absolute right-3 top-2 text-accent" /> : null}
    </Link>
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
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: "true" }>;
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
      {active ? <ActiveMark /> : null}
      <Icon aria-hidden="true" className={cn("size-5 shrink-0", active && "stroke-[2.5]")} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* More                                                                        */
/* -------------------------------------------------------------------------- */

function MoreBody({ groups, account, footer, onDone }: { groups: NavigationGroup[]; account: MobileAccount; footer?: React.ReactNode; onDone: () => void }) {
  const t = useTranslations("shell");
  const modules = useTranslations("modules");
  const pathname = usePathname();
  const [query, setQuery] = React.useState("");
  const { signOut, signingOut } = useSignOut(onDone);
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const labelOf = React.useCallback((item: NavigationItem) => modules(`${item.key}.label`), [modules]);
  const shown = React.useMemo(() => filterMoreGroups(groups, query, labelOf), [groups, query, labelOf]);
  const name = `${account.firstName} ${account.lastName}`.trim();

  return (
    <div className="space-y-4" data-testid="mobile-more-body">
      <Link href="/settings/profile" navSource="mobile" onNavigate={onDone} className="flex min-h-14 items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-hover">
        <Avatar firstName={account.firstName} lastName={account.lastName} src={account.avatarUrl} size="md" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-body font-semibold text-fg">{name}</span>
          <span className="block truncate text-meta text-fg-muted">{[account.roleLabel, account.workspaceName].filter(Boolean).join(" · ")}</span>
          <span className="sr-only">{t("myProfile")}</span>
        </span>
      </Link>

      {total > MORE_SEARCH_THRESHOLD ? (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("mobile.searchModules")}
            placeholder={t("mobile.searchModulesPlaceholder")}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-11 w-full rounded-md border border-control bg-surface pl-9 pr-3 text-body text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p role="status" className="px-1 py-4 text-center text-table text-fg-muted">{t("mobile.noModules")}</p>
      ) : (
        shown.map((group) => (
          <section key={group.group} aria-labelledby={`more-${group.group}`}>
            <h3 id={`more-${group.group}`} className="nesto-eyebrow mb-1.5 px-1 text-fg-subtle">
              {group.group === "primary" ? t("mobile.general") : t(`groups.${group.group}`)}
            </h3>
            <ul className="overflow-hidden rounded-lg border border-line">
              {group.items.map((item) => (
                <li key={item.key} className="border-b border-line last:border-b-0">
                  <MoreLink item={item} active={pathname === item.href || pathname.startsWith(`${item.href}/`)} onDone={onDone} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <section aria-label={t("mobile.account")} className="overflow-hidden rounded-lg border border-line">
        <Link href="/settings" navSource="mobile" onNavigate={onDone} className="flex min-h-12 items-center gap-3 border-b border-line px-3 text-body font-medium text-fg hover:bg-hover">
          <Settings aria-hidden="true" className="size-[18px] text-fg-subtle" />
          {t("settings")}
        </Link>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
          className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-body font-medium text-danger-strong hover:bg-danger-soft disabled:opacity-60"
        >
          <LogOut aria-hidden="true" className="size-[18px]" />
          {signingOut ? t("signingOut") : t("logout")}
        </button>
      </section>

      {footer}
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
      className={cn("relative flex min-h-12 items-center gap-3 px-3 text-body font-medium hover:bg-hover", active ? "bg-accent-soft text-accent-strong" : "text-fg")}
    >
      <Icon aria-hidden="true" className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-fg-subtle")} />
      <span className="min-w-0 flex-1 truncate">{modules(`${item.key}.label`)}</span>
      {pending ? <PendingDot className="text-accent" /> : null}
    </Link>
  );
}
