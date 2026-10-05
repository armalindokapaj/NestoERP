import type { ReactNode } from "react";

import { ModuleMessages } from "@/components/i18n/module-messages";

/**
 * The anonymous 3D viewer's layout (ADM-04A §7): full window, no NESTO shell,
 * no session required. The page checks the share address itself.
 */
export default function PublicViewerLayout({ children }: { children: ReactNode }) {
  return (
    <div data-project-viewer className={`fixed inset-0 overflow-hidden antialiased`}>
      <ModuleMessages namespaces={["threeD"]}>{children}</ModuleMessages>
    </div>
  );
}
