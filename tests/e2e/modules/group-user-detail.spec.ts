import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { signIn } from "../fixtures";

/**
 * The group user drawer (PRD #11): it opens beside the table without leaving
 * the group, the address carries the person, Back closes it, a refresh reopens
 * it, and suspend / reactivate show in the drawer.
 */

const EMAIL = "e2e-pr11-gia@nesto.test";
const USERNAME = "e2e-pr11-gia";

async function groupId(): Promise<string> {
  return (await db.parentGroup.findUniqueOrThrow({ where: { slug: "nesto-demo-group" }, select: { id: true } })).id;
}

async function removeGia(): Promise<void> {
  const user = await db.user.findFirst({ where: { email: EMAIL }, select: { id: true, personProfileId: true } });
  if (!user) return;
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.authEvent.deleteMany({ where: { userId: user.id } });
  await db.departmentAssignment.deleteMany({ where: { userId: user.id } });
  await db.companyMember.deleteMany({ where: { userId: user.id } });
  await db.parentGroupMember.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  if (user.personProfileId) await db.personProfile.deleteMany({ where: { id: user.personProfileId } });
}

const usersUrl = async () => `/admin/organizations/${await groupId()}?tab=users`;
const drawer = (page: Page) => page.getByTestId("group-user-drawer");

test.describe.configure({ mode: "serial" });
test.beforeAll(removeGia);
test.afterAll(async () => { await removeGia(); await db.$disconnect(); });

test("opens in place, deep-links, closes with Back, and suspends and reactivates", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  await page.goto(await usersTab());
  await page.getByTestId("group-add-user").click();
  const add = page.getByTestId("group-add-user-dialog");
  await add.getByLabel("First name").fill("Gia");
  await add.getByLabel("Last name").fill("Detail");
  await add.getByLabel("Username").fill(USERNAME);
  await add.getByLabel("Email").fill(EMAIL);
  await add.getByRole("button", { name: /add user|create user/i }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await page.goto(await usersUrl());
  const origin = page.url();
  await page.getByRole("button", { name: "Open Gia Detail" }).click();
  await expect(drawer(page)).toContainText("Gia Detail");
  if (process.env.PR11_SHOTS) await page.screenshot({ path: `${process.env.PR11_SHOTS}/drawer.png` });
  await expect(drawer(page)).toContainText("Group IT");
  await expect(page).toHaveURL(/user=/);
  // Still the group's page: the table is behind the drawer and no global user page was visited.
  expect(page.url()).toContain("/admin/organizations/");
  await expect(drawer(page).getByTestId("group-user-companies")).toContainText("No company access");

  // Refresh reopens the same person.
  await page.reload();
  await expect(drawer(page)).toContainText("Gia Detail");

  await drawer(page).getByTestId("group-user-more").click();
  await page.getByRole("menuitem", { name: "Suspend Group Access" }).click();
  await page.getByTestId("group-user-dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(drawer(page)).toContainText(/group access is suspended/i);
  await expect(drawer(page).getByTestId("group-user-activity")).toContainText("Group access suspended");
  await drawer(page).getByRole("button", { name: "Reactivate Group Access" }).click();
  await expect(drawer(page).getByTestId("group-user-activity")).toContainText("Group access reactivated");

  await page.goBack();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Gia Detail" })).toBeVisible();
  expect(origin).toContain("tab=users");
});

async function usersTab() { return usersUrl(); }
