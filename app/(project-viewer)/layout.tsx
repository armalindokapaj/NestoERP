import { UnsavedHost } from "@/components/unsaved/unsaved-host";
import { identityKeys } from "@/lib/context/identity-key";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { ModuleMessages } from "@/components/i18n/module-messages";
import { ResponseBeats } from "@/components/navigation/reveal-watchdog";
import { requireUserContext } from "@/lib/context/current-user";
import { admitPage, getPageMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";

/**
 * The Company Project viewer's own layout: an immersive, full-window 3D
 * viewer (the Rozaris project viewer, ported), with no NESTO sidebar or top
 * bar around it. Its only page is /projects/[projectId]/3d.
 *
 * The route group keeps the address under /projects while this tree never
 * passes through the application shell, the same arrangement as the Platform
 * Experience Editor. Because the shell's layout is not inherited here, its
 * guards run here first: a signed-out visitor goes to sign in, and maintenance
 * sends everyone where it sends every other signed-in page. Project access is
 * the page's own check.
 *
 * [data-project-viewer] scopes its dark NESTO look (styles/project-viewer.css).
 */
export default async function ProjectViewerLayout({ children }: { children: ReactNode }) {
  const maintenanceCandidate = getPageMaintenanceState();
  maintenanceCandidate.catch(() => undefined);
  const context = await requireUserContext();
  const maintenance = await admitPage(maintenanceCandidate);
  if (maintenance.enabled) redirect("/maintenance");

  return (
    <div
      data-project-viewer
      className={`fixed inset-0 overflow-hidden antialiased`}
    >
      <ResponseBeats />
      <UnsavedHost identity={identityKeys(context)} workspace={null} />
      <ModuleMessages namespaces={["threeD"]}>{children}</ModuleMessages>
    </div>
  );
}
