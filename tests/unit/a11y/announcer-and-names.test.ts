import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasAccessibleName, hasTextContent, warnUnnamedIconControl } from "@/lib/a11y/accessible-name";
import { announce, clearAnnouncements, getAnnouncerState, REPEAT_WINDOW_MS, subscribeAnnouncer } from "@/lib/a11y/announcer";

/** AUD-11 §3, §5: icon-only names (AV-06) and the two live regions (AV-09). */

describe("accessible names for icon-only controls (AV-06)", () => {
  const icon = React.createElement("svg", { "aria-hidden": "true" });

  it("an icon alone has no name", () => {
    expect(hasTextContent(icon)).toBe(false);
    expect(hasAccessibleName({ children: icon })).toBe(false);
  });

  it("aria-label, aria-labelledby, title or sr-only text name it", () => {
    expect(hasAccessibleName({ "aria-label": "Remove Jane Doe", children: icon })).toBe(true);
    expect(hasAccessibleName({ "aria-labelledby": "row-title", children: icon })).toBe(true);
    expect(hasAccessibleName({ title: "Close", children: icon })).toBe(true);
    const srOnly = React.createElement("span", { className: "sr-only" }, "Close");
    expect(hasAccessibleName({ children: [icon, srOnly] })).toBe(true);
  });

  it("a child link with its own aria-label names an asChild button", () => {
    expect(hasAccessibleName({ children: React.createElement("a", { href: "/x", "aria-label": "Open project" }, icon) })).toBe(true);
  });

  it("text hidden with aria-hidden does not count, and whitespace is not a name", () => {
    expect(hasAccessibleName({ children: React.createElement("span", { "aria-hidden": "true" }, "×") })).toBe(false);
    expect(hasAccessibleName({ "aria-label": "  ", children: icon })).toBe(false);
  });

  it("warns in development for an unnamed control, never for a named one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnUnnamedIconControl("Button", { "aria-label": "Close" });
    expect(warn).not.toHaveBeenCalled();
    warnUnnamedIconControl("Button", { children: icon });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("AV-06");
    warn.mockRestore();
  });
});

describe("the two live regions (AV-09)", () => {
  afterEach(() => clearAnnouncements());

  it("routes polite and assertive messages to their own region", () => {
    announce("12 results", "polite", 1_000);
    announce("Could not save", "assertive", 1_000);
    expect(getAnnouncerState().polite.message).toBe("12 results");
    expect(getAnnouncerState().assertive.message).toBe("Could not save");
  });

  it("says the same thing once inside the repeat window, again after it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnnouncer(listener);
    expect(announce("Saved", "polite", 10_000)).toBe(true);
    expect(announce("Saved", "polite", 10_000 + REPEAT_WINDOW_MS - 1)).toBe(false);
    const firstId = getAnnouncerState().polite.id;
    expect(announce("Saved", "polite", 10_000 + REPEAT_WINDOW_MS + 1)).toBe(true);
    expect(getAnnouncerState().polite.id).not.toBe(firstId);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("ignores empty messages and clears both regions", () => {
    expect(announce("   ")).toBe(false);
    announce("3 selected", "polite", 50_000);
    clearAnnouncements();
    expect(getAnnouncerState().polite.message).toBe("");
    expect(getAnnouncerState().assertive.message).toBe("");
  });
});
