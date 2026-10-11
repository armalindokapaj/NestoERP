import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FormSelect } from "@/components/ui/form-select";

/**
 * NESTO's own dropdown, as the server sends it.
 *
 * Radix writes the chosen option into the trigger only after its list has
 * mounted in the browser. Until the page hydrates a reader would see an empty
 * control, so the component names the choice itself; these read that markup.
 */
const options = [h("option", { key: "a", value: "a" }, "Apples"), h("option", { key: "b", value: "b" }, "Pears")];

describe("FormSelect in the server's markup", () => {
  it("shows the chosen option before any script runs", () => {
    const markup = renderToStaticMarkup(h(FormSelect, { name: "fruit", defaultValue: "b" }, options));
    expect(markup).toContain("Pears");
    expect(markup).not.toContain("Apples");
    expect(markup).toContain('name="fruit"');
    expect(markup).toContain('value="b"');
  });

  it("shows the first option when nothing matches, as a native select does", () => {
    const markup = renderToStaticMarkup(h(FormSelect, { name: "fruit", defaultValue: "zzz" }, options));
    expect(markup).toContain("Apples");
    expect(markup).toContain('value="a"');
  });

  it("shows the empty option's words when that is the choice", () => {
    const withEmpty = [h("option", { key: "all", value: "" }, "All fruit"), ...options];
    const markup = renderToStaticMarkup(h(FormSelect, { name: "fruit", defaultValue: "" }, withEmpty));
    expect(markup).toContain("All fruit");
    // A required field has no choice yet: the same words stand as its placeholder.
    const required = renderToStaticMarkup(h(FormSelect, { name: "fruit", defaultValue: "", required: true }, withEmpty));
    expect(required).toContain("All fruit");
    expect(required).toContain("data-placeholder");
  });

  it("follows a controlled value", () => {
    const markup = renderToStaticMarkup(h(FormSelect, { name: "fruit", value: "a", onChange: () => undefined }, options));
    expect(markup).toContain("Apples");
    expect(markup).not.toContain("Pears");
  });
});
