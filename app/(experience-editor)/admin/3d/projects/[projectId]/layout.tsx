import { UnsavedHost } from "@/components/unsaved/unsaved-host";
import { identityKeys } from "@/lib/context/identity-key";
import type { ReactNode } from "react";

import { ModuleMessages } from "@/components/i18n/module-messages";
import { ResponseBeats } from "@/components/navigation/reveal-watchdog";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requirePlatformContext } from "@/lib/context/platform-context";

/**
 * The Experience Editor's own layout (3D Editor PRD §8-§15, §180-§185).
 * Its only page is the editor, at /admin/3d/projects/[projectId]/editor.
 *
 * The route group keeps the address under /admin while this tree
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
  const context = await requirePlatformContext();

  return (
    <div data-experience-editor className="fixed inset-0 h-dvh w-screen overflow-hidden bg-canvas text-fg [color-scheme:dark]">
      <style>{":root:root:root{color-scheme:dark}body{background:var(--nesto-canvas)}"}</style>
      {/* A refresh (a model finished preparing) is shown once its data lands (vercel/next.js#86151). */}
      <ResponseBeats />
      <UnsavedHost identity={identityKeys(context)} workspace={null} />
      {/* The panels shared with the admin pages (model ingestion, unit bindings, remove dialog) read their words from here. */}
      <ModuleMessages namespaces={["adminPlatform"]}>
        <ToastProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ToastProvider>
      </ModuleMessages>
    </div>
  );
}
