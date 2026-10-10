"use client";

import * as React from "react";
import { X } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { WorkspacePopupContent } from "@/components/layout/organization-workspace-header";
import { useShellCore, useWorkspaceOptions } from "@/components/layout/shell-slots";
import { GlassPanel, type GlassPanelControl } from "@/components/ui/glass-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceSwitch } from "@/components/workspace/workspace-switch-provider";
import { createPanelLoader, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { organizationInitials } from "@/lib/workspace/branding";

/**
 * The workspace switcher: one button in a slim column at the far left, left of
 * the sidebar, showing the workspace being worked in. It opens the same glass
 * panel as search — growing out of the button — with the list of workspaces the
 * person may enter: the Group, then its companies. Choosing one hands it to the
 * same workspace switch the sidebar header used to open (OW §28-§36), so the
 * unsaved-work prompt, the in-place switch and the access rules are unchanged.
 *
 * Drawn only when the shell core says there is a choice, and only from 1024px;
 * below that the drawer's own workspace sheet is used.
 */

const body = createPanelLoader("workspace", () => import("@/components/layout/panels/workspace-panel-body"));

export function WorkspaceRail() {
  const t = useTranslations("workspace");
  const tu = useTranslations("ui");
  const core = useShellCore();
  const { activeWorkspace } = core;
  const [open, setOpen] = usePanelOpen("workspace");
  const { switchingTo } = useWorkspaceSwitch();
  const { state } = useWorkspaceOptions();
  const warm = useWarmIntent(body);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const controlRef = React.useRef<GlassPanelControl | null>(null);
  const titleId = React.useId();
  if (!core.workspaceChoice) return null;

  const close = () => (controlRef.current ? controlRef.current.close() : setOpen(false));
  const name = activeWorkspace.scopeType === "GROUP" ? activeWorkspace.groupLabel : activeWorkspace.label;

  return (
    <nav
      aria-label={t("railLabel")}
      data-testid="workspace-rail"
      data-shell-region
      className="fixed inset-y-0 left-0 z-40 hidden w-[var(--nesto-workspace-rail-w)] flex-col items-center border-r border-accent/25 bg-surface-muted py-3 lg:flex"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={t("railLabel")}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-busy={Boolean(switchingTo) || undefined}
            data-testid="organization-header"
            data-options={state.status}
            data-scope={activeWorkspace.scopeType}
            onClick={() => !switchingTo && setOpen(true)}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl bg-accent text-meta font-semibold text-accent-fg shadow-sm transition-all duration-200 hover:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-busy:cursor-progress"
            {...warm}
          >
            {organizationInitials(name)}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span className="block font-semibold">{t("railLabel")}</span>
          <span className="block opacity-80">{activeWorkspace.scopeType === "GROUP" ? `${activeWorkspace.groupLabel} — ${t("groupWorkspaceName")}` : activeWorkspace.label}</span>
        </TooltipContent>
      </Tooltip>

      <GlassPanel
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        controlRef={controlRef}
        title={t("railLabel")}
        maxWidth={480}
        testId="workspace-panel"
        header={
          <div className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
            <p className="text-card font-semibold text-fg">{t("railLabel")}</p>
            <button type="button" onClick={close} className="grid size-9 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg touch:size-11" aria-label={tu("close")}>
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [&_h2]:sr-only">
          <WorkspacePopupContent open={open} titleId={titleId} close={close} />
        </div>
      </GlassPanel>
    </nav>
  );
}
