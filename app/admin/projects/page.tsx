import Link from "@/components/navigation/nav-link";

import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listPlatformCompanies, listPlatformProjects } from "@/lib/modules/platform/platform-control.query";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const context = await requirePlatformContext();
  const [projects, companies] = await Promise.all([listPlatformProjects(context), listPlatformCompanies(context)]);
  return <div className="space-y-5"><PageHeader title="Projects" description="Every project provisioned on NESTO, across all organizations." actions={<PlatformCommandButton label="Create project" title="Create project" action="project.create" openOnCreate="project" variant="primary" success="Project created." fields={[{ name: "companyId", label: "Company", type: "select", required: true, options: companies.filter((row) => row.status === "ACTIVE").map((row) => ({ value: row.id, label: `${row.parentGroup.name} · ${row.name}` })) }, { name: "code", label: "Project code", type: "text", required: true }, { name: "name", label: "Project name", type: "text", required: true }, { name: "description", label: "Description", type: "textarea" }, { name: "status", label: "Status", type: "select", required: true, options: ["PENDING", "ACTIVE", "FINISHED"].map((value) => ({ value, label: value })) }, { name: "reason", label: "Implementation reason", type: "textarea", required: true }]} initial={{ status: "PENDING" }} />} />
    <section className="nesto-card p-5">{projects.length === 0 ? <EmptyState title="No projects yet." description="Projects can be created once a company exists. Use Create project above." /> : <Table flush aria-label="Projects"><TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>Company</TableHeaderCell><TableHeaderCell>Group</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Members</TableHeaderCell><TableHeaderCell>3D</TableHeaderCell><TableHeaderCell>Created</TableHeaderCell><TableHeaderCell /></TableRow></TableHead><TableBody>{projects.map((project) => <TableRow key={project.id}><TableCell><Link href={`/admin/projects/${project.id}`} className="font-medium text-fg hover:underline">{project.name}</Link><p className="font-mono text-micro text-fg-subtle">{project.code}</p></TableCell><TableCell><Link href={`/admin/organizations/${project.company.id}`} className="hover:underline">{project.company.name}</Link></TableCell><TableCell>{project.company.parentGroup.name}</TableCell><TableCell><Badge tone={project.archivedAt ? "danger" : project.status === "ACTIVE" ? "success" : "warning"}>{project.archivedAt ? "ARCHIVED" : project.status}</Badge></TableCell><TableCell>{project.members}</TableCell><TableCell>{project.threeD?.entitlement ? <div className="flex items-center gap-2"><Badge tone={project.threeD.entitlement.status === "ACTIVE" ? "success" : "warning"}>{project.threeD.entitlement.status}</Badge><span className="text-meta text-fg-muted">{project.threeD.workspace?.activeReleaseId ? "Released" : `${project.threeD.workspace?.slots ?? 0} slots`}</span></div> : "Not provisioned"}</TableCell><TableCell>{formatDate(project.createdAt)}</TableCell><TableCell>{project.threeD?.workspace ? <Button asChild size="sm" variant="secondary"><Link href={`/admin/3d/projects/${project.id}`}>Open 3D</Link></Button> : <EntitlementControl projectId={project.id} entitlement={null} compact />}</TableCell></TableRow>)}</TableBody></Table>}</section>
  </div>;
}
