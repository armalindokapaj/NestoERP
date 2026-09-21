import { WORKSPACE_CHANGED, type WorkspaceChange, type WorkspaceScopeType } from "@/config/workspace";

/**
 * The browser's half of a workspace switch (Workspace Context §67, §78).
 *
 * Client-safe: no server imports. The server decides; this only asks it and
 * announces the answer. Whatever is asked here is a request — the session is
 * the state (§14, §15).
 */

export type WorkspaceRequest = { scopeType: WorkspaceScopeType; companyId: string | null };

export async function requestWorkspaceSwitch(request: WorkspaceRequest): Promise<{ ok: true } | { ok: false }> {
  const response = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }).catch(() => null);
  if (!response?.ok) return { ok: false };

  const body = (await response.json().catch(() => null)) as { data?: { change?: WorkspaceChange } } | null;
  // The central event, for anything that must coordinate before the page reloads.
  if (body?.data?.change) window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: body.data.change }));
  return { ok: true };
}
