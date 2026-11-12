"use client";

import * as React from "react";
import { Building2, ChevronRight, CircleHelp, LogOut, Moon, Settings, ShieldCheck, Sparkles, Sun, type IconComponent } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useChangeLocale } from "@/components/i18n/use-change-locale";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { applyThemeChoice } from "@/components/settings/theme-preference";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readThemeChoice, type ThemeChoice } from "@/lib/layout/theme-state";
import { topbarOffset } from "@/lib/layout/topbar-line";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/config";
import { usePanelOpen } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";
import { fullName } from "@/lib/utils/format";

/**
 * What the account panel needs, all of it decided on the server (UI-01 §10).
 * Every destination is a real page the person may open: an entry the person has
 * no access to is left out here, not hidden by the client.
 */
export type AccountPanelModel = {
  user: { firstName: string; lastName: string; avatarUrl: string | null };
  /** The effective role label for the active context. */
  roleLabel: string;
  /** The full name of the active workspace, or "Platform Admin". */
  workspaceName: string;
  destinations: {
    profile: string;
    settings: string;
    help: string;
    whatsNew: string;
    /** "Group Settings" or "Company Settings", only with settings access. */
    organizationSettings?: { href: string; kind: "group" | "company" };
    /** Back to the platform dashboard, only for a platform operator outside a company. */
    platformAdmin?: string;
  };
};

const THEMES: { value: ThemeChoice; icon: IconComponent }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
];

/** Day or Night, as the root layout rendered it or the last switch set it. */
function readTheme(): ThemeChoice {
  return readThemeChoice(document.documentElement.dataset.theme);
}

/** A row that goes somewhere: the whole line is the target, ruled below, the chevron says it leaves the panel. */
const row =
  "group/row flex min-h-12 w-full cursor-pointer items-center gap-3 border-b border-line px-4 text-left text-table text-fg transition-colors last:border-b-0 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 touch:min-h-14";

/** A section's caption: mono capitals over its rows, as the phone's Menu and My Day. */
function Caption({ children }: { children: React.ReactNode }) {
  return <p aria-hidden="true" className="nesto-eyebrow border-b border-line bg-surface-muted/60 px-4 py-2 text-fg-subtle">{children}</p>;
}

/** One choice of a small square segmented control (Day | Night, EN | SQ). */
const segment = (selected: boolean) =>
  cn(
    "flex min-h-8 min-w-12 cursor-pointer items-center justify-center gap-1.5 px-2.5 font-mono text-micro font-medium uppercase tracking-[0.08em] transition-colors focus-visible:relative focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default touch:min-h-10",
    selected ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
  );

/** Arrow keys move a radio group's choice, and focus with it. */
function arrowKeys<T>(event: React.KeyboardEvent<HTMLDivElement>, options: readonly T[], current: T, choose: (next: T) => void) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const index = options.indexOf(current);
  const next = (index + step + options.length) % options.length;
  choose(options[next]);
  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
}

/**
 * The account panel (UI-01 §10; drawn in the drawing set, UI-07): the third
 * control of the universal cluster, the same on the platform, group and
 * company surfaces.
 *
 *   ( ED )  Erion Doko                       ›   ← you: the whole block opens your profile
 *           GROUP OWNER · Alba Construction
 *   ACCOUNT    Account settings · Company settings · Platform admin
 *   DISPLAY    Theme [ Light | Dark ]  ·  Language [ EN | SQ ]
 *   HELP       Help center · What's new
 *   ⎋ Sign out
 *
 * Sections are lined lists under mono captions; rows that leave the panel
 * carry a chevron, controls that change something here are square segmented
 * choices that show their state, so nothing in it needs guessing.
 *
 * A labelled non-modal dialog with semantic sections, not `role=menu`: it mixes
 * links, radio groups and a button. Opening it closes any other top-bar panel
 * (§5.4); a failing search or notification service cannot touch it, because it
 * renders from the server-resolved model and fetches nothing.
 */
export function AccountPanel({ model }: { model: AccountPanelModel }) {
  const t = useTranslations("shell");
  const [open, setOpen] = usePanelOpen("account");
  const [theme, setTheme] = React.useState<ThemeChoice>("light");
  const trigger = React.useRef<HTMLButtonElement>(null);
  const { signOut, signingOut } = useSignOut(() => setOpen(false));
  const locale = useChangeLocale();

  // The theme is read from the document, which the server rendered from the cookie.
  React.useEffect(() => {
    if (open) setTheme(readTheme());
  }, [open]);

  const name = fullName(model.user.firstName, model.user.lastName);
  const close = () => setOpen(false);
  const { destinations } = model;
  const themes = THEMES.map((option) => option.value);

  function choose(next: ThemeChoice) {
    setTheme(next);
    applyThemeChoice(next);
  }

  const link = (href: string, Icon: IconComponent, label: string, testId?: string) => (
    <Link href={href} onClick={close} className={row} data-testid={testId}>
      <Icon aria-hidden className="size-[18px] shrink-0 text-fg-subtle transition-colors group-hover/row:text-fg" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle transition-transform group-hover/row:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={t("account.menuFor", { name })}
          aria-haspopup="dialog"
          data-testid="account-trigger"
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-none transition-colors hover:bg-hover data-[state=open]:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
        >
          <Avatar firstName={model.user.firstName} lastName={model.user.lastName} src={model.user.avatarUrl} size="md" className="size-8 border-transparent bg-accent font-medium text-accent-fg font-display" />
        </button>
      </PopoverTrigger>
      {/* Its top edge on the breadcrumb bar's top line, like every panel opened from the top bar. */}
      <PopoverContent align="end" sideOffset={open ? topbarOffset(trigger.current) : undefined} aria-label={t("account.title")} className="w-[22rem] overflow-hidden p-0 max-sm:w-[calc(100vw-1.5rem)]" data-testid="account-panel">
        {/* You: the same gold disc as the button that opened it; the whole block opens your profile. */}
        <Link
          href={destinations.profile}
          onClick={close}
          data-testid="account-profile"
          className="group/you flex items-center gap-3.5 border-b border-line-strong px-4 py-4 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Avatar firstName={model.user.firstName} lastName={model.user.lastName} src={model.user.avatarUrl} size="lg" className="border-transparent bg-accent font-display text-[1.125rem] font-medium text-accent-fg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[1.375rem] font-medium leading-tight text-fg" title={name} data-testid="account-name">{name}</span>
            <span className="mt-1 block truncate text-meta text-fg-muted" title={`${model.roleLabel} · ${model.workspaceName}`} data-testid="account-context">
              <span className="font-mono font-medium uppercase tracking-[0.08em] text-fg">{model.roleLabel}</span>
              <span aria-hidden="true" className="px-1.5 text-fg-subtle">·</span>
              <span>{model.workspaceName}</span>
            </span>
            <span className="sr-only">{t("account.profile")}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle transition-transform group-hover/you:translate-x-0.5 motion-reduce:transition-none" />
        </Link>

        <nav aria-label={t("account.title")} className="border-b border-line-strong">
          <Caption>{t("account.title")}</Caption>
          {link(destinations.settings, Settings, t("account.settings"), "account-settings")}
          {destinations.organizationSettings
            ? link(
                destinations.organizationSettings.href,
                Building2,
                destinations.organizationSettings.kind === "group" ? t("account.groupSettings") : t("account.companySettings"),
                "account-organization-settings",
              )
            : null}
          {destinations.platformAdmin ? link(destinations.platformAdmin, ShieldCheck, t("account.platformAdmin"), "account-platform-admin") : null}
        </nav>

        <section aria-label={t("account.appearance")} className="border-b border-line-strong">
          <Caption>{t("account.appearance")}</Caption>
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2">
            <span id="account-theme-label" className="text-table text-fg">{t("account.theme")}</span>
            <div role="radiogroup" aria-labelledby="account-theme-label" onKeyDown={(event) => arrowKeys(event, themes, theme, choose)} className="flex border border-line-strong">
              {THEMES.map((option) => {
                const selected = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => choose(option.value)}
                    data-testid={`account-theme-${option.value}`}
                    className={segment(selected)}
                  >
                    <option.icon aria-hidden className="size-3.5" />
                    {t(`account.${option.value}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
            <span id="account-language-label" className="text-table text-fg">{t("account.language")}</span>
            <div role="radiogroup" aria-labelledby="account-language-label" onKeyDown={(event) => arrowKeys(event, LOCALES, locale.choice, locale.change)} className="flex border border-line-strong">
              {LOCALES.map((option) => {
                const selected = locale.choice === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={LOCALE_NAMES[option]}
                    lang={option}
                    tabIndex={selected ? 0 : -1}
                    disabled={locale.isPending}
                    onClick={() => locale.change(option)}
                    data-testid={`account-language-${option}`}
                    className={segment(selected)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <nav aria-label={t("account.support")} className="border-b border-line-strong">
          <Caption>{t("account.support")}</Caption>
          {link(destinations.help, CircleHelp, t("account.help"), "account-help")}
          {link(destinations.whatsNew, Sparkles, t("account.whatsNew"), "account-whats-new")}
        </nav>

        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
          data-testid="account-sign-out"
          className={cn(row, "border-b-0 font-medium text-danger-strong hover:bg-danger-soft")}
        >
          <LogOut aria-hidden className="size-[18px] shrink-0" />
          {signingOut ? t("account.signingOut") : t("account.signOut")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
