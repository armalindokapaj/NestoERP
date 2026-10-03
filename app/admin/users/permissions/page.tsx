import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getTranslations } from "@/lib/i18n/server";
import { listRolePermissionRegistry } from "@/lib/modules/platform/platform-control.query";

export async function generateMetadata() { const t = await getTranslations("adminAccess"); return { title: t("users.permissions.metaTitle") }; }

export default async function PermissionsPage() {
  const t = await getTranslations("adminAccess");
  const context = await requirePlatformContext();
  const { permissions } = await listRolePermissionRegistry(context);
  return <div className="space-y-5"><PageHeader title={t("users.permissions.title")} description={t("users.permissions.description")} /><section className="nesto-card p-5"><Table stack aria-label={t("users.permissions.tableLabel")}><TableHead><TableRow><TableHeaderCell>{t("users.permissions.cols.permission")}</TableHeaderCell><TableHeaderCell>{t("users.permissions.cols.module")}</TableHeaderCell><TableHeaderCell>{t("users.permissions.cols.action")}</TableHeaderCell><TableHeaderCell>{t("users.permissions.cols.roles")}</TableHeaderCell></TableRow></TableHead><TableBody>{permissions.map((permission) => <TableRow key={permission.id}><TableCell><span className="font-mono text-meta text-fg">{permission.key}</span><p className="text-micro text-fg-subtle">{permission.description ?? "—"}</p></TableCell><TableCell><Badge>{permission.module}</Badge></TableCell><TableCell>{permission.action}</TableCell><TableCell>{permission._count.roles}</TableCell></TableRow>)}</TableBody></Table></section></div>;
}
