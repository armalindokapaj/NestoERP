import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listRolePermissionRegistry } from "@/lib/modules/platform/platform-control.query";

export const metadata = { title: "Permissions" };

export default async function PermissionsPage() {
  const context = await requirePlatformContext();
  const { permissions } = await listRolePermissionRegistry(context);
  return <div className="space-y-5"><PageHeader title="Permission registry" description="Every tenant permission, its module and the number of roles that carry it." /><section className="nesto-card p-5"><Table stack flush aria-label="Permissions"><TableHead><TableRow><TableHeaderCell>Permission</TableHeaderCell><TableHeaderCell>Module</TableHeaderCell><TableHeaderCell>Action</TableHeaderCell><TableHeaderCell>Roles</TableHeaderCell></TableRow></TableHead><TableBody>{permissions.map((permission) => <TableRow key={permission.id}><TableCell><span className="font-mono text-meta text-fg">{permission.key}</span><p className="text-micro text-fg-subtle">{permission.description ?? "—"}</p></TableCell><TableCell><Badge>{permission.module}</Badge></TableCell><TableCell>{permission.action}</TableCell><TableCell>{permission._count.roles}</TableCell></TableRow>)}</TableBody></Table></section></div>;
}
