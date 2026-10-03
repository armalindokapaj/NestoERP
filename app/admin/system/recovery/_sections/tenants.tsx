import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
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
  const to = await getTranslations("adminOrgs");
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const rows = await listDeletedTenants(context);
  const canRestore = canPlatform(context, "platform.recovery.restore");
  const canPurge = canPlatform(context, "platform.recovery.purge");
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.recovery.tenants.title")} description={t("system.recovery.tenants.description", { days: RECOVERY_RETENTION_DAYS })} />
      {rows.length === 0 ? (
        <EmptyState title={t("system.recovery.tenants.empty")} description={t("system.recovery.tenants.emptyDescription")} />
      ) : (
        <section className="nesto-card p-5">
          <Table stack flush aria-label={t("system.recovery.tenants.tableLabel")} data-testid="deleted-tenants">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("system.recovery.tenants.cols.name")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.tenants.cols.type")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.tenants.cols.deleted")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.tenants.cols.reason")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.tenants.cols.removable")}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const subject = { kind: row.kind === "Group" ? ("group" as const) : ("company" as const), id: row.id, name: row.name };
                const items = row.viaGroup ? [] : [...(canRestore ? [restoreItem(subject, to)] : []), ...(canPurge ? [purgeItem(subject, to)] : [])];
                return (
                  <TableRow key={`${row.kind}-${row.id}`}>
                    <TableCell>
                      <Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link>
                      <p className="text-meta text-fg-subtle">{row.detail}</p>
                    </TableCell>
                    <TableCell>{enumLabel(t, "system.recovery.tenants.kinds", row.kind)} <AdminStatusBadge status="DELETED" /></TableCell>
                    <TableCell>{formatDate(row.deletedAt)}{row.deletedBy ? <p className="text-meta text-fg-subtle">{t("common.by", { name: row.deletedBy })}</p> : null}</TableCell>
                    <TableCell className="max-w-xs truncate">{row.reason ?? "—"}</TableCell>
                    <TableCell>{row.purgeAfter ? formatDate(row.purgeAfter) : "—"}</TableCell>
                    <TableCell className="text-right">{row.viaGroup ? <span className="text-meta text-fg-subtle">{t("system.recovery.tenants.comesBack")}</span> : <PlatformCommandMenu items={items} label={t("system.recovery.tenants.actions", { name: row.name })} />}</TableCell>
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
