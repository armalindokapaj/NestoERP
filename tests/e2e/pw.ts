import { test as base, expect, type Locator } from "@playwright/test";

export * from "@playwright/test";
export { expect };

/**
 * `@playwright/test` with one addition: `selectOption` also drives NESTO's own
 * dropdown (`components/ui/form-select.tsx`), which is a button + listbox rather
 * than a native `<select>`. A native select still takes the original path.
 *
 * Specs import `test` from here instead of `@playwright/test`; the patch is
 * applied once per worker, the first time a `page` is created.
 */
type Choice = string | { value?: string; label?: string; index?: number };

let patched = false;

function patchLocator(sample: Locator) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(sample) as { selectOption: (this: Locator, values: unknown, options?: unknown) => Promise<string[]> };
  const original = proto.selectOption;
  proto.selectOption = async function selectOption(this: Locator, values: unknown, options?: unknown) {
    const tag = await this.first().evaluate((element) => element.tagName.toLowerCase());
    if (tag === "select") return original.call(this, values, options);

    const list = (Array.isArray(values) ? values : [values]) as Choice[];
    const chosen: string[] = [];
    for (const entry of list) {
      await this.first().click();
      const listbox = this.page().getByRole("listbox");
      await listbox.waitFor({ state: "visible" });
      const choice = typeof entry === "string" ? { value: entry } : entry;
      let option: Locator;
      if (choice.index !== undefined) option = listbox.getByRole("option").nth(choice.index);
      else if (choice.label !== undefined) option = listbox.getByRole("option", { name: choice.label, exact: true });
      else option = listbox.locator(`[role="option"][data-value="${choice.value ?? ""}"]`);
      chosen.push((await option.getAttribute("data-value")) ?? "");
      await option.click();
      await listbox.waitFor({ state: "hidden" });
    }
    return chosen;
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    patchLocator(page.locator("html"));
    await use(page);
  },
});
