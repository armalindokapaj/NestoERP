import type { Metadata } from "next";
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
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Entitlements" };

type Props = { params: Promise<{ companyId: string }>; searchParams: Promise<{ tab?: string }> };
const TABS = [["modules", "Modules"], ["projects", "Projects"], ["limits", "Limits"], ["history", "History"]] as const;

const gb = (bytes: number | null) => (bytes === null ? "Unlimited" : `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`);
const used = (bytes: number) => (bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`);

function Limit({ label, used: value, limit }: { label: string; used: string | number; limit: number | string | null }) {
  const near = typeof value === "number" && typeof limit === "number" && value >= limit - 1;
  return (
    <div className="nesto-card p-4">
      <p className="text-meta text-fg-subtle">{label}</p>
      <p className={cn("mt-1 text-card font-semibold tabular-nums", near ? "text-warning-strong" : "text-fg")}>{value} / {limit ?? "Unlimited"}</p>
      {near ? <p className="text-meta text-warning-strong">{typeof limit === "number" && typeof value === "number" && value >= limit ? "Limit reached — new ones are refused." : "Close to the limit."}</p> : null}
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
      <Breadcrumbs items={[{ label: "Modules", href: "/admin/modules" }, { label: data.company.name }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold text-fg">{data.company.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            <span>{data.company.group?.name ?? "Standalone Company"}</span>
            <AdminStatusBadge status={data.company.status} />
            <span>Plan: {data.plan.name}</span>
            <span className="text-fg-subtle">· {enabled} modules enabled</span>
          </div>
          {data.company.status !== "ACTIVE" ? <p className="mt-1 text-meta text-fg-subtle">The company is {data.company.status.toLowerCase()}: its entitlements are kept and apply again when it is reactivated.</p> : null}
        </div>
        <Link href={`/admin/organizations/${data.company.id}`} className="text-table font-medium text-accent-strong hover:underline">Open organization</Link>
      </header>
      <nav aria-label="Entitlement sections" className="nesto-context-tabs" data-context-tabs>
        <ul className="border-b border-line flex gap-1">
          {TABS.map(([key, label]) => (
            <li key={key}><Link href={key === "modules" ? `/admin/modules/${companyId}` : `/admin/modules/${companyId}?tab=${key}`} scroll={false} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table", tab === key ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{label}</Link></li>
          ))}
        </ul>
      </nav>

      {tab === "modules" ? (
        <>
          <p className="text-table text-fg-muted">The platform grants a module; the company&apos;s administrators decide how it is used; each user still needs the permission.</p>
          <EntitlementEditor companyId={companyId} version={data.version} plan={data.plan} plans={plans} modules={data.modules} canManage={canManage} />
        </>
      ) : null}

      {tab === "projects" ? (
        <section className="nesto-card overflow-hidden" aria-label="Project entitlements">
          {data.projects.length === 0 ? (
            <EmptyState className="m-4" title="No Projects yet." description="Project-scoped modules, such as the 3D Viewer, are granted project by project." />
          ) : (
            <div className="overflow-x-auto">
              <Table stack flush aria-label="Project entitlements">
                <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>3D Viewer</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Status</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
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
            <Limit label="Active users" used={data.limits.users} limit={data.limits.maxActiveUsers} />
            <Limit label="Projects" used={data.limits.projects} limit={data.limits.maxProjects} />
            <Limit label="Storage" used={used(data.limits.storageBytes)} limit={gb(data.limits.maxStorageBytes)} />
          </div>
          {canManage ? (
            <PlatformCommandButton
              label="Change limits"
              title={`Limits for ${data.company.name}`}
              description="Leave a field empty for Unlimited. New users and projects past a limit are refused; nothing existing is removed."
              action="entitlements.limits"
              fixed={{ companyId }}
              fields={[
                { name: "maxActiveUsers", label: "Active users", type: "number" },
                { name: "maxProjects", label: "Projects", type: "number" },
                { name: "maxStorageGb", label: "Storage (GB)", type: "number" },
                { name: "reason", label: "Reason / note", type: "textarea" },
              ]}
              initial={{ maxActiveUsers: data.limits.maxActiveUsers ?? "", maxProjects: data.limits.maxProjects ?? "", maxStorageGb: data.limits.maxStorageBytes === null ? "" : Math.round(data.limits.maxStorageBytes / 1024 ** 3) }}
              success="Limits updated."
            />
          ) : null}
        </div>
      ) : null}

      {tab === "history" ? (
        <section className="nesto-card overflow-hidden" aria-label="Entitlement history">
          {data.history.length === 0 ? (
            <p className="p-5 text-table text-fg-muted">No entitlement changes recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.history.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <p className="text-body font-medium text-fg">{row.actionKey === "PLATFORM_ENTITLEMENT_LIMITS_CHANGED" ? "Limits changed" : row.actionKey === "PLATFORM_ENTITLEMENTS_CHANGED" ? "Entitlements changed" : row.actionKey.replace(/^PLATFORM_|^PROJECT_/, "").toLowerCase().replaceAll("_", " ")}</p>
                  {row.after && typeof row.after === "object" && "changed" in row.after ? <p className="text-table text-fg-muted">{String(row.after.changed)}{"plan" in row.after ? ` · Plan: ${String(row.after.plan)}` : ""}</p> : null}
                  {row.reason ? <p className="text-table text-fg-muted">“{row.reason}”</p> : null}
                  <p className="text-meta text-fg-subtle">{row.actor ?? "System"} · {formatDateTime(row.occurredAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
