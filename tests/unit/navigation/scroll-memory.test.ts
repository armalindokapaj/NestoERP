import { describe, expect, it } from "vitest";

import { PLACE_PREFIX, generatedId, headingValue, isPlaceAnchor, orderPlaces, placeAt, placeKey, placeTarget, type PlaceCandidate } from "@/lib/navigation/scroll-memory";
import { sectionAnchorId } from "@/lib/ui/section-id";

/**
 * Coming Back to a list or a record (UI-02 §7.4, §8.6; UI02-06): the place is
 * a row or a heading and the distance past it, never a pixel position or a
 * percentage, and a place that is no longer on the page restores nothing. What
 * the browser is asked, and where the place is stored, is
 * tests/unit/ui/section-return.test.ts.
 */

const row = (id: string, top: number): PlaceCandidate => ({ kind: "link", value: `/finance/invoices/${id}`, top });
/** A register: a heading, then forty 44px rows from 300px down. */
const register = (ids: string[], from = 300): PlaceCandidate[] => [
  { kind: "heading", value: "Invoices", top: 120 },
  ...ids.map((id, index) => row(id, from + index * 44)),
];
const forty = Array.from({ length: 40 }, (_, index) => `inv_${index}`);
/** Everything pinned plus an anchor's clearance, as `scroll-padding-top` gives it. */
const LINE = 112;

describe("a place's name", () => {
  it("is a hash: storage names no record", () => {
    const key = placeKey("link", "/finance/invoices/invoice_001");
    expect(key.startsWith(PLACE_PREFIX)).toBe(true);
    expect(key).not.toContain("invoice");
    expect(key).toBe(placeKey("link", "/finance/invoices/invoice_001"));
    expect(key).not.toBe(placeKey("link", "/finance/invoices/invoice_002"));
    expect(key).not.toBe(placeKey("heading", "/finance/invoices/invoice_001"));
  });

  it("cannot be taken for a registered section's id", () => {
    expect(isPlaceAnchor(placeKey("heading", "Financials"))).toBe(true);
    for (const key of ["financials", "needsAttention", "On site", "~odd"]) expect(isPlaceAnchor(sectionAnchorId(key))).toBe(false);
  });

  it("is not made from an id the next render will not have", () => {
    for (const id of [":r1:", "«r2»", "radix-:r3:-content", "_r_4_", "_R_1ipnb_", "react-aria-5"]) expect(generatedId(id)).toBe(true);
    for (const id of ["nesto-main", "financials", "unit-12"]) expect(generatedId(id)).toBe(false);
  });

  it("takes a heading by its words, whatever the white space", () => {
    expect(headingValue("  Payment \n   schedule ")).toBe("Payment schedule");
    expect(headingValue("x".repeat(400))).toHaveLength(120);
  });
});

describe("the places on a page", () => {
  it("are in page order, and a repeated link or heading is one place: its first", () => {
    const { ids, offsets } = orderPlaces([row("b", 344), row("a", 300), row("a", 310), { kind: "heading", value: "", top: 10 }, { kind: "id", value: "notes", top: Number.NaN }]);
    expect(ids).toEqual([placeKey("link", "/finance/invoices/a"), placeKey("link", "/finance/invoices/b")]);
    expect(offsets).toEqual([300, 344]);
  });

  it("a page at its top, or with nothing to anchor to, is forgotten", () => {
    expect(placeAt(register(forty), 0, LINE)).toBeNull();
    expect(placeAt([], 500, LINE)).toBeNull();
  });

  it("the place is the last row that has crossed the top of the visible page, and the distance past it", () => {
    // 730 down: content appears at 842. Row 12 starts at 828 and has crossed; row 13, at 872, has not.
    const place = placeAt(register(forty), 730, LINE);
    expect(place).toEqual({ id: placeKey("link", "/finance/invoices/inv_12"), offset: 14 });
    // Barely scrolled: the first place on the page, from above it.
    expect(placeAt(register(forty), 2, LINE)).toEqual({ id: placeKey("heading", "Invoices"), offset: -6 });
  });
});

describe("going back to a place", () => {
  const left = placeAt(register(forty), 730, LINE)!;

  it("an unchanged page gives back the position that was left", () => {
    expect(placeTarget(left, register(forty), LINE, 5000)).toBe(730);
  });

  it("rows added above move the page with the row — not the old pixel position, not the old percentage", () => {
    const grown = register(["new_1", "new_2", "new_3", ...forty]);
    expect(placeTarget(left, grown, LINE, 5132)).toBe(862);
    // A taller pinned stack — a narrower window — keeps the row under it.
    expect(placeTarget(left, register(forty), LINE + 44, 5000)).toBe(686);
  });

  it("never past the end of a page that shrank", () => {
    expect(placeTarget(left, register(forty), LINE, 400)).toBe(400);
  });

  it("a row that is no longer on the page — revoked, deleted, moved — restores nothing", () => {
    expect(placeTarget(left, register(forty.filter((id) => id !== "inv_12")), LINE, 5000)).toBeNull();
    expect(placeTarget(left, [], LINE, 5000)).toBeNull();
  });

  it("a section's anchor is the ruler's to restore, never this", () => {
    expect(placeTarget({ id: "financials", offset: 40 }, [{ kind: "id", value: "financials", top: 900 }], LINE, 5000)).toBeNull();
  });
});
