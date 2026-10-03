import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EntitlementEditor } from "@/components/platform/entitlement-editor";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getCompanyEntitlements, listEntitlementPlans } from "@/lib/modules/entitlements/entitlement.service";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { statusWord } from "../../organizations/_detail/labels";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.entitlements") };
}

type Props = { params: Promise<{ companyId: string }>; searchParams: Promise<{ tab?: string }> };
const TABS = [["modules", "entitlements.tabs.modules"], ["projects", "entitlements.tabs.projects"], ["limits", "entitlements.tabs.limits"], ["history", "entitlements.tabs.history"]] as const;

const gb = (t: Translate<"adminOrgs">, bytes: number | null) => (bytes === null ? t("common.unlimited") : `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`);
const used = (bytes: number) => (bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`);

function Limit({ label, used: value, limit, t }: { label: string; used: string | number; limit: number | string | null; t: Translate<"adminOrgs"> }) {
  const near = typeof value === "number" && typeof limit === "number" && value >= limit - 1;
  return (
    <div className="nesto-card p-4">
      <p className="text-meta text-fg-subtle">{label}</p>
      <p className={cn("mt-1 text-card font-semibold tabular-nums", near ? "text-warning-strong" : "text-fg")}>{value} / {limit ?? t("common.unlimited")}</p>
      {near ? <p className="text-meta text-warning-strong">{typeof limit === "number" && typeof value === "number" && value >= limit ? t("entitlements.limitReached") : t("entitlements.nearLimit")}</p> : null}
    </div>
  );
}

/**
 * One company's entitlement workspace (Admin Modules PRD #4 §12-§16, §40, §41,
 * §47-§53): what it may use, per project where that applies, its limits, and
 * the history of those decisions. Not the organization page.
 */
export default async function CompanyEntitlementsPage({ params, searchParams }: Props) {
  const [{ companyId }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  const data = await getCompanyEntitlements(context, companyId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const tab = TABS.some(([key]) => key === rawTab) ? rawTab! : "modules";
  const canManage = canPlatform(context, "platform.module.manage");
  const plans = (await listEntitlementPlans(context)).filter((plan) => plan.status === "ACTIVE" || plan.id === data.plan.id).map((plan) => ({ value: plan.id, label: plan.name }));
  const enabled = data.modules.filter((row) => row.entitled && row.source !== "core").length;

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: t("meta.modules"), href: "/admin/modules" }, { label: data.company.name }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold text-fg">{data.company.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            <span>{data.company.group?.name ?? t("common.standaloneCompany")}</span>
            <AdminStatusBadge status={data.company.status} />
            <span>{t("entitlements.planLabel", { plan: data.plan.name })}</span>
            <span className="text-fg-subtle">· {t("entitlements.enabledCount", { count: enabled })}</span>
          </div>
          {data.company.status !== "ACTIVE" ? <p className="mt-1 text-meta text-fg-subtle">{t("tabs.modules.inactiveNote", { status: statusWord(t, data.company.status) })}</p> : null}
        </div>
        <Link href={`/admin/organizations/${data.company.id}`} className="text-table font-medium text-accent-strong hover:underline">{t("entitlements.openOrganization")}</Link>
      </header>
      <nav aria-label={t("entitlements.sectionsNav")} className="nesto-context-tabs" data-context-tabs>
        <ul className="border-b border-line flex gap-1">
          {TABS.map(([key, labelKey]) => (
            <li key={key}><Link href={key === "modules" ? `/admin/modules/${companyId}` : `/admin/modules/${companyId}?tab=${key}`} scroll={false} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table", tab === key ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{t(labelKey)}</Link></li>
          ))}
        </ul>
      </nav>

      {tab === "modules" ? (
        <>
          <p className="text-table text-fg-muted">{t("entitlements.intro")}</p>
          <EntitlementEditor companyId={companyId} version={data.version} plan={data.plan} plans={plans} modules={data.modules} canManage={canManage} />
        </>
      ) : null}

      {tab === "projects" ? (
        <section className="nesto-card overflow-hidden" aria-label={t("entitlements.projectsLabel")}>
          {data.projects.length === 0 ? (
            <EmptyState className="m-4" title={t("tabs.modules.noProjects")} description={t("entitlements.projectsEmptyBody")} />
          ) : (
            <div className="overflow-x-auto">
              <Table stack flush aria-label={t("entitlements.projectsLabel")}>
                <TableHead><TableRow><TableHeaderCell>{t("common.project")}</TableHeaderCell><TableHeaderCell>{t("entitlements.viewer3d")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("common.status")}</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
                <TableBody>
                  {data.projects.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                      <TableCell><AdminStatusBadge status={row.viewer3d?.status === "ACTIVE" && row.viewer3d.viewerEnabled ? "Enabled" : "Disabled"} /></TableCell>
                      <TableCell className="max-sm:hidden"><AdminStatusBadge status={row.status} /></TableCell>
                      <TableCell>{canPlatform(context, "platform.3d.configure") ? <EntitlementControl projectId={row.id} entitlement={row.viewer3d} compact /> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "limits" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Limit t={t} label={t("entitlements.activeUsers")} used={data.limits.users} limit={data.limits.maxActiveUsers} />
            <Limit t={t} label={t("common.projects")} used={data.limits.projects} limit={data.limits.maxProjects} />
            <Limit t={t} label={t("entitlements.storage")} used={used(data.limits.storageBytes)} limit={gb(t, data.limits.maxStorageBytes)} />
          </div>
          {canManage ? (
            <PlatformCommandButton
              label={t("entitlements.changeLimits")}
              title={t("entitlements.limitsTitle", { name: data.company.name })}
              description={t("entitlements.limitsDescription")}
              action="entitlements.limits"
              fixed={{ companyId }}
              fields={[
                { name: "maxActiveUsers", label: t("entitlements.activeUsers"), type: "number" },
                { name: "maxProjects", label: t("common.projects"), type: "number" },
                { name: "maxStorageGb", label: t("entitlements.storageGb"), type: "number" },
                { name: "reason", label: t("entitlements.reasonNote"), type: "textarea" },
              ]}
              initial={{ maxActiveUsers: data.limits.maxActiveUsers ?? "", maxProjects: data.limits.maxProjects ?? "", maxStorageGb: data.limits.maxStorageBytes === null ? "" : Math.round(data.limits.maxStorageBytes / 1024 ** 3) }}
              success={t("entitlements.limitsUpdated")}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "history" ? (
        <section className="nesto-card overflow-hidden" aria-label={t("entitlements.historyLabel")}>
          {data.history.length === 0 ? (
            <p className="p-5 text-table text-fg-muted">{t("entitlements.historyEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.history.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <p className="text-body font-medium text-fg">{row.actionKey === "PLATFORM_ENTITLEMENT_LIMITS_CHANGED" ? t("entitlements.limitsChanged") : row.actionKey === "PLATFORM_ENTITLEMENTS_CHANGED" ? t("entitlements.entitlementsChanged") : row.actionKey.replace(/^PLATFORM_|^PROJECT_/, "").toLowerCase().replaceAll("_", " ")}</p>
                  {row.after && typeof row.after === "object" && "changed" in row.after ? <p className="text-table text-fg-muted">{String(row.after.changed)}{"plan" in row.after ? ` · ${t("entitlements.planLabel", { plan: String(row.after.plan) })}` : ""}</p> : null}
                  {row.reason ? <p className="text-table text-fg-muted">“{row.reason}”</p> : null}
                  <p className="text-meta text-fg-subtle">{row.actor ?? t("common.system")} · {formatDateTime(row.occurredAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
