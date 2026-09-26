import Link from "@/components/navigation/nav-link";
import { AlertTriangle, Building2, FolderKanban, ShieldAlert, Users } from "lucide-react";

import { CreateGroupButton } from "@/components/platform/platform-actions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { platformDashboard } from "@/lib/modules/platform/platform-control.query";
import { listParentGroups } from "@/lib/modules/platform/platform.service";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Platform overview" };

const tone = (status: string) => status === "ACTIVE" ? "success" as const : status === "SUSPENDED" || status === "ARCHIVED" ? "danger" as const : "warning" as const;

export default async function PlatformAdminPage() {
  const context = await requirePlatformContext();
  const [dashboard, groups] = await Promise.all([platformDashboard(context), listParentGroups(context)]);
  const metrics = [
    ["Parent Groups", dashboard.kpis.groups, Building2], ["Companies", dashboard.kpis.companies, Building2], ["Active Users", dashboard.kpis.activeUsers, Users], ["Active Projects", dashboard.kpis.activeProjects, FolderKanban],
    ["Implementations", dashboard.kpis.implementations, GaugeIcon], ["Disabled Accounts", dashboard.kpis.disabledAccounts, ShieldAlert], ["Failed Jobs", dashboard.kpis.failedJobs, AlertTriangle], ["Security Alerts (24h)", dashboard.kpis.alerts, ShieldAlert],
  ] as const;
  return <div className="space-y-6">
    <PageHeader title="Platform overview" description="Operational state across NESTO. Tenant business KPIs stay in tenant workspaces." actions={canPlatform(context, "platform.group.create") ? <CreateGroupButton /> : undefined} />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform metrics">
      {metrics.map(([label, value, Icon]) => <Card key={label} className="p-5"><div className="flex items-center justify-between"><p className="text-table font-medium text-fg-muted">{label}</p><Icon className="size-4 text-fg-subtle" /></div><p className="mt-3 text-3xl font-semibold tracking-tight text-fg">{value}</p></Card>)}
    </section>
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-card font-semibold text-fg">Parent groups</h2><p className="text-table text-fg-muted">Recent organizations and implementation state.</p></div><Link href="/platform-admin/organizations/groups" className="text-table font-medium text-accent-strong hover:underline">View all</Link></div><div className="divide-y divide-line">{groups.slice(0, 7).map((group) => <Link key={group.id} href={`/platform-admin/groups/${group.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-hover"><span><span className="block text-body font-medium text-fg">{group.name}</span><span className="text-meta text-fg-subtle">{group.slug} · {group.companyCount} companies</span></span><Badge tone={tone(group.status)}>{group.status.replaceAll("_", " ")}</Badge></Link>)}</div></Card>
      <Card className="overflow-hidden"><div className="border-b border-line px-5 py-4"><h2 className="text-card font-semibold text-fg">Recent platform audit</h2><p className="text-table text-fg-muted">Sensitive changes across the control plane.</p></div><div className="divide-y divide-line">{dashboard.recentAudit.map((event) => <Link key={event.id} href="/platform-admin/audit" className="block px-5 py-3 hover:bg-hover"><p className="text-table font-medium text-fg">{event.actionKey.replaceAll("_", " ")}</p><p className="text-meta text-fg-subtle">{event.actorDisplayNameSnapshot ?? "System"} · {formatDate(event.occurredAt)}</p></Link>)}</div></Card>
    </div>
  </div>;
}

function GaugeIcon({ className }: { className?: string }) { return <span className={className} aria-hidden="true">◫</span>; }
