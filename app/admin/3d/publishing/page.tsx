import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DWorkspaces } from "@/lib/modules/project-3d/project-3d.service";
import { assignedCompany } from "@/lib/access/project-ownership";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("threeD.publishing.metaTitle") }; }

export default async function PublishingPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const rows = (await listProject3DWorkspaces(context)).filter((row) => row.workspace);
  return <div className="space-y-5"><PageHeader title={t("threeD.publishing.title")} description={t("threeD.publishing.description")} /><section className="nesto-card p-5"><Table stack aria-label={t("threeD.publishing.tableLabel")}><TableHead><TableRow><TableHeaderCell>{t("threeD.publishing.cols.project")}</TableHeaderCell><TableHeaderCell>{t("threeD.publishing.cols.company")}</TableHeaderCell><TableHeaderCell>{t("threeD.publishing.cols.entitlement")}</TableHeaderCell><TableHeaderCell>{t("threeD.publishing.cols.activeRelease")}</TableHeaderCell><TableHeaderCell>{t("threeD.publishing.cols.history")}</TableHeaderCell><TableHeaderCell /></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>{row.name}<p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell><TableCell>{assignedCompany(row).name}<p className="text-meta text-fg-subtle">{assignedCompany(row).parentGroup.name}</p></TableCell><TableCell><Badge tone={row.entitlement?.status === "ACTIVE" ? "success" : "warning"}>{enumLabel(t, "enums.entitlement", row.entitlement?.status ?? "NONE")}</Badge></TableCell><TableCell>{row.workspace?.activeReleaseId ? <Badge tone="success">{t("threeD.publishing.published")}</Badge> : <Badge tone="neutral">{t("threeD.publishing.noRelease")}</Badge>}</TableCell><TableCell>{t("threeD.publishing.releases", { count: row.workspace?.releases ?? 0 })}</TableCell><TableCell><Button asChild variant="secondary" size="sm"><Link href={`/admin/3d/projects/${row.id}/releases`}>{t("threeD.publishing.manage")}</Link></Button></TableCell></TableRow>)}</TableBody></Table></section></div>;
}
