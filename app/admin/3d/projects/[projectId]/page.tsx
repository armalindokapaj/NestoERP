import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { Box, GitBranch, Layers3, PackageCheck } from "lucide-react";

import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { ExperienceMetadataForm } from "@/components/3d/platform/ExperienceMetadataForm";
import { PublicationControl } from "@/components/3d/platform/PublicationControl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("threeD.project.overview.metaTitle") }; }

export default async function ExperienceOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const workspace = await getProject3DWorkspace(context, projectId);
  const config = workspace.project3DConfig!;
  const versions = config.slots.flatMap((slot) => slot.versions);
  const ready = versions.filter((version) => version.status === "READY" || version.status === "PUBLISHED").length;

  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Summary href={`/admin/3d/projects/${projectId}/structure`} icon={<Layers3 />} label={t("threeD.project.overview.structure")} value={t("threeD.project.overview.structureValue", { buildings: workspace._count.buildings, floors: workspace._count.floors, units: workspace._count.units })} manage={t("threeD.project.overview.manage", { label: t("threeD.project.overview.structure").toLowerCase() })} open={t("threeD.project.overview.open")} />
      <Summary href={`/admin/3d/projects/${projectId}/models`} icon={<Box />} label={t("threeD.project.overview.models")} value={t("threeD.project.overview.modelsValue", { slots: config.slots.length, ready })} manage={t("threeD.project.overview.manage", { label: t("threeD.project.overview.models").toLowerCase() })} open={t("threeD.project.overview.open")} />
      <Summary href={`/admin/3d/projects/${projectId}/bindings`} icon={<GitBranch />} label={t("threeD.project.overview.binding")} value={t("threeD.project.overview.bindingValue", { count: versions.reduce((total, version) => total + version._count.unitBindings, 0) })} manage={t("threeD.project.overview.manage", { label: t("threeD.project.overview.binding").toLowerCase() })} open={t("threeD.project.overview.open")} />
      <Summary href={`/admin/3d/projects/${projectId}/releases`} icon={<PackageCheck />} label={t("threeD.project.overview.publishing")} value={t("threeD.project.overview.publishingValue", { count: config.releases.length, state: config.activeReleaseId ? t("threeD.project.overview.active") : t("threeD.project.overview.unpublished") })} manage={t("threeD.project.overview.manage", { label: t("threeD.project.overview.publishing").toLowerCase() })} open={t("threeD.project.overview.open")} />
    </div>
    <PublicationControl
      projectId={projectId}
      visibility={config.visibility}
      controlVersion={config.controlVersion}
      activeRelease={config.activeReleaseId ? { id: config.activeReleaseId, publicManifestHash: config.releases.find((release) => release.id === config.activeReleaseId)?.publicManifestHash ?? null } : null}
      deleted={Boolean(config.deletedAt)}
      canManage={canPlatform(context, "platform.3d.visibility.manage")}
    />
    <ExperienceMetadataForm projectId={projectId} name={config.experienceName || t("threeD.project.defaultName", { name: workspace.name })} notes={config.internalNotes} />
    <EntitlementControl projectId={projectId} entitlement={workspace.project3DEntitlement} />
  </div>;
}

function Summary({ href, icon, label, value, manage, open }: { href: string; icon: React.ReactElement<{ className?: string }>; label: string; value: string; manage: string; open: string }) {
  return <section className="nesto-card p-5"><div className="flex items-start justify-between gap-3"><span className="rounded-lg bg-accent-soft p-2 text-accent-strong">{icon}</span><Badge tone="neutral">{open}</Badge></div><h2 className="mt-4 text-body font-semibold text-fg">{label}</h2><p className="mt-1 text-table text-fg-muted">{value}</p><Button asChild variant="link" size="sm" className="mt-3 px-0"><Link href={href}>{manage}</Link></Button></section>;
}
