import { WORKSPACE_CHANGED, type WorkspaceChange, type WorkspaceScopeType } from "@/config/workspace";
import type { WorkspaceNavigationResult } from "@/lib/workspace/route-resolver";

export const WORKSPACE_CHANNEL = "nesto-workspace";
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
  | { ok: false; stale?: boolean };

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

function publish(change: WorkspaceChange): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: change }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(WORKSPACE_CHANNEL);
    channel.postMessage(change);
    channel.close();
  }
}

/** Only the newest response may commit in this tab. */
export async function requestWorkspaceSwitch(
  request: WorkspaceRequest,
  options: { publishChange?: boolean } = {},
): Promise<WorkspaceSwitchResult> {
  if (!confirmWorkspaceNavigation()) return { ok: false };

  const mine = ++transitionId;
  const serverTransitionId = Date.now() * 1000 + (mine % 1000);
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const currentPathname = request.currentPathname ?? (typeof window === "undefined" ? "/dashboard" : window.location.pathname);
  const currentSearch = request.currentSearch ?? (typeof window === "undefined" ? "" : window.location.search);

  const response = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, currentPathname, currentSearch, transitionId: serverTransitionId }),
    signal: controller.signal,
  }).catch(() => null);

  if (mine !== transitionId) return { ok: false, stale: true };
  if (!response?.ok) return { ok: false };
  const body = (await response.json().catch(() => null)) as { data?: WorkspaceSwitchData } | null;
  if (!body?.data?.change || !body.data.navigation) return { ok: false };

  dirty = false;
  if (options.publishChange !== false) publish(body.data.change);
  return { ok: true, data: body.data };
}
