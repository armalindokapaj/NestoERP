import { Layers3 } from "lucide-react";

import { requirePlatformContext } from "@/lib/context/platform-context";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";

export const metadata = { title: "3D Project Structure" };

export default async function ExperienceStructurePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const context = await requirePlatformContext();
  const workspace = await getProject3DWorkspace(context, projectId);
  return <section className="nesto-card p-5"><div className="flex items-start gap-3"><span className="rounded-lg bg-accent-soft p-2 text-accent-strong"><Layers3 className="size-5" /></span><div><h2 className="text-card font-semibold text-fg">Canonical Project structure</h2><p className="mt-1 text-body text-fg-muted">{workspace._count.buildings} buildings · {workspace._count.floors} floors · {workspace._count.units} units</p></div></div><p className="mt-5 rounded-lg border border-line bg-surface-muted p-4 text-table text-fg-muted">Structure management is attached to the canonical Project. Buildings, Floors, and Units created here become available to Unit Binding and the Company Project workspace immediately.</p></section>;
}
