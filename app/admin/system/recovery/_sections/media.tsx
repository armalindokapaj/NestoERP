import Link from "@/components/navigation/nav-link";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listRemovedProjectMedia } from "@/lib/modules/platform/platform-recovery.service";
import { formatDate } from "@/lib/utils/format";

/** Media taken off a project. The file stays in Documents; a restore links it to the project again. */
export async function RecoveryMedia() {
  const context = await requirePlatformContext();
  const rows = await listRemovedProjectMedia(context);
  const canRestore = canPlatform(context, "platform.recovery.restore");
  return (
    <div className="space-y-5">
      <PageHeader title="Recover project media" description="Renders and animations removed from a project's media. Archived files come back under Documents first." />
      {rows.length === 0 ? (
        <EmptyState title="No removed media to recover" description="Media removed from a project appears here while its file still exists." />
      ) : (
        <section className="nesto-card p-5">
          <Table stack flush aria-label="Removed project media" data-testid="removed-media">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Media</TableHeaderCell>
                <TableHeaderCell>Project</TableHeaderCell>
                <TableHeaderCell>Company</TableHeaderCell>
                <TableHeaderCell>Removed</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.eventId}>
                  <TableCell className="font-medium text-fg">{row.title}<p className="text-meta text-fg-subtle">{row.type === "ANIMATION" ? "Animation" : "Render"}</p></TableCell>
                  <TableCell>{row.project.name}</TableCell>
                  <TableCell><Link href={`/admin/organizations/${row.company.id}`} className="hover:underline">{row.company.name}</Link></TableCell>
                  <TableCell>{formatDate(row.removedAt)}{row.removedBy ? <p className="text-meta text-fg-subtle">by {row.removedBy}</p> : null}</TableCell>
                  <TableCell className="text-right">
                    {canRestore ? <PlatformCommandButton label="Restore" title={`Restore “${row.title}”?`} description={`It is added back to ${row.project.name}'s media, at the end. It is not made the cover again.`} action="projectMedia.restore" fixed={{ eventId: row.eventId }} reasonOnly submitLabel="Restore" success="Media restored." /> : null}
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
