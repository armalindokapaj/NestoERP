import Link from "@/components/navigation/nav-link";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listDeletedExperiences } from "@/lib/modules/platform/platform-recovery.service";
import { formatDate } from "@/lib/utils/format";

/** Deleted 3D experiences inside their restoration window. A restore returns one offline with a new public link. */
export async function RecoveryExperiences() {
  const context = await requirePlatformContext();
  const rows = await listDeletedExperiences(context);
  const canRestore = canPlatform(context, "platform.recovery.restore") && canPlatform(context, "platform.3d.experience.restore");
  return (
    <div className="space-y-5">
      <PageHeader title="Recover 3D experiences" description="A restored experience comes back offline with a new public link; opening it to viewers is a separate decision." />
      {rows.length === 0 ? (
        <EmptyState title="No deleted 3D experiences" description="Experiences deleted from 3D / Rozaris appear here until their files are removed." />
      ) : (
        <section className="nesto-card p-5">
          <Table flush aria-label="Deleted 3D experiences" data-testid="deleted-experiences">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Experience</TableHeaderCell>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Deleted</TableHeaderCell>
                <TableHeaderCell>Files removed after</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.projectId}>
                  <TableCell className="font-medium text-fg">{row.name}</TableCell>
                  <TableCell><Link href={`/admin/organizations/${row.company.id}`} className="hover:underline">{row.company.name}</Link></TableCell>
                  <TableCell>{formatDate(row.deletedAt)}</TableCell>
                  <TableCell>{row.purgeAfter ? formatDate(row.purgeAfter) : "—"}</TableCell>
                  <TableCell className="text-right">
                    {!row.restorable ? <Badge tone="default">Window ended</Badge> : canRestore ? <PlatformCommandButton label="Restore" title={`Restore ${row.name}?`} description="It returns offline with a new public link. Old share links stay dead." action="experience3d.restore" fixed={{ projectId: row.projectId, expectedControlVersion: row.controlVersion }} reasonOnly submitLabel="Restore" success="3D experience restored." /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
