import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { ExperienceWorkspaceNav } from "@/components/3d/platform/ExperienceWorkspaceNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";

export default async function ExperienceLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DWorkspace(context, projectId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (!workspace.project3DConfig) notFound();
  const name = workspace.project3DConfig.experienceName || `${workspace.name} 3D Experience`;
  return <div className="space-y-5">
    <Link href="/platform-admin/3d" className="inline-flex items-center gap-1 text-table text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />3D Experiences</Link>
    <header className="nesto-card overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-4 p-5"><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-page font-semibold text-fg">{name}</h1><Badge tone={workspace.project3DEntitlement?.status === "ACTIVE" ? "success" : "warning"}>{workspace.project3DEntitlement?.status ?? "NO ENTITLEMENT"}</Badge>{workspace.project3DConfig.activeReleaseId ? <Badge tone="success">PUBLISHED</Badge> : <Badge tone="neutral">DRAFT</Badge>}</div><p className="mt-1.5 text-body text-fg-muted">{workspace.company.parentGroup.name} · {workspace.company.name} · <span className="font-mono">{workspace.code}</span></p></div><Button asChild variant="secondary" size="sm"><Link href={`/projects/${projectId}/3d`} target="_blank">Company viewer<ExternalLink /></Link></Button></div><ExperienceWorkspaceNav projectId={projectId} /></header>
    {children}
  </div>;
}
