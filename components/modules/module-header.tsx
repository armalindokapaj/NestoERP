import * as React from "react";

import type { ModuleDefinition } from "@/config/modules";

/** Module title block (spec §31; design spec §28, §59). */
export function ModuleHeader({
  module,
  actions,
}: {
  module: ModuleDefinition;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-page font-semibold text-fg">{module.label}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{module.description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
