import { dateText } from "@/lib/i18n/format";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import type { ReactNode } from "react";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "@/components/icons";

import { ExperienceEditorSync } from "@/components/3d/platform/ExperienceEditorSync";
import { ExperienceWorkspaceNav } from "@/components/3d/platform/ExperienceWorkspaceNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { canOpenProject3DEditor } from "@/lib/modules/project-3d/project-3d.editor";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";
import { assignedCompany } from "@/lib/access/project-ownership";

export default async function ExperienceLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const t = await getTranslations("adminPlatform");
  const locale = await getLocale();
  const context = await requirePlatformContext();
  const workspace = await getProject3DWorkspace(context, projectId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  if (!workspace.project3DConfig) notFound();
  const name = workspace.project3DConfig.experienceName || t("threeD.project.defaultName", { name: workspace.name });
  const revision = (workspace.project3DConfig.authoringDocument as { revision?: unknown } | null)?.revision;
  return <div className="space-y-5">
    <ExperienceEditorSync projectId={projectId} />
    <Link href="/admin/3d" className="inline-flex items-center gap-1 text-table text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("threeD.project.back")}</Link>
    <header className="nesto-card overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-4 p-5"><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-page text-fg font-display [overflow-wrap:anywhere]">{name}</h1><Badge tone={workspace.project3DEntitlement?.status === "ACTIVE" ? "success" : "warning"}>{workspace.project3DEntitlement?.status ? enumLabel(t, "enums.entitlement", workspace.project3DEntitlement.status) : t("threeD.project.noEntitlement")}</Badge>{workspace.project3DConfig.activeReleaseId ? <Badge tone="success">{t("threeD.project.published")}</Badge> : <Badge tone="neutral">{t("threeD.project.draft")}</Badge>}</div><p className="mt-1.5 text-body text-fg-muted">{assignedCompany(workspace).parentGroup.name} · {assignedCompany(workspace).name} · <span className="font-mono">{workspace.code}</span></p><p className="mt-1 text-table text-fg-subtle" data-testid="experience-draft-state">{typeof revision === "number" ? t("threeD.project.draftRevision", { revision }) : ""}{t("threeD.project.updated", { date: dateText(workspace.project3DConfig.updatedAt, { dateStyle: "medium", timeStyle: "short" }, locale) })}</p></div><div className="flex flex-wrap items-center gap-2"><Button asChild variant="secondary" size="sm"><a href={`/admin/3d/projects/${projectId}/viewer`} target="_blank" rel="noopener noreferrer">{t("threeD.project.companyViewer")}<ExternalLink aria-hidden="true" /></a></Button>{canOpenProject3DEditor(context) ? <Button asChild size="sm"><a href={`/admin/3d/projects/${projectId}/editor`} target="_blank" rel="noopener noreferrer">{t("threeD.project.openEditor")}<ExternalLink aria-hidden="true" /></a></Button> : null}</div></div><ExperienceWorkspaceNav projectId={projectId} /></header>
    {children}
  </div>;
}
