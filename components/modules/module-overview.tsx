import Link from "@/components/navigation/nav-link";

import { StatusBadge } from "@/components/modules/status-badge";
import { sectionRoute, type ModuleKey } from "@/config/modules";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { recordSectionsFor } from "@/lib/modules/records/registry";

/**
 * A module's own landing page (PRD #7 §15, §16).
 *
 * Not a copy of the personal dashboard: this describes the module, scoped to
 * what the current user may see. Each card is a real count from a scoped query,
 * so an Architect and a Finance user reading the same page see different
 * numbers from the same code (PRD #4 §20).
 */
export async function ModuleOverview({
  context,
  moduleKey,
}: {
  context: UserContext;
  moduleKey: ModuleKey;
}) {
  const sections = recordSectionsFor(moduleKey).filter(
    (section) => can(context, section.permission) && section.section !== "overview",
  );

  // Deduplicate: several tabs can share one underlying record type.
  const seen = new Set<string>();
  const unique = sections.filter((section) => {
    if (seen.has(section.section)) return false;
    seen.add(section.section);
    return true;
  });

  const cards = await Promise.all(
    unique.map(async (section) => {
      const result = await section.list(context, { filters: {}, page: 1, limit: 5 });
      return { section, total: result.total, rows: result.rows };
    }),
  );

  if (cards.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong bg-surface-muted px-6 py-10 text-center text-table text-fg-muted">
        You have access to this module, but none of its sections are available to your role yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ section, total }) => (
          <Link
            key={section.section}
            href={sectionRoute(moduleKey, section.section)}
            className="nesto-card p-4 transition-colors hover:border-line-strong"
          >
            <p className="text-table text-fg-muted">{section.plural}</p>
            <p className="mt-2 text-page font-semibold tabular-nums text-fg">{total}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {cards
          .filter((card) => card.rows.length > 0)
          .slice(0, 4)
          .map(({ section, rows }) => (
            <section key={section.section} className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{section.plural}</h2>
                <Link
                  href={sectionRoute(moduleKey, section.section)}
                  className="text-table font-medium text-accent-strong"
                >
                  View all
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`${sectionRoute(moduleKey, section.section)}/${row.id}`}
                        className="block truncate text-table font-medium text-fg transition-colors hover:text-accent"
                      >
                        {row.primary}
                      </Link>
                      {row.secondary ? (
                        <p className="truncate text-meta text-fg-subtle">{row.secondary}</p>
                      ) : null}
                    </div>
                    {row.status ? <StatusBadge status={row.status} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  );
}
