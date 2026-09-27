"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { OrganizationMark } from "@/components/layout/organization-mark";
import Link from "@/components/navigation/nav-link";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import type { WorkspaceOption } from "@/components/layout/panels/workspace-panel-body";
import { useShellCore, useWorkspaceOptions } from "@/components/layout/shell-slots";
import { useSidebar } from "@/components/layout/sidebar-provider";
import { useWorkspaceSwitch } from "@/components/workspace/workspace-switch-provider";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createPanelLoader, usePanelModule, usePanelOpen, useWarmIntent } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";

/**
 * The organization and the workspace, at the top of the sidebar (OW §2-§18).
 *
 * It names the customer organization — the parent group, or a standalone
 * company — above the workspace being worked in: a company, or "Group
 * Workspace". Everything comes from the shell core the frame was drawn with;
 * nothing is fetched to draw it (§57). The mark is the tenant's logo, or its
 * initials (§12, §51).
 *
 * When there is somewhere else to work, the whole header is one button that
 * opens the workspace popup (§3, §14); otherwise it is identity only and
 * promises nothing (§46). Never an arrow, chevron or caret, in any state or
 * width (§4): the button's hover and open backgrounds say it can be pressed.
 *
 * It owns no access or switching rule (§10): the options are the server's
 * list, streamed with the shell, and choosing one hands it to the workspace
 * switch, which asks the server.
 *
 * Two presentations of one header: in the sidebar the popup is anchored beside
 * it, and a collapsed rail keeps the mark alone with both names in a tooltip
 * (§21, §47); in the phone and tablet navigation drawer it opens as a bottom
 * sheet (§48, §49).
 */

const body = createPanelLoader("workspace", () => import("@/components/layout/panels/workspace-panel-body"));

type Identity = {
  /** The organization: the group, or the company of a standalone tenant (§5, §8). */
  primary: string;
  /** The workspace: a company, "Group Workspace", or nothing for a standalone company (§7, §8). */
  secondary: string | null;
  /** The current workspace as a sentence names it (§52). */
  current: string;
  logoUrl: string | null;
  scope: "GROUP" | "COMPANY";
};

function useIdentity(): Identity {
  const t = useTranslations("workspace");
  const { activeWorkspace, organization } = useShellCore();
  const inGroup = activeWorkspace.scopeType === "GROUP";
  const group = t("groupWorkspaceName");
  return {
    primary: organization.standalone ? activeWorkspace.label : activeWorkspace.groupLabel,
    secondary: organization.standalone ? null : inGroup ? group : activeWorkspace.label,
    current: inGroup ? `${activeWorkspace.groupLabel} — ${group}` : activeWorkspace.label,
    logoUrl: organization.logoUrl,
    scope: activeWorkspace.scopeType,
  };
}

/** Whether the header opens anything: a choice the core promised, unless the list turned out to hold one (§45, §46). */
function useSwitchable(): boolean {
  const core = useShellCore();
  const { state } = useWorkspaceOptions();
  return core.workspaceChoice && !(state.status === "ready" && state.total < 2);
}

export function OrganizationWorkspaceHeader({
  variant,
  onSwitchStart,
}: {
  variant: "sidebar" | "drawer";
  /** The drawer closes as a switch starts, so the page's own progress is in view. */
  onSwitchStart?: () => void;
}) {
  const identity = useIdentity();
  const switchable = useSwitchable();
  if (!switchable) return <StaticHeader identity={identity} variant={variant} />;
  return variant === "sidebar" ? <SidebarHeader identity={identity} /> : <DrawerHeader identity={identity} onSwitchStart={onSwitchStart} />;
}

/**
 * The organization's mark in the phone and tablet top bar, where the sidebar is
 * folded into the drawer: the customer's identity rather than NESTO's (OW §5,
 * §6), and the way home. Dashboard is an approved destination, prepared on
 * intent like its navigation item (NAV-03 §7).
 */
export function OrganizationHomeMark({ label }: { label: string }) {
  const identity = useIdentity();
  return (
    // A 44px target under touch around the 32px mark (AUD-04 §4, MW-19).
    <Link href="/dashboard" intent aria-label={label} className="rounded-md touch:grid touch:size-11 touch:place-items-center" data-testid="organization-home">
      <OrganizationMark name={identity.primary} logoUrl={identity.logoUrl} size="sm" />
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* The header's face                                                          */
/* -------------------------------------------------------------------------- */

const faceClass =
  "flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left";

function Names({ identity, labels }: { identity: Identity; labels?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={labels} className="nesto-nav-label min-w-0 flex-1 leading-tight">
      <span data-testid="organization-name" className="block truncate text-body font-semibold text-fg">
        {identity.primary}
      </span>
      {identity.secondary ? (
        <span data-testid="workspace-label" className="mt-0.5 block truncate text-meta text-fg-muted">
          {identity.secondary}
        </span>
      ) : null}
    </span>
  );
}

function TooltipNames({ identity }: { identity: Identity }) {
  return (
    <span className="block max-w-72" data-testid="organization-tooltip">
      <span className="block font-semibold">{identity.primary}</span>
      {identity.secondary ? <span className="block opacity-80">{identity.secondary}</span> : null}
    </span>
  );
}

/** One workspace and nowhere else to go: the identity, and nothing that looks pressable (§46). */
function StaticHeader({ identity, variant }: { identity: Identity; variant: "sidebar" | "drawer" }) {
  const t = useTranslations("workspace");
  const { isRail } = useSidebar();
  const face = (
    <div
      role="group"
      aria-label={t("staticLabel", { name: identity.current })}
      data-testid="organization-header"
      data-options="single"
      data-scope={identity.scope}
      className={faceClass}
    >
      <OrganizationMark name={identity.primary} logoUrl={identity.logoUrl} />
      <Names identity={identity} />
    </div>
  );
  if (variant === "drawer" || !isRail) return face;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{face}</TooltipTrigger>
      <TooltipContent side="right">
        <TooltipNames identity={identity} />
      </TooltipContent>
    </Tooltip>
  );
}

/** The pressable header: hover and open backgrounds, the global focus ring, and a busy state while a switch runs (§15-§17). */
const HeaderButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & { identity: Identity; labels?: React.Ref<HTMLSpanElement>; busy: boolean; optionsState: string }
>(function HeaderButton({ identity, labels, busy, optionsState, className, ...props }, ref) {
  const t = useTranslations("workspace");
  return (
    <button
      ref={ref}
      type="button"
      aria-label={t("headerLabel", { name: identity.current })}
      aria-busy={busy || undefined}
      data-testid="organization-header"
      data-options={optionsState}
      data-scope={identity.scope}
      className={cn(faceClass, "cursor-pointer transition-colors hover:bg-hover aria-expanded:bg-hover aria-busy:cursor-progress", className)}
      {...props}
    >
      <OrganizationMark name={identity.primary} logoUrl={identity.logoUrl} />
      <Names identity={identity} labels={labels} />
    </button>
  );
});

/* -------------------------------------------------------------------------- */
/* Sidebar: an anchored popup                                                 */
/* -------------------------------------------------------------------------- */

function SidebarHeader({ identity }: { identity: Identity }) {
  const [open, setOpen] = usePanelOpen("workspace");
  const { isRail } = useSidebar();
  const { switchingTo } = useWorkspaceSwitch();
  const { state } = useWorkspaceOptions();
  const warm = useWarmIntent(body);
  const labels = React.useRef<HTMLSpanElement>(null);
  const [tip, setTip] = React.useState(false);
  const titleId = React.useId();

  // The rail shows both names on hover and focus (§47); a full sidebar only when a name is cut short (§50).
  const truncated = () => [...(labels.current?.children ?? [])].some((line) => line.scrollWidth > line.clientWidth);
  const tipOpen = tip && !open && (isRail || truncated());

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !switchingTo)}>
      <PopoverAnchor asChild>
        <div className="w-full min-w-0">
          <Tooltip open={tipOpen} onOpenChange={setTip}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <HeaderButton
                  identity={identity}
                  labels={labels}
                  busy={Boolean(switchingTo)}
                  optionsState={state.status}
                  {...warm}
                />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              <TooltipNames identity={identity} />
            </TooltipContent>
          </Tooltip>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        // Past the sidebar's edge: the anchor sits inside its 12px gutter (§21).
        sideOffset={20}
        aria-labelledby={titleId}
        data-testid="workspace-panel"
        className="flex max-h-[min(36rem,calc(100dvh-1rem))] w-[22rem] flex-col p-3"
        // The body focuses its own first control, with the current workspace active (§55).
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <WorkspacePopupContent open={open} titleId={titleId} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer: a bottom sheet                                                     */
/* -------------------------------------------------------------------------- */

function DrawerHeader({ identity, onSwitchStart }: { identity: Identity; onSwitchStart?: () => void }) {
  const t = useTranslations("workspace");
  const [open, setOpen] = React.useState(false);
  const { switchingTo } = useWorkspaceSwitch();
  const { state } = useWorkspaceOptions();
  const warm = useWarmIntent(body);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  return (
    <>
      <HeaderButton
        ref={trigger}
        identity={identity}
        busy={Boolean(switchingTo)}
        optionsState={state.status}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The drawer has no tooltip: a long name cut short on screen is whole in the name and the title (AUD-04 §4).
        title={identity.current}
        data-presentation="sheet"
        onClick={() => !switchingTo && setOpen(true)}
        {...warm}
      />
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          side="bottom"
          aria-describedby={undefined}
          data-testid="workspace-panel"
          className="bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DrawerTitle className="sr-only">{t("title")}</DrawerTitle>
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-line-strong" />
          <WorkspacePopupContent
            open={open}
            titleId={titleId}
            close={() => setOpen(false)}
            onSwitchStart={onSwitchStart}
          />
        </DrawerContent>
      </Drawer>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The popup's content                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the popup holds (§20-§27): the list once its code and options are in, a
 * named loading state before that, and a failure with Retry. Unsaved changes
 * are asked about by the switch itself, in the shared prompt (§37, AUD-03 §7).
 */
function WorkspacePopupContent({
  open,
  titleId,
  close,
  onSwitchStart,
}: {
  open: boolean;
  titleId: string;
  close: () => void;
  onSwitchStart?: () => void;
}) {
  const t = useTranslations("workspace");
  const { state: options, retry, retrying } = useWorkspaceOptions();
  const { state: code, retry: retryCode } = usePanelModule(body, open);
  const { switchTo } = useWorkspaceSwitch();
  const Body = code.status === "ready" ? code.module.WorkspacePanelBody : null;

  function commit(option: WorkspaceOption) {
    close();
    onSwitchStart?.();
    switchTo({ scopeType: option.scopeType, companyId: option.companyId, name: option.name });
  }

  function choose(option: WorkspaceOption) {
    if (option.isCurrent) {
      close();
      return;
    }
    // Never silently lose work (§37): the switch asks the tab's unsaved-work
    // coordinator before anything is sent, in the one shared prompt (AUD-03 §7).
    commit(option);
  }

  if (options.status === "failed") {
    return (
      <div data-testid="workspace-options-failed">
        <h2 id={titleId} className="px-1 text-card font-semibold text-fg">{t("title")}</h2>
        <p role="alert" className="px-1 pt-3 text-table text-fg-muted">{t("loadFailed")}</p>
        <div className="mt-3 flex gap-3 px-1">
          <button type="button" onClick={retry} disabled={retrying} className="text-table font-medium text-accent-strong hover:underline disabled:opacity-50" data-testid="workspace-options-retry">
            {t("retryLoad")}
          </button>
          <button type="button" onClick={close} className="text-table font-medium text-fg-muted hover:text-fg">
            {t("close")}
          </button>
        </div>
      </div>
    );
  }

  if (Body && options.status === "ready") return <Body workspaces={options.workspaces} choose={choose} titleId={titleId} />;

  return (
    <>
      <h2 id={titleId} className="px-1 text-card font-semibold text-fg">{t("title")}</h2>
      {code.status === "failed" ? (
        <PanelFailure kind="code" reloadAdvised={code.reloadAdvised} onRetry={retryCode} onClose={close} />
      ) : (
        <>
          <PanelLoading label={t("loadingOptions")} />
          {options.status === "pending" && options.overdue ? (
            <button type="button" onClick={retry} disabled={retrying} className="px-3 text-left text-table font-medium text-accent-strong hover:underline disabled:opacity-50" data-testid="workspace-options-retry">
              {t("retryLoad")}
            </button>
          ) : null}
        </>
      )}
    </>
  );
}
