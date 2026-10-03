import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PlatformCommandMenu } from "@/components/platform/platform-command";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listDeletedTenants } from "@/lib/modules/platform/platform-recovery.service";
import { RECOVERY_RETENTION_DAYS } from "@/lib/modules/platform/recovery-constants";
import { formatDate } from "@/lib/utils/format";
import { purgeItem, restoreItem } from "@/app/admin/organizations/_detail/recovery-actions";

/** Deleted companies and groups: restore them as they were, or remove them for good. */
export async function RecoveryTenants() {
  const context = await requirePlatformContext();
  const rows = await listDeletedTenants(context);
  const canRestore = canPlatform(context, "platform.recovery.restore");
  const canPurge = canPlatform(context, "platform.recovery.purge");
  return (
    <div className="space-y-5">
      <PageHeader title="Recovery" description={`Deleted companies and groups keep all their data for ${RECOVERY_RETENTION_DAYS} days and can be restored exactly as they were. Nobody can sign in to them meanwhile.`} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing is deleted" description="Companies and groups you delete from Organizations appear here." />
      ) : (
        <section className="nesto-card p-5">
          <Table stack flush aria-label="Deleted companies and groups" data-testid="deleted-tenants">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Deleted</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell>Removable after</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const subject = { kind: row.kind === "Group" ? ("group" as const) : ("company" as const), id: row.id, name: row.name };
                const items = row.viaGroup ? [] : [...(canRestore ? [restoreItem(subject)] : []), ...(canPurge ? [purgeItem(subject)] : [])];
                return (
                  <TableRow key={`${row.kind}-${row.id}`}>
                    <TableCell>
                      <Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link>
                      <p className="text-meta text-fg-subtle">{row.detail}</p>
                    </TableCell>
                    <TableCell>{row.kind} <AdminStatusBadge status="DELETED" /></TableCell>
                    <TableCell>{formatDate(row.deletedAt)}{row.deletedBy ? <p className="text-meta text-fg-subtle">by {row.deletedBy}</p> : null}</TableCell>
                    <TableCell className="max-w-xs truncate">{row.reason ?? "—"}</TableCell>
                    <TableCell>{row.purgeAfter ? formatDate(row.purgeAfter) : "—"}</TableCell>
                    <TableCell className="text-right">{row.viaGroup ? <span className="text-meta text-fg-subtle">Comes back with its group</span> : <PlatformCommandMenu items={items} label={`${row.name} actions`} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
