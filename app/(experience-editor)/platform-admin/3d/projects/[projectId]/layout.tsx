import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requirePlatformContext } from "@/lib/context/platform-context";

/**
 * The Experience Editor's own layout (3D Editor PRD §8-§15, §180-§185).
 * Its only page is the editor, at /platform-admin/3d/projects/[projectId]/editor.
 *
 * The route group keeps the address under /platform-admin while this tree
 * never passes through the Platform Admin layout: no admin sidebar, top bar,
 * search or account controls are rendered around the editor, and none of
 * their data is loaded. Because that layout's guard is not inherited here, the
 * same guard runs here first — a company session goes where it belongs and a
 * signed-out visitor goes to sign in.
 *
 * The frame owns the whole window and never scrolls; only the editor's panels
 * do. The editor is dark whatever the reader's theme, and the scheme is set on
 * the document while this layout is mounted so that dialogs, menus and toasts,
 * which render outside the frame, match it. The rule leaves with the layout.
 */
export default async function ExperienceEditorLayout({ children }: { children: ReactNode }) {
  await requirePlatformContext();

  return (
    <div data-experience-editor className="fixed inset-0 h-dvh w-screen overflow-hidden bg-neutral-950 text-neutral-100 [color-scheme:dark]">
      <style>{":root:root{color-scheme:dark}body{background:#0a0a0a}"}</style>
      <ToastProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ToastProvider>
    </div>
  );
}
