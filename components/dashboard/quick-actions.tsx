import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { QuickAction } from "@/config/dashboards";
import { can } from "@/config/permissions";
import type { CurrentUser } from "@/lib/auth/types";

/**
 * Quick actions (spec §13).
 * Filtered by permission so a dashboard never offers a link the role's own
 * route rules would refuse — no dead navigation (spec §69).
 */
export function QuickActions({
  actions,
  user,
}: {
  actions: QuickAction[];
  user: CurrentUser;
}) {
  const allowed = actions.filter(
    (action) => !action.permission || can(user, action.permission),
  );

  if (allowed.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowed.map((action) => (
        <Button key={action.href + action.label} asChild variant="secondary" size="sm">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ))}
    </div>
  );
}
