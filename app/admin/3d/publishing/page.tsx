import Link from "@/components/navigation/nav-link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DWorkspaces } from "@/lib/modules/project-3d/project-3d.service";
import { assignedCompany } from "@/lib/access/project-ownership";

export const metadata = { title: "3D Publishing" };

export default async function PublishingPage() {
  const context = await requirePlatformContext();
  const rows = (await listProject3DWorkspaces(context)).filter((row) => row.workspace);
  return <div className="space-y-5"><PageHeader title="3D publishing" description="Active immutable Company-viewer releases across all provisioned Projects." /><section className="nesto-card p-5"><Table stack flush aria-label="3D publishing"><TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>Company</TableHeaderCell><TableHeaderCell>Entitlement</TableHeaderCell><TableHeaderCell>Active release</TableHeaderCell><TableHeaderCell>History</TableHeaderCell><TableHeaderCell /></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{row.name}<p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell><TableCell>{assignedCompany(row).name}<p className="text-meta text-fg-subtle">{assignedCompany(row).parentGroup.name}</p></TableCell><TableCell><Badge tone={row.entitlement?.status === "ACTIVE" ? "success" : "warning"}>{row.entitlement?.status ?? "NONE"}</Badge></TableCell><TableCell>{row.workspace?.activeReleaseId ? <Badge tone="success">PUBLISHED</Badge> : <Badge tone="neutral">NO RELEASE</Badge>}</TableCell><TableCell>{row.workspace?.releases ?? 0} releases</TableCell><TableCell><Button asChild variant="secondary" size="sm"><Link href={`/admin/3d/projects/${row.id}/releases`}>Manage releases</Link></Button></TableCell></TableRow>)}</TableBody></Table></section></div>;
}
