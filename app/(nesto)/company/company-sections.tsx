import { notFound } from "next/navigation";

import { DetailGrid } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { isModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";
import { getCompany, getCompanyModules, getTeamMembers } from "@/lib/database/queries";
import { getTranslations } from "@/lib/i18n/server";
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
  const m = await getTranslations("misc");

  if (!company) notFound();

  const enabled = companyModules.filter((module) => module.enabled).length;
  const active = members.filter((member) => member.status === "ACTIVE").length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: m("company.teamMembers"), value: String(active) },
          { label: m("company.enabledModules"), value: String(enabled) },
          { label: m("company.industry"), value: orDash(company.industry) },
          { label: m("company.country"), value: orDash(company.country) },
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
            { label: m("company.legalName"), value: orDash(company.legalName) },
            { label: m("company.status"), value: <StatusBadge status={company.status} /> },
            { label: m("company.email"), value: orDash(company.email) },
            { label: m("company.phone"), value: orDash(company.phone) },
            { label: m("company.website"), value: orDash(company.website) },
            { label: m("company.created"), value: formatDate(company.createdAt) },
          ]}
        />
      </section>
    </div>
  );
}

export async function CompanyDetails({ context }: { context: UserContext }) {
  const company = await getCompany(context.companyId);
  if (!company) notFound();
  const m = await getTranslations("misc");

  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{m("company.details")}</h2>
      <DetailGrid
        className="mt-4"
        items={[
          { label: m("company.companyName"), value: company.name },
          { label: m("company.legalName"), value: orDash(company.legalName) },
          { label: m("company.industry"), value: orDash(company.industry) },
          { label: m("company.country"), value: orDash(company.country) },
          { label: m("company.address"), value: orDash(company.address) },
          { label: m("company.email"), value: orDash(company.email) },
          { label: m("company.phone"), value: orDash(company.phone) },
          { label: m("company.website"), value: orDash(company.website) },
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
  const [companyModules, names] = await Promise.all([getCompanyModules(context.companyId), getTranslations("modules")]);

  return (
    <ul className="nesto-card divide-y divide-line">
      {companyModules.map((module) => {
        // The stored row is the English of config/modules.ts; a module the frame knows is named as the sidebar names it.
        const known = isModuleKey(module.key) ? module.key : null;
        const description = known ? names(`${known}.description`) : module.description;
        return (
          <li key={module.key} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-table font-medium text-fg">{known ? names(`${known}.label`) : module.name}</p>
              {description ? <p className="truncate text-meta text-fg-subtle">{description}</p> : null}
            </div>
            <StatusBadge status={module.enabled ? "ACTIVE" : "INACTIVE"} />
          </li>
        );
      })}
    </ul>
  );
}
