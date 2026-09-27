import * as React from "react";

import { HelpEntry } from "@/components/help/help-entry";
import { ModuleTabs } from "@/components/modules/module-tabs";
import { headerActionsClass } from "@/components/ui/page-header";
import type { ResolvedModuleExperience } from "@/lib/access/module-access";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The structure every NESTO module uses (PRD #7 §5, §12, §93).
 *
 * Header, tabs, toolbar, content — Projects, Finance, HR and Procurement all
 * plug into this rather than inventing their own page furniture.
 *
 * Only actions the current user may perform are passed in; the shell does not
 * render a disabled control to advertise what somebody cannot do (PRD #7 §13).
 *
 * The actions wrap within the page on a narrow screen instead of widening it
 * (AUD-04 §3, D-02-03, D-04-02, MW-01); none is hidden.
 *
 * Orientation (AUD-05 §3, §4, §7): the default heading and description are the
 * module's name and line as the sidebar gives them, in the reader's language,
 * so the menu, the heading and the breadcrumb agree (UX-07). The header ends
 * with the module's Help entry, a quiet link after the page's own actions: the
 * primary action stays the one that stands out (UX-16).
 */
export async function ModulePage({
  experience,
  activeSection,
  title,
  description,
  actions,
  toolbar,
  children,
}: {
  experience: ResolvedModuleExperience;
  activeSection: string;
  /** Defaults to the module label; a section may override it. */
  title?: string;
  /** Defaults to the module's description; `null` shows no line under the title. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const names = await getTranslations("modules");
  const moduleLabel = names(`${experience.module}.label`);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg [overflow-wrap:anywhere]">{title ?? moduleLabel}</h1>
          {description === null ? null : (
            <p className="mt-1.5 text-body text-fg-muted">
              {description ?? names(`${experience.module}.description`)}
            </p>
          )}
        </div>
        <div className={headerActionsClass}>
          {actions}
          <HelpEntry moduleKey={experience.module} moduleLabel={moduleLabel} />
        </div>
      </div>

      <ModuleTabs experience={experience} activeSection={activeSection} />

      {toolbar ? <div>{toolbar}</div> : null}

      <div>{children}</div>
    </div>
  );
}
