import Link from "@/components/navigation/nav-link";
import { AlertOctagon, AlertTriangle, ArrowRight, Info } from "lucide-react";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { PlatformContext } from "@/lib/context/platform-context";
import {
  dashboardActivity, dashboardAttention, dashboardOrganizations, dashboardPlatformStatus, dashboardProjects, dashboardSummary, dashboardUsage,
  STORAGE_CRITICAL, STORAGE_WARNING, type Severity,
} from "@/lib/modules/platform/platform-dashboard.query";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/utils/format";
import { assignedCompany } from "@/lib/access/project-ownership";

/*
 * The Dashboard's sections (Dashboard PRD §5, §34). Each is its own async
 * server component, so each streams in when its data lands and fails alone.
 */

export function SectionHeader({ id, title, href, linkLabel }: { id: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <h2 id={id} className="text-card font-semibold text-fg">{title}</h2>
      {href ? <Link href={href} className="inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">{linkLabel}<ArrowRight aria-hidden="true" className="size-3.5" /></Link> : null}
    </div>
  );
}

function Time({ at }: { at: string }) {
  return <time dateTime={at} title={formatDateTime(at)}>{formatRelativeTime(at)}</time>;
}

const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : value < 1024 ** 4 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 4).toFixed(2)} TB`;

// ── Summary ─────────────────────────────────────────────────────────────────

function Metric({ label, value, detail, href, tone }: { label: string; value: React.ReactNode; detail: React.ReactNode; href: string; tone?: "attention" }) {
  return (
    <Link href={href} className={cn("group block rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong hover:bg-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40", tone === "attention" && "border-warning/50")}>
      <p className="text-table font-medium text-fg-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      <p className="mt-1 text-meta text-fg-subtle">{detail}</p>
    </Link>
  );
}

type Summary = Awaited<ReturnType<typeof dashboardSummary>>;

export async function SummarySection({ context, summary: pending }: { context: PlatformContext; summary: Promise<Summary> }) {
  const [summary, status] = await Promise.all([pending, dashboardPlatformStatus(context)]);
  const { organizations, projects, users } = summary;
  const statusText = status.state === "ATTENTION" ? "Attention required" : status.state === "OPERATIONAL" ? "Operational" : "Monitoring not available";
  const statusDetail = status.state === "ATTENTION"
    ? status.failing.map((row) => row.service).join(", ")
    : status.state === "OPERATIONAL"
      ? status.unverified.length ? `All verified checks pass · ${status.unverified.join(", ")} not reporting` : "All verified checks pass"
      : "Health checks need operations access";
  return (
    <section aria-label="Platform summary" className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="dashboard-summary">
      <Metric label="Organizations" value={organizations.total} detail={`${organizations.groups} Groups · ${organizations.companies} Companies`} href="/admin/organizations" />
      <Metric label="Projects" value={projects.total} detail={`${projects.active} Active · ${projects.pending} Pending · ${projects.finished} Finished`} href="/admin/projects" />
      <Metric label="Users" value={users.total} detail={`${users.active} Active · ${users.inactive + users.suspended} Inactive`} href="/admin/users" />
      <Metric label="Platform" value={<span className="text-xl">{statusText}</span>} detail={statusDetail} href="/admin/system/health" tone={status.state === "ATTENTION" ? "attention" : undefined} />
    </section>
  );
}

export function SummarySkeleton() {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[106px] rounded-xl" />)}</div>;
}

/** New installation: one restrained way in (§45). */
export async function FirstRun({ summary }: { summary: Promise<Summary> }) {
  const { organizations } = await summary.catch(() => ({ organizations: { companies: 1 } }));
  if (organizations.companies > 0) return null;
  return (
    <section className="nesto-card flex flex-wrap items-center justify-between gap-4 p-5" data-testid="dashboard-first-run">
      <div>
        <h2 className="text-card font-semibold text-fg">No companies have been created yet.</h2>
        <p className="mt-1 text-table text-fg-muted">Create the first company to begin configuring NESTO.</p>
      </div>
      <Link href="/admin/organizations?create=company" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-table font-medium text-accent-fg hover:bg-accent-strong">Create company</Link>
    </section>
  );
}

// ── Attention required ──────────────────────────────────────────────────────

const SEVERITY: Record<Severity, { label: string; icon: typeof Info; className: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, className: "text-danger-strong" },
  warning: { label: "Warning", icon: AlertTriangle, className: "text-warning-strong" },
  info: { label: "Information", icon: Info, className: "text-info-strong" },
};

export async function AttentionSection({ context }: { context: PlatformContext }) {
  const { items, total } = await dashboardAttention(context);
  const critical = items.some((item) => item.severity === "critical");
  return (
    <section aria-labelledby="dash-attention" className={cn("nesto-card overflow-hidden", critical && "border-danger/40")} data-testid="dashboard-attention">
      <SectionHeader id="dash-attention" title="Attention required" />
      {items.length === 0 ? (
        <p className="px-5 py-4 text-table text-fg-muted">No issues requiring attention.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const severity = SEVERITY[item.severity];
            return (
              <li key={item.id} className="flex gap-3 px-5 py-3.5" data-severity={item.severity}>
                <severity.icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", severity.className)} />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-fg"><span className="sr-only">{severity.label}: </span>{item.title}</p>
                  {item.entity ? <p className="text-table text-fg">{item.entity}</p> : null}
                  <p className="text-table text-fg-muted">{item.description}</p>
                  <div className="mt-1 flex items-center justify-between gap-3 text-meta text-fg-subtle">
                    <span>{item.at ? <Time at={item.at} /> : severity.label}</span>
                    <Link href={item.href} className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">{item.actionLabel}<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {total > items.length ? <p className="border-t border-line px-5 py-2.5 text-meta text-fg-subtle">{total - items.length} more not shown.</p> : null}
    </section>
  );
}

// ── Recent activity ─────────────────────────────────────────────────────────

export async function ActivitySection({ context }: { context: PlatformContext }) {
  const rows = await dashboardActivity(context);
  return (
    <section aria-labelledby="dash-activity" className="nesto-card overflow-hidden" data-testid="dashboard-activity">
      <SectionHeader id="dash-activity" title="Recent activity" href="/admin/audit" linkLabel="View Audit Log" />
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-table text-fg-muted">No administrative activity yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={row.href} className="block px-5 py-3 hover:bg-hover/50">
                <p className="text-body font-medium text-fg">{row.label}</p>
                {row.entity ? <p className="truncate text-table text-fg-muted">{row.entity}</p> : null}
                <p className="text-meta text-fg-subtle">{row.actor ? `by ${row.actor} · ` : ""}<Time at={row.at} /></p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Organizations and projects ──────────────────────────────────────────────

export async function OrganizationsSection({ context }: { context: PlatformContext }) {
  const rows = await dashboardOrganizations(context);
  return (
    <section aria-labelledby="dash-orgs" className="nesto-card overflow-hidden" data-testid="dashboard-organizations">
      <SectionHeader id="dash-orgs" title="Organizations" href="/admin/organizations" linkLabel="View all" />
      {rows.length === 0 ? (
        <div className="px-5 py-4 text-table text-fg-muted">
          <p>No organizations yet. Create a Company or Parent Group.</p>
          <Link href="/admin/organizations?create=company" className="mt-2 inline-block font-medium text-accent-strong hover:underline">Create</Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table flush aria-label="Recent organizations">
            <TableHead><TableRow><TableHeaderCell>Organization</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Type</TableHeaderCell><TableHeaderCell className="max-md:hidden">Companies</TableHeaderCell><TableHeaderCell>Projects</TableHeaderCell><TableHeaderCell className="max-md:hidden">Users</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                  <TableCell className="max-sm:hidden">{row.type}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.companies ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{row.projects}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.users}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export async function ProjectsSection({ context, summary }: { context: PlatformContext; summary: Promise<Summary> }) {
  const [rows, canCreate] = await Promise.all([dashboardProjects(context), summary.then((value) => value.organizations.companies > 0, () => false)]);
  return (
    <section aria-labelledby="dash-projects" className="nesto-card overflow-hidden" data-testid="dashboard-projects">
      <SectionHeader id="dash-projects" title="Projects" href="/admin/projects" linkLabel="View all" />
      {rows.length === 0 ? (
        <div className="px-5 py-4 text-table text-fg-muted">
          <p>No projects yet. Projects can be created after a Company exists.</p>
          {canCreate ? <Link href="/admin/projects?create=project" className="mt-2 inline-block font-medium text-accent-strong hover:underline">Create project</Link> : <p className="mt-1 text-meta text-fg-subtle">Create a company first.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table flush aria-label="Recent projects">
            <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Company</TableHeaderCell><TableHeaderCell>3D</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                  <TableCell className="max-sm:hidden"><Link href={`/admin/organizations/${assignedCompany(row).id}`} className="text-fg-muted hover:underline">{assignedCompany(row).name}</Link></TableCell>
                  <TableCell>{row.has3D ? <Link href={`/admin/3d/projects/${row.id}`} aria-label={`3D: ${row.threeD}. Open 3D administration for ${row.name}`} className="hover:opacity-80"><AdminStatusBadge status={row.threeD} /></Link> : <AdminStatusBadge status={row.threeD} />}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export function ListSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div className="nesto-card overflow-hidden" role="status" aria-busy="true" aria-label={`Loading ${label}`}>
      <div className="border-b border-line px-5 py-3.5"><Skeleton className="h-5 w-40" /></div>
      <div className="divide-y divide-line">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex gap-4 px-5 py-3.5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-1/5" /><Skeleton className="ml-auto h-5 w-16" /></div>)}</div>
    </div>
  );
}

// ── Usage ───────────────────────────────────────────────────────────────────

export async function UsageSection({ context }: { context: PlatformContext }) {
  const usage = await dashboardUsage(context);
  const { storage, modules, threeD } = usage;
  const share = storage.quotaBytes ? storage.usedBytes / storage.quotaBytes : null;
  const shareTone = share === null ? "" : share >= STORAGE_CRITICAL ? "text-danger-strong" : share >= STORAGE_WARNING ? "text-warning-strong" : "text-fg-subtle";
  return (
    <section aria-labelledby="dash-usage" className="nesto-card overflow-hidden" data-testid="dashboard-usage">
      <SectionHeader id="dash-usage" title="Platform usage" />
      <div className="grid divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
        <div className="px-5 py-4">
          <p className="text-table font-medium text-fg-muted">Storage</p>
          <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{storage.quotaBytes ? `${bytes(storage.usedBytes)} / ${bytes(storage.quotaBytes)}` : `${bytes(storage.usedBytes)} used`}</p>
          {share !== null ? <p className={cn("text-meta", shareTone)}>{Math.round(share * 100)}% of quota</p> : <p className="text-meta text-fg-subtle">No platform-wide quota set</p>}
          <Link href="/admin/system/storage" className="mt-2 inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Storage<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        </div>
        <div className="px-5 py-4">
          <p className="text-table font-medium text-fg-muted">Module provisioning</p>
          <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{modules.assignments}</p>
          <p className="text-meta text-fg-subtle">active company-module assignments · {modules.available} modules available</p>
          <Link href="/admin/modules" className="mt-2 inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Manage modules<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        </div>
        <div className="px-5 py-4">
          <p className="text-table font-medium text-fg-muted">3D / Rozaris</p>
          <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{threeD.configured}</p>
          <p className="text-meta text-fg-subtle">{threeD.configured === 0 ? "No projects configured" : `projects configured · ${threeD.public} Public · ${threeD.companyOnly} Company users · ${threeD.private} Private · ${threeD.offline} Offline`}</p>
          <Link href="/admin/3d" className="mt-2 inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Manage 3D<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        </div>
      </div>
    </section>
  );
}
