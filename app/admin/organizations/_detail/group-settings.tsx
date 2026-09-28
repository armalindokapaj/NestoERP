import type { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { formatDate } from "@/lib/utils/format";

type Props = { implementation: Awaited<ReturnType<typeof getGroupImplementation>> };

/**
 * A group's Settings tab (Organizations PRD §44): its identity, branding and
 * lifecycle. Editing is in the page header (Edit details, Branding,
 * Lifecycle); company settings stay on each company.
 */
export function GroupSettings({ implementation }: Props) {
  const { group } = implementation;
  const rows: [string, string | null][] = [
    ["Group name", group.name], ["Code", group.slug], ["Legal name", group.legalName], ["Country", group.country], ["Time zone", group.timezone], ["Currency", group.currency],
    ["Active since", group.activatedAt ? formatDate(group.activatedAt) : null],
  ];
  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="group-general">
        <h2 id="group-general" className="text-card font-semibold text-fg">General</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value || "—"}</dd></div>)}
        </dl>
      </section>
      <section className="nesto-card p-5" aria-labelledby="group-branding">
        <h2 id="group-branding" className="text-card font-semibold text-fg">Branding</h2>
        <p className="mt-2 text-table text-fg-muted">{group.logoUrl ? "A logo leads the tenant's sidebar." : "No logo — the group's initials stand in."}</p>
      </section>
    </div>
  );
}
