"use client";

import * as React from "react";
import { Building2, CircleHelp, LogOut, Moon, Settings, ShieldCheck, Sparkles, Sun } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { useSignOut } from "@/components/layout/use-sign-out";
import Link from "@/components/navigation/nav-link";
import { applyThemeChoice } from "@/components/settings/theme-preference";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isThemeChoice, type ThemeChoice } from "@/lib/layout/theme-state";
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

const THEMES: { value: ThemeChoice; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
];

/** The scheme in force: the explicit choice, else the operating system's, so one of the two is always selected. */
function readTheme(): ThemeChoice {
  const choice = document.documentElement.dataset.theme;
  if (isThemeChoice(choice) && choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const row =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-table text-fg transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60";

/**
 * The account panel (UI-01 §10): the third control of the universal cluster,
 * the same on the platform, group and company surfaces.
 *
 * A labelled non-modal dialog with semantic sections, not `role=menu`: it mixes
 * links, a radio group and a button. Opening it closes any other top-bar panel
 * (§5.4); a failing search or notification service cannot touch it, because it
 * renders from the server-resolved model and fetches nothing.
 */
export function AccountPanel({ model }: { model: AccountPanelModel }) {
  const t = useTranslations("shell");
  const [open, setOpen] = usePanelOpen("account");
  const [theme, setTheme] = React.useState<ThemeChoice>("light");
  const { signOut, signingOut } = useSignOut(() => setOpen(false));

  // The theme is read from the document, which the server rendered from the cookie.
  React.useEffect(() => {
    if (open) setTheme(readTheme());
  }, [open]);

  const name = fullName(model.user.firstName, model.user.lastName);
  const close = () => setOpen(false);
  const { destinations } = model;

  function choose(next: ThemeChoice) {
    setTheme(next);
    applyThemeChoice(next);
  }

  function onThemeKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = THEMES.findIndex((option) => option.value === theme);
    const next = THEMES[(index + step + THEMES.length) % THEMES.length];
    choose(next.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[THEMES.indexOf(next)]?.focus();
  }

  const link = (href: string, icon: React.ReactNode, label: string, testId?: string) => (
    <Link href={href} onClick={close} className={row} data-testid={testId}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
  const icon = (Icon: React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>) => (
    <Icon aria-hidden className="size-[18px] shrink-0 text-accent-strong" strokeWidth={1.6} />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("account.menuFor", { name })}
          aria-haspopup="dialog"
          data-testid="account-trigger"
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full transition-colors hover:bg-hover data-[state=open]:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar firstName={model.user.firstName} lastName={model.user.lastName} src={model.user.avatarUrl} size="md" className="size-8 border-transparent bg-accent font-serif font-normal text-accent-fg" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t("account.title")} className="w-80 p-0 max-sm:w-[calc(100vw-1.5rem)]" data-testid="account-panel">
        <Link href={destinations.profile} onClick={close} data-testid="account-profile" className="flex items-center gap-3 border-b border-line px-4 py-3.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Avatar firstName={model.user.firstName} lastName={model.user.lastName} src={model.user.avatarUrl} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-card font-semibold leading-snug text-fg" title={name} data-testid="account-name">{name}</span>
            <span className="block truncate text-table text-fg-muted" title={`${model.roleLabel} · ${model.workspaceName}`} data-testid="account-context">
              {t("account.identityRole", { role: model.roleLabel, workspace: model.workspaceName })}
            </span>
            <span className="sr-only">{t("account.profile")}</span>
          </span>
        </Link>

        <nav aria-label={t("account.title")} className="p-1.5">
          {link(destinations.settings, icon(Settings), t("account.settings"), "account-settings")}
          {destinations.organizationSettings
            ? link(
                destinations.organizationSettings.href,
                icon(Building2),
                destinations.organizationSettings.kind === "group" ? t("account.groupSettings") : t("account.companySettings"),
                "account-organization-settings",
              )
            : null}
          {destinations.platformAdmin ? link(destinations.platformAdmin, icon(ShieldCheck), t("account.platformAdmin"), "account-platform-admin") : null}
        </nav>

        <section aria-label={t("account.appearance")} className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <div role="radiogroup" aria-label={t("account.appearance")} onKeyDown={onThemeKeys} className="grid flex-1 grid-cols-2 gap-1 rounded-lg border border-line bg-surface-muted p-1">
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
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11",
                    selected ? "bg-surface font-semibold text-fg shadow-sm ring-1 ring-accent" : "text-fg-muted hover:text-fg",
                  )}
                >
                  <option.icon aria-hidden className="size-4" strokeWidth={1.6} />
                  {t(`account.${option.value}`)}
                </button>
              );
            })}
          </div>
          <LocaleSwitch label={t("account.language")} className="h-11 shrink-0 border border-line px-3" />
        </section>

        <nav aria-label={t("account.help")} className="border-t border-line p-1.5">
          {link(destinations.help, icon(CircleHelp), t("account.help"), "account-help")}
          {link(destinations.whatsNew, icon(Sparkles), t("account.whatsNew"), "account-whats-new")}
        </nav>

        <div className="border-t border-line p-1.5">
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void signOut()}
            data-testid="account-sign-out"
            className={cn(row, "text-danger-strong hover:bg-danger-soft")}
          >
            <LogOut aria-hidden className="size-[18px] shrink-0" strokeWidth={1.6} />
            {signingOut ? t("account.signingOut") : t("account.signOut")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
