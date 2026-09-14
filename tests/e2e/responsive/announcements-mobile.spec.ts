import { expect, test } from "@playwright/test";

import { seedStoredDocument } from "../../../prisma/seed/document-objects";
import { memberIdFor, resetAnnouncements } from "../announcements-fixtures";
import { db } from "../db";
import { signIn } from "../fixtures";

/**
 * Announcements and favorites on a phone (PRD #45 §327, §328): a critical
 * notice reaches the Engineer as a banner, is read in full, acknowledged from
 * the sticky button, and its attachment opens; a starred project is one tap
 * from the dashboard.
 */

const ID = "announcement_e2e_mobile_critical";

test.beforeAll(async () => {
  await resetAnnouncements();
  const [owner, engineer] = await Promise.all([memberIdFor("owner@nesto.test"), memberIdFor("engineer@nesto.test")]);
  await db.announcement.create({
    data: {
      id: ID, companyId: "company_demo_a", status: "PUBLISHED", priority: "CRITICAL", audienceType: "COMPANY", requiresAcknowledgment: true,
      title: "Riverside closed after storm damage", body: "Riverside is **closed** until the scaffold is inspected.\n\n> Do not enter the site.",
      authorMemberId: owner, publishedByMemberId: owner, publishedAt: new Date(),
      targets: { create: [{ memberId: engineer, targetedAt: new Date() }] },
    },
  });
  await seedStoredDocument(db, { id: "document_e2e_storm_notice", companyId: "company_demo_a", name: "Storm inspection notice.pdf", module: "announcements", entityType: "announcement", entityId: ID, uploadedByMemberId: owner, createdBy: "user_owner" });
});

test.afterAll(async () => {
  await db.documentUploadSession.deleteMany({ where: { documentId: "document_e2e_storm_notice" } });
  await db.activity.deleteMany({ where: { entityId: "document_e2e_storm_notice" } });
  await db.document.deleteMany({ where: { id: "document_e2e_storm_notice" } });
  await resetAnnouncements();
  await db.$disconnect();
});

test("reads and acknowledges a critical notice, then opens its attachment", async ({ page }) => {
  await signIn(page, "ENGINEER", { to: "/dashboard" });
  const banner = page.getByTestId("critical-announcement-banner");
  await expect(banner).toContainText("Riverside closed after storm damage");
  await banner.getByRole("link", { name: "Read and acknowledge" }).click();
  await expect(page.getByTestId("announcement-title")).toHaveText("Riverside closed after storm damage");
  await expect(page.getByTestId("announcement-priority")).toHaveText("Critical");

  await page.getByTestId("announcement-sticky-ack").getByRole("button", { name: "I have read this" }).click();
  await expect(page.getByTestId("announcement-acknowledgment")).toContainText("Acknowledged •");
  await expect(page.getByTestId("announcement-sticky-ack")).toHaveCount(0);

  await page.getByTestId("announcement-attachment").filter({ hasText: "Storm inspection notice" }).click();
  await expect(page).toHaveURL(/\/documents\/document_e2e_storm_notice$/);
  await page.goto("/dashboard");
  await expect(page.getByTestId("critical-announcement-banner")).toHaveCount(0);
});

test("stars a project and opens it from the dashboard", async ({ page }) => {
  const engineer = await memberIdFor("engineer@nesto.test");
  try {
    await signIn(page, "ENGINEER", { to: "/projects/project_d" });
    await page.getByTestId("favorite-button").first().click();
    await expect(page.getByTestId("favorite-button").first()).toHaveAttribute("aria-pressed", "true");
    await page.goto("/dashboard");
    await page.getByRole("region", { name: "Favorites" }).getByRole("link", { name: /Logistics Hub/ }).click();
    await expect(page).toHaveURL(/\/projects\/project_d$/);
  } finally {
    await db.userFavorite.deleteMany({ where: { memberId: engineer, entityType: "project", entityId: "project_d" } });
  }
});
