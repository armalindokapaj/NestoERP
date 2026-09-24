import { expect, test } from "@playwright/test";

import { mainRegion, signIn, signOut } from "../fixtures";

/**
 * Interface language is a personal choice every role can make from Settings.
 *
 * The choice lives in a cookie, and each Playwright test gets a fresh browser
 * context, so switching to Albanian here cannot leak into another spec.
 */
test("an Engineer switches NESTO to Albanian and back from Settings", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/settings" });

  const nav = () => page.getByRole("navigation", { name: /^(Main navigation|Navigimi kryesor)$/ }).first();
  const html = page.locator("html");

  await expect(html).toHaveAttribute("lang", "en");
  await expect(nav().getByRole("link", { name: "Tasks", exact: true })).toBeVisible();

  await mainRegion(page).getByRole("radio", { name: "Shqip" }).click();

  // The page, the sidebar and the account menu all come back in Albanian
  // without a reload, and the choice is marked as selected.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cilësimet");
  await expect(nav().getByRole("link", { name: "Detyrat", exact: true })).toBeVisible();
  await expect(mainRegion(page).getByRole("radio", { name: "Shqip" })).toHaveAttribute("aria-checked", "true");
  await expect(html).toHaveAttribute("lang", "sq");

  await page.getByRole("button", { name: "Hap menunë e përdoruesit" }).click();
  await expect(page.getByRole("menuitem", { name: "Cilësimet" })).toBeVisible();
  // The identity block opens the person's own Profile, and says so in Albanian too.
  await expect(page.getByTestId("user-menu-profile")).toHaveAccessibleName(/Profili im$/);
  await expect(page.getByRole("menuitem", { name: "Dil" })).toBeVisible();
  await page.keyboard.press("Escape");

  // It survives a full load of another page.
  await page.goto("/settings/appearance");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pamja");

  // And the way back is labelled in its own language.
  await page.goto("/settings");
  await mainRegion(page).getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(nav().getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
  await expect(html).toHaveAttribute("lang", "en");

  await signOut(page);
});
