import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { AdminTabs } from "@/components/platform/admin-list";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PageHeaderFrame } from "@/components/ui/page-header";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformCompanyOverview } from "@/lib/modules/platform/platform-company.service";
import { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { getTranslations } from "@/lib/i18n/server";
import { CompanyHeaderActions, CompanyOverview, CompanySettings } from "../_detail/company-detail";
import { GroupHeaderActions, GroupOverview } from "../_detail/group-detail";
import { statusWord } from "../_detail/labels";
import { GroupSettings } from "../_detail/group-settings";
import { GroupCompaniesTab, ModulesTab, ProjectsTab, RolesTab, UsageTab, UsersTab } from "../_detail/tabs";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.organization") };
}

type Props = { params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const GROUP_TABS = ["overview", "companies", "projects", "users", "roles", "modules", "usage", "settings"] as const;
const COMPANY_TABS = ["overview", "projects", "users", "roles", "modules", "usage", "settings"] as const;

const orNull = <T,>(promise: Promise<T>) => promise.catch((error: unknown) => {
  if (error instanceof AccessError && error.code === "NOT_FOUND") return null;
  throw error;
});

/**
 * One organization page for either kind (Organizations PRD §19-§23, §63, §64):
 * a Parent Group, a group company or a standalone company, told apart by the
 * record itself. Tabs live in `?tab=`, so refresh and Back keep them.
 */
export default async function OrganizationPage({ params, searchParams }: Props) {
  const [{ organizationId }, rawParams] = await Promise.all([params, searchParams]);
  const t = await getTranslations("adminOrgs");
  const query = Object.fromEntries(Object.entries(rawParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const rawTab = query.tab;
  const context = await requirePlatformContext();
  const group = await orNull(getGroupImplementation(context, organizationId));
  const company = group ? null : await orNull(getPlatformCompanyOverview(context, organizationId));
  if (!group && !company) notFound();

  const tabs = group ? GROUP_TABS : COMPANY_TABS;
  const tab = (tabs as readonly string[]).includes(rawTab ?? "") ? rawTab! : "overview";
  const name = group ? group.group.name : company!.company.name;
  const scope = group ? { kind: "group" as const, groupId: group.group.id } : { kind: "company" as const, companyId: company!.company.id };
  const status = group ? group.group.status : company!.company.status;
  const org = { id: organizationId, name, open: status === "ACTIVE" || status === "IMPLEMENTING" || status === "READY_FOR_VALIDATION" };
  // A group company sits under its group, so the way back to the group is one click (§52, §101).
  const parent = company?.structure.group ? [{ label: company.structure.group.name, href: `/admin/organizations/${company.structure.group.id}?tab=companies` }] : [];
  const crumbs = [{ label: t("detail.organizations"), href: "/admin/organizations" }, ...parent, tab === "overview" ? { label: name } : { label: name, href: `/admin/organizations/${organizationId}` }, ...(tab === "overview" ? [] : [{ label: t(`detail.tabs.${tab}` as "detail.tabs.overview") }])];

  const kind = group ? (
    <span data-testid="organization-kind">{t("detail.kind.parentGroup")}</span>
  ) : company!.structure.group ? (
    <span data-testid="organization-kind">
      {t("detail.kind.company")} ·{" "}
      <Link href={`/admin/organizations/${company!.structure.group.id}`} className="text-fg underline decoration-accent decoration-2 underline-offset-4" data-testid="company-structure">{company!.structure.group.name}</Link>
    </span>
  ) : (
    <span data-testid="organization-kind"><span data-testid="company-structure">{t("detail.kind.standaloneCompany")}</span></span>
  );

  return (
    <div className="space-y-5">
      <PageHeaderFrame
        kind="record"
        lead={<Breadcrumbs items={crumbs} />}
        title={name}
        subtitle={kind}
        status={<AdminStatusBadge status={status} />}
        actions={group ? <GroupHeaderActions implementation={group} /> : <CompanyHeaderActions overview={company!} />}
      />
      <AdminTabs
        label={t("detail.sectionsNav")}
        tabs={tabs.map((key) => ({ key, label: t(`detail.tabs.${key}` as "detail.tabs.overview"), href: key === "overview" ? `/admin/organizations/${organizationId}` : `/admin/organizations/${organizationId}?tab=${key}`, active: key === tab, testId: `org-detail-tab-${key}` }))}
      />
      {tab === "overview" ? (group ? <GroupOverview implementation={group} /> : <CompanyOverview overview={company!} />) : null}
      {!org.open ? <p className="border border-warning/50 bg-warning-soft px-4 py-3 text-table text-fg" role="status" data-testid="organization-closed">{t("detail.closed", { name, status: statusWord(t, status) })}</p> : null}
      {tab === "companies" && group ? <GroupCompaniesTab context={context} group={org} /> : null}
      {tab === "projects" ? <ProjectsTab context={context} scope={scope} org={org} /> : null}
      {tab === "users" ? <UsersTab context={context} scope={scope} org={org} params={query} /> : null}
      {tab === "roles" ? <RolesTab context={context} scope={scope} org={org} params={query} /> : null}
      {tab === "modules" ? <ModulesTab context={context} scope={scope} org={org} /> : null}
      {tab === "usage" ? <UsageTab context={context} scope={scope} /> : null}
      {tab === "settings" ? (group ? <GroupSettings implementation={group} /> : <CompanySettings overview={company!} />) : null}
    </div>
  );
}
