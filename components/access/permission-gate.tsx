import * as React from "react";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAll, canAny, isReadOnly } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";

/**
 * Declarative permission components (PRD #5 §57).
 *
 * A control the user may not use is absent, not disabled: a greyed-out
 * "Approve" tells them nothing useful and advertises what they cannot reach
 * (PRD #5 §32). The exception is workflow state — an Approve button disabled
 * because the invoice is already approved is legitimate.
 */

export function Can({
  context,
  permission,
  any,
  all,
  fallback = null,
  children,
}: {
  context: UserContext;
  permission?: Permission;
  any?: Permission[];
  all?: Permission[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const allowed =
    (permission ? can(context, permission) : true) &&
    (any ? canAny(context, any) : true) &&
    (all ? canAll(context, all) : true);

  return <>{allowed ? children : fallback}</>;
}

/**
 * Renders children only while the user has more than read access to a module.
 * Read-only roles get a clean interface with no editing affordances at all
 * (PRD #7 §54, PRD #3 §66).
 */
export function ReadOnlyGuard({
  context,
  module,
  fallback = null,
  children,
}: {
  context: UserContext;
  module: ModuleKey;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  return <>{isReadOnly(context, module) ? fallback : children}</>;
}
