import Link from "next/link";

import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DWorkspaces } from "@/lib/modules/project-3d/project-3d.service";

export const metadata = { title: "3D Platform" };
const filterSelectClass = "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

export default async function ThreeDPage({ searchParams }: { searchParams: Promise<{ q?: string; group?: string; company?: string; entitlement?: string; readiness?: string }> }) {
  const context = await requirePlatformContext();
  const [rows, filters] = await Promise.all([listProject3DWorkspaces(context), searchParams]);
  const groups = Array.from(new Map(rows.map((row) => [row.company.parentGroup.id, row.company.parentGroup])).values());
  const companies = Array.from(new Map(rows.map((row) => [row.company.id, row.company])).values());
  const query = filters.q?.trim().toLowerCase() ?? "";
  const filtered = rows.filter((row) => {
    const ready = Boolean(row.workspace && row.workspace.slots > 0);
    return (!query || `${row.code} ${row.name} ${row.company.name} ${row.company.parentGroup.name}`.toLowerCase().includes(query))
      && (!filters.group || row.company.parentGroup.id === filters.group)
      && (!filters.company || row.company.id === filters.company)
      && (!filters.entitlement || (row.entitlement?.status ?? "NONE") === filters.entitlement)
      && (!filters.readiness || (filters.readiness === "READY" ? ready : !ready));
  });

  return <div className="space-y-5"><PageHeader title="3D Platform" description="Provision premium 3D, manage private models, author experiences, bind canonical units, and publish Company releases." />
    <form className="nesto-card grid gap-3 p-4 md:grid-cols-5">
      <Input name="q" defaultValue={filters.q} placeholder="Search project, company, group" />
      <select name="group" defaultValue={filters.group ?? ""} className={filterSelectClass}><option value="">All groups</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <select name="company" defaultValue={filters.company ?? ""} className={filterSelectClass}><option value="">All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
      <select name="entitlement" defaultValue={filters.entitlement ?? ""} className={filterSelectClass}><option value="">All entitlements</option><option value="NONE">Not provisioned</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="INACTIVE">Inactive</option><option value="EXPIRED">Expired</option></select>
      <div className="flex gap-2"><select name="readiness" defaultValue={filters.readiness ?? ""} className={filterSelectClass}><option value="">Any readiness</option><option value="READY">Has model slots</option><option value="MISSING">Needs models</option></select><Button type="submit" variant="secondary">Filter</Button></div>
    </form>
    <section className="nesto-card p-5"><Table flush aria-label="Platform 3D projects"><TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>Organization</TableHeaderCell><TableHeaderCell>Entitlement</TableHeaderCell><TableHeaderCell>Workspace</TableHeaderCell><TableHeaderCell>Units</TableHeaderCell><TableHeaderCell /></TableRow></TableHead><TableBody>{filtered.map((row) => <TableRow key={row.id}><TableCell><span className="font-medium">{row.name}</span><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell><TableCell>{row.company.name}<p className="text-meta text-fg-subtle">{row.company.parentGroup.name}</p></TableCell><TableCell>{row.entitlement ? <Badge tone={row.entitlement.status === "ACTIVE" ? "success" : row.entitlement.status === "SUSPENDED" ? "warning" : "neutral"}>{row.entitlement.status}</Badge> : <Badge tone="neutral">NOT PROVISIONED</Badge>}</TableCell><TableCell>{row.workspace ? <span>{row.workspace.slots} slots · {row.workspace.releases} releases</span> : "—"}</TableCell><TableCell>{row.units}</TableCell><TableCell>{row.workspace ? <Button asChild size="sm"><Link href={`/platform-admin/3d/projects/${row.id}`}>Open workspace</Link></Button> : <EntitlementControl projectId={row.id} entitlement={null} compact />}</TableCell></TableRow>)}</TableBody></Table>{filtered.length === 0 ? <p className="py-8 text-center text-body text-fg-muted">No projects match these filters.</p> : null}</section>
  </div>;
}
