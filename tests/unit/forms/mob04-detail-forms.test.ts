import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DetailField, DetailFieldList } from "@/components/detail/detail-field";
import { DetailSection } from "@/components/detail/detail-section";
import { inputPropsFor } from "@/components/forms/unit-input";
import { formatBytes } from "@/components/forms/upload-field";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("DetailField (MOB-04 §9)", () => {
  it("shows an em dash for a missing value, so a gap is visible", () => {
    expect(html(React.createElement("dl", null, React.createElement(DetailField, { label: "Floor", value: "" })))).toContain("—");
    expect(html(React.createElement("dl", null, React.createElement(DetailField, { label: "Floor" })))).toContain("—");
  });

  it("keeps a money figure whole and tabular, and breaks long content instead of widening", () => {
    const out = html(React.createElement("dl", null, React.createElement(DetailField, { label: "Price", value: "€245,000.00", kind: "money", figure: true })));
    expect(out).toContain("€245,000.00");
    expect(out).toContain("tabular-nums");
    expect(out).toContain("[overflow-wrap:anywhere]");
  });

  it("turns an e-mail and a phone number into mailto and tel links while keeping the value visible", () => {
    const mail = html(React.createElement("dl", null, React.createElement(DetailField, { label: "Email", value: "a@b.al", kind: "email" })));
    expect(mail).toContain('href="mailto:a@b.al"');
    expect(mail).toContain(">a@b.al<");
    const tel = html(React.createElement("dl", null, React.createElement(DetailField, { label: "Phone", value: "+355 69 123 4567", kind: "phone" })));
    expect(tel).toContain('href="tel:+355691234567"');
    expect(tel).toContain("+355 69 123 4567");
  });

  it("marks an external link as leaving NESTO and opens it safely", () => {
    const out = html(React.createElement("dl", null, React.createElement(DetailField, { label: "Site", value: "example.com", kind: "external", href: "https://example.com" })));
    expect(out).toContain("data-external-link");
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("does not render a Copy control unless the page asks for one", () => {
    const out = html(React.createElement("dl", null, React.createElement(DetailField, { label: "Reference", value: "PO-204" })));
    expect(out).not.toContain("button");
  });
});

describe("DetailFieldList (MOB-04 §58)", () => {
  it("drops fields the reader may not see instead of rendering an empty row", () => {
    const out = html(
      React.createElement(DetailFieldList, {
        fields: [{ label: "Name", value: "Arben" }, false, null, undefined, { label: "Company", value: "Aurelia" }],
      }),
    );
    expect(out).toContain("Name");
    expect(out).toContain("Company");
    expect(out.match(/data-detail-field/g)).toHaveLength(2);
    expect(out).not.toContain("Salary");
  });

  it("is one column on a phone and two from sm", () => {
    const out = html(React.createElement(DetailFieldList, { fields: [{ label: "A", value: "1" }] }));
    expect(out).toContain("sm:grid-cols-2");
    expect(out).not.toMatch(/(^|\s)grid-cols-2/);
  });
});

describe("DetailSection (MOB-04 §8)", () => {
  it("renders a titled region with an optional action", () => {
    const out = html(React.createElement(DetailSection, { title: "Sales", action: React.createElement("a", { href: "/x" }, "Edit") }, "body"));
    expect(out).toContain('aria-label="Sales"');
    expect(out).toContain(">Edit<");
  });

  it("shows the empty label instead of children when empty", () => {
    const out = html(React.createElement(DetailSection, { title: "Documents", empty: true, emptyLabel: "No documents" }, "hidden"));
    expect(out).toContain("No documents");
    expect(out).not.toContain("hidden</");
  });

  it("collapses secondary information into a native disclosure, open only when asked", () => {
    const closed = html(React.createElement(DetailSection, { title: "Record", collapsible: true, defaultOpen: false }, "meta"));
    expect(closed).toContain("<details");
    expect(closed).not.toContain(" open");
    const open = html(React.createElement(DetailSection, { title: "Record", collapsible: true }, "meta"));
    expect(open).toContain("open");
  });
});

describe("phone keyboards (MOB-04 §26)", () => {
  it("uses the right keyboard per field kind and never type=number for money", () => {
    expect(inputPropsFor("email")).toMatchObject({ type: "email", inputMode: "email" });
    expect(inputPropsFor("phone")).toMatchObject({ type: "tel", inputMode: "tel" });
    expect(inputPropsFor("url")).toMatchObject({ type: "url", inputMode: "url" });
    expect(inputPropsFor("search")).toMatchObject({ type: "search", inputMode: "search" });
    expect(inputPropsFor("decimal")).toMatchObject({ type: "text", inputMode: "decimal" });
    expect(inputPropsFor("integer")).toMatchObject({ type: "text", inputMode: "numeric" });
  });
});

describe("attachment size (MOB-04 §41)", () => {
  it("states a file's size readably", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
