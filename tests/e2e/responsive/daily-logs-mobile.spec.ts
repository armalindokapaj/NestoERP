import { expect, test, type Locator, type Page } from "../pw";

import { photoWithExif, removeCreatedDailyLogs } from "../daily-logs-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { atViewport, expectInViewport, expectNoPageOverflow, expectTouchTargets, type ViewportName } from "./geometry";

/**
 * A daily log on a phone (PRD #43 §150-§154, §272): start today's log, add the
 * workforce, a photo, the work done and a delay from the sticky bar, submit.
 *
 * AUD-04 (§6, §7 Site reporting; MW-14, MW-15, MW-16, MW-18) adds the site
 * reporting journey at the phone and tablet sizes, a failed photo upload that
 * stays on screen until it is retried, an unsupported file and a cancelled
 * selection, a reviewer who returns, locks and corrects a log from a phone,
 * double taps and a failed or unanswered submit, and an entry being typed
 * while the phone turns.
 *
 * Runs in the `mobile` project (Pixel 7, touch); each test sets the size it is
 * about. The logs are today's on two projects, so every test starts from none.
 */

/** East Gate Logistics Hub, Terra's, where Terra's engineer works (E-06 §45). */
const PROJECT = "project_c";
/** Riverside, where the Engineer records and the Project Manager reviews (PRD #43 §269-§271). */
const REVIEW_PROJECT = "project_a";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await removeCreatedDailyLogs([PROJECT, REVIEW_PROJECT]);
});

test.afterAll(async () => {
  await removeCreatedDailyLogs([PROJECT, REVIEW_PROJECT]);
  await db.$disconnect();
});

const workspace = (page: Page) => mainRegion(page).getByTestId("daily-log-workspace");
const stickyBar = (page: Page) => page.getByTestId("daily-log-sticky-actions");
const PHONES: ViewportName[] = ["phone360", "phone390"];
const TABLETS: ViewportName[] = ["tabletPortrait", "tabletPortraitLarge", "phoneLandscape"];
/** Below md (768) the steps live in the sticky bar; from md, in the header. */
const isPhone = (name: ViewportName) => PHONES.includes(name) || name === "phone412" || name === "phoneSmall";

async function quickAdd(page: Page, section: string, fill: (sheet: ReturnType<Page["getByRole"]>) => Promise<void>) {
  await stickyBar(page).getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: section }).click();
  const sheet = page.getByRole("dialog");
  await fill(sheet);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet).toBeHidden();
}

/** Adds an entry from its section's own Add control, which every width has (PRD #43 §149). */
async function addFromSection(page: Page, section: string, fill: (form: Locator) => Promise<void>) {
  await workspace(page).getByRole("button", { name: `Add ${section}` }).click();
  const form = page.getByRole("dialog");
  await expect(form).toBeVisible();
  await fill(form);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toBeHidden();
}

/** Opens a folded section on a phone; from md every section is open already. */
async function openSection(page: Page, key: string, title: RegExp) {
  const toggle = workspace(page).getByTestId(`section-${key}`).getByRole("button", { name: title });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

async function startTodaysLog(page: Page, role: "ENGINEER_C" | "ENGINEER", project: string) {
  await signIn(page, role, { to: `/projects/${project}/daily-logs` });
  await mainRegion(page).getByRole("button", { name: "Start today's log" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project}/daily-logs/c[a-z0-9]+$`));
  return page.url().split("/").pop()!;
}

/** Counts the server-bound requests to a URL, per method. */
function track(page: Page, pattern: RegExp) {
  const counts = new Map<string, number>();
  page.on("request", (request) => {
    if (pattern.test(request.url())) counts.set(request.method(), (counts.get(request.method()) ?? 0) + 1);
  });
  return (method: string) => counts.get(method) ?? 0;
}

test("records a site day from the phone and submits it", async ({ page }) => {
  await signIn(page, "ENGINEER_C", { to: `/projects/${PROJECT}/daily-logs` });
  await page.getByRole("button", { name: "Start today's log" }).click();
  await expect(page).toHaveURL(/\/daily-logs\/c[a-z0-9]+$/);
  const logId = page.url().split("/").pop()!;
  await expect(page.getByTestId("daily-log-sticky-actions")).toBeVisible();

  await quickAdd(page, "Workforce", async (sheet) => {
    await sheet.getByLabel("Company or crew").fill("Atlas Groundworks");
    await sheet.getByLabel("Headcount").fill("7");
  });
  await quickAdd(page, "Work completed", async (sheet) => {
    await sheet.getByLabel("Work done").fill("Yard drainage trench");
  });
  await quickAdd(page, "Delays", async (sheet) => {
    await sheet.getByLabel("What held work up").fill("Waiting for survey levels");
    await sheet.getByLabel("Category").selectOption({ label: "Access" });
    await sheet.getByLabel("Duration (minutes)").fill("45");
  });
  await expect(page.getByTestId("count-workforce")).toHaveText("7");

  await page.getByTestId("section-evidence").getByRole("button", { name: /Photos & documents/ }).click();
  await page.getByTestId("evidence-input").setInputFiles({ name: "trench.jpg", mimeType: "image/jpeg", buffer: photoWithExif() });
  await expect(page.getByTestId("count-photos")).toHaveText("1", { timeout: 20_000 });

  await page.getByTestId("daily-log-sticky-actions").getByRole("button", { name: "Submit log" }).click();
  await expect(page.getByTestId("daily-log-status")).toHaveText("Submitted");
  expect((await db.dailyLog.findUniqueOrThrow({ where: { id: logId } })).status).toBe("SUBMITTED");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(412);
});

/*
 * MW-14: the site reporting journey at each phone and tablet size — every
 * section through the product's own controls, a photo whose first transfer
 * dies on the wire and is retried from its row, submit, and a reload that
 * shows what the database holds.
 */
for (const size of [...PHONES, ...TABLETS]) {
  test(`MW-14 site log at ${size}: sections, a failed photo retried, submit, reopen`, async ({ page }) => {
    await atViewport(page, size);
    const logId = await startTodaysLog(page, "ENGINEER_C", PROJECT);
    await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Draft");
    await expectNoPageOverflow(page, `${size} new log`);

    // The phone's bar holds the steps; from md they are in the header (§4: nothing only on one of them).
    if (isPhone(size)) {
      await expect(stickyBar(page)).toBeVisible();
      await expectTouchTargets(page, stickyBar(page));
    } else {
      await expect(stickyBar(page)).toBeHidden();
      await expect(workspace(page).getByRole("button", { name: "Submit", exact: true })).toBeVisible();
    }

    await addFromSection(page, "workforce", async (form) => {
      await form.getByLabel("Company or crew").fill("Atlas Groundworks");
      await form.getByLabel("Headcount").fill("7");
    });
    await addFromSection(page, "work completed", async (form) => {
      await form.getByLabel("Work done").fill("Yard drainage trench");
      await form.getByLabel("Progress today (%)").fill("40");
    });
    await addFromSection(page, "delays", async (form) => {
      await form.getByLabel("What held work up").fill("Waiting for survey levels");
      await form.getByLabel("Category").selectOption({ label: "Access" });
      await form.getByLabel("Duration (minutes)").fill("45");
    });
    await expect(workspace(page).getByTestId("count-workforce")).toHaveText("7");

    // The first transfer of the photo dies on the wire: its row stays, says so, and offers Retry (J-D3).
    let dropped = false;
    await page.route(/\/api\/storage\/objects\//, async (route) => {
      if (route.request().method() === "PUT" && !dropped) {
        dropped = true;
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });
    await openSection(page, "evidence", /Photos & documents/);
    await workspace(page).getByTestId("evidence-input").setInputFiles({ name: "trench.jpg", mimeType: "image/jpeg", buffer: photoWithExif() });
    const failed = workspace(page).getByTestId("upload-queue-item").filter({ hasText: "trench.jpg" });
    await expect(failed).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    await expect(failed.getByRole("alert")).toContainText("connection dropped");
    await expect(workspace(page).getByTestId("count-photos")).toHaveText("0");
    // Not a toast that goes away: still there a moment later.
    await page.waitForTimeout(6_000);
    await expect(failed).toBeVisible();
    const retry = failed.getByRole("button", { name: "Retry trench.jpg" });
    await expectInViewport(retry, `${size} retry`);
    await expectTouchTargets(page, failed);
    await retry.click();
    await expect(workspace(page).getByTestId("count-photos")).toHaveText("1", { timeout: 20_000 });
    await expect(workspace(page).getByTestId("upload-queue-item")).toHaveCount(0);
    await page.unroute(/\/api\/storage\/objects\//);
    const photos = await db.document.findMany({ where: { entityType: "daily_log", entityId: logId }, select: { storageStatus: true } });
    expect(photos).toEqual([{ storageStatus: "AVAILABLE" }]);

    if (isPhone(size)) await stickyBar(page).getByRole("button", { name: "Submit log" }).click();
    else await workspace(page).getByRole("button", { name: "Submit", exact: true }).click();
    await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Submitted");

    // Reopened: what is on screen is what was stored.
    await page.reload();
    await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Submitted");
    await expect(workspace(page).getByTestId("count-workforce")).toHaveText("7");
    await expect(workspace(page).getByTestId("count-photos")).toHaveText("1");
    await openSection(page, "delays", /Delays/);
    await expect(workspace(page).getByTestId("delay-entry")).toContainText("Waiting for survey levels");
    const stored = await db.dailyLog.findUniqueOrThrow({ where: { id: logId }, include: { workforce: true, workActivities: true, delayEntries: true } });
    expect(stored.status).toBe("SUBMITTED");
    expect(stored.workforce.map((entry) => [entry.organizationName, entry.headcount])).toEqual([["Atlas Groundworks", 7]]);
    expect(stored.workActivities.map((entry) => entry.title)).toEqual(["Yard drainage trench"]);
    expect(stored.delayEntries.map((entry) => entry.title)).toEqual(["Waiting for survey levels"]);
    await expectNoPageOverflow(page, `${size} submitted log`);
  });
}

test("MW-18 automated parts: a cancelled selection changes nothing; an unsupported file says what is accepted", async ({ page }) => {
  await atViewport(page, "phone390");
  const logId = await startTodaysLog(page, "ENGINEER_C", PROJECT);
  await openSection(page, "evidence", /Photos & documents/);
  const uploads = track(page, /\/api\/documents\/uploads/);

  // The gallery says what it takes before anything is chosen, and offers the photo library as well as files.
  await expect(workspace(page).getByTestId("evidence-accepted-types")).toContainText("Image (JPG, JPEG, PNG, WEBP)");
  const input = workspace(page).getByTestId("evidence-input");
  await expect(input).toHaveAttribute("accept", /image\/\*/);
  // Files/Photos is the ordinary picker, never camera-only; the camera is a separate, optional button.
  expect(await input.getAttribute("capture")).toBeNull();
  await expect(workspace(page).getByRole("button", { name: "Take photo" })).toBeVisible();
  await expect(workspace(page).getByLabel("Take a photo")).toHaveAttribute("capture", "environment");

  // Cancelling the picker is choosing nothing.
  await input.setInputFiles([]);
  await expect(workspace(page).getByTestId("upload-queue-item")).toHaveCount(0);

  // A HEIC straight off an iPhone is refused before any request, with the kinds that are accepted.
  await input.setInputFiles({ name: "site.heic", mimeType: "image/heic", buffer: Buffer.from("not really a heic") });
  const refused = workspace(page).getByTestId("upload-queue-item").filter({ hasText: "site.heic" });
  await expect(refused).toHaveAttribute("data-status", "failed");
  await expect(refused.getByRole("alert")).not.toBeEmpty();
  await expect(refused.getByRole("button", { name: /Retry/ })).toHaveCount(0);
  expect(uploads("POST")).toBe(0);
  // Removed by the person, not by a timer.
  await refused.getByRole("button", { name: "Remove site.heic from the list" }).click();
  await expect(refused).toHaveCount(0);
  expect(await db.document.count({ where: { entityType: "daily_log", entityId: logId } })).toBe(0);
});

test("MW-15 a double tap submits once; a refused or unanswered submit is never shown as done", async ({ page }) => {
  await atViewport(page, "phone390");
  const logId = await startTodaysLog(page, "ENGINEER_C", PROJECT);
  await addFromSection(page, "workforce", async (form) => {
    await form.getByLabel("Company or crew").fill("Atlas Groundworks");
    await form.getByLabel("Headcount").fill("4");
  });
  const submit = stickyBar(page).getByRole("button", { name: "Submit log" });
  const submitPath = new RegExp(`/api/daily-logs/${logId}/submit$`);

  // The server fails: the log stays a draft, on screen and stored, with no success message.
  await page.route(submitPath, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "The log could not be submitted." } }) }));
  await submit.click();
  await expect(page.getByText("The log could not be submitted.").first()).toBeVisible();
  await expect(page.getByText("Daily log submitted")).toHaveCount(0);
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Draft");
  expect((await db.dailyLog.findUniqueOrThrow({ where: { id: logId } })).status).toBe("DRAFT");
  await page.unroute(submitPath);

  // No answer at all: the person is told the outcome is unknown, not asked to try again blindly.
  await page.route(submitPath, (route) => route.abort("internetdisconnected"));
  await submit.click();
  await expect(page.getByText("We couldn't confirm whether this saved. Check the record before trying again.").first()).toBeVisible();
  await expect(page.getByText("Daily log submitted")).toHaveCount(0);
  await page.unroute(submitPath);
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Draft");

  // A slow answer and two taps in the same frame: one request, one submission.
  const sent = track(page, submitPath);
  await page.route(submitPath, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await submit.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(submit).toBeDisabled();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Submitted", { timeout: 15_000 });
  expect(sent("POST")).toBe(1);
  expect(await db.notificationEventOutbox.count({ where: { entityId: logId, eventType: "DAILY_LOG_SUBMITTED" } })).toBe(1);
});

test("MW-16 turning the phone mid-entry keeps the sheet, the typed entry and the overview text", async ({ page }) => {
  await atViewport(page, "phone390");
  const logId = await startTodaysLog(page, "ENGINEER_C", PROJECT);

  // Typed into the overview but not yet saved (it saves on blur).
  await openSection(page, "overview", /Overview/);
  const summary = workspace(page).getByTestId("overview-summary");
  await summary.fill("Drainage trench on the east yard");

  await stickyBar(page).getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Weather" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Observed at").fill("07:30");
  // Below zero: the field takes a minus sign on a phone keyboard (D-08-08) and a decimal comma.
  const temperature = sheet.getByLabel("Temperature (°C)");
  await expect(temperature).toHaveAttribute("inputmode", "text");
  await temperature.fill("-4,5");
  await sheet.getByLabel("Notes").fill("Frost on the formwork");

  // Across the md breakpoint and back: the same sheet, with what was typed.
  await atViewport(page, "phoneLandscape");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Temperature (°C)")).toHaveValue("-4,5");
  await expect(sheet.getByLabel("Notes")).toHaveValue("Frost on the formwork");
  await atViewport(page, "phone390");
  await expect(sheet.getByLabel("Notes")).toHaveValue("Frost on the formwork");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet).toBeHidden();

  const weather = await db.dailyLogWeatherEntry.findMany({ where: { dailyLogId: logId }, select: { temperatureC: true, notes: true } });
  expect(weather.map((row) => [Number(row.temperatureC), row.notes])).toEqual([[-4.5, "Frost on the formwork"]]);
  // The overview text is still in its field after both turns.
  await expect(summary).toHaveValue("Drainage trench on the east yard");
});

/*
 * J-D1, J-D2: a reviewer on a phone reaches every step the header offers from
 * md — Return, Mark reviewed, Lock, Add correction — through the bar and its
 * labelled More menu, and the bar never covers the end of the log.
 */
test("a reviewer returns, reviews, locks and corrects a log from a phone", async ({ page, browser }) => {
  // The Engineer records and submits the day through the API the workspace uses.
  const engineerContext = await browser.newContext();
  const engineer = await engineerContext.newPage();
  const logId = await startTodaysLog(engineer, "ENGINEER", REVIEW_PROJECT);
  const api = async (path: string, body: unknown) => {
    const response = await engineer.request.post(`/api/daily-logs/${logId}${path}`, { data: body });
    expect(response.ok(), `${path}: ${response.status()}`).toBe(true);
  };
  const version = async () => (await db.dailyLog.findUniqueOrThrow({ where: { id: logId }, select: { version: true } })).version;
  await api("/workforce", { organizationName: "Alba Concrete", headcount: 9 });
  await api("/activities", { title: "Level 4 column pour" });
  await api("/submit", { expectedVersion: await version() });

  await atViewport(page, "phone360");
  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${REVIEW_PROJECT}/daily-logs/${logId}` });
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Submitted");
  const bar = stickyBar(page);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Mark reviewed" })).toBeVisible();
  await expectTouchTargets(page, bar);
  await expectNoPageOverflow(page, "reviewer bar at 360");

  // The page keeps room for the bar: at the very bottom, the log ends above it (J-D2).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="daily-log-sticky-actions"]')!.getBoundingClientRect();
    const sections = Array.from(document.querySelectorAll('[data-testid^="section-"]'));
    const last = sections[sections.length - 1].getBoundingClientRect();
    return bar.top - last.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);

  // Return, from the labelled More menu.
  await bar.getByRole("button", { name: "More log actions" }).click();
  await page.getByRole("menuitem", { name: "Return for correction" }).click();
  const dialog = page.getByRole("dialog", { name: "Return for correction?" });
  await dialog.getByLabel("What needs correcting").fill("Add the pump crew to the workforce.");
  await dialog.getByRole("button", { name: "Return" }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Correction required");
  expect((await db.dailyLog.findUniqueOrThrow({ where: { id: logId } })).status).toBe("CORRECTION_REQUIRED");

  // Corrected and resubmitted by the Engineer.
  await api("/workforce", { organizationName: "Alba pump crew", headcount: 2 });
  await api("/submit", { expectedVersion: await version() });
  await engineerContext.close();

  await page.reload();
  await bar.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Reviewed");
  await bar.getByRole("button", { name: "Lock" }).click();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Locked");

  // A locked log's only step, the official correction, is the bar's button.
  await bar.getByRole("button", { name: "Add correction" }).click();
  const correction = page.getByRole("dialog", { name: "Add an official correction" });
  await correction.getByLabel("Why it needs correcting").fill("Pump crew headcount was mistyped.");
  await correction.getByLabel("The correction").fill("Pump crew: 3, not 2.");
  await expectInViewport(correction.getByRole("button", { name: "Add correction" }), "correction dialog at 360");
  await correction.getByRole("button", { name: "Add correction" }).click();
  await expect(workspace(page).getByTestId("daily-log-correction")).toContainText("Pump crew: 3, not 2.");

  await page.reload();
  await expect(workspace(page).getByTestId("daily-log-status")).toHaveText("Locked");
  const stored = await db.dailyLog.findUniqueOrThrow({ where: { id: logId }, include: { corrections: true } });
  expect(stored.status).toBe("LOCKED");
  expect(stored.corrections.map((row) => row.correctionSummary)).toEqual(["Pump crew: 3, not 2."]);
});
