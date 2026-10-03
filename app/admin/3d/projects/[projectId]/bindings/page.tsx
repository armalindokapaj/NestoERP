import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import Link from "@/components/navigation/nav-link";

import { UnitBindingEditor } from "@/components/3d/platform/UnitBindingEditor";
import { Badge } from "@/components/ui/badge";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DEditorWorkspace } from "@/lib/modules/project-3d/project-3d.editor";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("threeD.project.bindings.metaTitle") }; }

export default async function ExperienceBindingsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ versionId?: string }> }) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const workspace = await getProject3DEditorWorkspace(context, projectId);
  const versions = workspace.slots.flatMap((slot) => slot.versions.map((version) => ({ ...version, slotName: slot.displayName }))).filter((version) => ["READY", "PUBLISHED"].includes(version.status));
  const selected = versions.find((version) => version.id === search.versionId) ?? versions[0] ?? null;
  return <div className="space-y-4">
    <section className="nesto-card p-4"><div className="flex flex-wrap items-center gap-2"><span className="mr-2 text-table font-medium text-fg">{t("threeD.project.bindings.modelVersion")}</span>{versions.map((version) => <Link key={version.id} href={`?versionId=${version.id}`} className={`rounded-md border px-3 py-1.5 text-table ${selected?.id === version.id ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover"}`}>{version.slotName} · v{version.version} <Badge className="ml-1" tone="neutral">{enumLabel(t, "enums.modelStatus", version.status)}</Badge></Link>)}</div></section>
    {selected ? <UnitBindingEditor projectId={projectId} versionId={selected.id} /> : <section className="nesto-card p-8 text-center"><h2 className="text-card font-semibold text-fg">{t("threeD.project.bindings.emptyTitle")}</h2><p className="mt-1 text-body text-fg-muted">{t("threeD.project.bindings.emptyBody")}</p><Link className="mt-4 inline-block text-table font-medium text-accent-strong hover:underline" href={`/admin/3d/projects/${projectId}/models`}>{t("threeD.project.bindings.openModels")}</Link></section>}
  </div>;
}
