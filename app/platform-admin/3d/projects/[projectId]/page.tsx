import Link from "next/link";
import { Box, GitBranch, Layers3, PackageCheck } from "lucide-react";

import { EntitlementControl } from "@/components/3d/platform/EntitlementControl";
import { ExperienceMetadataForm } from "@/components/3d/platform/ExperienceMetadataForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";

export const metadata = { title: "3D Experience Overview" };

export default async function ExperienceOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DWorkspace(context, projectId);
  const config = workspace.project3DConfig!;
  const versions = config.slots.flatMap((slot) => slot.versions);
  const ready = versions.filter((version) => version.status === "READY" || version.status === "PUBLISHED").length;

  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Summary href={`/platform-admin/3d/projects/${projectId}/structure`} icon={<Layers3 />} label="Project structure" value={`${workspace._count.buildings} buildings · ${workspace._count.floors} floors · ${workspace._count.units} units`} />
      <Summary href={`/platform-admin/3d/projects/${projectId}/models`} icon={<Box />} label="Model library" value={`${config.slots.length} slots · ${ready} ready versions`} />
      <Summary href={`/platform-admin/3d/projects/${projectId}/bindings`} icon={<GitBranch />} label="Unit binding" value={`${versions.reduce((total, version) => total + version._count.unitBindings, 0)} linked nodes`} />
      <Summary href={`/platform-admin/3d/projects/${projectId}/releases`} icon={<PackageCheck />} label="Publishing" value={`${config.releases.length} releases · ${config.activeReleaseId ? "active" : "unpublished"}`} />
    </div>
    <ExperienceMetadataForm projectId={projectId} name={config.experienceName || `${workspace.name} 3D Experience`} notes={config.internalNotes} />
    <EntitlementControl projectId={projectId} entitlement={workspace.project3DEntitlement} />
  </div>;
}

function Summary({ href, icon, label, value }: { href: string; icon: React.ReactElement<{ className?: string }>; label: string; value: string }) {
  return <section className="nesto-card p-5"><div className="flex items-start justify-between gap-3"><span className="rounded-lg bg-accent-soft p-2 text-accent-strong">{icon}</span><Badge tone="neutral">OPEN</Badge></div><h2 className="mt-4 text-body font-semibold text-fg">{label}</h2><p className="mt-1 text-table text-fg-muted">{value}</p><Button asChild variant="link" size="sm" className="mt-3 px-0"><Link href={href}>Manage {label.toLowerCase()}</Link></Button></section>;
}
