"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ChevronUp,
  CircleHelp,
  Eye,
  FilePen,
  HardHat,
  Info,
  Landmark,
  Layers3,
  LayoutGrid,
  LogIn,
  Mail,
  Menu,
  Moon,
  PlayCircle,
  Receipt,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  User,
  Users,
  X,
} from "@/components/icons";

import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { getIcon, type IconComponent } from "@/components/layout/nav-icon";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { RIBBON_TABS, siteContact, siteRibbon, type RibbonIcon, type RibbonTab } from "@/config/marketing";
import { fill, type SiteCopy } from "@/lib/i18n/site";
import { cn } from "@/lib/utils/cn";

/**
 * The public site's masthead: the Ribbon (UI-05 §2).
 *
 * The same idea as the application's Ribbon, so a visitor learns the product's
 * navigation before signing in: five tabs, and each opens a panel of groups —
 * big buttons above, a caption below — with one dark callout that says where
 * to go next. On a phone the tabs become pills in a full-screen sheet.
 *
 * Every word arrives from the server layout; the structure is
 * config/marketing.ts → siteRibbon, and the Modules tab is the module registry.
 */

const ICONS: Record<RibbonIcon, IconComponent> = {
  LayoutGrid, Eye, Layers3, ShieldCheck, Smartphone, Moon, Building2, HardHat, Landmark,
  Users, Receipt, Tag, Sparkles, Info, CircleHelp, Mail, FilePen, LogIn,
};

export type MastheadModuleZone = { key: string; title: string; items: { key: string; label: string; icon: string }[] };
export type MastheadRole = { key: string; label: string };

type Item = { key: string; label: string; note?: string; href: string; Icon: IconComponent };
type Group = { key: string; caption: string; items: Item[]; compact?: boolean; /** Rows in a compact group; the Modules tab needs four to fit. */ rows?: 3 | 4 };
type Callout = { eyebrow: string; title: string; cta: string; href: string };
type Panel = { groups: Group[]; callout?: Callout; write?: boolean };

/** Which tab a page belongs to, so the masthead says where the reader is. */
function tabOf(pathname: string): RibbonTab | null {
  if (["/platform", "/full-view"].includes(pathname)) return "platform";
  if (pathname === "/pricing") return "pricing";
  if (["/about", "/security", "/faq", "/contact", "/privacy", "/terms"].includes(pathname)) return "company";
  return null;
}

function buildPanels(ribbon: SiteCopy["ribbon"], zones: MastheadModuleZone[], roles: MastheadRole[], roleCount: number): Record<RibbonTab, Panel> {
  const items = (list: readonly { key: string; href: string; icon: RibbonIcon }[]): Item[] =>
    list.map((item) => ({ key: item.key, label: ribbon.items[item.key as keyof typeof ribbon.items], href: item.href, Icon: ICONS[item.icon] }));
  const groups = (list: readonly { key: string; items: readonly { key: string; href: string; icon: RibbonIcon }[] }[]): Group[] =>
    list.map((group) => ({ key: group.key, caption: ribbon.groups[group.key as keyof typeof ribbon.groups], items: items(group.items) }));
  const { solutions } = siteRibbon;

  return {
    platform: {
      groups: groups(siteRibbon.platform.groups),
      callout: { ...ribbon.callouts.platform, href: siteRibbon.platform.callout },
    },
    solutions: {
      groups: [
        ...groups(solutions.groups),
        {
          key: "role",
          caption: ribbon.groups.role,
          compact: true,
          items: [
            ...roles.map((role) => ({ key: role.key, label: role.label, href: solutions.rolesHref, Icon: User })),
            { key: "all", label: fill(ribbon.items.allRoles, { n: roleCount }), href: solutions.rolesHref, Icon: Users },
          ],
        },
      ],
      callout: { ...ribbon.callouts.solutions, eyebrow: fill(ribbon.callouts.solutions.eyebrow, { n: roleCount }), href: solutions.callout },
    },
    modules: {
      groups: zones.map((zone) => ({
        key: zone.key,
        caption: zone.title,
        compact: true,
        rows: 4,
        items: zone.items.map((item) => ({ key: item.key, label: item.label, href: siteRibbon.modules.href, Icon: getIcon(item.icon) })),
      })),
    },
    pricing: {
      groups: [
        ...groups(siteRibbon.pricing.groups),
        {
          key: "foundations",
          caption: ribbon.groups.foundations,
          compact: true,
          items: [
            { key: "platform", label: ribbon.foundations.platform.name, note: ribbon.foundations.platform.note, href: "/pricing#prices", Icon: Layers3 },
            { key: "rozaris", label: ribbon.foundations.rozaris.name, note: ribbon.foundations.rozaris.note, href: "/pricing#prices", Icon: Building2 },
          ],
        },
      ],
      callout: { ...ribbon.callouts.pricing, href: siteRibbon.pricing.callout },
    },
    company: { groups: groups(siteRibbon.company.groups), write: true },
  };
}

export function SiteMasthead({
  copy,
  ribbon,
  category,
  moduleZones,
  roles,
  roleCount,
}: {
  copy: SiteCopy["header"];
  ribbon: SiteCopy["ribbon"];
  category: string;
  moduleZones: MastheadModuleZone[];
  roles: MastheadRole[];
  roleCount: number;
}) {
  const pathname = usePathname();
  // Each is remembered with the page it was opened on, so a new page finds both closed.
  const [opened, setOpened] = useState<{ tab: RibbonTab; at: string } | null>(null);
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const open = opened?.at === pathname ? opened.tab : null;
  const setOpen = (tab: RibbonTab | null) => setOpened(tab ? { tab, at: pathname } : null);
  const menu = menuAt === pathname;
  const setMenu = (value: boolean) => setMenuAt(value ? pathname : null);
  const panelId = useId();
  const tabRefs = useRef<Partial<Record<RibbonTab, HTMLButtonElement | null>>>({});
  const panels = buildPanels(ribbon, moduleZones, roles, roleCount);
  const here = tabOf(pathname);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      tabRefs.current[open]?.focus();
      setOpened(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-30" data-testid="site-masthead">
      <div className="relative bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-3.5 px-[clamp(16px,4vw,48px)]">
          <Link href="/" aria-label={copy.home} className="shrink-0 rounded-md">
            <NestoLogo />
          </Link>
          <span aria-hidden="true" className="hidden h-5 w-px bg-line-strong xl:block" />
          <p className="nesto-eyebrow hidden whitespace-nowrap text-fg-subtle xl:block">{category}</p>

          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="max-lg:hidden">
              <Link href="/login">{copy.signIn}</Link>
            </Button>
            <Button asChild size="sm" className="max-sm:px-3">
              <Link href="/apply">
                <span className="lg:hidden">{copy.applyShort}</span>
                <span className="max-lg:hidden">{copy.apply}</span>
                <ArrowRight className="max-sm:hidden" />
              </Link>
            </Button>
            <ThemeToggle className="max-lg:hidden" />
            <LocaleSwitch label={copy.language} className="max-lg:hidden" />
            <button
              type="button"
              onClick={() => setMenu(true)}
              aria-label={copy.openMenu}
              className="grid size-12 shrink-0 place-items-center rounded-full text-fg transition-colors hover:bg-hover lg:hidden"
            >
              <Menu aria-hidden="true" className="size-[22px]" />
            </button>
          </div>
        </div>

        {/* The tabs: a disclosure each, so a click opens the panel and a second one closes it. */}
        <div className="mx-auto hidden w-full max-w-[1280px] px-[clamp(16px,4vw,48px)] lg:block">
          <nav aria-label={copy.siteNavigation} className="flex h-11 items-end gap-0.5 border-b-2 border-fg">
            {RIBBON_TABS.map((tab) => {
              const on = open ? open === tab : here === tab;
              return (
                <button
                  key={tab}
                  ref={(node) => { tabRefs.current[tab] = node; }}
                  type="button"
                  aria-expanded={open === tab}
                  aria-controls={open === tab ? panelId : undefined}
                  aria-current={!open && here === tab ? "page" : undefined}
                  onClick={() => setOpen(open === tab ? null : tab)}
                  className={cn(
                    "relative inline-flex h-10 items-center rounded-t-[10px] px-4 text-body transition-colors hover:bg-hover hover:text-fg",
                    on ? "bg-surface font-semibold text-fg" : "text-fg-muted",
                    on && "after:absolute after:inset-x-3.5 after:bottom-0 after:h-[3px] after:rounded-t-[3px] after:bg-accent",
                  )}
                >
                  {ribbon.tabs[tab]}
                </button>
              );
            })}
            <Link
              href={siteRibbon.platform.callout}
              className="mb-2.5 ml-auto inline-flex items-center gap-1.5 text-table text-fg-muted transition-colors hover:text-fg"
            >
              <PlayCircle aria-hidden="true" className="size-4 text-accent-strong" />
              {copy.followUnit}
            </Link>
          </nav>
        </div>
      </div>

      {open ? (
        <>
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(null)} className="fixed inset-0 -z-10 hidden cursor-default bg-black/25 lg:block" />
          <div
            id={panelId}
            role="region"
            aria-label={ribbon.tabs[open]}
            className="absolute inset-x-0 top-full hidden border-b border-line bg-surface shadow-[0_26px_40px_-30px_rgb(15_20_26/0.45)] lg:block"
            data-testid="ribbon-panel"
          >
            <div className="mx-auto flex w-full max-w-[1280px] items-stretch px-[clamp(16px,4vw,48px)]">
              <RibbonPanel panel={panels[open]} ribbon={ribbon} onGo={() => setOpen(null)} />
              <button
                type="button"
                onClick={() => { tabRefs.current[open]?.focus(); setOpen(null); }}
                aria-label={copy.closePanel}
                className="mt-3 grid size-9 shrink-0 place-items-center self-start rounded-full text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
              >
                <ChevronUp aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
        </>
      ) : null}

      <PhoneMenu open={menu} onOpenChange={setMenu} copy={copy} ribbon={ribbon} panels={panels} here={here} />
    </header>
  );
}

function RibbonPanel({ panel, ribbon, onGo }: { panel: Panel; ribbon: SiteCopy["ribbon"]; onGo: () => void }) {
  return (
    <div className="flex min-h-[132px] flex-1 items-stretch gap-0 overflow-x-auto py-3">
      {panel.groups.map((group) => (
        <div key={group.key} className="flex flex-col justify-between gap-2 border-r border-line px-4 first:pl-0">
          {group.compact ? (
            <ul className={cn("grid grid-flow-col gap-x-1 gap-y-0.5", group.rows === 4 ? "grid-rows-[repeat(4,28px)]" : "grid-rows-[repeat(3,30px)]")}>
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} onClick={onGo} className="flex h-full items-center gap-2 whitespace-nowrap rounded-lg px-2 text-table text-fg transition-colors hover:bg-hover">
                    <item.Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    {item.label}
                    {item.note ? <span className="text-fg-subtle">· {item.note}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex items-start gap-1">
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} onClick={onGo} className="flex min-h-[84px] w-[92px] flex-col items-center gap-2 rounded-xl px-1.5 pb-2 pt-3 text-center text-meta leading-tight text-fg transition-colors hover:bg-hover">
                    <item.Icon aria-hidden="true" className="size-6 text-fg-subtle" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-center font-mono text-[9.5px] max-md:text-meta uppercase tracking-[0.14em] text-fg-subtle">{group.caption}</p>
        </div>
      ))}

      {panel.write ? (
        <div className="flex flex-col justify-between gap-2 px-[18px]">
          <ul className="grid gap-0.5">
            {(["general", "sales", "support"] as const).map((channel) => (
              <li key={channel}>
                <a href={`mailto:${siteContact[channel]}`} className="flex h-[30px] items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-table text-fg transition-colors hover:bg-hover">
                  <Mail aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                  <span className="text-fg-muted">{ribbon.channels[channel]}</span>
                  {siteContact[channel]}
                </a>
              </li>
            ))}
          </ul>
          <p className="px-2.5 text-meta text-fg-subtle">{ribbon.replyNote}</p>
          <p className="text-center font-mono text-[9.5px] max-md:text-meta uppercase tracking-[0.14em] text-fg-subtle">{ribbon.groups.write}</p>
        </div>
      ) : null}

      {panel.callout ? (
        <Link
          href={panel.callout.href}
          onClick={onGo}
          className="group ml-auto flex w-[300px] shrink-0 flex-col justify-between gap-2.5 rounded-xl bg-fg px-4 py-3.5 text-canvas"
        >
          <span className="nesto-eyebrow text-accent">{panel.callout.eyebrow}</span>
          <span className="text-section leading-tight font-display">{panel.callout.title}</span>
          <span className="inline-flex items-center gap-1.5 text-table font-medium">
            {panel.callout.cta}
            <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : null}
    </div>
  );
}

/** The phone's menu: a full-screen sheet with the tabs as pills and each panel as tiles (UI-05 §2.3). */
function PhoneMenu({
  open,
  onOpenChange,
  copy,
  ribbon,
  panels,
  here,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: SiteCopy["header"];
  ribbon: SiteCopy["ribbon"];
  panels: Record<RibbonTab, Panel>;
  here: RibbonTab | null;
}) {
  const [tab, setTab] = useState<RibbonTab>(here ?? "platform");
  const panel = panels[tab];
  const close = () => onOpenChange(false);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="inset-0 w-full max-w-none rounded-none border-0 bg-canvas sm:max-w-none">
        <DrawerTitle className="sr-only">{copy.drawerTitle}</DrawerTitle>
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <NestoLogo />
          <button type="button" onClick={close} aria-label={copy.closeMenu} className="grid size-12 place-items-center rounded-full text-fg transition-colors hover:bg-hover">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div role="group" aria-label={copy.siteNavigation} className="flex shrink-0 gap-1.5 overflow-x-auto border-b-2 border-fg px-4 pb-3">
          {RIBBON_TABS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "h-11 flex-none rounded-full border px-4 text-body transition-colors",
                tab === key ? "border-primary bg-primary text-primary-fg" : "border-line-strong text-fg-muted",
              )}
            >
              {ribbon.tabs[key]}
            </button>
          ))}
        </div>

        <nav aria-label={ribbon.tabs[tab]} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {panel.groups.map((group) => (
            <section key={group.key} className="mb-5">
              <h2 className="nesto-eyebrow mb-2 text-fg-subtle">{group.caption}</h2>
              <ul className="grid grid-cols-3 gap-2">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={close}
                      className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface p-2 text-center text-meta leading-tight text-fg active:bg-accent-soft"
                    >
                      <item.Icon aria-hidden="true" className="size-5 text-fg-subtle" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {panel.write ? (
            <section>
              <h2 className="nesto-eyebrow mb-2 text-fg-subtle">{ribbon.groups.write}</h2>
              <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                {(["general", "sales", "support"] as const).map((channel) => (
                  <li key={channel} className="border-b border-line last:border-b-0">
                    <a href={`mailto:${siteContact[channel]}`} className="flex min-h-12 items-center justify-between gap-3 px-4 text-body">
                      <span className="text-fg-muted">{ribbon.channels[channel]}</span>
                      <span className="text-fg">{siteContact[channel]}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-meta text-fg-subtle">{ribbon.replyNote}</p>
            </section>
          ) : null}
          {panel.callout ? (
            <Link href={panel.callout.href} onClick={close} className="mt-1 flex flex-col gap-2 rounded-xl bg-fg p-4 text-canvas">
              <span className="nesto-eyebrow text-accent">{panel.callout.eyebrow}</span>
              <span className="text-section leading-tight font-display">{panel.callout.title}</span>
              <span className="inline-flex items-center gap-1.5 text-table font-medium">
                {panel.callout.cta}
                <ArrowRight aria-hidden="true" className="size-4" />
              </span>
            </Link>
          ) : null}
        </nav>

        <div className="shrink-0 space-y-3 border-t border-line p-4">
          <div className="flex items-center gap-2">
            <ThemeToggle variant="row" className="flex-1" />
            <LocaleSwitch label={copy.language} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="secondary" size="lg">
              <Link href="/login" onClick={close}>{copy.signIn}</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/apply" onClick={close}>{copy.applyShort}</Link>
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
