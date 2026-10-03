import Link from "@/components/navigation/nav-link";
import { AlertOctagon, AlertTriangle, ArrowRight, Building2, ChevronRight, FolderKanban, Info, Plus, ShieldCheck, Users } from "lucide-react";

import { getLocale, getTranslations } from "@/lib/i18n/server";
import { greetingText } from "@/components/dashboard/config-text";
import { Badge } from "@/components/ui/badge";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { QUICK_CREATE } from "@/components/platform/quick-create-items";
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
    <div className="flex min-w-0 items-start justify-between gap-3">
      <h2 id={id} className="text-card font-semibold text-fg">{title}</h2>
      {href ? <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-table font-medium text-accent-strong transition-opacity hover:opacity-80">{linkLabel}<ArrowRight aria-hidden="true" className="size-3.5" /></Link> : null}
    </div>
  );
}

/** The platform dashboard's own header: the date as a gold eyebrow, a serif title with its gold italic word, the greeting and the focus line. */
export async function DashboardHeader({ context, actions }: { context: PlatformContext; actions?: React.ReactNode }) {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const today = new Intl.DateTimeFormat(locale === "sq" ? "sq-AL" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const quick = QUICK_CREATE.filter((item) => context.permissions.includes(item.permission));
  return (
    <>
      <div className="border-b border-accent/25 pb-6 max-md:border-0 max-md:pb-1 max-md:pt-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="nesto-eyebrow text-accent-strong">{today}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="font-serif text-[2.875rem] font-normal leading-none tracking-[-0.01em] text-fg md:text-headline md:leading-[1.05]">Platform <em className="italic text-accent-strong">overview</em></h1>
              <Badge tone="neutral" className="max-md:hidden">Platform Admin</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <p className="text-[0.9375rem] text-fg-muted md:text-body">{greetingText(t)}, {context.firstName}</p>
              <Badge tone="neutral" className="rounded-full border border-accent/30 bg-transparent px-2.5 py-0.5 text-micro font-semibold text-accent-strong md:hidden">Platform Admin</Badge>
            </div>
            <p className="mt-1 text-table leading-normal text-fg-subtle md:text-body md:text-fg-muted">Platform status and administration overview.</p>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      {quick.length ? (
        <div className="grid grid-cols-3 gap-2.5 md:flex md:flex-wrap md:items-center md:gap-2" data-testid="dashboard-quick-actions">
          {quick.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] border border-line bg-surface px-1 py-3 text-center text-micro font-semibold leading-tight text-fg transition-colors active:border-accent active:bg-accent-soft md:inline-flex md:h-8 md:min-h-0 md:flex-row md:gap-2 md:whitespace-nowrap md:rounded-full md:border-line-strong md:px-3 md:py-0 md:text-table md:font-medium md:hover:bg-hover md:active:bg-surface"
            >
              <Plus aria-hidden="true" strokeWidth={1.6} className="size-[22px] shrink-0 text-accent-strong md:size-4 md:text-current" />
              <span className="max-w-full break-words">New {item.label.toLowerCase()}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Time({ at }: { at: string }) {
  return <time dateTime={at} title={formatDateTime(at)}>{formatRelativeTime(at)}</time>;
}

const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : value < 1024 ** 4 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 4).toFixed(2)} TB`;

// ── Summary ─────────────────────────────────────────────────────────────────

function Metric({ label, value, detail, href, icon: Icon, tone }: { label: string; value: React.ReactNode; detail: React.ReactNode; href: string; icon: typeof Info; tone?: "attention" }) {
  return (
    <Link
      href={href}
      className={cn(
        "nesto-card relative block p-4 transition-colors before:absolute before:left-4 before:top-0 before:h-0.5 before:w-8 before:bg-accent before:content-[''] hover:border-line-strong md:p-5 md:before:left-5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        tone === "attention" && "border-warning/50",
      )}
    >
      <div className="flex items-center gap-2.5 md:gap-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong md:size-9"><Icon className="size-4" strokeWidth={1.6} /></span>
        <p className="line-clamp-2 min-w-0 break-words text-table font-medium text-fg-muted">{label}</p>
      </div>
      <p className="mt-3 font-serif text-display font-normal tabular-nums text-fg md:mt-4">{value}</p>
      <p className={cn("mt-1 text-meta", tone === "attention" ? "text-warning-strong" : "text-fg-subtle")}>{detail}</p>
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
    <section aria-label="Platform summary" className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:gap-4 lg:grid-cols-4 [&>*]:min-w-0" data-testid="dashboard-summary">
      <Metric label="Organizations" value={organizations.total} detail={`${organizations.groups} Groups · ${organizations.companies} Companies`} href="/admin/organizations" icon={Building2} />
      <Metric label="Projects" value={projects.total} detail={`${projects.active} Active · ${projects.pending} Pending · ${projects.finished} Finished`} href="/admin/projects" icon={FolderKanban} />
      <Metric label="Users" value={users.total} detail={`${users.active} Active · ${users.inactive + users.suspended} Inactive`} href="/admin/users" icon={Users} />
      <Metric label="Platform" value={<span className="text-[1.625rem] leading-tight">{statusText}</span>} detail={statusDetail} href="/admin/system/health" icon={ShieldCheck} tone={status.state === "ATTENTION" ? "attention" : undefined} />
    </section>
  );
}

export function SummarySkeleton() {
  return <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:gap-4 lg:grid-cols-4" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[132px] rounded-xl" />)}</div>;
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

const SEVERITY: Record<Severity, { label: string; icon: typeof Info; circle: string }> = {
  critical: { label: "Critical", icon: AlertOctagon, circle: "bg-danger-soft text-danger-strong" },
  warning: { label: "Warning", icon: AlertTriangle, circle: "bg-warning-soft text-warning-strong" },
  info: { label: "Information", icon: Info, circle: "bg-info-soft text-info-strong" },
};

export async function AttentionSection({ context }: { context: PlatformContext }) {
  const { items, total } = await dashboardAttention(context);
  const critical = items.some((item) => item.severity === "critical");
  return (
    <section aria-labelledby="dash-attention" className={cn("nesto-card flex min-w-0 flex-col p-5", critical && "border-danger/40")} data-testid="dashboard-attention">
      <div className="flex items-center gap-2">
        <SectionHeader id="dash-attention" title="Attention required" />
        {items.length > 0 ? <span className="grid h-[26px] min-w-[26px] place-items-center rounded-full bg-accent-soft px-1.5 text-meta font-bold text-accent-strong">{total}</span> : null}
      </div>
      <div className="mt-4 min-w-0 flex-1">
        {items.length === 0 ? (
          <p className="text-table text-fg-subtle">No issues requiring attention.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const severity = SEVERITY[item.severity];
              return (
                <li key={item.id} className="first:[&>*]:pt-0 last:[&>*]:pb-0" data-severity={item.severity}>
                  <Link href={item.href} className="flex min-w-0 items-center gap-3.5 py-3.5 transition-colors hover:bg-row-hover active:bg-accent-soft">
                    <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-full", severity.circle)}><severity.icon className="size-[18px]" strokeWidth={1.8} /></span>
                    <span className="min-w-0 flex-1">
                      {item.entity ? <span className="block text-micro font-medium text-fg-subtle">{item.entity}</span> : null}
                      <span className="block text-body font-semibold text-fg"><span className="sr-only">{severity.label}: </span>{item.title}</span>
                      <span className="block text-meta text-fg-muted">{item.description}</span>
                      <span className="mt-0.5 block text-meta text-fg-subtle">{item.at ? <Time at={item.at} /> : severity.label} · <span className="font-medium text-accent-strong">{item.actionLabel}</span></span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {total > items.length ? <p className="mt-3 text-meta text-fg-subtle">{total - items.length} more not shown.</p> : null}
      </div>
    </section>
  );
}

// ── Recent activity ─────────────────────────────────────────────────────────

export async function ActivitySection({ context }: { context: PlatformContext }) {
  const rows = await dashboardActivity(context);
  return (
    <section aria-labelledby="dash-activity" className="nesto-card flex min-w-0 flex-col p-5" data-testid="dashboard-activity">
      <SectionHeader id="dash-activity" title="Recent activity" href="/admin/audit" linkLabel="View Audit Log" />
      <div className="mt-4 min-w-0 flex-1">
        {rows.length === 0 ? (
          <p className="text-table text-fg-subtle">No administrative activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full border border-accent bg-transparent" />
                <Link href={row.href} className="group min-w-0">
                  <p className="text-table text-fg transition-colors group-hover:text-accent">{row.actor ? <span className="font-medium">{row.actor} </span> : null}{row.label}{row.entity ? <span className="text-fg-muted"> · {row.entity}</span> : null}</p>
                  <p className="text-meta text-fg-subtle"><Time at={row.at} /></p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Organizations and projects ──────────────────────────────────────────────

export async function OrganizationsSection({ context }: { context: PlatformContext }) {
  const rows = await dashboardOrganizations(context);
  return (
    <section aria-labelledby="dash-orgs" className="nesto-card flex min-w-0 flex-col p-5" data-testid="dashboard-organizations">
      <SectionHeader id="dash-orgs" title="Organizations" href="/admin/organizations" linkLabel="View all" />
      {rows.length === 0 ? (
        <div className="mt-4 text-table text-fg-subtle">
          <p>No organizations yet. Create a Company or Parent Group.</p>
          <Link href="/admin/organizations?create=company" className="mt-2 inline-block font-medium text-accent-strong hover:underline">Create</Link>
        </div>
      ) : (
        <div className="mt-4 min-w-0 flex-1">
          <Table stack flush aria-label="Recent organizations">
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
    <section aria-labelledby="dash-projects" className="nesto-card flex min-w-0 flex-col p-5" data-testid="dashboard-projects">
      <SectionHeader id="dash-projects" title="Projects" href="/admin/projects" linkLabel="View all" />
      {rows.length === 0 ? (
        <div className="mt-4 text-table text-fg-subtle">
          <p>No projects yet. Projects can be created after a Company exists.</p>
          {canCreate ? <Link href="/admin/projects?create=project" className="mt-2 inline-block font-medium text-accent-strong hover:underline">Create project</Link> : <p className="mt-1 text-meta text-fg-subtle">Create a company first.</p>}
        </div>
      ) : (
        <div className="mt-4 min-w-0 flex-1">
          <Table stack flush aria-label="Recent projects">
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
    <div className="nesto-card p-5" role="status" aria-busy="true" aria-label={`Loading ${label}`}>
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 divide-y divide-line">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex gap-4 py-3.5"><Skeleton className="size-10 shrink-0 rounded-full" /><Skeleton className="h-10 w-1/2" /><Skeleton className="ml-auto h-5 w-16" /></div>)}</div>
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
    <section aria-labelledby="dash-usage" className="nesto-card flex min-w-0 flex-col p-5" data-testid="dashboard-usage">
      <SectionHeader id="dash-usage" title="Platform usage" />
      <div className="mt-4 grid gap-5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
        <div className="min-w-0 sm:px-5 sm:first:pl-0 sm:last:pr-0">
          <p className="text-table font-medium text-fg-muted">Storage</p>
          <p className="mt-1 font-serif text-[1.625rem] font-normal leading-tight text-fg tabular-nums">{storage.quotaBytes ? `${bytes(storage.usedBytes)} / ${bytes(storage.quotaBytes)}` : `${bytes(storage.usedBytes)} used`}</p>
          {share !== null ? <p className={cn("text-meta", shareTone)}>{Math.round(share * 100)}% of quota</p> : <p className="text-meta text-fg-subtle">No platform-wide quota set</p>}
          <Link href="/admin/system/storage" className="mt-2 inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Storage<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        </div>
        <div className="min-w-0 sm:px-5 sm:first:pl-0 sm:last:pr-0">
          <p className="text-table font-medium text-fg-muted">Module provisioning</p>
          <p className="mt-1 font-serif text-[1.625rem] font-normal leading-tight text-fg tabular-nums">{modules.assignments}</p>
          <p className="text-meta text-fg-subtle">active company-module assignments · {modules.available} modules available</p>
          <Link href="/admin/modules" className="mt-2 inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Manage modules<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        </div>
        <div className="min-w-0 sm:px-5 sm:first:pl-0 sm:last:pr-0">
          <p className="text-table font-medium text-fg-muted">3D / Rozaris</p>
          <p className="mt-1 font-serif text-[1.625rem] font-normal leading-tight text-fg tabular-nums">{threeD.configured}</p>
          <p className="text-meta text-fg-subtle">{threeD.configured === 0 ? "No projects configured" : `projects configured · ${threeD.public} Public · ${threeD.companyOnly} Company users · ${threeD.private} Private · ${threeD.offline} Offline`}</p>
          <Link href="/admin/3d" className="mt-2 inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Manage 3D<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        </div>
      </div>
    </section>
  );
}
