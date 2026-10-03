import { getTranslations } from "@/lib/i18n/server";
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
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const rows = await listDeletedExperiences(context);
  const canRestore = canPlatform(context, "platform.recovery.restore") && canPlatform(context, "platform.3d.experience.restore");
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.recovery.experiences.title")} description={t("system.recovery.experiences.description")} />
      {rows.length === 0 ? (
        <EmptyState title={t("system.recovery.experiences.empty")} description={t("system.recovery.experiences.emptyDescription")} />
      ) : (
        <section className="nesto-card p-5">
          <Table stack flush aria-label={t("system.recovery.experiences.tableLabel")} data-testid="deleted-experiences">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("system.recovery.experiences.cols.experience")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.experiences.cols.company")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.experiences.cols.deleted")}</TableHeaderCell>
                <TableHeaderCell>{t("system.recovery.experiences.cols.filesRemoved")}</TableHeaderCell>
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
                    {!row.restorable ? <Badge tone="default">{t("system.recovery.experiences.windowEnded")}</Badge> : canRestore ? <PlatformCommandButton label={t("common.restore")} title={t("system.recovery.experiences.restoreTitle", { name: row.name })} description={t("system.recovery.experiences.restoreDescription")} action="experience3d.restore" fixed={{ projectId: row.projectId, expectedControlVersion: row.controlVersion }} reasonOnly submitLabel={t("common.restore")} success={t("system.recovery.experiences.restored")} /> : null}
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
