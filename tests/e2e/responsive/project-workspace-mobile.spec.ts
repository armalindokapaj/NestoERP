import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

test("the Project workspace stacks cover, experiences, and summary on mobile", async ({ page }) => {
  await signIn(page, "PM_B", { to: "/projects/project_b" });

  const cover = page.getByRole("img", { name: "Central Office Tower cover render" });
  const renders = page.getByRole("link", { name: /view renders/i });
  const summary = page.getByRole("heading", { name: "Project summary" });
  await expect(cover).toBeVisible();
  await expect(renders).toBeVisible();
  await expect(summary).toBeVisible();

  const [coverBox, rendersBox, summaryBox] = await Promise.all([cover.boundingBox(), renders.boundingBox(), summary.boundingBox()]);
  expect(coverBox).not.toBeNull();
  expect(rendersBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(rendersBox!.y).toBeGreaterThan(coverBox!.y);
  expect(summaryBox!.y).toBeGreaterThan(rendersBox!.y);
});
