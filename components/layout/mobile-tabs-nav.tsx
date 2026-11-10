"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Landmark, Menu, NestoProjects, Plus, X } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import {
  BarButton,
  BarLink,
  MoreBody,
  MoreLink,
  OPEN_MORE_EVENT,
  OPEN_QUICK_CREATE_EVENT,
  type MobileAccount,
} from "@/components/layout/mobile-bottom-nav";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { isNavigationItemActive, type NavigationGroup, type NavigationItem } from "@/config/navigation";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { requestPageRefresh } from "@/lib/navigation/refresh-event";

type Sheet = "work" | "department" | "more" | null;

/**
 * Bottom tabs, the second phone navigation in Settings › Appearance
 * (docs/ui/UI-04-navigation-layouts.md). Below `lg`, like the Thumb bar it
 * replaces, and drawn with the Thumb bar's own cells and More sheet.
 *
 * Left to right: Home, which goes straight home; Work and Departments, which
 * each open their own menu from the bottom, with Create at its top; Alerts,
 * the bell; and More, the side sheet with the profile, the general and company
 * modules, Settings, Refresh, the theme and Logout. A tab whose menu holds the
 * module you are in is marked.
 *
 * Renders what the one navigation resolver produced for this person; with
 * little access it simply has fewer tabs. `data-mobile-bottom-nav` keeps
 * content, focus scrolling and toasts clear of it, as for the Thumb bar.
 */
export function MobileTabsNav({
  navigation,
  canCreate,
  account,
  footer,
  activity,
}: {
  navigation: NavigationGroup[];
  canCreate: boolean;
  account: MobileAccount;
  footer?: React.ReactNode;
  activity?: React.ReactNode;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const [sheet, setSheet] = React.useState<Sheet>(null);
  const navigated = React.useRef(false);
  const opener = React.useRef<HTMLElement | null>(null);

  const { home, work, department, more } = React.useMemo(() => {
    const primary = navigation.find((group) => group.group === "primary")?.items ?? [];
    const dashboard = primary.find((item) => item.module === "dashboard") ?? null;
    return {
      home: dashboard,
      work: navigation.find((group) => group.group === "work") ?? null,
      department: navigation.find((group) => group.group === "department") ?? null,
      // More: the general modules besides Home, then the company's.
      more: [
        { group: "primary" as const, label: null, items: primary.filter((item) => item !== dashboard) },
        ...navigation.filter((group) => group.group === "company"),
      ].filter((group) => group.items.length > 0) as NavigationGroup[],
    };
  }, [navigation]);

  // A completed navigation closes the open sheet; so does turning a tablet to landscape, where the bar is gone.
  React.useEffect(() => setSheet(null), [pathname]);
  React.useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (wide.matches) setSheet(null);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);
  // Whatever asks for More (OPEN_MORE_EVENT) gets this layout's More.
  React.useEffect(() => {
    const onOpen = (event: Event) => {
      opener.current = (event as CustomEvent<{ opener?: HTMLElement }>).detail?.opener ?? null;
      navigated.current = false;
      setSheet("more");
    };
    window.addEventListener(OPEN_MORE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MORE_EVENT, onOpen);
  }, []);

  const holds = (items: readonly NavigationItem[]) => items.some((item) => isNavigationItemActive(item, pathname));
  const open = (next: Sheet) => (event: React.MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    navigated.current = false;
    emitNavigationEvent("more_opened");
    setSheet(next);
  };
  const done = () => {
    navigated.current = true;
    setSheet(null);
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (navigated.current) {
      navigated.current = false;
      document.getElementById("nesto-main")?.focus({ preventScroll: true });
      return;
    }
    opener.current?.focus({ preventScroll: true });
  };

  const menuGroup = sheet === "work" ? work : sheet === "department" ? department : null;
  const menuTitle = sheet === "work" ? t("tabs.work") : t("tabs.departments");

  return (
    <nav
      aria-label={t("tabs.barLabel")}
      data-mobile-bottom-nav
      data-mobile-tabs
      className="nesto-bottom-nav fixed inset-x-0 bottom-0 z-[var(--nesto-z-shell-tabs)] border-t border-line bg-surface/[0.96] px-1.5 pb-[var(--nesto-safe-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto flex h-[68px] max-w-xl items-center">
        {home ? (
          <li className="min-w-0 flex-1 px-0.5">
            <BarLink item={home} active={isNavigationItemActive(home, pathname)} />
          </li>
        ) : null}
        {work ? (
          <li className="min-w-0 flex-1 px-0.5">
            <BarButton icon={NestoProjects} label={t("tabs.work")} active={holds(work.items)} expanded={sheet === "work"} haspopup="dialog" testId="tabs-work" onClick={open("work")} />
          </li>
        ) : null}
        {department ? (
          <li className="min-w-0 flex-1 px-0.5">
            <BarButton icon={Landmark} label={t("tabs.departments")} active={holds(department.items)} expanded={sheet === "department"} haspopup="dialog" testId="tabs-department" onClick={open("department")} />
          </li>
        ) : null}
        {activity ? <li className="flex min-w-0 flex-1">{activity}</li> : null}
        <li className="min-w-0 flex-1 px-0.5">
          <BarButton icon={Menu} label={t("tabs.more")} active={more.some((group) => holds(group.items))} expanded={sheet === "more"} haspopup="dialog" testId="tabs-more" onClick={open("more")} />
        </li>
      </ul>

      {/* Work and Departments: each tab's own menu, from the bottom, with Create first. */}
      <Drawer open={menuGroup !== null} onOpenChange={(next) => (next ? null : setSheet(null))}>
        <DrawerContent side="bottom" className="max-h-[80dvh] bg-canvas" data-testid="tabs-menu" onCloseAutoFocus={restoreFocus}>
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b pl-4 pr-2 border-fg">
            <DrawerTitle className="text-[1.375rem] text-fg font-display">{menuTitle}</DrawerTitle>
            <div className="flex items-center gap-1">
              {canCreate ? (
                <button
                  type="button"
                  data-testid="tabs-create"
                  onClick={(event) => {
                    emitNavigationEvent("quick_create_opened", { source: "bottom_nav" });
                    setSheet(null);
                    window.dispatchEvent(new CustomEvent(OPEN_QUICK_CREATE_EVENT, { detail: { opener: event.currentTarget } }));
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-table font-medium text-primary-fg"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  {t("tabs.create")}
                </button>
              ) : null}
              <DrawerClose
                aria-label={t("closeNavigation")}
                className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              >
                <X aria-hidden="true" className="size-5" />
              </DrawerClose>
            </div>
          </div>
          <ul className="min-h-0 overflow-y-auto overscroll-contain px-4 py-2">
            {(menuGroup?.items ?? []).map((item) => (
              <li key={item.key} className="border-b border-line last:border-b-0">
                <MoreLink item={item} active={isNavigationItemActive(item, pathname)} onDone={done} />
              </li>
            ))}
          </ul>
        </DrawerContent>
      </Drawer>

      {/* More: the Thumb bar's own sheet, holding what the tabs do not. */}
      <Drawer open={sheet === "more"} onOpenChange={(next) => (next ? null : setSheet(null))}>
        <DrawerContent side="right" className="w-[66.667vw] max-w-none bg-canvas sm:max-w-[480px]" data-testid="mobile-more-drawer" onCloseAutoFocus={restoreFocus}>
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b pl-4 pr-2 border-fg">
            <DrawerTitle className="text-[1.375rem] text-fg font-display">{t("mobile.moreTitle")}</DrawerTitle>
            <DrawerClose
              aria-label={t("closeNavigation")}
              className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden="true" className="size-5" />
            </DrawerClose>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <MoreBody
              groups={more}
              account={account}
              footer={footer}
              onDone={done}
              onRefresh={() => {
                setSheet(null);
                requestPageRefresh();
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
