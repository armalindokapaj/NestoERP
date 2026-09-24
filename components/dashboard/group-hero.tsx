import Link from "@/components/navigation/nav-link";
import { Building2, Info } from "lucide-react";

import type { GroupIdentity } from "@/lib/modules/dashboard/dashboard.group";

/** What a demonstration tenant says about its data, wherever it says it (D-01 §69). */
export const DEMO_DISCLAIMER = "Demo environment — public company and project information combined with synthetic operational data.";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The group at the top of its dashboard (D-01 §26): name, legal name,
 * registration number (the NIPT) and city, how many companies are active and
 * suspended — and, for a demonstration tenant, that its operational data is
 * synthetic. Shown to the people who see the group as a group: its Owner and
 * the heads of its functions.
 */
export function GroupHero({ identity }: { identity: GroupIdentity }) {
  const facts = [identity.legalName, identity.registrationNumber ? `NIPT ${identity.registrationNumber}` : null, [identity.city, identity.country].filter(Boolean).join(", ") || null].filter(Boolean);

  return (
    <section aria-labelledby="group-hero-title" className="nesto-card overflow-hidden" data-testid="group-hero">
      <div className="flex flex-wrap items-center justify-between gap-4 border-l-2 border-l-accent p-5 md:p-6">
        <div className="min-w-0">
          <p className="nesto-eyebrow text-fg-subtle">Group</p>
          <h2 id="group-hero-title" className="mt-1 truncate font-serif text-section text-fg">
            {identity.name}
          </h2>
          {facts.length ? <p className="mt-1 text-table text-fg-muted">{facts.join(" · ")}</p> : null}
        </div>
        <Link navSource="dashboard"
          href="/organization/companies"
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-line px-3 py-2 text-table text-fg transition-colors hover:border-line-strong"
        >
          <Building2 aria-hidden="true" className="size-4 text-fg-muted" />
          <span>
            {plural(identity.activeCompanies, "active company", "active companies")}
            {identity.suspendedCompanies ? <span className="text-fg-subtle"> · {identity.suspendedCompanies} suspended</span> : null}
          </span>
        </Link>
      </div>
      {identity.isDemo ? (
        <p role="note" className="flex items-start gap-2 border-t border-line bg-hover/60 px-5 py-2.5 text-meta text-fg-muted md:px-6">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {DEMO_DISCLAIMER}
        </p>
      ) : null}
    </section>
  );
}
