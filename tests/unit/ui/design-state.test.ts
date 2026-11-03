import { describe, expect, it } from "vitest";

import { devModeFor } from "@/lib/auth/dev-mode";
import {
  DENSITY_CHOICES,
  DENSITY_COOKIE,
  DESIGN_COOKIE,
  DESIGN_VERSIONS,
  RULER_CHOICES,
  RULER_COOKIE,
  densityAttribute,
  designAttribute,
  isRulerDisabled,
  readDensityChoice,
  readRulerChoice,
  resolveDesignSystem,
  rulerAttribute,
} from "@/lib/layout/design-state";

/**
 * UI-02 §33: the design-system version is a release flag. Every combination
 * that matters, so a change to the rule changes this table on purpose.
 */
describe("which design-system version a request is rendered in", () => {
  const cases: Array<[{ flag: string | undefined; devMode: boolean; cookie: string | undefined }, "1" | "2", boolean, string]> = [
    [{ flag: undefined, devMode: false, cookie: undefined }, "1", false, "production today: no flag"],
    [{ flag: undefined, devMode: true, cookie: undefined }, "1", false, "a developer's machine with no flag"],
    [{ flag: undefined, devMode: true, cookie: "2" }, "1", false, "no flag: a cookie cannot turn version 2 on"],
    [{ flag: "", devMode: true, cookie: "2" }, "1", false, "an empty flag"],
    [{ flag: "3", devMode: true, cookie: "2" }, "1", false, "a version that does not exist"],
    [{ flag: "two", devMode: true, cookie: "2" }, "1", false, "a typo"],
    [{ flag: "true", devMode: true, cookie: "2" }, "1", false, "a boolean where a version belongs"],
    [{ flag: "1", devMode: false, cookie: undefined }, "1", false, "flag 1 outside development"],
    [{ flag: "1", devMode: false, cookie: "2" }, "1", false, "flag 1 outside development: the cookie is ignored"],
    [{ flag: "2", devMode: false, cookie: undefined }, "2", false, "flag 2 outside development"],
    [{ flag: "2", devMode: false, cookie: "1" }, "2", false, "flag 2 outside development: the cookie is ignored"],
    [{ flag: "1", devMode: true, cookie: undefined }, "1", true, "flag 1 in development: the default"],
    [{ flag: "1", devMode: true, cookie: "2" }, "2", true, "flag 1 in development, switched to New"],
    [{ flag: "2", devMode: true, cookie: undefined }, "2", true, "flag 2 in development: the default"],
    [{ flag: "2", devMode: true, cookie: "1" }, "1", true, "flag 2 in development, switched to Classic"],
    [{ flag: "2", devMode: true, cookie: "new" }, "2", true, "a cookie that is not a version falls back to the flag"],
    [{ flag: " 2 ", devMode: true, cookie: undefined }, "2", true, "a flag with stray spaces"],
  ];

  it.each(cases)("%o → version %s, switchable %s (%s)", (input, version, switchable) => {
    expect(resolveDesignSystem(input)).toEqual({ version, switchable });
  });

  it("is never switchable where development conveniences are off", () => {
    for (const env of [{ APP_ENV: "production" }, { APP_ENV: "staging" }, { NODE_ENV: "production" }, { APP_ENV: "preview" }]) {
      for (const flag of [undefined, "1", "2"]) {
        const design = resolveDesignSystem({ flag, devMode: devModeFor(env), cookie: flag === "2" ? "1" : "2" });
        expect(design, JSON.stringify({ env, flag })).toEqual({ version: flag ?? "1", switchable: false });
      }
    }
  });

  it("version 1 renders no attribute, so no version-2 rule can match it", () => {
    expect(DESIGN_VERSIONS).toEqual(["1", "2"]);
    expect(designAttribute("1")).toBeUndefined();
    expect(designAttribute("2")).toBe("2");
  });
});

describe("density (UI-02 §6.4)", () => {
  it("comfortable is the default and the absence of the attribute", () => {
    expect(DENSITY_CHOICES).toEqual(["comfortable", "compact"]);
    expect(readDensityChoice(undefined)).toBe("comfortable");
    expect(readDensityChoice("touch")).toBe("comfortable");
    expect(readDensityChoice("compact")).toBe("compact");
    expect(densityAttribute("comfortable", "2")).toBeUndefined();
    expect(densityAttribute("compact", "2")).toBe("compact");
  });

  it("version 1 has one density, whatever is stored", () => {
    expect(densityAttribute("compact", "1")).toBeUndefined();
    expect(densityAttribute("comfortable", "1")).toBeUndefined();
  });
});

describe("page ruler (UI-02 §15, §33.3)", () => {
  it("auto is the default and the absence of the attribute", () => {
    expect(RULER_CHOICES).toEqual(["auto", "off"]);
    expect(readRulerChoice(undefined)).toBe("auto");
    expect(readRulerChoice("on")).toBe("auto");
    expect(readRulerChoice("off")).toBe("off");
    expect(rulerAttribute("auto", false, "2")).toBeUndefined();
    expect(rulerAttribute("off", false, "2")).toBe("off");
  });

  it("belongs to version 2: version 1 never carries the attribute", () => {
    expect(rulerAttribute("off", false, "1")).toBeUndefined();
    expect(rulerAttribute("off", true, "1")).toBeUndefined();
    expect(rulerAttribute("auto", true, "1")).toBeUndefined();
  });

  it("the kill switch turns it off for everyone, and only the word off does", () => {
    expect(isRulerDisabled("off")).toBe(true);
    expect(isRulerDisabled(" OFF ")).toBe(true);
    expect(isRulerDisabled(undefined)).toBe(false);
    expect(isRulerDisabled("")).toBe(false);
    expect(isRulerDisabled("0")).toBe(false);
    expect(isRulerDisabled("auto")).toBe(false);
    expect(rulerAttribute("auto", true, "2")).toBe("off");
    expect(rulerAttribute("off", true, "2")).toBe("off");
  });
});

describe("the three preferences keep their own cookies", () => {
  it("named beside the theme and the sidebar", () => {
    expect([DESIGN_COOKIE, DENSITY_COOKIE, RULER_COOKIE]).toEqual(["nesto.ds", "nesto.density", "nesto.ruler"]);
  });
});
