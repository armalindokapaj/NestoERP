import { expect, test, type Page, type Request } from "@playwright/test";

import { db, removeTestTasks } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The shared field and submission contract in a real browser (AUD-09 §3, §6;
 * FV-02, FV-03, FV-12, FV-13, FV-14).
 *
 * RecordForm is exercised on the Tasks create page (the most used record
 * form), the FormDialog kit on the engineering RFI dialog opened over its
 * page. Server-action submissions are counted from the network: a Next
 * server action is a POST carrying a `next-action` header.
 *
 * Written for the final run; not run by the agent that wrote it.
 */

const PREFIX = "E2E aud09 shared";

test.afterAll(async () => {
  await removeTestTasks(PREFIX);
  await db.$disconnect();
});

function countActionPosts(page: Page): { readonly count: number } {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) seen.push(request);
  });
  return {
    get count() {
      return seen.length;
    },
  };
}

/** Every id in the document is unique, and every label points at exactly one element. */
async function expectUniqueIdsAndLabels(page: Page) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    for (const [id, count] of ids) if (count > 1) found.push(`duplicate id ${id} ×${count}`);
    for (const label of document.querySelectorAll<HTMLLabelElement>("label[for]")) {
      if (!label.htmlFor) continue;
      if (document.querySelectorAll(`[id="${label.htmlFor}"]`).length !== 1) found.push(`label "${label.textContent?.trim()}" → ${label.htmlFor}`);
    }
    return found;
  });
  expect(problems).toEqual([]);
}

test.describe("RecordForm on the Tasks create page", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER", { to: "/tasks/new" });
  });

  test("no error wall on load; required state and descriptions wired to the control (FV-02, FV-03)", async ({ page }) => {
    const main = mainRegion(page);
    const title = main.getByLabel("Title");
    await expect(title).toBeVisible();
    await expect(main.getByTestId("form-error-summary")).toHaveCount(0);
    await expect(main.getByTestId("field-error")).toHaveCount(0);
    await expect(main.locator('[aria-invalid="true"]')).toHaveCount(0);
    await expect(title).toHaveAttribute("required", "");
    await expect(title).toHaveAttribute("aria-required", "true");
    // A hint is the control's description (the Project field says what empty means).
    const project = main.locator('[data-field="projectId"] select, [data-field="projectId"] input').first();
    const described = await project.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    await expect(page.locator(`[id="${described!.split(" ").pop()}"]`)).toBeVisible();
    await expectUniqueIdsAndLabels(page);
  });

  test("a field is checked when left, and re-checked as it is corrected (FV-03)", async ({ page }) => {
    const main = mainRegion(page);
    const title = main.getByLabel("Title");
    const field = main.locator('[data-field="title"]');
    await title.focus();
    // Focus alone shows nothing.
    await expect(field.getByTestId("field-error")).toHaveCount(0);
    await title.press("Tab");
    await expect(field.getByTestId("field-error")).toBeVisible();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    const errorId = await field.getByTestId("field-error").getAttribute("id");
    expect(await title.getAttribute("aria-describedby")).toContain(errorId!);
    // The message is not a live region: typing does not announce per keystroke.
    await expect(field.getByTestId("field-error")).not.toHaveAttribute("aria-live", /.+/);
    await title.fill(`${PREFIX} corrected`);
    await expect(field.getByTestId("field-error")).toHaveCount(0);
    await expect(title).not.toHaveAttribute("aria-invalid", "true");
    // Untouched fields stayed quiet the whole time; no summary before a submit.
    await expect(main.getByTestId("form-error-summary")).toHaveCount(0);
  });

  test("an invalid submit shows the summary, focuses the first invalid field and sends nothing (FV-03, FV-12)", async ({ page }) => {
    const posts = countActionPosts(page);
    const main = mainRegion(page);
    await main.getByRole("button", { name: "Create task" }).click();
    const summary = main.getByTestId("form-error-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("role", "alert");
    await expect(main.getByLabel("Title")).toBeFocused();
    await expect(main.locator("form")).toHaveAttribute("data-save-outcome", "invalid");
    // The summary's link takes the person to the field.
    await main.getByLabel("Description").focus();
    await summary.getByRole("link").first().click();
    await expect(main.getByLabel("Title")).toBeFocused();
    expect(posts.count).toBe(0);
  });

  test("Enter in a textarea is a new line; Enter while composing never submits (FV-12)", async ({ page }) => {
    const posts = countActionPosts(page);
    const main = mainRegion(page);
    await main.getByLabel("Title").fill(`${PREFIX} textarea`);
    const description = main.getByLabel("Description");
    await description.fill("First line");
    await description.press("Enter");
    await description.pressSequentially("Second line");
    await expect(description).toHaveValue("First line\nSecond line");
    // An input method confirming a word sends Enter with isComposing: the form refuses it.
    const prevented = await main.getByLabel("Title").evaluate((input) => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await page.waitForTimeout(500);
    expect(posts.count).toBe(0);
    await expect(page).toHaveURL(/\/tasks\/new$/);
  });

  test("a double click is one request, and success navigates once (FV-12, FV-14)", async ({ page }) => {
    const posts = countActionPosts(page);
    const main = mainRegion(page);
    await main.getByLabel("Title").fill(`${PREFIX} double`);
    await main.getByRole("button", { name: "Create task" }).dblclick();
    await page.waitForURL(/\/tasks\/[^/]+$/);
    expect(posts.count).toBe(1);
    expect(await db.task.count({ where: { title: `${PREFIX} double` } })).toBe(1);
  });

  test("Enter in a single-line field submits through the same path (FV-12)", async ({ page }) => {
    const posts = countActionPosts(page);
    const main = mainRegion(page);
    await main.getByLabel("Title").fill(`${PREFIX} enter`);
    await main.getByLabel("Title").press("Enter");
    await page.waitForURL(/\/tasks\/[^/]+$/);
    expect(posts.count).toBe(1);
  });

  test("an unanswered request keeps the input, says it is unknown, and is not retried (FV-13)", async ({ page }) => {
    const posts = countActionPosts(page);
    await page.route("**/tasks/new", (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));
    const main = mainRegion(page);
    const title = `${PREFIX} unknown`;
    await main.getByLabel("Title").fill(title);
    await main.getByLabel("Description").fill("Kept through an unknown outcome");
    await main.getByRole("button", { name: "Create task" }).click();
    await expect(main.getByTestId("record-form-outcome")).toContainText("couldn't confirm");
    await expect(main.locator("form")).toHaveAttribute("data-save-outcome", "unknown");
    await expect(main.getByLabel("Title")).toHaveValue(title);
    await expect(main.getByLabel("Description")).toHaveValue("Kept through an unknown outcome");
    await expect(page).toHaveURL(/\/tasks\/new$/);
    // Nothing resends by itself.
    await page.waitForTimeout(1500);
    expect(posts.count).toBe(1);
  });
});

test.describe("the FormDialog kit over its page", () => {
  test("per-instance ids, no error wall, summary and focus on an invalid submit (FV-02, FV-03)", async ({ page }) => {
    await signIn(page, "ENGINEER", { to: "/projects/project_a/engineering/rfis" });
    await mainRegion(page).getByTestId("new-rfi").click();
    const dialog = page.getByTestId("rfi-form");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("form-error-summary")).toHaveCount(0);
    await expect(dialog.getByTestId("field-error")).toHaveCount(0);
    await expectUniqueIdsAndLabels(page);
    // The dialog's ids are its own instance's, never a bare name the page could share.
    const subjectId = await dialog.getByLabel("Subject").getAttribute("id");
    expect(subjectId).not.toBe("subject");

    // Left empty → checked when left.
    await dialog.getByLabel("Subject").focus();
    await dialog.getByLabel("Subject").press("Tab");
    await expect(dialog.locator('[data-field="subject"]').getByTestId("field-error")).toBeVisible();

    // Submit with the question still empty: summary, first invalid focused, nothing sent.
    let sent = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/")) sent += 1;
    });
    await dialog.getByRole("button", { name: "Save RFI" }).click();
    await expect(dialog.getByTestId("form-error-summary")).toBeVisible();
    await expect(dialog.getByLabel("Subject")).toBeFocused();
    await expect(dialog.locator("form")).toHaveAttribute("data-save-outcome", "invalid");
    expect(sent).toBe(0);

    // Corrected as typed once it showed an error.
    await dialog.getByLabel("Subject").fill("AUD-09 dialog check");
    await expect(dialog.locator('[data-field="subject"]').getByTestId("field-error")).toHaveCount(0);
  });
});
