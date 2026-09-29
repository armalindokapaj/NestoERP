import type { ReactNode } from "react";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { ExperienceEditorSync } from "@/components/3d/platform/ExperienceEditorSync";
import { ExperienceWorkspaceNav } from "@/components/3d/platform/ExperienceWorkspaceNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { canOpenProject3DEditor } from "@/lib/modules/project-3d/project-3d.editor";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";

const updatedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function ExperienceLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DWorkspace(context, projectId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (!workspace.project3DConfig) notFound();
  const name = workspace.project3DConfig.experienceName || `${workspace.name} 3D Experience`;
  const revision = (workspace.project3DConfig.authoringDocument as { revision?: unknown } | null)?.revision;
  return <div className="space-y-5">
    <ExperienceEditorSync projectId={projectId} />
    <Link href="/admin/3d" className="inline-flex items-center gap-1 text-table text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />3D Experiences</Link>
    <header className="nesto-card overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-4 p-5"><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-page font-semibold text-fg">{name}</h1><Badge tone={workspace.project3DEntitlement?.status === "ACTIVE" ? "success" : "warning"}>{workspace.project3DEntitlement?.status ?? "NO ENTITLEMENT"}</Badge>{workspace.project3DConfig.activeReleaseId ? <Badge tone="success">PUBLISHED</Badge> : <Badge tone="neutral">DRAFT</Badge>}</div><p className="mt-1.5 text-body text-fg-muted">{workspace.company.parentGroup.name} · {workspace.company.name} · <span className="font-mono">{workspace.code}</span></p><p className="mt-1 text-table text-fg-subtle" data-testid="experience-draft-state">{typeof revision === "number" ? `Draft revision ${revision} · ` : ""}Updated {updatedFormat.format(workspace.project3DConfig.updatedAt)}</p></div><div className="flex flex-wrap items-center gap-2"><Button asChild variant="secondary" size="sm"><a href={`/admin/3d/projects/${projectId}/viewer`} target="_blank" rel="noopener noreferrer">Company viewer<ExternalLink aria-hidden="true" /></a></Button>{canOpenProject3DEditor(context) ? <Button asChild size="sm"><a href={`/admin/3d/projects/${projectId}/editor`} target="_blank" rel="noopener noreferrer">Open Experience Editor<ExternalLink aria-hidden="true" /></a></Button> : null}</div></div><ExperienceWorkspaceNav projectId={projectId} /></header>
    {children}
  </div>;
}
