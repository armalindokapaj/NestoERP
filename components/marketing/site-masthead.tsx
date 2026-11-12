"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronRight,
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
 * The public site's masthead: the Ribbon (UI-05 §2, §9).
 *
 * The same idea as the application's Ribbon, so a visitor learns the product's
 * navigation before signing in: five tabs, and each opens a panel of groups —
 * big buttons above, a caption below — with one dark callout that says where
 * to go next. On a phone the tabs become square tabs in a full-screen sheet.
 *
 * One row of cells divided by lines, in glass (95% of the page and an 8px
 * blur): the logo, the tabs in mono capitals — the open one, or the one the
 * page is in, in ink — then the language, the theme, Sign in, and Apply as the
 * ink block at the end. A tab's panel drops over the page as glass (72% and a
 * 16px blur), the page showing through it.
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
  moduleZones,
  roles,
  roleCount,
}: {
  copy: SiteCopy["header"];
  ribbon: SiteCopy["ribbon"];
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

  // Below lg the masthead slides away while you read down, and comes back as soon as you scroll up;
  // the section bars and the gold line take its place at the top (styles/globals.css).
  const away = useAwayOnScroll(menu);

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

  const cell = "flex items-center border-l border-line-strong";
  const mono = "whitespace-nowrap font-mono text-[11px] max-md:text-meta font-medium uppercase tracking-[0.12em]";

  return (
    <header className={cn("sticky top-0 z-30 transition-transform duration-200", away && "max-lg:-translate-y-full")} data-testid="site-masthead" data-away={away || undefined}>
      {/* The glass sits on a layer behind the masthead, not on it: a backdrop filter makes its
          element the box `position: fixed` children are placed in, which would trap the scrim. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 border-b border-line-strong bg-canvas/95 backdrop-blur-[8px]" />
      <div className="flex h-16 items-stretch">
        <Link href="/" aria-label={copy.home} className="flex shrink-0 items-center border-r border-line-strong px-4 sm:px-5">
          <NestoLogo />
        </Link>

        {/* The tabs: a disclosure each, so a click opens the panel and a second one closes it. */}
        <nav aria-label={copy.siteNavigation} className="hidden items-center gap-1 px-3 lg:flex">
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
                  "inline-flex h-8 items-center gap-1.5 px-2.5 transition-colors",
                  mono,
                  on ? "bg-fg text-canvas" : "text-fg-muted hover:text-fg",
                )}
              >
                {ribbon.tabs[tab]}
                <ChevronDown aria-hidden="true" className={cn("size-3 transition-transform", open === tab && "rotate-180")} />
              </button>
            );
          })}
        </nav>
        <Link
          href={siteRibbon.platform.callout}
          className={cn("hidden items-center gap-2 border-l border-line-strong px-5 text-accent-strong transition-colors hover:text-fg min-[100rem]:flex", mono)}
        >
          <PlayCircle aria-hidden="true" className="size-4" />
          {copy.followUnit}
        </Link>

        <span className="flex-1" />
        <div className={cn(cell, "px-2 max-lg:hidden")}>
          <LocaleSwitch label={copy.language} />
        </div>
        <div className={cn(cell, "px-1.5 max-lg:hidden")}>
          <ThemeToggle />
        </div>
        <Link href="/login" className={cn(cell, mono, "px-5 text-fg transition-colors hover:bg-hover max-lg:hidden")}>
          {copy.signIn}
        </Link>
        <Link href="/apply" className={cn("flex items-center gap-2.5 bg-fg px-4 text-canvas transition-[filter] hover:brightness-125 sm:px-6", mono)}>
          <span className="xl:hidden">{copy.applyShort}</span>
          <span className="max-xl:hidden">{copy.apply}</span>
          <ArrowRight aria-hidden="true" className="size-3.5 max-sm:hidden" />
        </Link>
        <button
          type="button"
          onClick={() => setMenu(true)}
          aria-label={copy.openMenu}
          className={cn(cell, "w-14 justify-center text-fg transition-colors hover:bg-hover lg:hidden")}
        >
          <Menu aria-hidden="true" className="size-[22px]" />
        </button>
      </div>

      {open ? (
        <>
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(null)} className="fixed inset-0 -z-20 hidden cursor-default lg:block" />
          <div
            id={panelId}
            role="region"
            aria-label={ribbon.tabs[open]}
            className="absolute inset-x-0 top-full hidden border-b border-line-strong bg-canvas/72 backdrop-blur-[16px] backdrop-saturate-[1.3] lg:block"
            data-testid="ribbon-panel"
          >
            <div className="flex w-full items-stretch">
              <RibbonPanel panel={panels[open]} ribbon={ribbon} onGo={() => setOpen(null)} />
              <button
                type="button"
                onClick={() => { tabRefs.current[open]?.focus(); setOpen(null); }}
                aria-label={copy.closePanel}
                className="grid w-14 shrink-0 place-items-center border-l border-line-strong text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
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
    <div className="flex min-h-[132px] flex-1 items-stretch gap-0 overflow-x-auto">
      {panel.groups.map((group) => (
        <div key={group.key} className="flex flex-col justify-between gap-2 border-r border-line-strong px-4 py-3">
          {group.compact ? (
            <ul className={cn("grid grid-flow-col gap-x-1 gap-y-0.5", group.rows === 4 ? "grid-rows-[repeat(4,28px)]" : "grid-rows-[repeat(3,30px)]")}>
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} onClick={onGo} className="flex h-full items-center gap-2 whitespace-nowrap px-2 text-table text-fg transition-colors hover:bg-hover">
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
                  <Link href={item.href} onClick={onGo} className="flex min-h-[84px] w-[92px] flex-col items-center gap-2 px-1.5 pb-2 pt-3 text-center text-meta leading-tight text-fg transition-colors hover:bg-hover">
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
        <div className="flex flex-col justify-between gap-2 px-[18px] py-3">
          <ul className="grid gap-0.5">
            {(["general", "sales", "support"] as const).map((channel) => (
              <li key={channel}>
                <a href={`mailto:${siteContact[channel]}`} className="flex h-[30px] items-center gap-2 whitespace-nowrap px-2.5 text-table text-fg transition-colors hover:bg-hover">
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
          className="group ml-auto flex w-[300px] shrink-0 flex-col justify-between gap-2.5 bg-fg px-5 py-4 text-canvas"
        >
          <span className="nesto-eyebrow text-accent">{panel.callout.eyebrow}</span>
          <span className="text-section leading-tight font-display">{panel.callout.title}</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] max-md:text-meta font-medium uppercase tracking-[0.12em]">
            {panel.callout.cta}
            <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Below lg the masthead slides away while the page scrolls down and comes back
 * as soon as it scrolls up or reaches its top. Marked on <html> too, so the
 * section bars and the gold line can take its place. Never while the menu is open.
 */
function useAwayOnScroll(menuOpen: boolean): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 1023.98px)");
    let last = window.scrollY;
    let frame = 0;
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      if (!phone.matches || menuOpen || y <= 80) setAway(false);
      else if (y > last + 6) setAway(true);
      else if (y < last - 6) setAway(false);
      if (Math.abs(y - last) > 6 || y <= 80) last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    phone.addEventListener("change", read);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      phone.removeEventListener("change", read);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (away) document.documentElement.dataset.siteMasthead = "away";
    else delete document.documentElement.dataset.siteMasthead;
    return () => {
      delete document.documentElement.dataset.siteMasthead;
    };
  }, [away]);
  return away;
}

/**
 * The phone's menu, a full-screen sheet (UI-05 §2.3): the Ribbon's five tabs
 * as lines in the index rail's capitals that open in place, the one for the
 * page you are on open first, its sets as rows; then language and Day or
 * Night; and the two ways in, Sign in and Apply, at the foot, where the thumb is.
 */
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
  const [tab, setTab] = useState<RibbonTab | null>(here ?? "platform");
  const close = () => onOpenChange(false);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="nesto-site inset-0 w-full max-w-none rounded-none border-0 bg-canvas sm:max-w-none">
        <DrawerTitle className="sr-only">{copy.drawerTitle}</DrawerTitle>
        <div className="flex h-16 shrink-0 items-stretch justify-between border-b border-line-strong">
          <span className="flex items-center px-4"><NestoLogo /></span>
          <button type="button" onClick={close} aria-label={copy.closeMenu} className="grid w-14 place-items-center bg-fg text-canvas transition-[filter] hover:brightness-125">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <nav aria-label={copy.siteNavigation} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {RIBBON_TABS.map((key) => {
            const expanded = tab === key;
            const panel = panels[key];
            return (
              <div key={key} data-testid={`site-menu-${key}`}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setTab(expanded ? null : key)}
                  className="flex h-16 w-full items-center justify-between gap-4 border-b border-line-strong px-4 text-left transition-colors hover:bg-hover sm:px-6"
                >
                  <span className={cn("font-display text-[1.875rem] font-medium uppercase leading-none tracking-[0.01em]", here === key ? "text-accent-strong" : "text-fg")}>{ribbon.tabs[key]}</span>
                  <span aria-hidden="true" className="font-mono text-[1.125rem] text-fg">{expanded ? "−" : "+"}</span>
                </button>
                {expanded ? (
                  <div className="border-b border-line-strong bg-surface pb-3">
                    {panel.groups.map((group) => (
                      <section key={group.key}>
                        <h2 className="nesto-eyebrow px-4 pb-1 pt-4 text-fg-subtle sm:px-6">{group.caption}</h2>
                        <ul>
                          {group.items.map((item) => (
                            <li key={item.key}>
                              <Link href={item.href} onClick={close} className="flex min-h-12 items-center gap-3 px-4 text-body text-fg transition-colors hover:bg-hover active:bg-accent-soft sm:px-6">
                                <item.Icon aria-hidden="true" className="size-[18px] shrink-0 text-fg-subtle" />
                                <span className="min-w-0 flex-1">{item.label}</span>
                                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                    {panel.write ? (
                      <section>
                        <h2 className="nesto-eyebrow px-4 pb-1 pt-4 text-fg-subtle sm:px-6">{ribbon.groups.write}</h2>
                        <ul>
                          {(["general", "sales", "support"] as const).map((channel) => (
                            <li key={channel}>
                              <a href={`mailto:${siteContact[channel]}`} className="flex min-h-12 items-center justify-between gap-3 px-4 text-body sm:px-6">
                                <span className="text-fg-muted">{ribbon.channels[channel]}</span>
                                <span className="text-fg">{siteContact[channel]}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                        <p className="px-4 pt-1 text-meta text-fg-subtle sm:px-6">{ribbon.replyNote}</p>
                      </section>
                    ) : null}
                    {panel.callout ? (
                      <Link href={panel.callout.href} onClick={close} className="mx-4 mt-3 flex flex-col gap-2 bg-fg p-4 text-canvas sm:mx-6">
                        <span className="nesto-eyebrow text-accent">{panel.callout.eyebrow}</span>
                        <span className="text-section leading-tight font-display">{panel.callout.title}</span>
                        <span className="inline-flex items-center gap-1.5 text-table font-medium">
                          {panel.callout.cta}
                          <ArrowRight aria-hidden="true" className="size-4" />
                        </span>
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 px-4 py-5 sm:px-6">
            <LocaleSwitch label={copy.language} />
            <ThemeToggle />
          </div>
        </nav>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-line-strong px-4 pb-[max(1rem,var(--nesto-safe-bottom))] pt-3 sm:px-6">
          <Button asChild variant="secondary" size="lg">
            <Link href="/login" onClick={close}>{copy.signIn}</Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/apply" onClick={close}>
              {copy.applyShort}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
