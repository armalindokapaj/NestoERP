import { DevUserSwitcherDialog } from "@/components/layout/dev-user-switcher-dialog";
import { auth } from "@/lib/auth";
import { demoRosters } from "@/lib/auth/demo-tenants";

/**
 * The top bar's demo user switcher (C-01 §14, §17, §41): the sign-in page's
 * roster, read from the same place, with the signed-in account marked.
 *
 * Its callers render it behind isDevMode only — the business top bar and the
 * Platform Admin's header, so a developer can move between the two (§78).
 */
export async function DevUserSwitcher() {
  const [rosters, session] = await Promise.all([demoRosters(), auth()]);
  return <DevUserSwitcherDialog rosters={rosters} currentUsername={session?.user?.username ?? null} />;
}
