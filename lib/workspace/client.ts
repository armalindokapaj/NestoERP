import { WORKSPACE_CHANGED, type WorkspaceChange, type WorkspaceScopeType } from "@/config/workspace";
import type { WorkspaceNavigationResult } from "@/lib/workspace/route-resolver";

export const WORKSPACE_CHANNEL = "nesto-workspace";

/**
 * This tab's id on the workspace channel. A BroadcastChannel message reaches
 * every other channel object of the origin — this tab's own WorkspaceSync
 * included — so a message says which tab sent it (NAV-01 QC-11).
 */
export const WORKSPACE_TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/** What the channel carries: the change, the sending tab, and whether that tab wants its own echo. */
export type WorkspaceChannelMessage = WorkspaceChange & { sourceTab?: string; echo?: boolean };
export const WORKSPACE_DIRTY_STATE_CHANGED = "NESTO_WORKSPACE_DIRTY_STATE_CHANGED";

export type WorkspaceRequest = {
  scopeType: WorkspaceScopeType;
  companyId: string | null;
  currentPathname?: string;
  currentSearch?: string;
};

export type WorkspaceSwitchData = {
  switched: boolean;
  change: WorkspaceChange;
  navigation: WorkspaceNavigationResult;
  workspaceVersion: number;
  workspaceKey: string;
  effectiveModuleKeys: string[];
};

export type WorkspaceSwitchResult =
  | { ok: true; data: WorkspaceSwitchData }
  /**
   * `ambiguous`: the request was sent but no answer came back (a timeout or a
   * dropped connection), so the server may already have switched. The caller
   * re-reads the canonical workspace before offering anything else (NAV-01 QC-11).
   */
  | { ok: false; stale?: boolean; ambiguous?: boolean };

let dirty = false;
let transitionId = 0;
let activeRequest: AbortController | null = null;

/** Forms use this shared contract instead of inventing per-page switch prompts. */
export function setWorkspaceDirtyState(isDirty: boolean): void {
  dirty = isDirty;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKSPACE_DIRTY_STATE_CHANGED, { detail: { isDirty } }));
  }
}

export function hasWorkspaceDirtyState(): boolean {
  return dirty;
}

export function confirmWorkspaceNavigation(message = "You have unsaved changes. Discard them and continue?"): boolean {
  if (!dirty || typeof window === "undefined") return true;
  return window.confirm(message);
}

function publish(change: WorkspaceChange, echo: boolean): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: change }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
    channel.postMessage({ ...change, sourceTab: WORKSPACE_TAB_ID, echo } satisfies WorkspaceChannelMessage);
    channel.close();
  }
}

/**
 * Goes on after this tab's own switch, made with `echoToThisTab: false`. The
 * destination is loaded as a new document, so nothing of the old workspace —
 * shell, list or client cache — survives under the new header (Workspace
 * Context §29, §93). The tab's own channel echo used to reload the page it was
 * leaving, racing the router's navigation, and the tab landed back where it
 * started; loading the destination here makes it land where the switch said
 * (NAV-01 NAV-04, QC-11).
 */
export function openInSwitchedWorkspace(destination: string, { replace = false }: { replace?: boolean } = {}): void {
  leavingForSwitch = true;
  if (replace) window.location.replace(destination);
  else window.location.assign(destination);
}

let leavingForSwitch = false;
if (typeof window !== "undefined") {
  // A page restored from the back/forward cache is not leaving any more.
  window.addEventListener("pageshow", () => {
    leavingForSwitch = false;
  });
}

let switchingInPlace = false;

/**
 * Set while this tab switches its workspace without a document load (OW §34):
 * from the request until the new workspace's shell and page have committed.
 * Nothing is prepared for the old workspace in the meantime.
 */
export function setWorkspaceSwitchInPlace(active: boolean): void {
  switchingInPlace = active;
}

export function isWorkspaceSwitchInPlace(): boolean {
  return switchingInPlace;
}

/**
 * True while this tab loads the destination of its own switch. The switch
 * already asked about unsaved changes (`confirmWorkspaceNavigation`), so a
 * form that answers to that question does not ask the browser to ask again:
 * one prompt for one action (NAV-01 NAV-05).
 */
export function isLeavingForWorkspaceSwitch(): boolean {
  return leavingForSwitch;
}

/** Only the newest response may commit in this tab. */
export async function requestWorkspaceSwitch(
  request: WorkspaceRequest,
  options: {
    publishChange?: boolean;
    timeoutMs?: number;
    /** The caller already asked about unsaved changes for this same action; ask once, not twice (NAV-05). */
    confirmed?: boolean;
    /**
     * `false`: this tab goes on to its destination itself
     * (`openInSwitchedWorkspace`), so its WorkspaceSync must not reload the
     * page it is leaving underneath that navigation. Other tabs still reload
     * as before (NAV-01 QC-11).
     */
    echoToThisTab?: boolean;
  } = {},
): Promise<WorkspaceSwitchResult> {
  if (!options.confirmed && !confirmWorkspaceNavigation()) return { ok: false };

  const mine = ++transitionId;
  const serverTransitionId = Date.now() * 1000 + (mine % 1000);
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const currentPathname = request.currentPathname ?? (typeof window === "undefined" ? "/dashboard" : window.location.pathname);
  const currentSearch = request.currentSearch ?? (typeof window === "undefined" ? "" : window.location.search);

  const timer = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
  const response = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, currentPathname, currentSearch, transitionId: serverTransitionId }),
    signal: controller.signal,
  }).catch(() => null);
  if (timer) clearTimeout(timer);

  if (mine !== transitionId) return { ok: false, stale: true };
  // Sent, but unanswered: it may have committed on the server.
  if (!response) return { ok: false, ambiguous: true };
  if (!response.ok) return { ok: false };
  const body = (await response.json().catch(() => null)) as { data?: WorkspaceSwitchData } | null;
  if (!body?.data?.change || !body.data.navigation) return { ok: false };

  dirty = false;
  if (options.publishChange !== false) publish(body.data.change, options.echoToThisTab !== false);
  return { ok: true, data: body.data };
}
