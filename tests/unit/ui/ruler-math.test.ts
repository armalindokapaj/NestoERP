import { describe, expect, it } from "vitest";

import {
  ACTIVATION_OFFSET,
  ARROW_STEP,
  LABEL_PANEL_WIDTH,
  MAX_DIRECT_LABELS,
  RETURN_HOLD_MS,
  RETURN_WAIT_MS,
  RULER_SLACK,
  SECTION_CLEARANCE,
  activeSection,
  anchorTarget,
  clamp,
  clusterMarkers,
  displayPercent,
  keyboardTarget,
  labelPanelFits,
  markerY,
  maxScroll,
  progress,
  progressAt,
  readingAnchor,
  resolveActive,
  returnStep,
  rulerMode,
  rulerTicks,
  sectionMarker,
  sectionTarget,
  type RulerConditions,
} from "@/lib/ui/ruler-math";
import { sectionAnchorId } from "@/lib/ui/section-id";

/**
 * UI-02 §8.3 as written, held by a table: a change to the arithmetic changes
 * these numbers on purpose (UI02-18, UI02-19, UI02-25).
 */

/** A 4200px page in a 900px window under a 104px sticky stack. */
const PAGE = { scrollHeight: 4200, clientHeight: 900, sticky: 104 };
const MAX = maxScroll(PAGE.scrollHeight, PAGE.clientHeight);

describe("progress (UI02-18)", () => {
  it("the scroll range is what the page has beyond its viewport, and never negative", () => {
    expect(MAX).toBe(3300);
    expect(maxScroll(900, 900)).toBe(0);
    expect(maxScroll(600, 900)).toBe(0);
    expect(maxScroll(Number.NaN, 900)).toBe(0);
  });

  it("is 0 at the top, 100 at the bottom and proportional between", () => {
    expect(displayPercent(progress(0, MAX))).toBe(0);
    expect(displayPercent(progress(MAX, MAX))).toBe(100);
    expect(progress(825, MAX)).toBe(0.25);
    expect(displayPercent(progress(1254, MAX))).toBe(38);
    expect(displayPercent(progress(1650, MAX))).toBe(50);
  });

  it("stays inside 0–1 while the browser overscrolls", () => {
    expect(progress(-80, MAX)).toBe(0);
    expect(progress(MAX + 80, MAX)).toBe(1);
  });

  it("a page with nothing to scroll is at 0, not at a meaningless 100", () => {
    expect(progress(0, 0)).toBe(0);
    expect(progress(40, 0)).toBe(0);
    expect(displayPercent(progress(0, 0))).toBe(0);
    expect(sectionMarker(0, 0)).toBe(0);
  });

  it("the marker travels the usable rail, and a point on the rail maps back to the same progress", () => {
    expect(markerY(0, 40, 600)).toBe(40);
    expect(markerY(1, 40, 600)).toBe(640);
    expect(markerY(0.38, 40, 600)).toBeCloseTo(268);
    expect(progressAt(268, 40, 600)).toBeCloseTo(0.38);
    expect(progressAt(0, 40, 600)).toBe(0);
    expect(progressAt(900, 40, 600)).toBe(1);
    expect(progressAt(100, 40, 0)).toBe(0);
    for (const value of [0, 0.1, 0.5, 0.93, 1]) expect(progressAt(markerY(value, 40, 600), 40, 600)).toBeCloseTo(value);
  });

  it("clamp tolerates a range that has collapsed and a value that is not a number", () => {
    expect(clamp(5, 0, -10)).toBe(0);
    expect(clamp(Number.NaN, 2, 9)).toBe(2);
  });
});

describe("section targets", () => {
  it("land the heading 12px under the sticky stack", () => {
    expect(SECTION_CLEARANCE).toBe(12);
    expect(sectionTarget(1000, PAGE.sticky, MAX)).toBe(1000 - 104 - 12);
  });

  it("subtract nothing for a scroller that already starts below the shell", () => {
    expect(sectionTarget(1000, 0, MAX)).toBe(988);
  });

  it("clamp to the ends of the scroll range", () => {
    expect(sectionTarget(60, PAGE.sticky, MAX)).toBe(0);
    expect(sectionTarget(4100, PAGE.sticky, MAX)).toBe(MAX);
    expect(sectionTarget(500, PAGE.sticky, 0)).toBe(0);
  });

  it("place their markers by the same range as the progress marker", () => {
    expect(sectionMarker(sectionTarget(1766, PAGE.sticky, MAX), MAX)).toBe(0.5);
    expect(sectionMarker(sectionTarget(4100, PAGE.sticky, MAX), MAX)).toBe(1);
  });
});

describe("the active section (UI02-19)", () => {
  // Headings at these distances from the top of the page, in page order.
  const offsets = [140, 900, 1800, 3900, 4050];
  const active = (scrollTop: number) => activeSection(offsets, scrollTop, MAX, PAGE.sticky);

  it("is the first section before any heading has crossed the line", () => {
    expect(active(0)).toBe(0);
    expect(activeSection([600, 900, 1800], 0, MAX, PAGE.sticky)).toBe(0);
  });

  it("is the last heading above a line 16px below the unobscured viewport's top", () => {
    expect(ACTIVATION_OFFSET).toBe(16);
    // 900 crosses when scrollTop + 104 + 16 reaches it.
    expect(active(779)).toBe(0);
    expect(active(780)).toBe(1);
    expect(active(1679)).toBe(1);
    expect(active(1680)).toBe(2);
    expect(active(2500)).toBe(2);
  });

  it("is the section a jump was made to", () => {
    offsets.slice(0, 3).forEach((offset, index) => expect(active(sectionTarget(offset, PAGE.sticky, MAX))).toBe(index));
  });

  it("resolves the last section at the bottom, though its heading can never reach the line", () => {
    // 3900 and 4050 both clamp to the end of the range.
    expect(sectionTarget(3900, PAGE.sticky, MAX)).toBe(MAX);
    expect(sectionTarget(4050, PAGE.sticky, MAX)).toBe(MAX);
    expect(active(MAX - 40)).toBe(2);
    expect(active(MAX)).toBe(4);
    expect(active(MAX - 0.5)).toBe(4);
  });

  it("has no answer without sections, and never invents the bottom on a page that does not scroll", () => {
    expect(activeSection([], 0, MAX, PAGE.sticky)).toBe(-1);
    expect(activeSection([140, 400, 700], 0, 0, PAGE.sticky)).toBe(0);
  });

  it("keeps the section a person chose among those the scroll position cannot tell apart", () => {
    const targets = offsets.map((offset) => sectionTarget(offset, PAGE.sticky, MAX));
    // Chose 3900: at the bottom the headings alone say 4050.
    expect(resolveActive(active(MAX), 3, targets)).toBe(3);
    // Scrolled back up: the choice no longer applies.
    expect(resolveActive(active(1700), 3, targets)).toBe(2);
    // Two headings side by side, the first chosen.
    expect(resolveActive(2, 1, [0, 500, 500, 900])).toBe(1);
    expect(resolveActive(2, -1, [0, 500, 500, 900])).toBe(2);
    expect(resolveActive(2, 9, [0, 500, 500, 900])).toBe(2);
  });
});

describe("markers that collide (UI02-25)", () => {
  it("are drawn as one, and keep their separate sections", () => {
    const clusters = clusterMarkers([0, 100, 110, 300, 600, 600, 600]);
    expect(clusters.map((cluster) => cluster.members)).toEqual([[0], [1, 2], [3], [4, 5, 6]]);
    expect(clusters.map((cluster) => cluster.position)).toEqual([0, 100, 300, 600]);
  });

  it("leave every label at least the gap apart", () => {
    const clusters = clusterMarkers([0, 10, 20, 30, 40, 50, 60, 70], 24);
    for (let index = 1; index < clusters.length; index += 1) {
      expect(clusters[index].position - clusters[index - 1].position).toBeGreaterThanOrEqual(24);
    }
    expect(clusters.flatMap((cluster) => cluster.members).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("never label more than eight directly, merging the nearest neighbours first", () => {
    expect(MAX_DIRECT_LABELS).toBe(8);
    const positions = [0, 50, 100, 150, 200, 250, 300, 350, 380, 450, 500];
    const clusters = clusterMarkers(positions);
    expect(clusters).toHaveLength(8);
    // 350 and 380 are the nearest pair; then the first 50px pair.
    expect(clusters.map((cluster) => cluster.members)).toContainEqual([7, 8]);
    expect(clusters.flatMap((cluster) => cluster.members)).toHaveLength(positions.length);
  });

  it("follow the rail, not the order the sections were given in", () => {
    expect(clusterMarkers([300, 0, 310]).map((cluster) => cluster.members)).toEqual([[1], [0, 2]]);
    expect(clusterMarkers([])).toEqual([]);
  });
});

describe("ticks", () => {
  it("are a major every 10 percent and a minor every 2", () => {
    const ticks = rulerTicks(600);
    expect(ticks).toHaveLength(51);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.percent)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ticks[1]).toEqual({ percent: 2, major: false });
    expect(ticks[ticks.length - 1]).toEqual({ percent: 100, major: true });
  });

  it("drop the minors on a short rail", () => {
    const ticks = rulerTicks(200);
    expect(ticks).toHaveLength(11);
    expect(ticks.every((tick) => tick.major)).toBe(true);
    expect(rulerTicks(250)).toHaveLength(51);
  });

  it("are not drawn on a rail with no travel", () => {
    expect(rulerTicks(0)).toEqual([]);
    expect(rulerTicks(-20)).toEqual([]);
  });
});

describe("the keys, while the ruler has focus", () => {
  const viewport = 796;

  it("move 40px, one unobscured viewport, or to an end", () => {
    expect(ARROW_STEP).toBe(40);
    expect(keyboardTarget("ArrowDown", 500, MAX, viewport)).toBe(540);
    expect(keyboardTarget("ArrowUp", 500, MAX, viewport)).toBe(460);
    expect(keyboardTarget("PageDown", 500, MAX, viewport)).toBe(1296);
    expect(keyboardTarget("PageUp", 1296, MAX, viewport)).toBe(500);
    expect(keyboardTarget("Home", 500, MAX, viewport)).toBe(0);
    expect(keyboardTarget("End", 500, MAX, viewport)).toBe(MAX);
  });

  it("stop at the ends", () => {
    expect(keyboardTarget("ArrowUp", 10, MAX, viewport)).toBe(0);
    expect(keyboardTarget("PageDown", MAX - 100, MAX, viewport)).toBe(MAX);
    expect(keyboardTarget("End", 0, 0, viewport)).toBe(0);
  });

  it("leave every other key alone", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "Escape", "a"]) expect(keyboardTarget(key, 500, MAX, viewport)).toBeNull();
  });
});

describe("what a page shows (UI02-16, UI02-17)", () => {
  const eligible: RulerConditions = {
    enabled: true,
    preference: "auto",
    desktop: true,
    sections: 5,
    maxScroll: MAX,
    contentHeight: 4096,
    unobscuredViewport: 796,
    blocked: false,
    current: "none",
  };

  it("the rail when every condition holds", () => {
    expect(rulerMode(eligible)).toBe("rail");
  });

  it("nothing in version 1, whatever else is true", () => {
    expect(rulerMode({ ...eligible, enabled: false })).toBe("none");
    expect(rulerMode({ ...eligible, enabled: false, preference: "off" })).toBe("none");
  });

  it("the links, not the rail, below 1280px or under a coarse pointer", () => {
    expect(rulerMode({ ...eligible, desktop: false })).toBe("links");
  });

  it("the links when the person turned the ruler off", () => {
    expect(rulerMode({ ...eligible, preference: "off" })).toBe("links");
  });

  it("the links on a page that scrolls but is not 1.5 viewports long", () => {
    expect(rulerMode({ ...eligible, contentHeight: 1100, maxScroll: 200 })).toBe("links");
    expect(rulerMode({ ...eligible, contentHeight: 796 * 1.5 + RULER_SLACK + 1, maxScroll: 500 })).toBe("rail");
  });

  it("nothing with fewer than three sections", () => {
    expect(rulerMode({ ...eligible, sections: 2 })).toBe("none");
    expect(rulerMode({ ...eligible, sections: 3 })).toBe("rail");
  });

  it("nothing on a page that does not scroll", () => {
    expect(rulerMode({ ...eligible, maxScroll: 0, contentHeight: 700 })).toBe("none");
    expect(rulerMode({ ...eligible, maxScroll: 0, contentHeight: 700, desktop: false })).toBe("none");
  });

  it("no rail while a blocking dialog or drawer is open, and links already in the page stay put", () => {
    expect(rulerMode({ ...eligible, blocked: true, current: "rail" })).toBe("none");
    expect(rulerMode({ ...eligible, blocked: true, desktop: false, current: "links" })).toBe("links");
    expect(rulerMode({ ...eligible, blocked: true, preference: "off", current: "links" })).toBe("links");
  });

  it("a page on a threshold keeps what it shows", () => {
    const edge = { ...eligible, contentHeight: 796 * 1.5 + 4, maxScroll: 400 };
    expect(rulerMode({ ...edge, current: "links" })).toBe("links");
    expect(rulerMode({ ...edge, current: "rail" })).toBe("rail");
    const barely = { ...eligible, desktop: false, maxScroll: 4 };
    expect(rulerMode({ ...barely, current: "none" })).toBe("none");
    expect(rulerMode({ ...barely, current: "links" })).toBe("links");
  });
});

describe("the label panel's gutter (§8.2)", () => {
  it("opens only over an empty gutter at least as wide as the panel", () => {
    expect(LABEL_PANEL_WIDTH).toBe(160);
    // 1440px window: the content ends 32px short of the rail.
    expect(labelPanelFits(1364, 1396)).toBe(false);
    expect(labelPanelFits(1396 - 159, 1396)).toBe(false);
    expect(labelPanelFits(1396 - 160, 1396)).toBe(true);
    // 2560px window, a 1600px page centred beside the sidebar.
    expect(labelPanelFits(2176, 2516)).toBe(true);
  });

  it("never over content that runs under the rail, or a measurement that failed", () => {
    expect(labelPanelFits(1500, 1396)).toBe(false);
    expect(labelPanelFits(Number.NaN, 1396)).toBe(false);
  });
});

describe("returning to a page (§8.6, J01)", () => {
  const ids = ["overview", "financials", "schedule", "risks"];
  const offsets = [140, 900, 1800, 2900];
  const sticky = PAGE.sticky;

  it("a place is the section being read and the distance into it", () => {
    // 1254px down: the financials heading (900) crossed the line at 1254 + 104.
    expect(readingAnchor(ids, offsets, 1254, sticky)).toEqual({ id: "financials", offset: 458 });
    // Above the first heading: the first section, and a negative distance.
    expect(readingAnchor(ids, offsets, 0, sticky)).toEqual({ id: "overview", offset: -36 });
    expect(readingAnchor([], [], 400, sticky)).toBeNull();
  });

  it("the bottom of the page does not change the place: it is where the headings are", () => {
    // At the very end `activeSection` lights the last label; the reader is still in the section whose heading crossed.
    expect(activeSection(offsets, MAX, MAX, sticky)).toBe(3);
    expect(readingAnchor(ids, [140, 900, 1800, 3900], MAX, sticky)).toEqual({ id: "schedule", offset: MAX + sticky - 1800 });
  });

  it("unchanged content gives back the position that was left", () => {
    for (const top of [0, 37, 1254, 2000, MAX]) {
      const anchor = readingAnchor(ids, offsets, top, sticky)!;
      expect(anchorTarget(anchor, ids, offsets, sticky, MAX)).toBe(top);
    }
  });

  it("content that changed above the section gives the same place in it, not the old pixel or the old percentage", () => {
    const anchor = readingAnchor(ids, offsets, 1254, sticky)!;
    // 400px more arrived above "financials": everything from there on is 400px lower, and the page 400px longer.
    const grown = [140, 1300, 2200, 3300];
    const target = anchorTarget(anchor, ids, grown, sticky, MAX + 400)!;
    expect(target).toBe(1654);
    expect(target).not.toBe(1254);
    expect(target).not.toBe(Math.round((1254 / MAX) * (MAX + 400)));
    // And the other way: a card above it went away.
    expect(anchorTarget(anchor, ids, [140, 600, 1500, 2600], sticky, MAX - 300)).toBe(954);
  });

  it("follows a sticky stack that changed height, and a section that moved in the order", () => {
    const anchor = readingAnchor(ids, offsets, 1254, sticky)!;
    expect(anchorTarget(anchor, ids, offsets, 150, MAX)).toBe(1254 - 46);
    expect(anchorTarget(anchor, ["overview", "schedule", "financials"], [140, 900, 1800], sticky, MAX)).toBe(1800 + 458 - sticky);
  });

  it("stays inside the page that is there now", () => {
    const anchor = readingAnchor(ids, offsets, 3000, sticky)!;
    expect(anchorTarget(anchor, ids, offsets, sticky, 1200)).toBe(1200);
    expect(anchorTarget({ id: "overview", offset: -500 }, ids, offsets, sticky, MAX)).toBe(0);
  });

  it("a section that is no longer on the page is nowhere to return to", () => {
    expect(anchorTarget({ id: "financials", offset: 458 }, ["overview", "risks"], [140, 900], sticky, MAX)).toBeNull();
    expect(anchorTarget({ id: "financials", offset: Number.NaN }, ids, offsets, sticky, MAX)).toBeNull();
  });

  describe("one look at a return in progress", () => {
    const look = { scrollTop: 0, expected: null, target: 1254, now: 100, deadline: 100 + RETURN_WAIT_MS };

    it("goes to the section once it has been measured", () => {
      expect(returnStep(look)).toEqual({ action: "scroll", top: 1254 });
    });

    it("waits while the section has not arrived", () => {
      expect(returnStep({ ...look, target: null })).toEqual({ action: "wait" });
      expect(returnStep({ ...look, target: null, expected: 0 })).toEqual({ action: "wait" });
    });

    it("keeps the place while content above settles, for as long as the page is where it was put", () => {
      expect(returnStep({ ...look, scrollTop: 1254, expected: 1254, target: 1654, deadline: 100 + RETURN_HOLD_MS })).toEqual({ action: "scroll", top: 1654 });
      // A browser rounds a position to its own pixel grid: that is not the reader.
      expect(returnStep({ ...look, scrollTop: 1254.5, expected: 1254, target: 1654 })).toEqual({ action: "scroll", top: 1654 });
    });

    it("never moves a page its reader has scrolled, before the return or after it", () => {
      expect(returnStep({ ...look, scrollTop: 240, expected: 0 })).toEqual({ action: "stop" });
      expect(returnStep({ ...look, scrollTop: 1600, expected: 1254, target: 1654 })).toEqual({ action: "stop" });
      expect(returnStep({ ...look, scrollTop: 1252, expected: 1254, target: 1654 })).toEqual({ action: "stop" });
    });

    it("gives up at the deadline, whether or not the section came", () => {
      expect(returnStep({ ...look, now: look.deadline + 1 })).toEqual({ action: "stop" });
      expect(returnStep({ ...look, target: null, now: look.deadline + 1 })).toEqual({ action: "stop" });
      expect(returnStep({ ...look, now: look.deadline })).toEqual({ action: "scroll", top: 1254 });
    });
  });
});

describe("section anchors", () => {
  it("are kebab-case and say nothing of the visible order", () => {
    expect(sectionAnchorId("needsAttention")).toBe("needs-attention");
    expect(sectionAnchorId("groupFinanceByCompany")).toBe("group-finance-by-company");
    expect(sectionAnchorId("recent_activity")).toBe("recent-activity");
    expect(sectionAnchorId("Usage")).toBe("usage");
  });
});
