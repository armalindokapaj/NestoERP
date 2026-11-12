import Link from "@/components/navigation/nav-link";
import { AlertOctagon, AlertTriangle, ArrowRight, ChevronRight, Info } from "@/components/icons";

import { dateText, formatDateTime, formatRelativeTime } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { adminText } from "@/components/platform/admin-i18n";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { HealthGrid } from "@/components/platform/admin-health";
import { adminActionLabel } from "@/components/platform/admin-actions";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { platformHealth } from "@/lib/modules/platform/platform-control.query";
import {
  dashboardActivity, dashboardAttention, dashboardOrganizations, dashboardProjects, dashboardSummary, dashboardUsage,
  STORAGE_CRITICAL, STORAGE_WARNING, type Severity,
} from "@/lib/modules/platform/platform-dashboard.query";
import { cn } from "@/lib/utils/cn";
import { assignedCompany } from "@/lib/access/project-ownership";

/*
 * The Overview's sections, an operations cockpit (docs/ui/UI-09-admin-console.md §Home):
 * health first, the platform in numbers, then what needs attention beside
 * what just happened, the newest organizations and projects, and usage. Each
 * is its own async server component, so each streams in when its data lands
 * and fails alone (Dashboard PRD §43, §44).
 */

/** The page's head: its name, who and when, and Refresh. */
export async function CockpitHeader({ actions }: { actions?: React.ReactNode }) {
  const [t, locale] = await Promise.all([getTranslations("admin"), getLocale()]);
  const today = dateText(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }, locale);
  return <PageHeader title={t("nav.page.overview")} description={t("dashboard.standfirst", { date: today })} actions={actions} />;
}

/** A lined panel with a numbered mono caption, as the console's lists are drawn. */
function Panel({ id, number, title, count, href, linkLabel, testId, tone, children }: { id: string; number: string; title: string; count?: React.ReactNode; href?: string; linkLabel?: string; testId: string; tone?: "danger"; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col border bg-surface", tone === "danger" ? "border-danger/50" : "border-line-strong")} data-testid={testId}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line-strong px-4">
        <h2 id={id} className="min-w-0 truncate font-mono text-meta font-medium uppercase tracking-[0.12em] text-fg">
          <span aria-hidden="true" className="mr-2.5 text-fg-subtle">{number} /</span>
          {title}
          {count !== undefined ? <span className="ml-2.5 tabular-nums text-fg-subtle">{count}</span> : null}
        </h2>
        {href ? (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1.5 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-muted transition-colors hover:text-fg">
            {linkLabel}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-5 text-table text-fg-subtle">{children}</div>;
}

async function Time({ at }: { at: string }) {
  const locale = await getLocale();
  return <time dateTime={at} title={formatDateTime(at, locale)}>{formatRelativeTime(at, locale)}</time>;
}

const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : value < 1024 ** 4 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 4).toFixed(2)} TB`;

// ── Health ──────────────────────────────────────────────────────────────────

/** The eight services in one lined strip, each with its state; the strip opens Health. */
export async function HealthSection({ context }: { context: PlatformContext }) {
  const t = await getTranslations("admin");
  if (!canPlatform(context, "platform.operations.view")) {
    return (
      <Panel id="dash-health" number="01" title={t("dashboard.healthTitle")} testId="dashboard-health">
        <Empty>{t("dashboard.statusNeedsOps")}</Empty>
      </Panel>
    );
  }
  const checks = await platformHealth(context);
  const issues = checks.filter((check) => check.state !== "HEALTHY").length;
  const down = checks.some((check) => check.state === "DOWN");
  return (
    <Panel id="dash-health" number="01" title={t("dashboard.healthTitle")} href="/admin/system/health" linkLabel={t("dashboard.healthOpen")} testId="dashboard-health" tone={down ? "danger" : undefined}>
      <p className={cn("border-b border-line px-4 py-2 text-table font-medium", issues ? "text-warning-strong" : "text-fg-muted")} data-testid="dashboard-health-summary">
        {issues ? t("dashboard.healthIssues", { count: issues }) : t("dashboard.healthAll", { count: checks.length })}
      </p>
      <HealthGrid cells={checks.map((check) => ({ key: check.service, service: adminText(t, `dashboard.service.${check.service}`, check.service), state: check.state, stateLabel: adminText(t, `dashboard.healthState.${check.state}`, check.state) }))} />
    </Panel>
  );
}

export function HealthSkeleton() {
  return <Skeleton aria-hidden="true" className="h-[7.5rem] rounded-none" />;
}

// ── In numbers ──────────────────────────────────────────────────────────────

type Summary = Awaited<ReturnType<typeof dashboardSummary>>;

function Figure({ label, value, detail, href }: { label: string; value: React.ReactNode; detail: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="group block min-w-0 bg-surface px-4 py-4 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <p className="flex items-center justify-between gap-2 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle">
        {label}
        <ArrowRight aria-hidden="true" className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
      <p className="mt-2 font-display text-[2.5rem] leading-none tabular-nums text-fg">{value}</p>
      <p className="mt-2 truncate text-meta text-fg-muted">{detail}</p>
    </Link>
  );
}

export async function NumbersSection({ summary: pending }: { summary: Promise<Summary> }) {
  const [{ organizations, projects, users }, t] = await Promise.all([pending, getTranslations("admin")]);
  return (
    <Panel id="dash-numbers" number="02" title={t("dashboard.numbersTitle")} testId="dashboard-summary">
      <div className="grid grid-cols-1 gap-px bg-line min-[420px]:grid-cols-3">
        <Figure label={t("dashboard.organizations")} value={organizations.total} detail={t("dashboard.groupsCompanies", { groups: organizations.groups, companies: organizations.companies })} href="/admin/organizations" />
        <Figure label={t("dashboard.projects")} value={projects.total} detail={t("dashboard.projectsDetail", { active: projects.active, pending: projects.pending, finished: projects.finished })} href="/admin/projects" />
        <Figure label={t("dashboard.users")} value={users.total} detail={t("dashboard.usersDetail", { active: users.active, inactive: users.inactive + users.suspended })} href="/admin/users" />
      </div>
    </Panel>
  );
}

export function NumbersSkeleton() {
  return <Skeleton aria-hidden="true" className="h-[9.5rem] rounded-none" />;
}

/** New installation: one restrained way in (§45). */
export async function FirstRun({ summary }: { summary: Promise<Summary> }) {
  const { organizations } = await summary.catch(() => ({ organizations: { companies: 1 } }));
  if (organizations.companies > 0) return null;
  const t = await getTranslations("admin");
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 border border-line-strong bg-surface p-5 shadow-[inset_3px_0_0_var(--nesto-accent)]" data-testid="dashboard-first-run">
      <div>
        <h2 className="text-card font-semibold text-fg">{t("dashboard.firstRunTitle")}</h2>
        <p className="mt-1 text-table text-fg-muted">{t("dashboard.firstRunBody")}</p>
      </div>
      <Link href="/admin/organizations?create=company" className="inline-flex h-10 items-center bg-primary px-4 text-table font-medium text-primary-fg hover:bg-primary-hover">{t("dashboard.firstRunAction")}</Link>
    </section>
  );
}

// ── Attention required ──────────────────────────────────────────────────────

const SEVERITY: Record<Severity, { label: "sevCritical" | "sevWarning" | "sevInfo"; icon: typeof Info; cell: string }> = {
  critical: { label: "sevCritical", icon: AlertOctagon, cell: "border-danger/40 bg-danger-soft text-danger-strong" },
  warning: { label: "sevWarning", icon: AlertTriangle, cell: "border-warning/40 bg-warning-soft text-warning-strong" },
  info: { label: "sevInfo", icon: Info, cell: "border-line-strong bg-surface text-fg-muted" },
};

export async function AttentionSection({ context }: { context: PlatformContext }) {
  const [{ items, total }, t] = await Promise.all([dashboardAttention(context), getTranslations("admin")]);
  const critical = items.some((item) => item.severity === "critical");
  return (
    <Panel id="dash-attention" number="03" title={t("dashboard.attentionTitle")} count={items.length ? total : undefined} testId="dashboard-attention" tone={critical ? "danger" : undefined}>
      {items.length === 0 ? (
        <Empty>{t("dashboard.attentionNone")}</Empty>
      ) : (
        <ul>
          {items.map((item) => {
            const severity = SEVERITY[item.severity];
            const severityLabel = t(`dashboard.${severity.label}`);
            const values = item.values && typeof item.values.service === "string" ? { ...item.values, service: adminText(t, `dashboard.service.${item.values.service}`, item.values.service) } : item.values;
            const title = adminText(t, `dashboard.attention.${item.code}`, item.title, values);
            const body = adminText(t, `dashboard.attention.${item.code}Body`, item.description, item.values);
            const action = adminText(t, `dashboard.attention.action${item.actionLabel}`, item.actionLabel);
            return (
              <li key={item.id} className="border-b border-line last:border-b-0" data-severity={item.severity}>
                <Link href={item.href} className="flex min-w-0 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-hover">
                  <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center border", severity.cell)}>
                    <severity.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    {item.entity ? <span className="block truncate font-mono text-micro uppercase tracking-[0.08em] text-fg-subtle">{item.entity}</span> : null}
                    <span className="block text-body font-semibold text-fg">
                      <span className="sr-only">{severityLabel}: </span>
                      {title}
                    </span>
                    <span className="block text-meta text-fg-muted">{body}</span>
                    <span className="mt-0.5 block text-meta text-fg-subtle">
                      {item.at ? <Time at={item.at} /> : severityLabel} · <span className="font-medium text-fg">{action}</span>
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {total > items.length ? <p className="border-t border-line px-4 py-2 text-meta text-fg-subtle">{t("dashboard.attentionMore", { count: total - items.length })}</p> : null}
    </Panel>
  );
}

// ── Recent activity ─────────────────────────────────────────────────────────

export async function ActivitySection({ context }: { context: PlatformContext }) {
  const [rows, t] = await Promise.all([dashboardActivity(context), getTranslations("admin")]);
  return (
    <Panel id="dash-activity" number="04" title={t("dashboard.activityTitle")} href="/admin/audit" linkLabel={t("dashboard.activityLink")} testId="dashboard-activity">
      {rows.length === 0 ? (
        <Empty>{t("dashboard.activityNone")}</Empty>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="border-b border-line last:border-b-0">
              <Link href={row.href} className="flex min-w-0 items-baseline gap-3 px-4 py-2.5 transition-colors hover:bg-hover">
                <span className="min-w-0 flex-1 text-table text-fg">
                  {row.actor ? <span className="font-medium">{row.actor} </span> : null}
                  {adminActionLabel(t, row.actionKey, row.label)}
                  {row.entity ? <span className="text-fg-muted"> · {row.entity}</span> : null}
                </span>
                <span className="shrink-0 font-mono text-micro uppercase tracking-[0.06em] text-fg-subtle">
                  <Time at={row.at} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Organizations and projects ──────────────────────────────────────────────

export async function OrganizationsSection({ context }: { context: PlatformContext }) {
  const [rows, t] = await Promise.all([dashboardOrganizations(context), getTranslations("admin")]);
  return (
    <Panel id="dash-orgs" number="05" title={t("dashboard.orgsTitle")} href="/admin/organizations" linkLabel={t("dashboard.viewAll")} testId="dashboard-organizations">
      {rows.length === 0 ? (
        <Empty>
          <p>{t("dashboard.orgsNone")}</p>
          <Link href="/admin/organizations?create=company" className="mt-2 inline-block font-medium text-fg underline decoration-accent decoration-2 underline-offset-4">{t("dashboard.orgsCreate")}</Link>
        </Empty>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <Table stack aria-label={t("dashboard.recentOrgsLabel")}>
            <TableHead><TableRow><TableHeaderCell>{t("dashboard.colOrganization")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("dashboard.colType")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("dashboard.colCompanies")}</TableHeaderCell><TableHeaderCell>{t("dashboard.colProjects")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("dashboard.colUsers")}</TableHeaderCell><TableHeaderCell>{t("dashboard.colStatus")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                  <TableCell className="max-sm:hidden">{row.type === "Group" ? t("dashboard.typeGroup") : t("dashboard.typeStandalone")}</TableCell>
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
    </Panel>
  );
}

export async function ProjectsSection({ context, summary }: { context: PlatformContext; summary: Promise<Summary> }) {
  const [rows, canCreate, t] = await Promise.all([dashboardProjects(context), summary.then((value) => value.organizations.companies > 0, () => false), getTranslations("admin")]);
  return (
    <Panel id="dash-projects" number="06" title={t("dashboard.projectsTitle")} href="/admin/projects" linkLabel={t("dashboard.viewAll")} testId="dashboard-projects">
      {rows.length === 0 ? (
        <Empty>
          <p>{t("dashboard.projectsNone")}</p>
          {canCreate ? <Link href="/admin/projects?create=project" className="mt-2 inline-block font-medium text-fg underline decoration-accent decoration-2 underline-offset-4">{t("dashboard.projectsCreate")}</Link> : <p className="mt-1 text-meta text-fg-subtle">{t("dashboard.projectsCompanyFirst")}</p>}
        </Empty>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <Table stack aria-label={t("dashboard.recentProjectsLabel")}>
            <TableHead><TableRow><TableHeaderCell>{t("dashboard.colProject")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("dashboard.colCompany")}</TableHeaderCell><TableHeaderCell>{t("dashboard.col3d")}</TableHeaderCell><TableHeaderCell>{t("dashboard.colStatus")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                  <TableCell className="max-sm:hidden"><Link href={`/admin/organizations/${assignedCompany(row).id}`} className="text-fg-muted hover:underline">{assignedCompany(row).name}</Link></TableCell>
                  <TableCell>{row.has3D ? <Link href={`/admin/3d/projects/${row.id}`} aria-label={t("dashboard.open3d", { state: row.threeD, name: row.name })} className="hover:opacity-80"><AdminStatusBadge status={row.threeD} /></Link> : <AdminStatusBadge status={row.threeD} />}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

export { ListSkeleton } from "./list-skeleton";

// ── Usage ───────────────────────────────────────────────────────────────────

function UsageFigure({ label, value, detail, detailClass, href, linkLabel }: { label: string; value: React.ReactNode; detail: React.ReactNode; detailClass?: string; href: string; linkLabel: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-4">
      <p className="font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p className="mt-2 font-display text-[1.625rem] leading-tight tabular-nums text-fg">{value}</p>
      <p className={cn("mt-1 text-meta", detailClass ?? "text-fg-subtle")}>{detail}</p>
      <Link href={href} className="mt-3 inline-flex items-center gap-1.5 font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-muted transition-colors hover:text-fg">
        {linkLabel}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

export async function UsageSection({ context }: { context: PlatformContext }) {
  const [usage, t] = await Promise.all([dashboardUsage(context), getTranslations("admin")]);
  const { storage, modules, threeD } = usage;
  const share = storage.quotaBytes ? storage.usedBytes / storage.quotaBytes : null;
  const shareTone = share === null ? undefined : share >= STORAGE_CRITICAL ? "text-danger-strong" : share >= STORAGE_WARNING ? "text-warning-strong" : undefined;
  return (
    <Panel id="dash-usage" number="07" title={t("dashboard.usageTitle")} testId="dashboard-usage">
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <UsageFigure
          label={t("dashboard.storage")}
          value={storage.quotaBytes ? `${bytes(storage.usedBytes)} / ${bytes(storage.quotaBytes)}` : t("dashboard.storageUsed", { used: bytes(storage.usedBytes) })}
          detail={share !== null ? t("dashboard.quotaShare", { percent: Math.round(share * 100) }) : t("dashboard.noQuota")}
          detailClass={shareTone}
          href="/admin/system/storage"
          linkLabel={t("dashboard.storage")}
        />
        <UsageFigure label={t("dashboard.moduleProvisioning")} value={modules.assignments} detail={t("dashboard.assignmentsHint", { available: modules.available })} href="/admin/modules" linkLabel={t("dashboard.manageModules")} />
        <UsageFigure
          label={t("dashboard.threeD")}
          value={threeD.configured}
          detail={threeD.configured === 0 ? t("dashboard.threeDNone") : t("dashboard.threeDHint", { public: threeD.public, companyOnly: threeD.companyOnly, private: threeD.private, offline: threeD.offline })}
          href="/admin/3d"
          linkLabel={t("dashboard.manage3d")}
        />
      </div>
    </Panel>
  );
}
