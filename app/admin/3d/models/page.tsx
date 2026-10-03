import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";

import { DeleteModelVersionButton } from "@/components/3d/platform/DeleteModelVersionButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listProject3DModels } from "@/lib/modules/project-3d/project-3d.service";
import { assignedCompany } from "@/lib/access/project-ownership";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("threeD.models.metaTitle") }; }

export default async function ModelLibraryPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const models = await listProject3DModels(context);
  const canDelete = canPlatform(context, "platform.3d.model.delete");
  return <div className="space-y-5"><PageHeader title={t("threeD.models.title")} description={t("threeD.models.description")} /><section className="nesto-card p-5"><Table stack aria-label={t("threeD.models.tableLabel")}><TableHead><TableRow><TableHeaderCell>{t("threeD.models.cols.model")}</TableHeaderCell><TableHeaderCell>{t("threeD.models.cols.experience")}</TableHeaderCell><TableHeaderCell>{t("threeD.models.cols.slot")}</TableHeaderCell><TableHeaderCell>{t("threeD.models.cols.state")}</TableHeaderCell><TableHeaderCell>{t("threeD.models.cols.geometry")}</TableHeaderCell><TableHeaderCell>{t("threeD.models.cols.size")}</TableHeaderCell><TableHeaderCell /></TableRow></TableHead><TableBody>{models.map((model) => <TableRow key={model.id}><TableCell><span className="font-medium text-fg">{model.originalFileName}</span><p className="text-meta text-fg-subtle">{t("threeD.models.version", { version: model.version })}</p></TableCell><TableCell>{model.project.name}<p className="text-meta text-fg-subtle">{assignedCompany(model.project).parentGroup.name} · {assignedCompany(model.project).name}</p></TableCell><TableCell>{model.slot.displayName}<p className="text-meta text-fg-subtle">{enumLabel(t, "enums.slotRole", model.slot.role)}</p></TableCell><TableCell><Badge tone={model.status === "READY" || model.status === "PUBLISHED" ? "success" : model.status === "FAILED" ? "danger" : "warning"}>{enumLabel(t, "enums.modelStatus", model.status)}</Badge><p className="mt-1 text-meta text-fg-subtle">{enumLabel(t, "enums.validation", model.validationStatus)}</p></TableCell><TableCell>{t("threeD.models.meshes", { count: model.meshCount ?? "—" })}<p className="text-meta text-fg-subtle">{t("threeD.models.triangles", { count: model.triangleCount?.toLocaleString() ?? "—" })}</p></TableCell><TableCell>{formatBytes(model.runtimeSizeBytes ?? model.sourceSizeBytes)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button asChild size="sm" variant="secondary"><Link href={`/admin/3d/projects/${model.project.id}/models`}>{t("threeD.models.open")}</Link></Button>{canDelete ? <DeleteModelVersionButton versionId={model.id} fileName={model.originalFileName} /> : null}</div></TableCell></TableRow>)}</TableBody></Table>{models.length === 0 ? <p className="py-10 text-center text-body text-fg-muted">{t("threeD.models.empty")}</p> : null}</section></div>;
}

function formatBytes(bytes: bigint | null) {
  if (bytes === null) return "—";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
