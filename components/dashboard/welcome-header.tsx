import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import type { UserContext } from "@/lib/context/types";
import { cn } from "@/lib/utils/cn";
import { focusText, greetingText } from "./config-text";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { StartHere } from "./start-here";

/**
 * Dashboard header (design spec §18, §73).
 *
 * The date as a gold eyebrow, a two-colour serif heading ("Company *overview*",
 * the second word in gold italic), then the greeting and the lines of context,
 * closed by a gold hairline (Black & Gold reskin §5b).
 *
 * The role sits beside the title rather than in a corner: the signed-in
 * account's own, from its membership (C-01 §34).
 *
 * From `lg` the heading keeps two thirds of the row and `aside` takes the last
 * third — the day's entry point, and the approvals waiting, stacked. The
 * heading's own height, from the date to its last line, is the height of the
 * whole row: the aside is held to it and never makes the row taller, so what
 * it lists has to fit (components/dashboard/pending-approvals.tsx). Below `lg`
 * it is one column — heading, then the aside at its natural height.
 *
 * "Start here" follows it, streamed on its own, so every dashboard gets it
 * from the one header rather than a second page slot (AUD-05 §7, UX-15).
 */
export async function WelcomeHeader({
  context,
  focus,
  aside,
}: {
  context: UserContext;
  focus: string;
  /** The right-hand third of the row: My Day, and Pending Approvals under it. */
  aside?: React.ReactNode;
}) {
  const t = await getTranslations("dashboard");
  const roles = await getTranslations("roles");
  const locale = await getLocale();
  const today = new Intl.DateTimeFormat(locale === "sq" ? "sq-AL" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const isGroup = context.workspace.scopeType === "GROUP";
  const heading = isGroup ? "heading.group" : "heading.company";
  // The role's name in the reader's language; `context.roleLabel` is the configuration's English.
  const roleLabel = roles(`${context.role}.label`);

  return (
    <>
      <div className="grid gap-x-8 gap-y-5 border-b border-accent/25 pb-6 max-md:border-0 max-md:pb-1 max-md:pt-1 lg:grid-cols-3" data-testid="dashboard-header">
        <div className={cn("min-w-0", aside ? "lg:col-span-2" : "lg:col-span-3")} data-testid="dashboard-heading">
          <p className="nesto-eyebrow text-accent-strong">{today}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-serif text-[2.875rem] font-normal leading-none tracking-[-0.01em] text-fg md:text-headline md:leading-[1.05]">
              {t(`${heading}.lead`)} <em className="italic text-accent-strong">{t(`${heading}.accent`)}</em>
            </h1>
            <Badge tone="neutral" className="max-md:hidden">{roleLabel}</Badge>
          </div>

          {/* Phone: the greeting and the role chip share one row (Premium Mobile §5.1). */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <p className="text-[0.9375rem] text-fg-muted md:text-body">
              {greetingText(t)}, {context.firstName}
            </p>
            <Badge tone="neutral" className="rounded-full border border-accent/30 bg-transparent px-2.5 py-0.5 text-micro font-semibold text-accent-strong md:hidden">
              {roleLabel}
            </Badge>
          </div>
          <p className="mt-1 text-table leading-normal text-fg-subtle md:text-body md:text-fg-muted">{focusText(t, focus)}</p>
          {/* Group: "Across <the group>"; company: the company's own name (Workspace Context §70). The header names it on a phone. */}
          <p
            className="mt-1 text-table text-fg-subtle max-md:hidden"
            data-testid="dashboard-workspace"
          >
            {isGroup ? t("across", { name: context.parentGroup.name }) : context.company.name}
          </p>
        </div>
        {aside ? (
          // h-0 + min-h-full: the aside asks for no height of its own, then fills the row the heading made.
          <div className="flex min-w-0 flex-col gap-3 lg:h-0 lg:min-h-full lg:gap-2.5 lg:overflow-hidden" data-testid="dashboard-aside">
            {aside}
          </div>
        ) : null}
      </div>
      {/* Under the header, streamed: only for a genuinely empty view, never holding up the dashboard (AUD-05 §7, UX-15). */}
      <Suspense fallback={null}>
        <StartHere context={context} />
      </Suspense>
    </>
  );
}
