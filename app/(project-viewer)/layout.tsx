import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { ResponseBeats } from "@/components/navigation/reveal-watchdog";
import { requireUserContext } from "@/lib/context/current-user";
import { admitPage, getPageMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { nunitoSans, roboto } from "@/lib/fonts";

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
 * The viewer's typefaces load only here; [data-project-viewer] scopes its
 * look (styles/project-viewer.css).
 */
export default async function ProjectViewerLayout({ children }: { children: ReactNode }) {
  const maintenanceCandidate = getPageMaintenanceState();
  maintenanceCandidate.catch(() => undefined);
  await requireUserContext();
  const maintenance = await admitPage(maintenanceCandidate);
  if (maintenance.enabled) redirect("/maintenance");

  return (
    <div
      data-project-viewer
      className={`${nunitoSans.variable} ${roboto.variable} fixed inset-0 h-dvh w-screen overflow-hidden antialiased`}
    >
      <ResponseBeats />
      {children}
    </div>
  );
}
