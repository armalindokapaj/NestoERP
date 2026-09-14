import { expect, test, type Browser, type Page } from "@playwright/test";

import { db } from "../db";
import { ENGINEERING_SEED, PROJECT, dispatchNotifications, isoDay, pdf, restoreContractorsEngineering, runJob } from "../engineering-fixtures";
import { mainRegion, signIn, type DemoRole } from "../fixtures";

/**
 * Contractors and engineering, desktop (PRD #46 §308-§312): a project manager
 * sets a contractor up end to end; an RFI goes from the engineer to the
 * architect and back; a submittal and a drawing go round the review loop until
 * they are approved, keeping every earlier revision; and Legal renews an
 * insurance certificate the daily job found expiring.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await restoreContractorsEngineering();
});

test.afterAll(async () => {
  await restoreContractorsEngineering();
  await db.$disconnect();
});

const S = ENGINEERING_SEED;

async function openAs(browser: Browser, role: DemoRole, path: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role, { to: path });
  return page;
}

const revision = (page: Page, code: string) => mainRegion(page).locator(`[data-testid="revision-item"][data-revision="${code}"]`);

/** Uploads a file into the revision dialog and submits it as the next revision. */
async function addRevision(page: Page, code: string, file: string) {
  await mainRegion(page).getByTestId("add-revision").click();
  const dialog = page.getByTestId("revision-dialog");
  await expect(dialog.locator("#revision-code")).toHaveValue(code);
  await dialog.getByTestId("revision-upload").setInputFiles(pdf(file));
  const option = dialog.locator("#revision-file option", { hasText: `${file}.pdf` });
  await expect(option).toHaveCount(1, { timeout: 20_000 });
  await dialog.locator("#revision-file").selectOption({ value: (await option.getAttribute("value"))! });
  await dialog.getByRole("button", { name: "Submit revision" }).click();
  await expect(dialog).toBeHidden();
  await expect(revision(page, code)).toHaveAttribute("data-status", "SUBMITTED");
}

/** The reviewer's decision on a revision, with the comment the decision asks for. */
async function decide(page: Page, code: string, button: string, comment: string | null) {
  await page.reload();
  await revision(page, code).getByRole("button", { name: button, exact: true }).click();
  const dialog = page.getByTestId("decision-dialog");
  if (comment) await dialog.getByLabel("Review comment").fill(comment);
  await dialog.getByRole("button", { name: /^Record:/ }).click();
  await expect(dialog).toBeHidden();
  await expect(revision(page, code)).toHaveAttribute("data-status", "FINALIZED");
}

test("a project manager sets up a contractor with its supplier, project, work package, contract and compliance (§308)", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "PROJECT_MANAGER", { to: "/contractors" });

  // A likely duplicate is shown, never merged: the writer says it is a different organisation.
  await mainRegion(page).getByTestId("new-contractor").click();
  const form = page.getByTestId("contractor-form");
  await form.getByLabel("Legal name").fill("Kodra Scaffolding sh.p.k.");
  await form.getByLabel("Status").selectOption({ label: "Active" });
  await form.getByLabel("Email", { exact: true }).fill("kodra@apex-structural.test");
  await form.getByLabel("Linked supplier").selectOption({ label: "Legacy Scaffold Hire" });
  await form.getByRole("button", { name: "Create contractor" }).click();
  const warning = form.getByTestId("duplicate-warning");
  await expect(warning).toContainText("Apex Structural Works sh.p.k.");
  await expect(warning).toContainText("Same email domain");
  await warning.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Create anyway" }).click();
  await expect(page).toHaveURL(/\/contractors\/c[a-z0-9]+$/);
  const contractorId = page.url().split("/").pop()!;
  await expect(mainRegion(page).getByRole("heading", { name: "Kodra Scaffolding sh.p.k." })).toBeVisible();
  expect((await db.contractorProfile.findUniqueOrThrow({ where: { id: contractorId } })).supplierId).toBe("supplier_legacy");

  await page.getByTestId("contractor-tabs").getByRole("link", { name: "Contacts" }).click();
  await mainRegion(page).getByTestId("add-contact").click();
  const contact = page.getByTestId("contact-form");
  await contact.getByLabel(/^Name/).fill("Arta Kodra");
  await contact.getByLabel("Job title").fill("Site manager");
  await contact.getByLabel("Email").fill("arta@kodra-scaffolding.test");
  await contact.getByRole("button", { name: "Add contact" }).click();
  await expect(mainRegion(page).getByTestId("contact-card")).toContainText("Arta Kodra");

  // The project assignment carries its own scope, manager, contact and contract.
  await page.goto(`/projects/${PROJECT}/contractors`);
  await mainRegion(page).getByTestId("assign-contractor").click();
  const assignment = page.getByTestId("assignment-form");
  await assignment.getByLabel(/^Contractor \*$/).selectOption({ label: "Kodra Scaffolding sh.p.k." });
  await assignment.getByLabel("Status").selectOption({ label: "Active" });
  await assignment.getByLabel("Internal manager").selectOption({ label: "Alex Morgan" });
  await assignment.getByLabel("Scope").fill("Access scaffolding to Blocks A and B");
  await assignment.getByLabel("Contractor's contact").selectOption({ label: "Arta Kodra · Site manager" });
  await assignment.getByLabel("Contract", { exact: true }).selectOption({ label: "CTR-2026-001 · Riverside phase 2 — main works" });
  await assignment.getByRole("button", { name: "Assign" }).click();
  await expect(assignment).toBeHidden();
  const row = mainRegion(page).getByTestId("assignment-row").filter({ hasText: "Kodra Scaffolding sh.p.k." });
  await expect(row).toContainText("CTR-2026-001");
  await expect(row.getByTestId("assignment-status")).toHaveText("Active");

  await mainRegion(page).getByTestId("new-work-package").click();
  const pack = page.getByTestId("work-package-form");
  await pack.getByLabel("Name").fill("Access scaffolding — Blocks A & B");
  await pack.getByLabel("Status").selectOption({ label: "Active" });
  await pack.getByLabel("Contractor", { exact: true }).selectOption({ label: "Kodra Scaffolding sh.p.k." });
  await pack.getByLabel("Responsible").selectOption({ label: "Alex Morgan" });
  await pack.getByLabel("Contract", { exact: true }).selectOption({ label: "CTR-2026-001 · Riverside phase 2 — main works" });
  await pack.getByLabel("Planned start").fill(isoDay(7));
  await pack.getByLabel("Planned finish").fill(isoDay(90));
  await pack.getByRole("button", { name: "Create work package" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/work-packages/c[a-z0-9]+$`));
  await expect(mainRegion(page).getByRole("heading", { name: /Access scaffolding — Blocks A & B/ })).toBeVisible();
  await expect(mainRegion(page).getByRole("link", { name: "Kodra Scaffolding sh.p.k." })).toBeVisible();
  await expect(mainRegion(page).getByRole("link", { name: /CTR-2026-001/ })).toBeVisible();

  // Compliance evidence is a file filed on the contractor, chosen on the item.
  await page.goto(`/contractors/${contractorId}/compliance`);
  await mainRegion(page).getByTestId("add-compliance").click();
  const compliance = page.getByTestId("compliance-form");
  await compliance.getByLabel("Type").selectOption({ label: "Insurance" });
  await compliance.getByLabel("Title").fill("Public liability insurance");
  await compliance.getByTestId("compliance-upload").setInputFiles(pdf("Kodra public liability 2026"));
  const evidence = compliance.getByLabel("Evidence", { exact: true });
  const option = evidence.locator("option", { hasText: "Kodra public liability 2026.pdf" });
  await expect(option).toHaveCount(1, { timeout: 20_000 });
  await evidence.selectOption({ value: (await option.getAttribute("value"))! });
  await compliance.getByLabel("Issuer").fill("Sigal Uniqa Group");
  await compliance.getByLabel("Issued").fill(isoDay(-10));
  await compliance.getByLabel("Expires").fill(isoDay(355));
  await compliance.getByRole("button", { name: "Add requirement" }).click();
  await expect(compliance).toBeHidden();
  const item = mainRegion(page).getByTestId("compliance-row").filter({ hasText: "Public liability insurance" });
  await expect(item.getByTestId("compliance-status")).toHaveText("Valid");
  await expect(item).toContainText("Kodra public liability 2026.pdf");

  await expect(mainRegion(page).getByTestId("contractor-counts")).toContainText("1 project • 1 work package • 0 open RFIs • 0 submittals • 0 compliance alerts");
});

test("an engineer's RFI is answered by the architect and closed, and the attention it raised resolves (§309)", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const subject = "Lintel bearing at the level 2 core opening";
  await signIn(page, "ENGINEER", { to: `/projects/${PROJECT}/engineering/rfis` });
  await mainRegion(page).getByTestId("new-rfi").click();
  const form = page.getByTestId("rfi-form");
  await form.getByLabel("Subject").fill(subject);
  await form.getByLabel("Question").fill("Drawing STR-GA-004 shows a 1.8 m opening in core wall C2 at level 2. What bearing length and lintel section do you want?");
  await form.getByLabel("Priority").selectOption({ label: "High" });
  await form.getByLabel("Discipline").selectOption({ label: "Structural" });
  await form.getByLabel("Assign to").selectOption({ label: "Anna Rossi" });
  await form.getByLabel("Contractor").selectOption({ label: "Apex Structural Works sh.p.k." });
  await form.getByRole("button", { name: "Save RFI" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/engineering/rfis/c[a-z0-9]+$`));
  const rfiId = page.url().split("/").pop()!;
  await expect(mainRegion(page).getByTestId("rfi-status")).toHaveText("Open");

  // The architect is told, and the RFI waits in their attention list.
  dispatchNotifications();
  await runJob("attention.reconcile");
  expect(await db.notification.count({ where: { entityId: rfiId, recipientMemberId: "member_architect" } })).toBeGreaterThan(0);
  expect(await db.attentionItem.count({ where: { entityId: rfiId, recipientMemberId: "member_architect", conditionKey: "RFI_RESPONSE_REQUIRED", status: "ACTIVE" } })).toBe(1);

  const architect = await openAs(browser, "ARCHITECT", "/engineering");
  await mainRegion(architect).getByRole("link", { name: subject }).click();
  await expect(architect).toHaveURL(new RegExp(`/rfis/${rfiId}$`));
  await mainRegion(architect).getByLabel("Your response").fill("Use a 203x133 UB lintel with 250 mm bearing each side on a padstone. Detail to follow on STR-SK-019.");
  await mainRegion(architect).getByRole("button", { name: "Send response" }).click();
  await expect(mainRegion(architect).getByTestId("rfi-status")).toHaveText("Answered");
  await expect(mainRegion(architect).getByTestId("rfi-response")).toContainText("203x133 UB lintel");
  await architect.context().close();
  expect(await db.attentionItem.count({ where: { entityId: rfiId, status: "ACTIVE" } })).toBe(0);

  await page.reload();
  await expect(mainRegion(page).getByTestId("rfi-response")).toContainText("203x133 UB lintel");
  await mainRegion(page).getByTestId("close-rfi").click();
  const close = page.getByRole("dialog");
  await close.getByLabel("Closing note").fill("Answer accepted; issued to Apex.");
  await close.getByRole("button", { name: "Close RFI" }).click();
  await expect(mainRegion(page).getByTestId("rfi-status")).toHaveText("Closed");
  await expect(mainRegion(page).getByTestId("rfi-closed-note")).toContainText("Answer accepted; issued to Apex.");

  dispatchNotifications();
  expect(await db.notification.count({ where: { entityId: rfiId, recipientMemberId: "member_engineer", eventType: "RFI_ANSWERED" } })).toBe(1);
  expect((await db.rfi.findUniqueOrThrow({ where: { id: rfiId } })).status).toBe("CLOSED");
});

test("a submittal goes back for revision, and revision B is approved with comments (§310)", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, "ENGINEER", { to: `/projects/${PROJECT}/engineering/material-submittals` });
  await mainRegion(page).getByTestId("new-submittal").click();
  const form = page.getByTestId("submittal-form");
  await form.getByLabel("Title").fill("Aluminium louvres — rooftop plant screen");
  await form.getByLabel("Contractor").selectOption({ label: "Brightline Façades Ltd" });
  await form.getByLabel("Reviewer").selectOption({ label: "Anna Rossi" });
  await form.getByLabel("Manufacturer").fill("Renson");
  await form.getByLabel("Product").fill("Linarte louvre");
  await form.getByRole("button", { name: "Register submittal" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/engineering/submittals/c[a-z0-9]+$`));
  const url = new URL(page.url()).pathname;
  await expect(mainRegion(page).getByTestId("submittal-status")).toHaveText("Draft");

  // The em dash is deliberate: a file name outside Latin-1 once broke the upload before it left the browser.
  await addRevision(page, "A", "Louvres Rev A — product data");
  await expect(mainRegion(page).getByTestId("submittal-status")).toHaveText("Submitted");

  const architect = await openAs(browser, "ARCHITECT", url);
  await decide(architect, "A", "Revision required", "Provide the wind-load calculation for the 2.4 m span and the RAL 7016 finish sample.");
  await expect(mainRegion(architect).getByTestId("submittal-status")).toHaveText("Revision required");

  await page.reload();
  await expect(revision(page, "A").getByTestId("revision-comment")).toContainText("wind-load calculation");
  await addRevision(page, "B", "Louvres Rev B — with calculation");

  await decide(architect, "B", "Approve with comments", "Approved. Confirm the fixing centres on site before installation.");
  await expect(mainRegion(architect).getByTestId("submittal-status")).toHaveText("Approved with comments");
  await architect.context().close();

  await page.reload();
  await expect(revision(page, "B").getByTestId("revision-current")).toBeVisible();
  // Revision A stays on the record with the reason it went back.
  await expect(revision(page, "A")).toHaveAttribute("data-status", "SUPERSEDED");
  await expect(revision(page, "A").getByTestId("revision-comment")).toContainText("wind-load calculation");
  await expect(mainRegion(page).getByTestId("revision-item")).toHaveCount(2);
});

test("a drawing moves from revision A to C, and the earlier revisions are kept as superseded (§311)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, "ENGINEER", { to: `/projects/${PROJECT}/engineering/drawings` });
  await mainRegion(page).getByTestId("new-document").click();
  const form = page.getByTestId("document-form");
  await form.getByLabel("Drawing number").fill("STR-GA-104");
  await form.getByLabel("Title").fill("Level 2 transfer beam layout");
  await form.getByLabel("Discipline").selectOption({ label: "Structural" });
  await form.getByLabel("Reviewer").selectOption({ label: "Anna Rossi" });
  await form.getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/engineering/documents/c[a-z0-9]+$`));
  const url = new URL(page.url()).pathname;
  const documentId = url.split("/").pop()!;

  await addRevision(page, "A", "STR-GA-104 Rev A");
  const architect = await openAs(browser, "ARCHITECT", url);
  await decide(architect, "A", "Revision required", "Beam TB2 clashes with the riser on grid C/4.");

  await page.reload();
  await addRevision(page, "B", "STR-GA-104 Rev B");
  await decide(architect, "B", "Approve with comments", "Add the camber note to TB1.");

  await page.reload();
  await addRevision(page, "C", "STR-GA-104 Rev C");
  await decide(architect, "C", "Approve", null);
  await architect.context().close();

  await page.reload();
  await expect(mainRegion(page).getByTestId("record-status").first()).toHaveText("Approved");
  await expect(mainRegion(page).getByTestId("revision-item")).toHaveCount(3);
  await expect(revision(page, "C").getByTestId("revision-current")).toBeVisible();
  for (const code of ["A", "B"]) {
    await expect(revision(page, code)).toHaveAttribute("data-status", "SUPERSEDED");
    await expect(revision(page, code)).toContainText("Superseded — do not build from this revision.");
    await expect(revision(page, code).getByTestId("revision-file")).toHaveText(`STR-GA-104 Rev ${code}.pdf`);
  }
  const current = await db.engineeringDocument.findUniqueOrThrow({ where: { id: documentId }, select: { currentRevision: { select: { revisionCode: true } } } });
  expect(current.currentRevision?.revisionCode).toBe("C");

  await page.goto(`/projects/${PROJECT}/engineering/drawings`);
  const row = mainRegion(page).getByTestId("document-row").filter({ hasText: "STR-GA-104" });
  await expect(row.getByTestId("document-current-revision")).toContainText("Rev C");
  await expect(row.getByTestId("document-current-revision")).toContainText("of 3");
});

test("an insurance certificate expiring in 14 days reaches Legal, who renews it with a new certificate (§312)", async ({ page }) => {
  test.setTimeout(180_000);
  const itemId = S.compliance.apexInsurance;
  // As on the day before the job noticed: on file, expiring in 14 days, nobody told yet.
  await db.contractorComplianceItem.update({ where: { id: itemId }, data: { status: "VALID", statusChangedAt: null } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: itemId } });
  await db.attentionItem.deleteMany({ where: { entityId: itemId } });

  await runJob("contractors.compliance");
  expect((await db.contractorComplianceItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe("EXPIRING");
  dispatchNotifications();
  await runJob("attention.reconcile");
  for (const member of ["member_legal", "member_pm"]) {
    expect(await db.notification.count({ where: { entityId: itemId, recipientMemberId: member, eventType: "CONTRACTOR_COMPLIANCE_EXPIRING" } }), member).toBe(1);
  }
  expect(await db.attentionItem.count({ where: { entityId: itemId, recipientMemberId: "member_legal", conditionKey: "CONTRACTOR_COMPLIANCE_EXPIRING", status: "ACTIVE" } })).toBe(1);

  await signIn(page, "LEGAL", { to: `/contractors/${S.contractors.apex}/compliance` });
  const row = mainRegion(page).getByTestId("compliance-row").filter({ hasText: "Contractor's all-risk insurance" });
  await expect(row).toHaveAttribute("data-status", "EXPIRING");
  await row.getByTestId("edit-compliance").click();
  const form = page.getByTestId("compliance-form");
  await form.getByTestId("compliance-upload").setInputFiles(pdf("Apex CAR insurance certificate 2027"));
  const evidence = form.getByLabel("Evidence", { exact: true });
  const option = evidence.locator("option", { hasText: "Apex CAR insurance certificate 2027.pdf" });
  await expect(option).toHaveCount(1, { timeout: 20_000 });
  await evidence.selectOption({ value: (await option.getAttribute("value"))! });
  await form.getByLabel("Reference").fill("CAR-2026-51022");
  await form.getByLabel("Issued").fill(isoDay(0));
  await form.getByLabel("Expires").fill(isoDay(365));
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();

  await expect(row).toHaveAttribute("data-status", "VALID");
  await expect(row.getByTestId("compliance-status")).toHaveText("Valid");
  await expect(row).toContainText("Apex CAR insurance certificate 2027.pdf");
  expect(await db.attentionItem.count({ where: { entityId: itemId, status: "ACTIVE" } })).toBe(0);
});
