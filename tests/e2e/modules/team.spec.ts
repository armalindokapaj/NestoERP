import { expect, test } from "@playwright/test";

import {
  db,
  removeTestDepartments,
  removeTestInvitations,
  resetTeamFixtures,
} from "../db";
import { expectAccessDenied, mainRegion, recordTable, signIn } from "../fixtures";

/**
 * The Team journey (PRD #14 §256–§280).
 */
const INVITE_PREFIX = "e2e-invite";
const DEPARTMENT_PREFIX = "E2E Department";

test.afterAll(async () => {
  await removeTestInvitations(INVITE_PREFIX);
  await removeTestDepartments(DEPARTMENT_PREFIX);
  await resetTeamFixtures();
  await db.$disconnect();
});

test.describe("Owner (PRD #14 §257)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "OWNER");
  });

  test("sees the directory and opens a member by membership id", async ({ page }) => {
    await page.goto("/team/people");

    const table = recordTable(page);
    await expect(table.getByText("architect@nesto.test")).toBeVisible();

    await table.getByRole("link", { name: /Anna Rossi/ }).click();
    // The canonical URL is the membership, not the user: the same person can
    // belong to several companies (PRD #14 §350).
    await page.waitForURL(/\/team\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Anna Rossi" })).toBeVisible();
    await expect(page.getByText("Architecture").first()).toBeVisible();
  });

  test("invites somebody and the invitation appears as pending", async ({ page }) => {
    await page.goto("/team/invite");

    const email = `${INVITE_PREFIX}-owner@nesto.test`;
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Role").selectOption({ label: "Viewer" });
    await page.getByRole("button", { name: "Send invitation" }).click();

    await expect(page.getByText(new RegExp(`Invitation (sent to|created for) ${email}`))).toBeVisible();

    await page.getByRole("link", { name: "View invitations" }).click();
    await page.waitForURL(/\/team\/invitations/);
    await expect(mainRegion(page).getByText(email)).toBeVisible();
  });

  test("cancels an invitation, and the link stops working", async ({ page }) => {
    await page.goto("/team/invite");

    const email = `${INVITE_PREFIX}-cancelled@nesto.test`;
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Role").selectOption({ label: "Viewer" });
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(new RegExp(email))).toBeVisible();

    await page.goto("/team/invitations");
    await page.getByRole("button", { name: `Cancel invitation for ${email}` }).click();
    await page.getByRole("button", { name: "Cancel invitation" }).click();

    await expect(page.getByText("Invitation cancelled.").first()).toBeVisible();

    const row = await db.companyInvite.findFirstOrThrow({ where: { email } });
    expect(row.status).toBe("CANCELLED");
  });

  test("creates a department and archives it again", async ({ page }) => {
    await page.goto("/team/departments/new");

    const name = `${DEPARTMENT_PREFIX} Facilities`;
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create department" }).click();

    await page.waitForURL(/\/team\/departments$/);
    await expect(recordTable(page).getByText(name)).toBeVisible();

    await recordTable(page).getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Archive department" }).click();
    await page.getByRole("button", { name: "Archive department" }).click();

    await expect(page.getByText("Department archived.").first()).toBeVisible();
    await expect(mainRegion(page).getByText(name)).toHaveCount(0);
  });

  test("cannot archive a department that still has members (PRD #14 §127)", async ({ page }) => {
    await page.goto("/team/departments");

    await recordTable(page).getByRole("button", { name: "Actions for Engineering" }).click();
    await page.getByRole("menuitem", { name: "Archive department" }).click();

    // The refusal is stated before the press, not discovered after it.
    await expect(page.getByText(/still assigned to this department/i)).toBeVisible();
  });

  test("cannot remove its own access (PRD #14 §167)", async ({ page }) => {
    await page.goto("/team/people");
    await recordTable(page).getByRole("link", { name: /Olivia Owner/ }).click();
    await page.waitForURL(/\/team\/[^/]+$/);

    // No self-service deactivation control is offered at all.
    await expect(page.getByRole("button", { name: /More actions for Olivia Owner/ })).toHaveCount(0);
  });
});

test.describe("Viewer (PRD #14 §259)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "VIEWER");
  });

  test("sees only the colleagues they share work with", async ({ page }) => {
    await page.goto("/team/people");

    const table = recordTable(page);
    await expect(table.getByText("viewer@nesto.test")).toBeVisible();
    // Finance shares no project with the Viewer, so they are simply absent.
    await expect(mainRegion(page).getByText("finance@nesto.test")).toHaveCount(0);
  });

  test("is offered no invite control", async ({ page }) => {
    await page.goto("/team/people");
    await expect(page.getByRole("link", { name: "Invite member" })).toHaveCount(0);
  });

  test("is refused the invite page directly", async ({ page }) => {
    await expectAccessDenied(page, "/team/invite");
  });

  test("is refused the invitations section", async ({ page }) => {
    await expectAccessDenied(page, "/team/invitations");
  });
});

test.describe("Invitation links (PRD #14 §240)", () => {
  test("every invalid token gets the same answer", async ({ page }) => {
    await page.goto("/invite/definitely-not-a-real-token");
    await expect(
      page.getByRole("heading", { name: "This invitation is no longer valid" }),
    ).toBeVisible();
  });

  test("a pending invitation for a new address offers account setup", async ({ page }) => {
    // The seed fixes this token so the flow can be walked without a mailbox.
    await page.goto("/invite/nesto-demo-pending-invite-token");

    await expect(page.getByRole("heading", { name: /Join Fixture Works/ })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("new-engineer@nesto.test");
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });

  test("an invitation for an existing account asks them to sign in, not for a password", async ({
    page,
  }) => {
    await page.goto("/invite/nesto-demo-existing-account-invite-token");

    await expect(page.getByRole("heading", { name: /Sign in to join/ })).toBeVisible();
    // Never a password field: the account is claimed by proving control of it.
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
