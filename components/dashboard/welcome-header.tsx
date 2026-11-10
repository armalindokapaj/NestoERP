import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import type { UserContext } from "@/lib/context/types";
import { dateText } from "@/lib/i18n/format";
import { cn } from "@/lib/utils/cn";
import { focusText, greetingText } from "./config-text";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { StartHere } from "./start-here";

/**
 * Dashboard header (design spec §18, §73).
 *
 * The date as a gold eyebrow, then the heading set as the reference's hero
 * ("Company *overview*"): the first word solid, the second drawn in outline on
 * the line below, closed by a gold square for a full stop; then the greeting as
 * the italic kicker and the lines of context.
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
  const today = dateText(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }, locale);
  const isGroup = context.workspace.scopeType === "GROUP";
  const heading = isGroup ? "heading.group" : "heading.company";
  // The role's name in the reader's language; `context.roleLabel` is the configuration's English.
  const roleLabel = roles(`${context.role}.label`);

  return (
    <>
      <div className="grid gap-x-8 gap-y-5 border-b pb-6 max-md:border-0 max-md:pb-1 max-md:pt-1 lg:grid-cols-3 border-fg" data-testid="dashboard-header">
        <div className={cn("min-w-0 animate-[nesto-rise-focus_0.8s_cubic-bezier(0.25,0.46,0.45,0.94)_both] motion-reduce:animate-none", aside ? "lg:col-span-2" : "lg:col-span-3")} data-testid="dashboard-heading">
          <p className="nesto-eyebrow text-accent-strong">{today}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Version 2: no display face and nothing above the page title (UI-02 §6.2). */}
            <h1 className="text-fg font-display font-semibold text-[clamp(4rem,9vw,7.5rem)] max-md:text-[min(calc(25vw-10px),7.5rem)] leading-[0.82] tracking-[-0.035em] [font-variation-settings:'wdth'_62]">
              {t(`${heading}.lead`)} <em className="block pl-[0.42em] font-display font-semibold not-italic tracking-[-0.035em] text-transparent [-webkit-text-stroke:1.25px_var(--nesto-fg)] [font-variation-settings:'wdth'_62] after:ml-[0.04em] after:inline-block after:size-[0.13em] after:bg-accent after:align-baseline after:content-['']">{t(`${heading}.accent`)}</em>
              {/* The top of the page, as the first of its sections (UI-02 §26.3). */}
            </h1>
            <Badge tone="neutral" className="max-md:hidden">{roleLabel}</Badge>
          </div>

          {/* Phone: the greeting and the role chip share one row (Premium Mobile §5.1). */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <p className="text-fg-muted nesto-standfirst text-[1.1875rem] leading-[1.3] md:text-[1.3125rem]">
              {/* The name takes the heading's accent: the serif in gold italic, like "overview" above. */}
              {greetingText(t)}, <em className="font-serif text-[1.15em] italic leading-none text-accent-strong font-light tracking-normal">{context.firstName}</em>
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
