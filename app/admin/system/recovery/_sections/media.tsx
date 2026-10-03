import { getTranslations } from "@/lib/i18n/server";
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
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const rows = await listRemovedProjectMedia(context);
  const canRestore = canPlatform(context, "platform.recovery.restore");
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.recovery.media.title")} description={t("system.recovery.media.description")} />
      {rows.length === 0 ? (
        <EmptyState title={t("system.recovery.media.empty")} description={t("system.recovery.media.emptyDescription")} />
      ) : (
        <section className="nesto-card p-5">
          <Table stack flush aria-label={t("system.recovery.media.tableLabel")} data-testid="removed-media">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("system.recovery.media.cols.media")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.media.cols.project")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.media.cols.company")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.media.cols.removed")}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.eventId}>
                  <TableCell className="font-medium text-fg">{row.title}<p className="text-meta text-fg-subtle">{row.type === "ANIMATION" ? t("system.recovery.media.animation") : t("system.recovery.media.render")}</p></TableCell>
                  <TableCell>{row.project.name}</TableCell>
                  <TableCell><Link href={`/admin/organizations/${row.company.id}`} className="hover:underline">{row.company.name}</Link></TableCell>
                  <TableCell>{formatDate(row.removedAt)}{row.removedBy ? <p className="text-meta text-fg-subtle">{t("common.by", { name: row.removedBy })}</p> : null}</TableCell>
                  <TableCell className="text-right">
                    {canRestore ? <PlatformCommandButton label={t("common.restore")} title={t("system.recovery.media.restoreTitle", { title: row.title })} description={t("system.recovery.media.restoreDescription", { project: row.project.name })} action="projectMedia.restore" fixed={{ eventId: row.eventId }} reasonOnly submitLabel={t("common.restore")} success={t("system.recovery.media.restored")} /> : null}
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
