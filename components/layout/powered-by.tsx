"use client";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { brand } from "@/config/brand";

/**
 * The foot of the navigation (OW §6, §71): NESTO as secondary branding, small
 * and muted, under the customer's own identity at the top. A demonstration
 * tenant says so here too (D-01 §68, §69) — the notice left the top bar with
 * the workspace switcher (OW §19), and the dashboard hero still carries it.
 *
 * A Client Component because the three shells that end with it are, and the
 * company sidebar renders it from the server.
 */
export function PoweredBy({ isDemo, version = false }: { isDemo: boolean; version?: boolean }) {
  const t = useTranslations("shell");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="powered-by">
      <p className="min-w-0 truncate text-micro text-fg-subtle">
        {t("poweredBy")} <span className="font-medium tracking-[0.12em] text-fg-muted">{brand.name}</span>
        {version ? <span className="ml-1.5 tabular-nums">{brand.version}</span> : null}
      </p>
      {isDemo ? (
        <span
          title={t("demoDisclaimer")}
          aria-label={t("demoDisclaimer")}
          data-testid="demo-notice"
          className="inline-flex shrink-0 rounded-full border border-line px-2 py-px text-micro font-medium text-fg-muted"
        >
          {t("demoData")}
        </span>
      ) : null}
    </div>
  );
}
