import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/config/roles";
import type { CurrentUser } from "@/lib/auth/types";
import { greeting } from "@/lib/utils/format";

/**
 * Dashboard header (design spec §18).
 *
 * Greeting eyebrow, title, one line of context, and today's date on the right.
 * The title is set in the display serif — §7 pairs the serif with the wordmark
 * and the dashboard heading, and nothing else.
 */
export function WelcomeHeader({ user }: { user: CurrentUser }) {
  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-micro font-semibold uppercase tracking-[0.16em] text-fg-subtle">
          {greeting()}, {user.firstName}
        </p>
        <h1 className="mt-1.5 font-serif text-page text-fg">Dashboard</h1>
        <p className="mt-1 text-body text-fg-muted">
          {roleLabel(user.role)}
          <span className="px-1.5 text-fg-subtle">·</span>
          {user.companyName}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {user.roleIsOverridden ? (
          <Badge tone="warning">Viewing as {roleLabel(user.role)}</Badge>
        ) : null}
        <p className="hidden text-table text-fg-subtle md:block">{today}</p>
      </div>
    </div>
  );
}
