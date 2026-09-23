import { expect, test } from "@playwright/test";

import { roleModuleAccess } from "../../../config/role-defaults";
import { ROLE_KEYS, type RoleKey } from "../../../config/roles";
import { mainRegion, signIn, signOut } from "../fixtures";

/**
 * Sixteen-role acceptance over the PRD #38 surfaces (§111-§128).
 *
 * The same walk for every role — dashboard, bell, notification centre,
 * attention, preferences, search, logout — with the access expectations read
 * from the role matrix itself, so the suite asserts what the matrix says rather
 * than a second copy of it. Module navigation and denial per role are covered
 * by role-navigation.spec.ts; this suite checks that none of the new doors
 * (notifications, search, attention, discussion) opens a room the role's
 * modules keep shut.
 */

const noFinance = (role: RoleKey) => roleModuleAccess[role].finance.accessLevel === "NONE";
const noTasks = (role: RoleKey) => roleModuleAccess[role].tasks.accessLevel === "NONE";

// Platform Admin has no company workspace to walk: it signs in to the platform
// area, which the role walk in verify:roles covers (E-06 §19).
for (const role of ROLE_KEYS.filter((key) => key !== "PLATFORM_ADMIN")) {
  test(`${role}: the collaboration and notification surfaces work within the role's access`, async ({ page }) => {
    await signIn(page, role, { to: "/dashboard" });

    // The bell is real for every role and opens the one Activity Center (Activity Center §3, §9).
    await page.getByTestId("notification-bell").click();
    const panel = page.getByRole("dialog", { name: "Activity Center" });
    await expect(panel.getByRole("tab", { name: "Notifications" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "View all activity" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The old notification centre now lands on the Activity Center (§164).
    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/activity\?type=notifications/);
    await expect(page.getByRole("heading", { level: 1, name: "Activity Center" })).toBeVisible();

    // Preferences are personal: every role has them, and the safety lock holds.
    await page.goto("/settings/notifications");
    await expect(mainRegion(page).getByTestId("preference-hse").getByRole("switch", { name: /In the app/ })).toBeDisabled();

    // Search answers only from modules the role can open.
    await page.goto("/dashboard");
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByRole("combobox", { name: "Search NESTO" });
    await input.fill("INV-2026-001");
    if (noFinance(role)) {
      await expect(page.getByText(/Nothing you can open matches/)).toBeVisible();
    } else {
      // Finance access may still be scoped to projects the invoice is not on,
      // so either answer is correct here; what matters is that one arrives.
      await expect(
        page.getByRole("listbox", { name: "Search results" }).or(page.getByText(/Nothing you can open matches/)),
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // A task discussion never becomes a way in for a role without Tasks.
    if (noTasks(role)) {
      const response = await page.goto("/tasks/task_006");
      expect(response?.status() === 404 || /module-unavailable|access-denied/.test(page.url())).toBe(true);
    }

    await signOut(page);
  });
}
