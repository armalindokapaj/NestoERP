import { expect, test } from "@playwright/test";

import { signIn, signOut, type DemoRole } from "../fixtures";

/**
 * The search bar holds one position for everyone (PRD #3 §18).
 *
 * The search bar leads the top bar's left zone, after nothing but the
 * navigation controls, so where it lands depends on the viewport and nothing
 * else. The fault this locks out is anything role-dependent creeping in ahead
 * of it or squeezing it: sized to their content, the zones once moved with the
 * length of the signed-in person's name, their role label and the landing
 * module's title, and six roles put the bar in six different places.
 *
 * Roles chosen for the spread of cluster widths: a short name and a short role
 * label against a long one of each.
 */
const ROLES: DemoRole[] = ["OWNER", "CEO", "QAQC", "VIEWER"];

test("the search bar sits in the same place whoever signs in", async ({ page }) => {
  const positions: { role: DemoRole; x: number; width: number }[] = [];

  for (const role of ROLES) {
    await signIn(page, role, { to: "/dashboard" });

    const search = page.locator("header").getByRole("button", { name: /^search projects/i });
    await expect(search).toBeVisible();

    const box = await search.boundingBox();
    expect(box, `no search bar for ${role}`).not.toBeNull();
    positions.push({ role, x: Math.round(box!.x), width: Math.round(box!.width) });

    await signOut(page);
  }

  const [first, ...rest] = positions;
  for (const position of rest) {
    expect(
      position,
      `${position.role} sees the search bar somewhere else than ${first.role}`,
    ).toEqual({ role: position.role, x: first.x, width: first.width });
  }

  // The bar keeps its full width too: a role whose account cluster squeezed it
  // narrower would still pass the position check on its left edge alone.
  expect(first.width).toBeGreaterThan(380);
});
