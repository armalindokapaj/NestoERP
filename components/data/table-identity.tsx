"use client";

import * as React from "react";

import { useRecordNavigation } from "@/components/navigation/record-navigation-provider";
import { tabIdentity } from "@/lib/unsaved/tab-context";
import type { TableIdentity } from "@/lib/tables/preferences";

/**
 * Who and where a table's preferences belong to (AUD-08 §5, DT-08).
 *
 * The shell already tells the tab both, so nothing new is sent to the browser:
 * - the person is the opaque `identityKeys().user` digest that the unsaved-work
 *   host registers in `lib/unsaved/tab-context` (AUD-03 §7) — never the raw id;
 * - the workspace is `RecordNavigationProvider`'s key, which the shell keys the
 *   whole page by, so a workspace switch remounts every table under the new key
 *   and no choice of the old workspace is shown in the new one.
 *
 * `TableIdentityProvider` overrides both, for a surface outside the shell.
 * Outside the shell with no provider there is no identity: choices then last
 * for the page only and nothing is stored.
 */
const TableIdentityContext = React.createContext<TableIdentity | null>(null);

export function TableIdentityProvider({ identity, children }: { identity: TableIdentity; children: React.ReactNode }) {
  const value = React.useMemo(() => ({ user: identity.user, workspace: identity.workspace }), [identity.user, identity.workspace]);
  return <TableIdentityContext.Provider value={value}>{children}</TableIdentityContext.Provider>;
}

/**
 * The identity, or null until it is known. The tab-context store is written in
 * the shell's layout effect, which has run by the time any passive effect of
 * the page runs — so callers read this in an effect, never during render
 * (the server has no tab context, and a render-time read would mismatch).
 */
export function useTableIdentity(): () => TableIdentity | null {
  const explicit = React.useContext(TableIdentityContext);
  const navigation = useRecordNavigation();
  const workspace = navigation?.workspace.key ?? null;
  return React.useCallback(() => {
    if (explicit) return explicit;
    const user = tabIdentity()?.user ?? null;
    return user && workspace ? { user, workspace } : null;
  }, [explicit, workspace]);
}
