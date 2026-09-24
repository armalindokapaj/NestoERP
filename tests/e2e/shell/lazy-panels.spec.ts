import { expect, test, type Page, type Route } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * The top bar's panels load their code on open (NAV-03 §6, §17.1). These run
 * against a production build, whose panel bodies are real separate chunks:
 * holding or failing "the next script the page asks for" after it has loaded
 * holds or fails exactly the panel body being opened.
 */

const SCRIPT = (url: URL) => url.pathname.startsWith("/_next/static/chunks/") && url.pathname.endsWith(".js");

/** Signs in and waits until the page has fetched every script it needs by itself. */
async function settled(page: Page) {
  await signIn(page, "OWNER", { to: "/calendar" });
  await page.waitForLoadState("networkidle");
}

test.describe("lazy panels (P03, P06, P07, P08, P12)", () => {
  test("the search shortcut opens at once, and what is typed before the body arrives is kept (P03)", async ({ page }) => {
    await settled(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    await page.route(SCRIPT, async (route: Route) => {
      asked += 1;
      await held;
      await route.continue();
    });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("panel-loading")).toBeVisible();
    await page.keyboard.type("Riverside");
    await expect(page.getByTestId("search-input")).toHaveValue("Riverside");
    expect(asked).toBeGreaterThan(0);
    release();
    await expect(dialog.getByTestId("panel-loading")).toHaveCount(0);
    await expect(page.getByTestId("search-input")).toHaveValue("Riverside");
    await expect(page.getByTestId("search-input")).toBeFocused();
    await expect(dialog.getByText("Riverside Residences").first()).toBeVisible();
  });

  test("a body that fails to load says so and offers Reload, which loads it; Close leaves the page as it was (P07)", async ({ page }) => {
    await settled(page);
    let failing = true;
    let asked = 0;
    await page.route(SCRIPT, (route) => {
      asked += 1;
      return failing ? route.abort("failed") : route.continue();
    });
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("panel-failure")).toHaveAttribute("data-kind", "code");
    await expect(dialog.getByRole("alert")).toHaveText("This panel could not load.");
    // The bundler keeps a failed chunk load for the document's life: no in-page retry is offered.
    await expect(dialog.getByTestId("panel-retry")).toHaveCount(0);
    await expect(dialog.getByTestId("panel-reload")).toBeVisible();
    // Closing and reopening makes no new request: nothing loops.
    await dialog.getByTestId("panel-failure").getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    const before = asked;
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog").getByTestId("panel-reload")).toBeVisible();
    expect(asked).toBe(before);
    await expect(page.locator("#nesto-main h1").first()).toBeAttached();

    // Reload is a plain document load, and the panel works in it.
    failing = false;
    await page.getByRole("dialog").getByTestId("panel-reload").click();
    await page.waitForLoadState("load");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("search-input")).toBeVisible();
    await expect(page.getByRole("dialog").getByTestId("panel-failure")).toHaveCount(0);
    await expect(page.getByRole("dialog").getByTestId("panel-loading")).toHaveCount(0);
  });

  test("code that loads but data that fails is a local error, and the code is not fetched again (P06)", async ({ page }) => {
    await settled(page);
    await page.route((url) => url.pathname === "/api/search", (route) => route.fulfill({ status: 500, body: "{}" }));
    let scripts = 0;
    page.on("request", (request) => {
      if (SCRIPT(new URL(request.url()))) scripts += 1;
    });
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Riverside");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toBeVisible();
    const afterFirst = scripts;
    await page.getByTestId("search-input").fill("Riversid");
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(scripts).toBe(afterFirst);
    // The page behind is untouched.
    await expect(page.locator("#nesto-main h1").first()).toBeAttached();
  });

  test("one overlay at a time: opening search closes the Activity panel (P08)", async ({ page }) => {
    await settled(page);
    await page.getByTestId("notification-bell").click();
    await expect(page.getByTestId("activity-panel")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("search-input")).toBeVisible();
    await expect(page.getByTestId("activity-panel")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search-input")).toHaveCount(0);
  });

  test("payloads an older version kept in sessionStorage are removed on load (P12)", async ({ page }) => {
    await settled(page);
    await page.evaluate(() => {
      sessionStorage.setItem("nesto-search-home:old-key", JSON.stringify({ recent: [{ title: "Someone else's record" }] }));
      sessionStorage.setItem("nesto-activity:old-key", JSON.stringify({ items: [{ title: "Someone else's notice" }] }));
      sessionStorage.setItem("unrelated", "kept");
    });
    await page.reload();
    await expect(page.getByTestId("notification-bell")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("nesto-search-home:") || key.startsWith("nesto-activity:"))))
      .toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem("unrelated"))).toBe("kept");
  });
});
