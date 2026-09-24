import type { WorkspaceScopeType } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import { quickCreateShellSummary, type QuickCreateShellDTO } from "@/lib/modules/quick-create/context-key";
import { quickCreateCandidates } from "@/lib/modules/quick-create/eligibility";
import { hasWorkspaceChoice } from "@/lib/workspace/workspace.service";

/**
 * What the shell frame needs before it can draw (NAV-02 API-01, COMPAT-01,
 * COMPAT-02) — and nothing it can draw later.
 *
 * Everything here comes from contexts the request already holds: the verified
 * session's own, and in the Group workspace the group's company contexts that
 * Group navigation needs anyway. The full workspace chooser, the other groups a
 * person belongs to and the critical banner are not here; they stream in their
 * own slots. Presentation data: nothing reads it back as proof of access.
 */

/** Whether the Group view can be entered from here: known at once in the Group workspace, streamed otherwise. */
export type GroupEntryCapability = { status: "pending" } | { status: "ready"; canEnter: boolean } | { status: "failed" };

export type ShellCoreDTO = {
  /** NAV-01's opaque UI namespace: the key every shell slot's answer is checked against. */
  contextKey: string;
  activeWorkspace: {
    scopeType: WorkspaceScopeType;
    parentGroupId: string;
    companyId: string | null;
    /** The workspace's own name, verified with the session: the chooser's label before its list arrives. */
    label: string;
    /** The parent group's name, the label's first line. */
    groupLabel: string;
  };
  /** Whether the switcher will offer a choice: its place is kept while it loads, and never drawn otherwise. */
  workspaceChoice: boolean;
  quickCreate: QuickCreateShellDTO;
  groupEntry: GroupEntryCapability;
};

export async function resolveShellCore(session: UserContext): Promise<ShellCoreDTO> {
  const inGroup = session.workspace.scopeType === "GROUP";
  // In a company workspace + Create is the session's own company: no group
  // contexts are loaded for it. In the Group workspace they are already
  // resolved, with the session, for Group navigation (COMPAT-02).
  const [groupContexts, workspaceChoice] = await Promise.all([inGroup ? resolveGroupContexts(session) : Promise.resolve([]), hasWorkspaceChoice(session)]);
  const candidates = quickCreateCandidates(session, groupContexts);
  const quickCreate = quickCreateShellSummary(session, candidates);
  return {
    contextKey: quickCreate.contextKey,
    activeWorkspace: {
      scopeType: session.workspace.scopeType,
      parentGroupId: session.parentGroupId,
      companyId: session.workspace.companyId,
      label: inGroup ? session.parentGroup.name : session.company.name,
      groupLabel: session.parentGroup.name,
    },
    workspaceChoice,
    quickCreate,
    // Standing in the Group view is what put this session there (§91).
    groupEntry: inGroup ? { status: "ready", canEnter: true } : { status: "pending" },
  };
}
