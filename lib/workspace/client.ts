import { WORKSPACE_CHANGED, type WorkspaceChange, type WorkspaceScopeType } from "@/config/workspace";
import { unsaved, type Approval } from "@/lib/unsaved/coordinator";
import { tabWorkspace } from "@/lib/unsaved/tab-context";
import type { WorkspaceNavigationResult } from "@/lib/workspace/route-resolver";

export const WORKSPACE_CHANNEL = "nesto-workspace";

/**
 * This tab's id on the workspace channel. A BroadcastChannel message reaches
 * every other channel object of the origin — this tab's own WorkspaceSync
 * included — so a message says which tab sent it (NAV-01 QC-11).
 */
export const WORKSPACE_TAB_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/**
 * What the channel carries: the change, the sending tab, whether that tab
 * wants its own echo, and the destination's name for a tab that must explain
 * the change to somebody with unsaved work (AUD-03 §7).
 */
export type WorkspaceChannelMessage = WorkspaceChange & { sourceTab?: string; echo?: boolean; targetName?: string };

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
   * `cancelled`: the person chose to stay with their unsaved changes, so
   * nothing was sent — not a failure to report (AUD-03 §7).
   */
  | { ok: false; stale?: boolean; ambiguous?: boolean; cancelled?: boolean };

let transitionId = 0;
let activeRequest: AbortController | null = null;

function publish(change: WorkspaceChange, echo: boolean, targetName?: string): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: change }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
    channel.postMessage({ ...change, sourceTab: WORKSPACE_TAB_ID, echo, targetName } satisfies WorkspaceChannelMessage);
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
 * True while this tab loads the destination of its own switch — the tab is
 * busy, so nothing is prefetched for the page it is leaving (NAV-03).
 */
export function isLeavingForWorkspaceSwitch(): boolean {
  return leavingForSwitch;
}

type SwitchOptions = {
  publishChange?: boolean;
  timeoutMs?: number;
  /**
   * The departure the caller already had approved for this same action — one
   * question for one action (NAV-05). Without one, this asks the tab's
   * unsaved-work coordinator itself. There is no boolean way past the question:
   * an approval is one-shot and bound to the editors it was given for (AUD-03 §4).
   */
  approval?: Approval;
  /** An approval an earlier step of the same flow obtained (Quick Create asks once, at launch). */
  prior?: Approval;
  /** The destination's name, for the question and for other tabs' notices. */
  targetName?: string;
  /**
   * `false`: this tab goes on to its destination itself
   * (`openInSwitchedWorkspace`), so its WorkspaceSync must not reload the
   * page it is leaving underneath that navigation. Other tabs still reload
   * as before (NAV-01 QC-11).
   */
  echoToThisTab?: boolean;
};

/**
 * Switches the session's workspace. Asks about unsaved work before anything is
 * sent (AUD-03 §7): Stay sends nothing, and Save and continue has saved in the
 * original workspace before the switch is requested. Only the newest response
 * may commit in this tab.
 */
export async function requestWorkspaceSwitch(request: WorkspaceRequest, options: SwitchOptions = {}): Promise<WorkspaceSwitchResult> {
  const approval = options.approval ?? (await unsaved.requestDeparture({ kind: "workspace", target: options.targetName ?? "" }, { prior: options.prior }));
  if (!approval || approval.intent.kind !== "workspace") return { ok: false, cancelled: true };
  // Used once, here: a second switch needs a second approval.
  if (!approval.run(() => undefined)) return { ok: false, cancelled: true };
  const result = await postSwitch(request, options);
  // A refused, superseded or unanswered switch leaves the editors where they
  // are, protected again. An unanswered one may yet have switched: the caller
  // reconciles, and keeps the page covered meanwhile.
  if (!result.ok) approval.release();
  return result;
}

/**
 * Puts the session back into the workspace this tab renders, after another tab
 * moved it while this one held unsaved work (AUD-03 §7). It can only go to what
 * the tab already shows, so it destroys nothing here and needs no approval; the
 * server authorizes it like any switch, and the other tabs follow it.
 */
export async function restoreTabWorkspace(): Promise<boolean> {
  const workspace = tabWorkspace();
  if (!workspace) return false;
  const result = await postSwitch(
    { scopeType: workspace.scopeType, companyId: workspace.companyId },
    { echoToThisTab: false, targetName: workspace.name, timeoutMs: 15_000 },
  );
  return result.ok && result.data.workspaceKey === workspace.key;
}

async function postSwitch(request: WorkspaceRequest, options: SwitchOptions): Promise<WorkspaceSwitchResult> {
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

  if (options.publishChange !== false) publish(body.data.change, options.echoToThisTab !== false, options.targetName);
  return { ok: true, data: body.data };
}
