import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { brand } from "@/config/brand";
import type { UserContext } from "@/lib/context/types";
import { focusText, greetingText } from "./config-text";
import { getTranslations } from "@/lib/i18n/server";
import { StartHere } from "./start-here";

/**
 * Dashboard header (design spec §18, §73).
 *
 * Greeting eyebrow, title, one line of context — and on the right the date over
 * the brand line. The title is set in the display serif: §7 pairs the serif
 * with the wordmark and the dashboard heading, and nothing else.
 *
 * The role sits beside the title rather than in a corner: the signed-in
 * account's own, from its membership (C-01 §34).
 *
 * "Start here" follows it, streamed on its own, so every dashboard gets it
 * from the one header rather than a second page slot (AUD-05 §7, UX-15).
 */
export async function WelcomeHeader({
  context,
  focus,
}: {
  context: UserContext;
  focus: string;
}) {
  const t = await getTranslations("dashboard");
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="nesto-eyebrow text-fg-subtle">
            {greetingText(t)}, {context.firstName}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-serif text-display text-fg">{t("title")}</h1>
            <Badge tone="neutral">{context.roleLabel}</Badge>
          </div>

          <p className="mt-2 text-body text-fg-muted">{focusText(t, focus)}</p>
          {/* Group: "Across <the group>"; company: the company's own name (Workspace Context §70). */}
          <p
            className="mt-1 text-table text-fg-subtle"
            data-testid="dashboard-workspace"
          >
            {context.workspace.scopeType === "GROUP"
              ? t("across", { name: context.parentGroup.name })
              : context.company.name}
          </p>
        </div>

        <div className="hidden shrink-0 text-right md:block">
          <p className="text-table font-medium text-fg">{today}</p>
          <div
            aria-hidden="true"
            className="my-3 ml-auto h-px w-6 bg-line-strong"
          />
          {brand.motto.map((line) => (
            <p key={line} className="nesto-eyebrow text-fg-subtle">
              {line}
            </p>
          ))}
        </div>
      </div>
      {/* Under the header, streamed: only for a genuinely empty view, never holding up the dashboard (AUD-05 §7, UX-15). */}
      <Suspense fallback={null}>
        <StartHere context={context} />
      </Suspense>
    </>
  );
}
