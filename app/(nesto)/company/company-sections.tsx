import { notFound } from "next/navigation";

import { DetailGrid } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import type { UserContext } from "@/lib/context/types";
import { getCompany, getCompanyModules, getTeamMembers } from "@/lib/database/queries";
import { formatDate, orDash } from "@/lib/utils/format";

/**
 * Company identity (PRD #5 §38).
 *
 * Basic company information is widely visible; editing requires
 * `company.manage`, which V0.1 exposes through Settings rather than here.
 */
export async function CompanyOverview({ context }: { context: UserContext }) {
  const [company, members, companyModules] = await Promise.all([
    getCompany(context.companyId),
    getTeamMembers(context.companyId),
    getCompanyModules(context.companyId),
  ]);

  if (!company) notFound();

  const enabled = companyModules.filter((module) => module.enabled).length;
  const active = members.filter((member) => member.status === "ACTIVE").length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Team members", value: String(active) },
          { label: "Enabled modules", value: String(enabled) },
          { label: "Industry", value: orDash(company.industry) },
          { label: "Country", value: orDash(company.country) },
        ].map((card) => (
          <div key={card.label} className="nesto-card p-4">
            <p className="text-table text-fg-muted">{card.label}</p>
            <p className="mt-2 text-section font-semibold text-fg">{card.value}</p>
          </div>
        ))}
      </div>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{company.name}</h2>
        <DetailGrid
          className="mt-4"
          items={[
            { label: "Legal name", value: orDash(company.legalName) },
            { label: "Status", value: <StatusBadge status={company.status} /> },
            { label: "Email", value: orDash(company.email) },
            { label: "Phone", value: orDash(company.phone) },
            { label: "Website", value: orDash(company.website) },
            { label: "Created", value: formatDate(company.createdAt) },
          ]}
        />
      </section>
    </div>
  );
}

export async function CompanyDetails({ context }: { context: UserContext }) {
  const company = await getCompany(context.companyId);
  if (!company) notFound();

  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">Company details</h2>
      <DetailGrid
        className="mt-4"
        items={[
          { label: "Company name", value: company.name },
          { label: "Legal name", value: orDash(company.legalName) },
          { label: "Industry", value: orDash(company.industry) },
          { label: "Country", value: orDash(company.country) },
          { label: "Address", value: orDash(company.address) },
          { label: "Email", value: orDash(company.email) },
          { label: "Phone", value: orDash(company.phone) },
          { label: "Website", value: orDash(company.website) },
        ]}
      />
    </section>
  );
}

/**
 * Company module activation (PRD #7 §59).
 *
 * A module switched off here disappears from navigation and its routes answer
 * "module unavailable" — which is how Company B's reduced set is tested
 * (PRD #9 §110).
 */
export async function CompanyModules({ context }: { context: UserContext }) {
  const companyModules = await getCompanyModules(context.companyId);

  return (
    <ul className="nesto-card divide-y divide-line">
      {companyModules.map((module) => (
        <li key={module.key} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-table font-medium text-fg">{module.name}</p>
            {module.description ? (
              <p className="truncate text-meta text-fg-subtle">{module.description}</p>
            ) : null}
          </div>
          <StatusBadge status={module.enabled ? "ACTIVE" : "INACTIVE"} />
        </li>
      ))}
    </ul>
  );
}
