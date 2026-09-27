import Link from "@/components/navigation/nav-link";

import { getIcon } from "@/components/layout/nav-icon";
import { Button } from "@/components/ui/button";
import type { QuickActionDefinition } from "@/config/quick-actions";
import { getTranslations } from "@/lib/i18n/server";
import { quickActionLabel } from "./config-text";

/**
 * Quick actions (PRD #4 §22).
 *
 * The list arrives already filtered by permission, so the dashboard never
 * offers a link the route guard would refuse — there is no dead navigation
 * anywhere in NESTO (PRD #3 §125). A Viewer gets nothing here at all.
 */
export async function QuickActions({ actions }: { actions: QuickActionDefinition[] }) {
  if (actions.length === 0) return null;
  const t = await getTranslations("dashboard");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const Icon = getIcon(action.icon);
        return (
          <Button key={action.key} asChild variant="secondary" size="sm">
            <Link navSource="dashboard" href={action.href}>
              <Icon aria-hidden="true" />
              {quickActionLabel(t, action.key, action.label)}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
