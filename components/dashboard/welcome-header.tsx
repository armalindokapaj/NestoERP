import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import type { UserContext } from "@/lib/context/types";
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
  const locale = await getLocale();
  const today = new Intl.DateTimeFormat(locale === "sq" ? "sq-AL" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const isGroup = context.workspace.scopeType === "GROUP";
  const heading = isGroup ? "heading.group" : "heading.company";

  return (
    <>
      <div className="border-b border-accent/25 pb-6">
        <div className="min-w-0">
          <p className="nesto-eyebrow text-accent-strong">{today}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-serif text-[2.5rem] font-normal leading-[1.05] tracking-[-0.01em] text-fg md:text-headline">
              {t(`${heading}.lead`)} <em className="italic text-accent-strong">{t(`${heading}.accent`)}</em>
            </h1>
            <Badge tone="neutral">{context.roleLabel}</Badge>
          </div>

          <p className="mt-3 text-body text-fg-muted">
            {greetingText(t)}, {context.firstName}
          </p>
          <p className="mt-1 text-body text-fg-muted">{focusText(t, focus)}</p>
          {/* Group: "Across <the group>"; company: the company's own name (Workspace Context §70). */}
          <p
            className="mt-1 text-table text-fg-subtle"
            data-testid="dashboard-workspace"
          >
            {isGroup ? t("across", { name: context.parentGroup.name }) : context.company.name}
          </p>
        </div>
      </div>
      {/* Under the header, streamed: only for a genuinely empty view, never holding up the dashboard (AUD-05 §7, UX-15). */}
      <Suspense fallback={null}>
        <StartHere context={context} />
      </Suspense>
    </>
  );
}
