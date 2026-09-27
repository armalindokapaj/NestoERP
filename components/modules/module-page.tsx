import * as React from "react";

import { ModuleTabs } from "@/components/modules/module-tabs";
import { headerActionsClass } from "@/components/ui/page-header";
import type { ResolvedModuleExperience } from "@/lib/access/module-access";

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
 */
export function ModulePage({
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
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg [overflow-wrap:anywhere]">{title ?? experience.label}</h1>
          {description === null ? null : (
            <p className="mt-1.5 text-body text-fg-muted">
              {description ?? experience.description}
            </p>
          )}
        </div>
        {actions ? <div className={headerActionsClass}>{actions}</div> : null}
      </div>

      <ModuleTabs experience={experience} activeSection={activeSection} />

      {toolbar ? <div>{toolbar}</div> : null}

      <div>{children}</div>
    </div>
  );
}
