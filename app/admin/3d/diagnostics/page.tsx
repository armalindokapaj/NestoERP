import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DDiagnostics } from "@/lib/modules/project-3d/project-3d.service";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("threeD.diagnostics.metaTitle") }; }

export default async function DiagnosticsPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const rows = await listProject3DDiagnostics(context);
  const withoutModel = rows.filter((row) => row.slots.length === 0 || row.slots.some((slot) => slot.versions.length === 0));
  const failed = rows.flatMap((row) => row.slots.flatMap((slot) => slot.versions
    .filter((version) => version.status === "FAILED" || version.validationStatus === "BLOCKED")
    .map((version) => ({ row, slot, version }))));
  const unpublished = rows.filter((row) => row.entitlementStatus === "ACTIVE" && !row.activeReleaseId);

  return <div className="space-y-5">
    <PageHeader title={t("threeD.diagnostics.title")} description={t("threeD.diagnostics.description")} />
    <div className="grid gap-4 md:grid-cols-4">
      <Card className="p-5"><p className="text-table text-fg-muted">{t("threeD.diagnostics.workspaces")}</p><p className="mt-2 text-3xl font-semibold">{rows.length}</p></Card>
      <Card className="p-5"><p className="text-table text-fg-muted">{t("threeD.diagnostics.missing")}</p><p className="mt-2 text-3xl font-semibold">{withoutModel.length}</p></Card>
      <Card className="p-5"><p className="text-table text-fg-muted">{t("threeD.diagnostics.failed")}</p><p className="mt-2 text-3xl font-semibold">{failed.length}</p></Card>
      <Card className="p-5"><p className="text-table text-fg-muted">{t("threeD.diagnostics.awaiting")}</p><p className="mt-2 text-3xl font-semibold">{unpublished.length}</p></Card>
    </div>
    <Card className="p-5">
      <h2 className="text-card font-semibold">{t("threeD.diagnostics.findings")}</h2>
      <div className="mt-4 space-y-2">
        {withoutModel.map((row) => <Finding key={`model-${row.id}`} row={row} label={t("threeD.diagnostics.noModel")} tone="warning" badge={t("threeD.diagnostics.modelNeeded")} />)}
        {failed.map(({ row, slot, version }) => <Finding key={version.id} row={row} label={t("threeD.diagnostics.failedVersion", { slot: slot.displayName, version: version.version })} tone="danger" badge={t("threeD.diagnostics.failedBadge")} />)}
        {unpublished.map((row) => <Finding key={`release-${row.id}`} row={row} label={t("threeD.diagnostics.unpublished")} tone="info" badge={t("threeD.diagnostics.unpublishedBadge")} />)}
        {!withoutModel.length && !failed.length && !unpublished.length ? <p className="text-table text-fg-muted">{t("threeD.diagnostics.none")}</p> : null}
      </div>
    </Card>
  </div>;
}

function Finding({ row, label, tone, badge }: {
  row: { projectId: string; projectName: string; companyName: string };
  label: string;
  tone: "warning" | "danger" | "info";
  badge: string;
}) {
  return <Link href={`/admin/3d/projects/${row.projectId}`} className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3 hover:bg-surface-subtle">
    <span><span className="font-medium text-fg">{row.projectName}</span> <span className="text-fg-muted">({row.companyName}) {label}</span></span>
    <Badge tone={tone}>{badge}</Badge>
  </Link>;
}
