import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";

import { StatusBadge } from "@/components/modules/status-badge";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformCompanyOverview } from "@/lib/modules/platform/platform-company.service";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Company" };

type Props = { params: Promise<{ companyId: string }> };

/**
 * A company's overview (Simplified Company Creation §4, §5, §6, §7): what it
 * is, where it sits, what can still be completed, and the controls that move
 * it into a Parent Group or out of one.
 */
export default async function CompanyOverviewPage({ params }: Props) {
  const { companyId } = await params;
  const context = await requirePlatformContext();
  const overview = await getPlatformCompanyOverview(context, companyId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { company, structure, counts, setup, detach } = overview;
  const open = setup.filter((item) => !item.done).length;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-meta text-fg-subtle">
        <Link href="/platform-admin/organizations/companies" className="hover:text-fg hover:underline">
          Companies
        </Link>{" "}
        / {company.name}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">{company.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            <StatusBadge status={company.status} />
            {structure.group ? (
              <Link href={`/platform-admin/groups/${structure.group.id}`} className="text-accent-strong hover:underline" data-testid="company-structure">
                Group: {structure.group.name}
              </Link>
            ) : (
              <Badge data-testid="company-structure">Standalone</Badge>
            )}
            <span className="font-mono text-meta">{company.slug}</span>
            <span>
              Created {formatDate(company.createdAt)}
              {overview.createdBy ? ` by ${overview.createdBy}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlatformCommandButton
            label="Edit details"
            title={`Edit ${company.name}`}
            action="company.update"
            fixed={{ companyId: company.id }}
            fields={[
              { name: "name", label: "Company name", type: "text", required: true },
              { name: "legalName", label: "Legal name", type: "text" },
              { name: "registrationNumber", label: "Registration number / NUIS", type: "text" },
              { name: "taxNumber", label: "VAT / Tax ID", type: "text" },
              { name: "industry", label: "Industry", type: "text" },
              { name: "country", label: "Country", type: "text" },
              { name: "address", label: "Address", type: "text", wide: true },
              { name: "email", label: "Email", type: "email" },
              { name: "phone", label: "Phone", type: "text" },
              { name: "website", label: "Website", type: "text" },
              { name: "logoUrl", label: "Logo", type: "textarea", hint: "A path on this deployment (/branding/logo.svg) or an inline image (data:image/png;base64,…). Leave empty for initials." },
              { name: "reason", label: "Reason", type: "textarea", required: true },
            ]}
            initial={{ ...company, logoUrl: company.logoUrl ?? "" }}
            success="Company updated."
          />
          {structure.group ? (
            detach?.allowed ? (
              <PlatformCommandButton
                label="Remove from group"
                title={`Remove ${company.name} from ${structure.group.name}`}
                description={[
                  `${company.name} becomes a standalone company. Its data, projects, modules and history stay as they are.`,
                  detach.movingPeople ? `${detach.movingPeople} ${detach.movingPeople === 1 ? "person moves" : "people move"} with it.` : "",
                  detach.groupLevelPeople.length ? `Group-level access ends here for: ${detach.groupLevelPeople.join(", ")}.` : "",
                ].filter(Boolean).join(" ")}
                action="company.detach"
                fixed={{ companyId: company.id }}
                reasonOnly
                destructive
                submitLabel="Remove from group"
                success="Company is now standalone."
              />
            ) : null
          ) : (
            <PlatformCommandButton
              label="Assign to group"
              title={`Assign ${company.name} to a Parent Group`}
              description="The company keeps its ID, users, projects, documents, units, contracts, permissions, modules and history. Its people and departments join the group; group-wide access from its own workspace ends."
              action="company.attach"
              fixed={{ companyId: company.id }}
              fields={[
                { name: "groupId", label: "Parent group", type: "select", required: true, options: overview.groupOptions },
                { name: "reason", label: "Reason", type: "textarea", required: true },
              ]}
              submitLabel="Assign to group"
              success="Company assigned to the group."
            />
          )}
        </div>
      </div>

      {structure.group && detach && !detach.allowed ? (
        <p className="nesto-card p-4 text-table text-fg-muted" data-testid="detach-blocked">
          It cannot be removed from the group while these people also work in another of its companies: {detach.sharedPeople.join(", ")}.
        </p>
      ) : null}

      <section className="nesto-card p-5" aria-labelledby="company-setup">
        <h2 id="company-setup" className="text-card font-semibold text-fg">
          Complete setup
        </h2>
        <p className="mt-1 text-table text-fg-muted">
          {open === 0 ? "Everything is set up." : "Optional. None of this blocks the company from working, and it can be completed at any time."}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="company-setup">
          {setup.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-table" data-done={item.done}>
              {item.done ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
              <span className={item.done ? "text-fg" : "text-fg-muted"}>
                {item.href && !item.done ? (
                  <Link href={item.href} className="hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
                <span className="sr-only">{item.done ? " — done" : " — not done"}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="nesto-card p-5" aria-labelledby="company-counts">
        <h2 id="company-counts" className="text-card font-semibold text-fg">
          At a glance
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([["Users", counts.users], ["Employees", counts.people], ["Projects", counts.projects], ["Departments", counts.departments], ["Modules on", counts.modules]] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="text-meta text-fg-subtle">{label}</dt>
              <dd className="text-card font-semibold tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="nesto-card p-5" aria-labelledby="company-history">
        <h2 id="company-history" className="text-card font-semibold text-fg">
          Recent history
        </h2>
        {overview.history.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {overview.history.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-table">
                <span className="font-mono text-meta text-fg">{event.actionKey}</span>
                <span className="text-fg-muted">
                  {event.actor ?? "System"} · {formatDate(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
