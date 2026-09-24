"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Building2, ChevronDown, Layers, Loader2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { openInSwitchedWorkspace, requestWorkspaceSwitch } from "@/lib/workspace/client";
import type { WorkspaceCompanyDTO, WorkspacesDTO } from "@/lib/workspace/workspace.service";
import { cn } from "@/lib/utils/cn";

export type WorkspaceOption =
  | { key: "group"; scopeType: "GROUP"; companyId: null; name: string; isCurrent: boolean }
  | { key: string; scopeType: "COMPANY"; companyId: string; name: string; isCurrent: boolean; company: WorkspaceCompanyDTO; groupName: string | null };

/**
 * The workspace switcher (Workspace Context §5, §9, §49-§53).
 *
 * One control for where the person works: the parent group first — always the
 * top option, and visually the strongest, when they have group-level standing —
 * then the companies they may enter. It replaces the company switcher.
 *
 * Choosing an entry asks the server (POST /api/workspace), which validates it
 * against the person's own access; the browser's choice is a request, never
 * state (§14, §15). On success the whole page is loaded again behind a
 * "switching" cover: no dashboard, sidebar or list of the old workspace — and
 * no client cache — survives to sit under the new header (§29, §93). A failure
 * keeps the previous workspace and says so (§89).
 *
 * Keyboard: the search field owns focus (a combobox over a listbox), the arrow
 * keys move, Enter chooses, Escape closes (§52). On a phone it is a bottom
 * sheet, on a desktop a panel under the button (§53).
 */
const body = createPanelLoader("workspace", () => import("@/components/layout/panels/workspace-panel-body"));

export function WorkspaceSwitcher({ workspaces }: { workspaces: WorkspacesDTO }) {
  const t = useTranslations("workspace");
  const toast = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = usePanelOpen("workspace");
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);
  const warm = useWarmIntent(body);
  const { state: code, retry: retryCode } = usePanelModule(body, open);
  const Body = code.status === "ready" ? code.module.WorkspacePanelBody : null;

  const { parentGroup, active: current } = workspaces;
  const inGroup = current.scopeType === "GROUP";
  const currentCompany = workspaces.companies.find((company) => company.id === current.companyId)
    ?? workspaces.otherGroups.flatMap((group) => group.companies).find((company) => company.id === current.companyId);
  const currentName = inGroup ? parentGroup.name : (currentCompany?.name ?? parentGroup.name);

  React.useEffect(() => {
    setSwitchingTo(null);
  }, [current.scopeType, current.companyId]);

  // Nothing to choose between: one company and no group to enter.
  const total = (parentGroup.groupViewAllowed ? 1 : 0) + workspaces.companies.length + workspaces.otherGroups.reduce((sum, group) => sum + group.companies.length, 0);
  if (total < 2) return null;

  async function choose(option: WorkspaceOption) {
    if (switchingTo) return;
    if (option.isCurrent) {
      setOpen(false);
      return;
    }
    setSwitchingTo(option.name);
    const result = await requestWorkspaceSwitch({
      scopeType: option.scopeType,
      companyId: option.companyId,
      currentPathname: pathname,
      currentSearch: searchParams.size ? `?${searchParams.toString()}` : "",
    }, { echoToThisTab: false });
    if (!result.ok) {
      if (result.stale) return;
      setSwitchingTo(null);
      setOpen(false);
      toast({ title: t("switchFailed", { name: currentName }), tone: "danger" });
      return;
    }
    setOpen(false);
    const navigation = result.data.navigation;
    if (navigation.reason === "RECORD_NOT_AVAILABLE") {
      toast({ title: t("recordFallback", { name: option.name }) });
    } else if (navigation.resolution !== "KEEP_EXACT") {
      toast({ title: t("moduleFallback", { name: option.name }) });
    }

    openInSwitchedWorkspace(navigation.destination, { replace: true });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={setOpen}
      >
        <DialogTrigger
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover data-[state=open]:bg-hover"
          aria-label={t("switcherLabel", { name: inGroup ? `${parentGroup.name} — ${t("groupWorkspaceName")}` : currentName })}
          data-testid="workspace-switcher"
          data-scope={current.scopeType}
          disabled={Boolean(switchingTo)}
          {...warm}
        >
          {inGroup ? (
            <Layers aria-hidden="true" className="size-4 shrink-0 text-accent-strong" />
          ) : (
            <Building2 aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
          )}
          <span className="hidden min-w-0 flex-col leading-tight xl:flex">
            <span className="max-w-[11rem] truncate text-micro text-fg-subtle">{parentGroup.name}</span>
            <span className="max-w-[11rem] truncate text-table font-medium text-fg" data-testid="workspace-label">
              {inGroup ? t("groupWorkspaceName") : currentName}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
        </DialogTrigger>

        <DialogContent
          data-testid="workspace-panel"
          className={cn(
            "flex max-h-[80dvh] flex-col gap-3 p-4",
            // A panel under the button on a desktop (§53)…
            "sm:left-auto sm:right-6 sm:top-16 sm:w-[22rem] sm:max-w-none sm:translate-x-0 sm:translate-y-0",
            // …and a bottom sheet, full width, on a phone.
            "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl",
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {Body ? (
            <Body workspaces={workspaces} choose={(option) => void choose(option)} />
          ) : (
            <>
              <DialogTitle>{t("title")}</DialogTitle>
              {code.status === "failed" ? <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={() => setOpen(false)} /> : <PanelLoading label={t("title")} />}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Over everything while the next workspace loads, so nothing of this one
          can be read or clicked under the new header (§29). In a portal: the
          top bar's own blur would otherwise contain it. */}
      {switchingTo && typeof document !== "undefined"
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              data-testid="workspace-switching"
              className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-canvas/95 backdrop-blur-sm"
            >
              <Loader2 aria-hidden="true" className="size-6 animate-spin text-accent-strong" />
              <p className="text-body font-medium text-fg">{t("switching", { name: switchingTo })}</p>
              <div aria-hidden="true" className="w-64 space-y-2">
                <div className="h-3 animate-pulse rounded bg-surface-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-surface-muted" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-surface-muted" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
