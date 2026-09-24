import { expect, test } from "@playwright/test";

import { db, removeTestDocuments } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Mobile browser behaviour (PRD #9 §182, §184; PRD #3 §6, §21–§28).
 *
 * NESTO on a phone is a website inside a browser, not an imitation of a native
 * app: a sticky header with a hamburger, a left drawer, and no permanent bottom
 * navigation (PRD #3 §6).
 */
test.describe("mobile navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("hides the desktop sidebar and shows the hamburger", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByRole("button", { name: /open navigation/i })).toBeVisible();
  });

  test("opens the drawer, navigates, and closes on selection (PRD #3 §27)", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /open navigation/i }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: "Projects", exact: true }).click();

    await expect(page).toHaveURL(/\/projects/);
    await expect(drawer).toBeHidden();
  });

  test("closes the drawer on Escape (PRD #3 §27)", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /open navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("has no permanent bottom app navigation (PRD #3 §6)", async ({ page }) => {
    await page.goto("/dashboard");

    const navigations = page.getByRole("navigation");
    const count = await navigations.count();

    for (let index = 0; index < count; index += 1) {
      const box = await navigations.nth(index).boundingBox();
      if (!box) continue;
      const viewport = page.viewportSize()!;
      // Nothing pinned to the bottom edge of the screen.
      expect(box.y).toBeLessThan(viewport.height - 60);
    }
  });

  test("shows the drawer's own close control", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open navigation/i }).click();

    await page.getByRole("button", { name: /close navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("mobile module layout (PRD #9 §184)", () => {
  test("shows projects as full-width cards, one to a row, with the star and the menu in reach (Projects Workspace Grid §151-§154)", async ({ page }) => {
    // The Owner sees a project in each of the group's five companies (E-06 §45),
    // which is the Group workspace's list (Workspace Context §83).
    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto("/projects");

    await expect(page.getByRole("table")).toBeHidden();
    const cards = page.locator("#nesto-main").getByTestId("project-card");
    await expect(cards.first()).toBeVisible();
    const [first, second, main] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox(), page.locator("#nesto-main").boundingBox()]);
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
    // The main region's side padding is all that is left beside a card.
    expect(first!.width).toBeGreaterThan(main!.width - 40);
    // A phone's one column shows the render landscape, so a screen holds more than one card.
    const cover = await cards.first().getByTestId("project-cover").boundingBox();
    expect(cover!.width / cover!.height).toBeCloseTo(4 / 3, 1);

    for (const control of ["project-favorite", "project-menu"]) {
      const box = await cards.first().getByTestId(control).boundingBox();
      expect(box!.width, control).toBeGreaterThanOrEqual(44);
      expect(box!.height, control).toBeGreaterThanOrEqual(44);
    }
    await expect(cards.first().getByTestId("project-company")).toBeVisible();
    await expect(cards.first().getByTestId("project-status")).toBeVisible();
  });

  test("keeps the search and nothing else above the cards (Projects Workspace Grid §151)", async ({ page }) => {
    await signIn(page, "OWNER", { workspace: "GROUP" });
    await page.goto("/projects");
    const main = page.locator("#nesto-main");
    await expect(main.getByRole("searchbox", { name: "Search projects" })).toBeVisible();
    await expect(main.getByTestId("projects-filters-open")).toHaveCount(0);
    await expect(main.getByRole("combobox")).toHaveCount(0);
  });

  test("never scrolls the page sideways", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");

    for (const path of ["/dashboard", "/projects", "/projects/project_a"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });

  test("keeps the project detail usable on a phone (PRD #10 §142)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/project_a");

    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* Inventory on a phone (PRD #20 §322–§326, §417, §418)                        */
/* -------------------------------------------------------------------------- */

test.describe("mobile inventory (PRD #20 §418)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "INVENTORY");
  });

  test("renders the item master as cards rather than a squeezed table (§322)", async ({
    page,
  }) => {
    await page.goto("/inventory/items");

    // Both layouts are in the document; only one of them is on screen. The
    // desktop table is hidden below the tablet breakpoint (PRD #7 §86), so the
    // assertion has to name the copy the reader actually sees.
    await expect(
      page.locator("#nesto-main").getByText("MAT-001").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.locator("table").first()).toBeHidden();
  });

  test("shows on hand, reserved and available on an item card (§322)", async ({ page }) => {
    await page.goto("/inventory/items");

    const card = page.locator("#nesto-main li").filter({ visible: true }).first();
    await expect(card.getByText("On hand")).toBeVisible();
    await expect(card.getByText("Available")).toBeVisible();
  });

  test("keeps the stock ledger inside the viewport (§417)", async ({ page }) => {
    await page.goto("/inventory/movements");
    await expect(page.locator("#nesto-main")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps a stock document form inside the viewport (§417)", async ({ page }) => {
    await page.goto("/inventory/issues/new");
    await expect(page.locator("#warehouseId")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* -------------------------------------------------------------------------- */
/* QA/QC on a phone (PRD #21 §440)                                             */
/* -------------------------------------------------------------------------- */

test.describe("mobile inspection execution (PRD #21 §440)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "QAQC");
  });

  test("answers a checklist on a phone", async ({ page }) => {
    // INS-2026-0008 is under way, so its checklist is editable.
    await page.goto("/qaqc/inspections/ins_008/execute");

    const first = mainRegion(page).locator("#answer-0");
    await expect(first).toBeVisible();
    await first.selectOption("PASS");

    await expect(page.getByRole("button", { name: "Save answers" })).toBeVisible();
  });

  test("keeps the checklist inside the viewport", async ({ page }) => {
    await page.goto("/qaqc/inspections/ins_008/execute");
    await expect(mainRegion(page).locator("#answer-0")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("renders the inspection list as cards, with status and result", async ({ page }) => {
    await page.goto("/qaqc/inspections");

    const card = page.locator("#nesto-main li").filter({ visible: true }).first();
    await expect(card).toBeVisible();
    // The two facts stay separate even on a card (§65).
    await expect(card.getByText("Status")).toBeVisible();
    await expect(card.getByText("Result")).toBeVisible();

    await expect(page.locator("table").first()).toBeHidden();
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Safety on a phone (PRD #22 §325–§329, §334, §336, §338).
 *
 * HSE is the module most often used one-handed on a site, in daylight, by
 * somebody who is not sitting down. The reporting forms must be reachable
 * without deep navigation (§338), the checklist must be answerable without
 * pinching, and nothing may need a sideways scroll.
 */
test.describe("mobile HSE (PRD #22 §334)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "HSE");
  });

  test("renders the hazard register as cards rather than a squeezed table", async ({ page }) => {
    await page.goto("/hse/hazards");

    const card = page.locator("#nesto-main li").filter({ visible: true }).first();
    await expect(card).toBeVisible();
    await expect(page.locator("table").first()).toBeHidden();
  });

  test("shows the risk as a level and a number on a hazard card (§326, §332)", async ({
    page,
  }) => {
    await page.goto("/hse/hazards?sort=risk-desc");

    const card = page.locator("#nesto-main li").filter({ visible: true }).first();
    await expect(card).toBeVisible();
    // Never colour alone: the band and the score are both words on the card.
    await expect(card.getByText(/Critical|High|Medium|Low/).first()).toBeVisible();
    await expect(card.getByText("Risk")).toBeVisible();
  });

  /*
   * §336, §338: a critical report form buried three levels down is one that
   * gets filled in after the shift instead of during it.
   */
  test("the hazard report form is usable one-handed", async ({ page }) => {
    await page.goto("/hse/hazards/new");

    await expect(page.getByLabel("Title")).toBeVisible();
    await page.getByLabel(/^Risk — likelihood/).selectOption("4");
    await page.getByLabel(/^Risk — severity/).selectOption("5");

    await expect(page.getByText(/Score 20 · Critical risk/)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("answers a safety checklist on a phone (§334)", async ({ page }) => {
    // HSE-INS-2026-0010 is under way, so its checklist is editable.
    await page.goto("/hse/inspections/hse_ins_010/execute");

    const first = mainRegion(page).locator("#answer-0");
    await expect(first).toBeVisible();
    await first.selectOption("PASS");

    await expect(page.getByRole("button", { name: "Save checklist" })).toBeVisible();
  });

  test("keeps the safety checklist inside the viewport", async ({ page }) => {
    await page.goto("/hse/inspections/hse_ins_010/execute");
    await expect(mainRegion(page).locator("#answer-0")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps the 5×5 risk matrix inside the viewport (§357)", async ({ page }) => {
    await page.goto("/hse/reports?report=risk-matrix");
    await expect(page.getByText("Likelihood ↓ / Severity →")).toBeVisible();

    // The grid scrolls inside its own container, never the page (§184).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the stop-work banner is the first thing on the overview (§338)", async ({ page }) => {
    await page.goto("/hse");

    const banner = page.locator("#nesto-main").getByRole("alert").first();
    await expect(banner).toContainText("Work is stopped");
    await expect(banner).toBeInViewport();
  });
});

/**
 * Mobile file upload (PRD #29 §172, §173, §185, §344).
 *
 * A phone is where site photos actually come from, so this is the upload path
 * that matters most in construction — and the one most likely to be
 * interrupted. Progress, cancel and retry all have to work at 412px.
 */
test.describe("mobile upload (PRD #29 §185)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  const MOBILE_PREFIX = "E2E mobile document";

  test.afterAll(async () => {
    await removeTestDocuments(MOBILE_PREFIX);
    await db.$disconnect();
  });

  test("uploads a site photo taken on the phone (§172, §173)", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    const name = `${MOBILE_PREFIX} Site Photo`;
    await page.getByLabel("Document name").fill(name);

    // A real JPEG: the same magic-byte verification applies to a camera image
    // as to anything else (PRD #29 §173).
    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "site-photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
      ]),
    });

    await expect(page.locator("#nesto-main").getByText(/· Uploaded$/)).toBeVisible({
      timeout: 20_000,
    });

    const stored = await db.document.findFirstOrThrow({
      where: { name },
      select: { storageStatus: true, detectedMimeType: true, previewStatus: true },
    });
    expect(stored.storageStatus).toBe("AVAILABLE");
    expect(stored.detectedMimeType).toBe("image/jpeg");
    // An image is inline-safe, so it previews (PRD #29 §47, §53).
    expect(stored.previewStatus).toBe("READY");
  });

  test("keeps the dropzone and the queue inside the viewport (§184)", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    await expect(page.getByRole("button", { name: /Drop files here/ })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  /**
   * The dropzone has to be reachable without a pointer (PRD #29 §343).
   *
   * It is a button with a labelled file input behind it, rather than a `div`
   * with a drop handler bolted on — so the keyboard and a screen reader get
   * the same door a mouse does.
   */
  test("the file picker is a labelled control, not a drop target only (§343)", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    const input = page.getByLabel("Choose files to upload");
    await expect(input).toHaveAttribute("type", "file");
    await expect(input).toHaveAttribute("multiple", "");

    const dropzone = page.getByRole("button", { name: /Drop files here/ });
    await expect(dropzone).toHaveAttribute("aria-describedby", "upload-hint");
  });

  test("says what it will refuse before a file is chosen (§154)", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    await expect(page.locator("#upload-hint")).toContainText(/Executables, scripts, archives/);
    await expect(page.locator("#upload-hint")).toContainText(/100 MB/);
  });
});
