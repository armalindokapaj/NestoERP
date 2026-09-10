import { Badge } from "@/components/ui/badge";
import { brand } from "@/config/brand";
import { roleLabel } from "@/config/roles";
import type { CurrentUser } from "@/lib/auth/types";
import { greeting } from "@/lib/utils/format";

/**
 * Dashboard header (design spec §18, §73).
 *
 * Greeting eyebrow, title, one line of context — and on the right the date over
 * the brand line. The title is set in the display serif: §7 pairs the serif
 * with the wordmark and the dashboard heading, and nothing else.
 *
 * The role sits beside the title rather than in a corner, because switching
 * roles is the main thing anyone does with this screen in V0.1 (§96).
 */
export function WelcomeHeader({ user }: { user: CurrentUser }) {
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <p className="nesto-eyebrow text-fg-subtle">
          {greeting()}, {user.firstName}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-display text-fg">Dashboard</h1>
          <Badge tone={user.roleIsOverridden ? "warning" : "neutral"}>
            {user.roleIsOverridden ? `Viewing as ${roleLabel(user.role)}` : roleLabel(user.role)}
          </Badge>
        </div>

        <p className="mt-2 text-body text-fg-muted">
          Here&apos;s what&apos;s happening across {user.companyName} today.
        </p>
      </div>

      <div className="hidden shrink-0 text-right md:block">
        <p className="text-table font-medium text-fg">{today}</p>
        <div aria-hidden="true" className="my-3 ml-auto h-px w-6 bg-line-strong" />
        {brand.motto.map((line) => (
          <p key={line} className="nesto-eyebrow text-fg-subtle">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
