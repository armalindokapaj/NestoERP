import type { WorkspaceScopeType } from "@/config/workspace";
import { TAB_WORKSPACE_HEADER } from "@/lib/unsaved/outcome";

/**
 * What this tab renders — its workspace and its signed-in identity — as the
 * unsaved-work host last heard it from the shell (AUD-03 §7).
 *
 * The workspace travels with every state-changing request so the server can
 * refuse a write from a tab that still shows another workspace
 * (`lib/context/tab-workspace.ts`). Nothing here is a credential.
 */

export type TabWorkspace = {
  key: string;
  scopeType: WorkspaceScopeType;
  companyId: string | null;
  parentGroupId: string;
  name: string;
};

export type TabIdentity = { user: string; session: string };

let workspace: TabWorkspace | null = null;
let identity: TabIdentity | null = null;

/** `workspace` is null where the session has none (the platform administration area). */
export function setTabContext(next: { workspace: TabWorkspace | null; identity: TabIdentity }): void {
  workspace = next.workspace;
  identity = next.identity;
}

export function tabWorkspace(): TabWorkspace | null {
  return workspace;
}

export function tabIdentity(): TabIdentity | null {
  return identity;
}

/** Requests that change the context itself, or end it, are never refused for being stale. */
const EXEMPT = /^\/api\/(workspace|auth)(\/|$)/;

type Fetch = typeof fetch & { __nestoTabContext?: true };

/**
 * Adds the tab's workspace to same-origin, state-changing requests — the
 * app's own fetches and Next's server-action POSTs alike, since both go
 * through `window.fetch`. Installed once per document.
 */
export function installContextHeader(): void {
  if (typeof window === "undefined") return;
  const original = window.fetch as Fetch;
  if (original.__nestoTabContext) return;
  const wrapped: Fetch = function fetchWithTabContext(input: RequestInfo | URL, init?: RequestInit) {
    try {
      const key = workspace?.key;
      const request = input instanceof Request ? input : null;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (key && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const url = new URL(request ? request.url : String(input), window.location.href);
        if (url.origin === window.location.origin && !EXEMPT.test(url.pathname)) {
          const headers = new Headers(init?.headers ?? request?.headers);
          if (!headers.has(TAB_WORKSPACE_HEADER)) headers.set(TAB_WORKSPACE_HEADER, key);
          init = { ...init, headers };
        }
      }
    } catch {
      // The header is a safety net; a request is never blocked for lack of it.
    }
    return original.call(window, input, init);
  } as Fetch;
  wrapped.__nestoTabContext = true;
  window.fetch = wrapped;
}
