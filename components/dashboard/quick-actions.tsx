import Link from "@/components/navigation/nav-link";

import { cn } from "@/lib/utils/cn";
import { getIcon } from "@/components/layout/nav-icon";
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
    <div className="grid grid-cols-4 gap-2.5 md:flex md:flex-wrap md:items-center md:gap-2">
      {actions.map((action) => {
        const Icon = getIcon(action.icon);
        return (
          // One link: a tile on a phone, the pill button from tablet up (Premium Mobile §5.3).
          <Link
            key={action.key}
            navSource="dashboard"
            href={action.href}
            className={cn(
              "flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] border border-line bg-surface px-1 py-3 text-center text-micro font-semibold leading-tight text-fg transition-colors active:border-accent active:bg-accent-soft",
              "md:inline-flex md:h-8 md:min-h-0 md:flex-row md:gap-2 md:whitespace-nowrap md:rounded-full md:border-line-strong md:px-3 md:py-0 md:text-table md:font-medium md:hover:bg-hover md:active:bg-surface md:touch:h-11 md:touch:min-w-11",
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.6} className="size-[22px] shrink-0 text-accent-strong md:size-4 md:text-current" />
            <span className="max-w-full break-words">{quickActionLabel(t, action.key, action.label)}</span>
          </Link>
        );
      })}
    </div>
  );
}
