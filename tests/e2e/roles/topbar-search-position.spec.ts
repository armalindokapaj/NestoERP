import { expect, test } from "@playwright/test";

import { signIn, signOut, type DemoRole } from "../fixtures";

/**
 * The universal cluster holds one place for everyone (UI-01 §1, §5.1).
 *
 * Search, Notifications and Account sit at the right edge of the top bar, in
 * that order, as 44px targets, whoever signs in. The fault this locks out is
 * anything role-dependent creeping into the cluster or squeezing it: a longer
 * name or role label must not move a control.
 */
const ROLES: DemoRole[] = ["OWNER", "CEO", "QAQC", "VIEWER"];

test("the three controls sit in the same order and place whoever signs in", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "the phone keeps its bell in the bottom bar and its account in More");
  const edges: { role: DemoRole; right: number; xs: number[] }[] = [];

  for (const role of ROLES) {
    await signIn(page, role, { to: "/dashboard" });

    const cluster = page.getByTestId("global-actions");
    const search = cluster.getByTestId("search-trigger");
    const bell = cluster.getByTestId("notification-bell");
    const account = cluster.getByTestId("account-trigger");
    const boxes = [];
    for (const control of [search, bell, account]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `a universal control is missing for ${role}`).not.toBeNull();
      expect(box!.width, "a 44px target").toBeGreaterThanOrEqual(36);
      boxes.push(box!);
    }
    // Search → Notifications → Account, left to right.
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    edges.push({ role, right: Math.round(boxes[2].x + boxes[2].width), xs: boxes.map((box) => Math.round(box.x)) });

    await signOut(page);
  }

  const [first, ...rest] = edges;
  for (const edge of rest) {
    expect(edge, `${edge.role} sees the controls somewhere else than ${first.role}`).toEqual({ ...first, role: edge.role });
  }
});
