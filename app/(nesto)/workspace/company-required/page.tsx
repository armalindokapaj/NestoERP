import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChooseCompany } from "@/components/workspace/choose-company";
import { PageHeader } from "@/components/ui/page-header";
import { isModuleKey, modules } from "@/config/modules";
import { requireUserContext } from "@/lib/context/current-user";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { getTranslations } from "@/lib/i18n/server";
import { isModuleEnabled, canAccessModule } from "@/lib/access/can";

export const metadata: Metadata = { title: "Choose a company" };

type Props = { searchParams: Promise<{ module?: string | string[]; next?: string | string[] }> };

/**
 * Where a company-only module lands somebody in the Group workspace (Workspace
 * Context §25, §29).
 *
 * The Group workspace never opens one company's records under a group header,
 * so a module that works inside one company asks which. Only companies that
 * offer the module to this person are listed; choosing one enters it.
 * A person already in a company workspace has nothing to choose and goes on.
 */
export default async function CompanyRequiredPage({ searchParams }: Props) {
  const [{ module: raw, next }, context, t] = await Promise.all([searchParams, requireUserContext(), getTranslations("workspace")]);
  const key = typeof raw === "string" && isModuleKey(raw) ? raw : null;
  const definition = key ? modules[key] : null;
  // Where they were going, only if it is inside the module they were refused in —
  // never an arbitrary address, so this page cannot redirect anywhere else.
  const destination =
    definition && typeof next === "string" && next.startsWith(`${definition.route}`) && !next.startsWith("//") && /^\/[A-Za-z0-9/_\-\[\]]*$/.test(next)
      ? next
      : (definition?.route ?? "/dashboard");

  if (context.workspace.scopeType === "COMPANY") redirect(destination);

  const companies = (await resolveGroupContexts(context))
    .filter((company) => (key ? isModuleEnabled(company, key) && canAccessModule(company, key) : true))
    .map((company) => ({ id: company.companyId, name: company.company.name, roleLabel: company.roleLabel }));
  const moduleLabel = definition?.label ?? t("company");

  return (
    <div className="space-y-6">
      <PageHeader title={t("companyRequiredTitle")} description={companies.length > 0 ? t("companyRequiredDescription", { module: moduleLabel }) : t("companyRequiredNone", { module: moduleLabel })} />
      {companies.length > 0 ? <ChooseCompany companies={companies} destination={destination} /> : null}
    </div>
  );
}
