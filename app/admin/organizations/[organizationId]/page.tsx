import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformCompanyOverview } from "@/lib/modules/platform/platform-company.service";
import { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { cn } from "@/lib/utils/cn";
import { CompanyHeaderActions, CompanyOverview, CompanySettings } from "../_detail/company-detail";
import { GroupHeaderActions, GroupOverview } from "../_detail/group-detail";
import { GroupSettings } from "../_detail/group-settings";
import { GroupCompaniesTab, ModulesTab, ProjectsTab, UsageTab, UsersTab } from "../_detail/tabs";

export const metadata: Metadata = { title: "Organization" };

type Props = { params: Promise<{ organizationId: string }>; searchParams: Promise<{ tab?: string }> };

const GROUP_TABS = ["overview", "companies", "projects", "users", "modules", "usage", "settings"] as const;
const COMPANY_TABS = ["overview", "projects", "users", "modules", "usage", "settings"] as const;
const LABEL: Record<string, string> = { overview: "Overview", companies: "Companies", projects: "Projects", users: "Users", modules: "Modules", usage: "Usage", settings: "Settings" };

const orNull = <T,>(promise: Promise<T>) => promise.catch((error: unknown) => {
  if (error instanceof AccessError && error.code === "NOT_FOUND") return null;
  throw error;
});

function Tabs({ id, tabs, current }: { id: string; tabs: readonly string[]; current: string }) {
  return (
    <nav aria-label="Organization sections" className="overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <li key={tab}>
            <Link href={tab === "overview" ? `/admin/organizations/${id}` : `/admin/organizations/${id}?tab=${tab}`} scroll={false} aria-current={tab === current ? "page" : undefined} data-testid={`org-detail-tab-${tab}`} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table transition-colors", tab === current ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}>
              {LABEL[tab]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One organization page for either kind (Organizations PRD §19-§23, §63, §64):
 * a Parent Group, a group company or a standalone company, told apart by the
 * record itself. Tabs live in `?tab=`, so refresh and Back keep them.
 */
export default async function OrganizationPage({ params, searchParams }: Props) {
  const [{ organizationId }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const context = await requirePlatformContext();
  const group = await orNull(getGroupImplementation(context, organizationId));
  const company = group ? null : await orNull(getPlatformCompanyOverview(context, organizationId));
  if (!group && !company) notFound();

  const tabs = group ? GROUP_TABS : COMPANY_TABS;
  const tab = (tabs as readonly string[]).includes(rawTab ?? "") ? rawTab! : "overview";
  const name = group ? group.group.name : company!.company.name;
  const scope = group ? { kind: "group" as const, groupId: group.group.id } : { kind: "company" as const, companyId: company!.company.id };
  const crumbs = [{ label: "Organizations", href: "/admin/organizations" }, tab === "overview" ? { label: name } : { label: name, href: `/admin/organizations/${organizationId}` }, ...(tab === "overview" ? [] : [{ label: LABEL[tab] }])];

  return (
    <div className="space-y-5">
      <Breadcrumbs items={crumbs} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-page font-semibold text-fg">{name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted" data-testid="organization-kind">
            {group ? (
              <><span>Parent Group</span><AdminStatusBadge status={group.group.status} /></>
            ) : company!.structure.group ? (
              <><span>Company</span><span aria-hidden="true">·</span><Link href={`/admin/organizations/${company!.structure.group.id}`} className="text-accent-strong hover:underline" data-testid="company-structure">{company!.structure.group.name}</Link><AdminStatusBadge status={company!.company.status} /></>
            ) : (
              <><span data-testid="company-structure">Standalone Company</span><AdminStatusBadge status={company!.company.status} /></>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {group ? <GroupHeaderActions implementation={group} /> : <CompanyHeaderActions overview={company!} />}
        </div>
      </header>
      <Tabs id={organizationId} tabs={tabs} current={tab} />
      {tab === "overview" ? (group ? <GroupOverview implementation={group} /> : <CompanyOverview overview={company!} />) : null}
      {tab === "companies" && group ? <GroupCompaniesTab context={context} group={{ id: group.group.id, name: group.group.name, open: group.group.status !== "SUSPENDED" && group.group.status !== "ARCHIVED" }} /> : null}
      {tab === "projects" ? <ProjectsTab context={context} scope={scope} /> : null}
      {tab === "users" ? <UsersTab context={context} scope={scope} /> : null}
      {tab === "modules" ? <ModulesTab context={context} scope={scope} /> : null}
      {tab === "usage" ? <UsageTab context={context} scope={scope} /> : null}
      {tab === "settings" ? (group ? <GroupSettings implementation={group} /> : <CompanySettings overview={company!} />) : null}
    </div>
  );
}
