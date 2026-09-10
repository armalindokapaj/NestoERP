import * as React from "react";

import { ModuleTabs } from "@/components/modules/module-tabs";
import type { ResolvedModuleExperience } from "@/lib/access/module-access";

/**
 * The structure every NESTO module uses (PRD #7 §5, §12, §93).
 *
 * Header, tabs, toolbar, content — Projects, Finance, HR and Procurement all
 * plug into this rather than inventing their own page furniture.
 *
 * Only actions the current user may perform are passed in; the shell does not
 * render a disabled control to advertise what somebody cannot do (PRD #7 §13).
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
  description?: string;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">{title ?? experience.label}</h1>
          <p className="mt-1.5 text-body text-fg-muted">
            {description ?? experience.description}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      <ModuleTabs experience={experience} activeSection={activeSection} />

      {toolbar ? <div>{toolbar}</div> : null}

      <div>{children}</div>
    </div>
  );
}
