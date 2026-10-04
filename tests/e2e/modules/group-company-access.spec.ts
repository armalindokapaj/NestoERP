import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { DEMO_PASSWORD, signIn } from "../fixtures";

/**
 * Company access of a group seat (PRD #10 §101-§105, §132, §135): the picker in
 * Add User, Edit Access with its confirmations and discard prompt, and a seat
 * losing a company while signed in.
 */

const EMAIL = "e2e-pr10-sam@nesto.test";
const USERNAME = "e2e-pr10-sam";

async function groupId(): Promise<string> {
  return (await db.parentGroup.findUniqueOrThrow({ where: { slug: "nesto-demo-group" }, select: { id: true } })).id;
}

async function removeSam(): Promise<void> {
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

async function usersTab(page: Page) {
  await page.goto(`/admin/organizations/${await groupId()}?tab=users`);
  await expect(page.getByTestId("group-add-user")).toBeVisible();
}

const row = (page: Page) => page.getByTestId("group-person").filter({ hasText: "Sam Access" });

test.describe.configure({ mode: "serial" });

test.beforeAll(removeSam);
test.afterAll(async () => {
  await removeSam();
  await db.$disconnect();
});

test("Add User defaults to no company access, validates Selected, searches and saves", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  await usersTab(page);
  await page.getByTestId("group-add-user").click();
  const dialog = page.getByTestId("group-add-user-dialog");
  await expect(dialog.getByRole("radio", { name: /No companies/ })).toBeChecked();

  await dialog.getByLabel("First name").fill("Sam");
  await dialog.getByLabel("Last name").fill("Access");
  await dialog.getByLabel("Username").fill(USERNAME);
  await dialog.getByLabel("Email").fill(EMAIL);

  await dialog.getByRole("radio", { name: /Selected companies/ }).check();
  const picker = dialog.getByTestId("company-picker");
  await expect(picker.getByRole("checkbox", { name: /Aurelia Construction/ })).toBeVisible();

  // An empty selection is refused with the PRD's wording; nothing is created.
  await dialog.getByRole("button", { name: /add user|create user/i }).click();
  await expect(dialog.getByRole("alert")).toContainText(/Select at least one company/);
  expect(await db.user.count({ where: { email: EMAIL } })).toBe(0);

  // Search narrows to this group's companies; the count announces the selection.
  await picker.getByLabel("Search companies…").fill("Aurelia");
  await expect(picker.getByRole("checkbox", { name: /Meridian/ })).toHaveCount(0);
  await picker.getByRole("checkbox", { name: /Aurelia Construction/ }).check();
  await expect(picker.getByText("1 selected")).toBeVisible();
  if (process.env.PR10_SHOTS) await dialog.screenshot({ path: `${process.env.PR10_SHOTS}/add-user.png` });

  await dialog.getByRole("button", { name: /add user|create user/i }).click();
  await expect(page.getByText(/Default password|nesto1234/).first()).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await usersTab(page);
  await expect(row(page)).toContainText("1 company");
  const sam = await db.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const seat = await db.parentGroupMember.findFirstOrThrow({ where: { userId: sam.id } });
  expect(seat.companyAccessMode).toBe("SELECTED");
  expect(await db.parentGroupMemberCompany.count({ where: { seatId: seat.id } })).toBe(1);
});

test("Edit Access: a discard prompt on unsaved changes, a confirmation to widen, a confirmation to narrow", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN");
  await usersTab(page);

  const open = async () => {
    await row(page).getByTestId("group-person-actions").click();
    await page.getByRole("menuitem", { name: "Edit company access" }).click();
    const dialog = page.getByTestId("edit-access-dialog");
    await expect(dialog.getByRole("radio", { name: /Selected companies/ })).toBeChecked();
    return dialog;
  };

  // Unsaved: cancelling asks first, and staying keeps the form.
  let dialog = await open();
  await dialog.getByRole("radio", { name: /No companies/ }).check();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  if (process.env.PR10_SHOTS) await dialog.screenshot({ path: `${process.env.PR10_SHOTS}/discard.png` });
  await expect(dialog.getByText(/unsaved access changes/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByRole("radio", { name: /No companies/ })).toBeChecked();

  // Selected -> All widens: one confirmation, then it is saved.
  await dialog.getByRole("radio", { name: /All companies/ }).check();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alertdialog")).toContainText("Grant access to all companies?");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("edit-access-dialog")).toHaveCount(0);
  await expect(row(page)).toContainText("All companies");
  const sam = await db.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const all = await db.companyMember.count({ where: { userId: sam.id, groupDerived: true, status: "ACTIVE" } });
  expect(all).toBe(5);

  // All -> None narrows: confirmed, and the policy's memberships end.
  await page.reload();
  await row(page).getByTestId("group-person-actions").click();
  await page.getByRole("menuitem", { name: "Edit company access" }).click();
  dialog = page.getByTestId("edit-access-dialog");
  await expect(dialog.getByRole("radio", { name: /All companies/ })).toBeChecked();
  await dialog.getByRole("radio", { name: /No companies/ }).check();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alertdialog")).toContainText("Reduce company access?");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(row(page)).toContainText("None");
  expect(await db.companyMember.count({ where: { userId: sam.id, groupDerived: true, status: "ACTIVE" } })).toBe(0);
});

test("a seat that loses a company while signed in is moved off it on the next request", async ({ page, browser }) => {
  const sam = await db.user.findFirstOrThrow({ where: { email: EMAIL }, select: { id: true } });
  await db.user.update({ where: { id: sam.id }, data: { mustChangePassword: false } });
  const aurelia = await db.company.findFirstOrThrow({ where: { name: "Aurelia Construction" }, select: { id: true } });
  const seat = await db.parentGroupMember.findFirstOrThrow({ where: { userId: sam.id }, select: { id: true } });

  // Give Sam Aurelia through the policy, from the admin's own screen.
  await signIn(page, "PLATFORM_ADMIN");
  await usersTab(page);
  await row(page).getByTestId("group-person-actions").click();
  await page.getByRole("menuitem", { name: "Edit company access" }).click();
  let dialog = page.getByTestId("edit-access-dialog");
  await dialog.getByRole("radio", { name: /Selected companies/ }).check();
  await dialog.getByRole("checkbox", { name: /Aurelia Construction/ }).check();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(row(page)).toContainText("1 company");
  expect(await db.companyMember.count({ where: { userId: sam.id, companyId: aurelia.id, status: "ACTIVE" } })).toBe(1);

  // Sam signs in and works in the company.
  const context = await browser.newContext();
  const samPage = await context.newPage();
  await samPage.goto("/login");
  await samPage.getByLabel("Username").fill(USERNAME);
  await samPage.getByLabel("Password").fill(DEMO_PASSWORD);
  await samPage.locator("form").getByRole("button", { name: /sign in/i }).click();
  await samPage.waitForURL((url) => !url.pathname.startsWith("/login"));
  const before = await samPage.request.get("/api/me");
  expect(before.ok()).toBe(true);

  // The admin takes the company away.
  await row(page).getByTestId("group-person-actions").click();
  await page.getByRole("menuitem", { name: "Edit company access" }).click();
  dialog = page.getByTestId("edit-access-dialog");
  await dialog.getByRole("radio", { name: /No companies/ }).check();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(row(page)).toContainText("None");
  expect(await db.companyMember.count({ where: { userId: sam.id, companyId: aurelia.id, status: "ACTIVE" } })).toBe(0);
  expect(seat.id).toBeTruthy();

  // The next protected request is refused; the person lands somewhere valid, not on an error.
  const response = await samPage.goto("/dashboard");
  expect(response?.status()).toBeLessThan(500);
  await expect(samPage).not.toHaveURL(/\/dashboard$/);
  await context.close();
});
