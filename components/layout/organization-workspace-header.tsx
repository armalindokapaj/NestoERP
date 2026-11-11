"use client";

import { ChevronDown } from "@/components/icons";
import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { OrganizationMark } from "@/components/layout/organization-mark";
import { PanelFailure, PanelLoading } from "@/components/layout/panels/panel-frame";
import type { WorkspaceOption } from "@/components/layout/panels/workspace-panel-body";
import { useShellCore, useWorkspaceOptions } from "@/components/layout/shell-slots";
import { useWorkspaceSwitch } from "@/components/workspace/workspace-switch-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createPanelLoader, usePanelModule, useWarmIntent } from "@/lib/navigation/panel-host";
import { cn } from "@/lib/utils/cn";

/**
 * The workspace: where it is named, and where it is switched (OW §2-§18).
 *
 * The header at the top of the logo's panel (components/layout/modules-panel.tsx),
 * drawn from the shell core the frame came with — nothing is fetched to draw it
 * (§57). It names the workspace being worked in — the company, or the group in
 * the Group workspace — beside its mark, the tenant's logo or the workspace's
 * initials (§12, §51). Where there is somewhere else to work it is the switch:
 * it opens the list in a popup under it, with a pointer on the header (§46,
 * §48, §49). The top bar's company name is Home (`HomeLink`, the same file as
 * the panel).
 *
 * None of them owns an access or switching rule (§10): the options are the
 * server's list, streamed with the shell, and choosing one hands it to the
 * workspace switch, which asks the server.
 */

const body = createPanelLoader("workspace", () => import("@/components/layout/panels/workspace-panel-body"));

type Identity = {
  /** The organization: the group, or the company of a standalone tenant (§5, §8). */
  primary: string;
  /** The current workspace as a sentence names it (§52). */
  current: string;
  /** The current workspace's own name, alone: the company, or the group in the Group workspace. */
  workspace: string;
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
    current: inGroup ? `${activeWorkspace.groupLabel} — ${group}` : activeWorkspace.label,
    workspace: activeWorkspace.label,
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
  onSwitchStart,
}: {
  /** The panel closes as a switch starts, so the page's own progress is in view. */
  onSwitchStart?: () => void;
}) {
  const identity = useIdentity();
  const switchable = useSwitchable();
  if (!switchable) return <StaticHeader identity={identity} />;
  return <DrawerHeader identity={identity} onSwitchStart={onSwitchStart} />;
}

/* -------------------------------------------------------------------------- */
/* The header's face                                                          */
/* -------------------------------------------------------------------------- */

const faceClass =
  "flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left";

/** The workspace's own name, alone. `switchable` adds a small chevron after it, so only a header that can switch looks like it can. */
function Names({ identity, switchable = false }: { identity: Identity; switchable?: boolean }) {
  return (
    <span className="nesto-nav-label flex min-w-0 flex-1 items-center gap-1.5 leading-tight">
      <span data-testid="workspace-label" className="block truncate font-semibold text-fg text-[0.8125rem] uppercase tracking-[0.08em] [font-family:var(--font-nesto-display),sans-serif] [font-variation-settings:'wdth'_100] leading-(--nesto-leading-body)">
        {identity.workspace}
      </span>
      {switchable ? <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" /> : null}
    </span>
  );
}

/** One workspace and nowhere else to go: the identity, and nothing that looks pressable (§46). */
function StaticHeader({ identity }: { identity: Identity }) {
  const t = useTranslations("workspace");
  return (
    <div
      role="group"
      aria-label={t("staticLabel", { name: identity.current })}
      data-testid="organization-header"
      data-options="single"
      data-scope={identity.scope}
      className={faceClass}
    >
      <OrganizationMark name={identity.workspace} logoUrl={identity.logoUrl} />
      <Names identity={identity} />
    </div>
  );
}

/** The pressable header: hover and open backgrounds, the global focus ring, and a busy state while a switch runs (§15-§17). */
const HeaderButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & { identity: Identity; busy: boolean; optionsState: string }
>(function HeaderButton({ identity, busy, optionsState, className, ...props }, ref) {
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
      <OrganizationMark name={identity.workspace} logoUrl={identity.logoUrl} />
      <Names identity={identity} switchable />
    </button>
  );
});

/* -------------------------------------------------------------------------- */
/* Phone and tablet drawer: the header is the switch                          */
/* -------------------------------------------------------------------------- */

/**
 * The pressable header of a phone's top bar and of the tablet's navigation
 * drawer. Its popup hangs under it — the platform's glass, with a pointer on
 * the header — like every popup on a touch layout (components/ui/popup-pointer.tsx).
 */
function DrawerHeader({ identity, onSwitchStart }: { identity: Identity; onSwitchStart?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const { switchingTo } = useWorkspaceSwitch();
  const { state } = useWorkspaceOptions();
  const warm = useWarmIntent(body);
  const titleId = React.useId();

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !switchingTo)}>
      <PopoverTrigger asChild>
        <HeaderButton
          identity={identity}
          busy={Boolean(switchingTo)}
          optionsState={state.status}
          aria-haspopup="dialog"
          // No tooltip on a touch layout: a long name cut short on screen is whole in the name and the title (AUD-04 §4).
          title={identity.current}
          data-presentation="popup"
          {...warm}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        aria-labelledby={titleId}
        data-testid="workspace-panel"
        className="flex max-h-[min(34rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-1.5rem))] flex-col p-3"
        // The body focuses its own first control, with the current workspace active (§55).
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <WorkspacePopupContent open={open} titleId={titleId} close={() => setOpen(false)} onSwitchStart={onSwitchStart} />
      </PopoverContent>
    </Popover>
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
