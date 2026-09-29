import type { ReactNode } from "react";

import { ResponseBeats } from "@/components/navigation/reveal-watchdog";
import { requirePlatformContext } from "@/lib/context/platform-context";

/**
 * Platform Admin's full-window Company viewer, at
 * /admin/3d/projects/[projectId]/viewer. Like the Experience Editor, this tree
 * never passes through the Platform Admin layout, so its guard runs here: a
 * company session goes where it belongs, a signed-out visitor to sign in.
 */
export default async function PlatformViewerLayout({ children }: { children: ReactNode }) {
  await requirePlatformContext();
  return (
    <div className="fixed inset-0 h-dvh w-screen overflow-hidden bg-neutral-900">
      <ResponseBeats />
      {children}
    </div>
  );
}
