import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModuleShell, resolveTab } from "@/components/modules/module-shell";
import { Badge } from "@/components/ui/badge";
import { modules } from "@/config/modules";
import { requirePermission } from "@/lib/auth/session";
import { getCompany, getCompanyModules, getTeamMembers } from "@/lib/database/queries";
import { formatDate } from "@/lib/utils/format";

const MODULE_KEY = "company" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

/** Company identity (spec §45) — real records from the database. */
export default async function CompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission(modules[MODULE_KEY].viewPermission);
  const { tab } = await searchParams;
  const activeTab = resolveTab(MODULE_KEY, tab);

  const [company, members, companyModules] = await Promise.all([
    getCompany(user.companyId),
    getTeamMembers(user.companyId),
    getCompanyModules(user.companyId),
  ]);

  if (!company) notFound();

  const details = [
    { label: "Company name", value: company.name },
    { label: "Industry", value: company.industry ?? "—" },
    { label: "Country", value: company.country ?? "—" },
    { label: "Address", value: company.address ?? "—" },
    { label: "Email", value: company.email ?? "—" },
    { label: "Phone", value: company.phone ?? "—" },
    { label: "Website", value: company.website ?? "—" },
    { label: "Created", value: formatDate(company.createdAt) },
  ];

  return (
    <ModuleShell moduleKey={MODULE_KEY} activeTab={activeTab}>
      {activeTab === "overview" ? (
        <div className="space-y-4">
          <div className="nesto-card p-6">
            <div className="flex flex-wrap items-center gap-4">
              <span
                aria-hidden="true"
                className="grid size-14 shrink-0 place-items-center rounded-lg bg-graphite font-serif text-section text-graphite-fg"
              >
                {company.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <h2 className="text-section font-semibold text-fg">{company.name}</h2>
                <p className="mt-0.5 text-body text-fg-muted">
                  {company.industry}
                  <span className="px-1.5 text-fg-subtle">·</span>
                  {company.country}
                </p>
              </div>
              <Badge tone="success" className="ml-auto">
                {company.status === "ACTIVE" ? "Active" : "Suspended"}
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Employees", value: String(members.length) },
              {
                label: "Modules enabled",
                value: `${companyModules.filter((item) => item.enabled).length} of ${companyModules.length}`,
              },
              {
                label: "Departments",
                value: String(new Set(members.map((member) => member.department)).size),
              },
            ].map((stat) => (
              <div key={stat.label} className="nesto-card p-4">
                <p className="text-table text-fg-muted">{stat.label}</p>
                <p className="mt-2 text-page font-semibold tabular-nums text-fg">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "details" ? (
        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Company details</h2>
          <dl className="mt-3 divide-y divide-line">
            {details.map((detail) => (
              <div
                key={detail.label}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <dt className="text-table text-fg-muted">{detail.label}</dt>
                <dd className="text-table font-medium text-fg">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </ModuleShell>
  );
}
