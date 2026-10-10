import { expect, test } from "../pw";

import { GROUP_DEPARTMENTS } from "../../../config/group-departments";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { removePlatformGroup } from "../platform-fixtures";

/**
 * Group and company departments in a browser (E-13 §124-§127, ADR 0003).
 *
 * The Owner creates a department, activates it in a company, appoints its
 * manager, adds a member and finds it on the company's own departments page.
 * The head of Group Finance adds somebody to a company's Finance team; Forma's
 * Finance manager adds somebody to their own branch and cannot open another
 * company's. The Platform Admin sets up a new company with only the departments
 * it needs, and staffs one.
 */

test.describe.configure({ mode: "serial" });

const GROUP = "group_demo_nesto";
const CODE = "E2EFAC";
const PLATFORM_GROUP = "e2e-north-group";
const startedAt = new Date();

const nameOf = async (username: string) => {
  const user = await db.user.findUniqueOrThrow({ where: { username }, select: { firstName: true, lastName: true, personProfile: { select: { jobTitle: true } } } });
  const name = `${user.firstName} ${user.lastName}`;
  return { name, label: [name, user.personProfile?.jobTitle].filter(Boolean).join(" · ") };
};

test.beforeAll(async () => {
  await removePlatformGroup(PLATFORM_GROUP);
});

test.afterAll(async () => {
  const created = await db.groupDepartment.findMany({ where: { parentGroupId: GROUP, code: CODE }, select: { id: true } });
  const ids = created.map((row) => row.id);
  await db.notificationEventOutbox.deleteMany({ where: { createdAt: { gte: startedAt }, eventType: { startsWith: "DEPARTMENT_" } } });
  await db.notification.deleteMany({ where: { createdAt: { gte: startedAt }, eventType: { startsWith: "DEPARTMENT_" } } });
  await db.auditEvent.deleteMany({ where: { occurredAt: { gte: startedAt }, moduleKey: "organization", entityType: "GroupDepartment" } });
  const branches = await db.department.findMany({ where: { groupDepartmentId: { in: ids } }, select: { id: true } });
  await db.companyMember.updateMany({ where: { departmentId: { in: branches.map((row) => row.id) } }, data: { departmentId: null } });
  await db.departmentAssignment.deleteMany({ where: { createdAt: { gte: startedAt }, parentGroupId: GROUP } });
  await db.department.deleteMany({ where: { id: { in: branches.map((row) => row.id) } } });
  await db.groupDepartment.deleteMany({ where: { id: { in: ids } } });
  await removePlatformGroup(PLATFORM_GROUP);
  await db.$disconnect();
});

test("the Owner creates a department, activates it, staffs it and finds it on the company's page (§39, §40, §124)", async ({ page }) => {
  const manager = await nameOf("pm-a");
  await signIn(page, "OWNER", { to: "/organization/departments" });
  await mainRegion(page).getByRole("button", { name: "New department" }).click();
  const create = page.getByTestId("new-department-dialog");
  await create.getByRole("textbox", { name: /^Name/ }).fill("E2E Facilities");
  await create.getByRole("textbox", { name: /^Code/ }).fill(CODE.toLowerCase());
  await create.getByRole("button", { name: "Create department" }).click();
  await mainRegion(page).getByRole("table", { name: "Group departments" }).getByRole("link", { name: "E2E Facilities" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "E2E Facilities" })).toBeVisible();
  await expect(mainRegion(page).getByText(CODE, { exact: true })).toBeVisible();
  await mainRegion(page).getByRole("button", { name: "Activate in companies" }).click();
  const activate = page.getByTestId("activate-companies-dialog");
  await activate.getByRole("checkbox", { name: "Aurelia Construction" }).check();
  await activate.getByRole("button", { name: "Activate selected" }).click();
  await expect(page.getByText("Department activated.").first()).toBeVisible();

  const sections = page.getByRole("navigation", { name: "Department sections" });
  await sections.getByRole("link", { name: "Companies" }).click();
  const aurelia = mainRegion(page).getByRole("table", { name: "E2E Facilities by company" }).getByRole("row", { name: /Aurelia Construction/ });
  await aurelia.getByRole("button", { name: "Assign manager" }).click();
  const appoint = page.getByTestId("appoint-manager-dialog");
  await appoint.getByRole("combobox", { name: /^Person/ }).selectOption({ label: manager.label });
  await appoint.getByRole("button", { name: "Appoint" }).click();
  await expect(aurelia).toContainText(manager.name);

  await sections.getByRole("link", { name: "Team" }).click();
  await mainRegion(page).getByRole("button", { name: "Add member" }).click();
  const add = page.getByTestId("add-member-dialog");
  await add.getByRole("combobox", { name: /^Person/ }).selectOption({ label: (await nameOf("viewer-a")).label });
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText("Member added.").first()).toBeVisible();
  await expect(mainRegion(page).getByRole("table", { name: "E2E Facilities team" }).getByRole("row")).toHaveCount(3);

  await page.goto("/organization/companies/company_demo_a");
  const row = mainRegion(page).getByRole("table", { name: "Departments of Aurelia Construction" }).getByRole("row", { name: /E2E Facilities/ });
  await expect(row).toContainText(manager.name);
  await expect(row).toContainText("2");
});

test("the head of Group Finance adds somebody to a company's Finance team (§125)", async ({ page }) => {
  const pmB = await nameOf("pm-b");
  await signIn(page, "FINANCE", { to: "/organization/departments" });
  await mainRegion(page).getByRole("table", { name: "Group departments" }).getByRole("link", { name: "Finance", exact: true }).click();
  await page.getByRole("navigation", { name: "Department sections" }).getByRole("link", { name: "Team" }).click();
  // Every company of the group is theirs to see.
  await expect(mainRegion(page).getByRole("combobox", { name: "Company" }).locator("option")).toHaveCount(6);

  await mainRegion(page).getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByTestId("add-member-dialog");
  await dialog.getByRole("combobox", { name: /^Company/ }).selectOption({ label: "Meridian Developments" });
  await dialog.getByRole("combobox", { name: /^Person/ }).selectOption({ label: pmB.label });
  await dialog.getByRole("button", { name: "Add member" }).click();
  const row = mainRegion(page).getByRole("table", { name: "Finance team" }).getByRole("row", { name: new RegExp(pmB.name) });
  await expect(row.getByTestId("coverage")).toContainText("Meridian Developments");
});

test("a company's Finance manager staffs their own branch and cannot open another company's (§126)", async ({ page }) => {
  const pmD = await nameOf("pm-d");
  await signIn(page, "FINANCE_MANAGER_D", { to: "/organization/companies/company_demo_d" });
  await mainRegion(page).getByRole("table", { name: "Departments of Forma Engineering" }).getByRole("row", { name: /Finance/ }).getByRole("link", { name: "View team" }).click();
  await mainRegion(page).getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByTestId("add-member-dialog");
  await dialog.getByRole("combobox", { name: /^Person/ }).selectOption({ label: pmD.label });
  await dialog.getByRole("button", { name: "Add member" }).click();
  await expect(mainRegion(page).getByRole("table", { name: "Finance team" }).getByRole("row", { name: new RegExp(pmD.name) })).toBeVisible();

  await page.goto("/organization/companies/company_demo_b");
  await expect(page.getByText(/not found|could not be found|doesn.t exist/i).first()).toBeVisible();
});

test("the Platform Admin sets up a company with only the departments it needs, and staffs one (§124, §127)", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: "/admin/organizations" });
  await page.getByTestId("organization-create").click();
  await page.getByRole("menuitem", { name: "Create Parent Group" }).click();
  const create = page.getByTestId("new-group-dialog");
  // The code is made from the name: "E2E North Group" → PLATFORM_GROUP.
  await create.getByRole("textbox", { name: /^Group name/ }).fill("E2E North Group");
  await create.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E North Group" })).toBeVisible();
  const actions = page.getByTestId("implementation-actions");

  await actions.getByRole("button", { name: "New company" }).click();
  const company = page.getByTestId("create-company-dialog");
  await company.getByRole("textbox", { name: /^Name/ }).fill("E2E North Build");
  await company.getByLabel("Code").fill(`${PLATFORM_GROUP}-build`);
  // Every department starts ticked; this company runs three of them (§49).
  for (const department of GROUP_DEPARTMENTS.filter((row) => !["finance", "hr", "procurement"].includes(row.key))) {
    await company.getByRole("checkbox", { name: `${department.name} (${department.code})` }).uncheck();
  }
  await company.getByRole("button", { name: "Create company" }).click();
  const row = page.getByTestId("implementation-company").filter({ hasText: "E2E North Build" });
  await expect(row.getByRole("cell").nth(2)).toHaveText("3");

  for (const [first, role] of [["Fatos", "Finance"], ["Klea", "Viewer"]] as const) {
    await actions.getByRole("button", { name: "Add to roster" }).click();
    const person = page.getByTestId("initial-user-dialog");
    await person.getByLabel("First name").fill(first);
    await person.getByLabel("Last name").fill("North");
    await person.getByLabel("Role").selectOption({ label: role });
    await person.getByLabel("Company").selectOption({ label: "E2E North Build" });
    await person.getByRole("button", { name: "Create account" }).click();
    await page.getByTestId("initial-user-credentials").getByRole("button", { name: "Done" }).click();
  }

  await page.getByRole("link", { name: "Set up departments" }).click();
  await page.getByTestId("platform-department").getByRole("link", { name: "Finance", exact: true }).click();
  const setup = page.getByTestId("platform-department-setup");
  const branch = setup.getByTestId("platform-branch").filter({ hasText: "E2E North Build" });
  await branch.getByRole("button", { name: "Assign manager" }).click();
  await page.getByTestId("appoint-manager-dialog").getByRole("button", { name: "Appoint" }).click();
  await expect(branch).toContainText("Fatos North");
  await setup.getByRole("button", { name: "Add member" }).click();
  await page.getByTestId("add-member-dialog").getByRole("button", { name: "Add member" }).click();
  await expect(branch.getByRole("cell").last()).toHaveText("2");
});
