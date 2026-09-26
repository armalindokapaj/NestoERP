import { describe, expect, it } from "vitest";

import { devModeFor, platformOneClickFor } from "@/lib/auth/dev-mode";

/**
 * AUD-06 §4, RP-04: the demo picker and switcher exist only where the
 * environment says so, fail-closed. Every combination that matters, so a
 * change to the rule changes this table on purpose.
 */
describe("the demo conveniences' environment rule", () => {
  const cases: Array<[Record<string, string | undefined>, boolean, string]> = [
    [{ APP_ENV: "production" }, false, "production"],
    [{ APP_ENV: "production", NESTO_DEMO_MODE: "true" }, false, "production with the hosted-demo opt-in"],
    [{ APP_ENV: "production", NODE_ENV: "development" }, false, "production built in development"],
    [{ APP_ENV: "staging" }, false, "staging"],
    [{ APP_ENV: "staging", NESTO_DEMO_MODE: "true" }, false, "staging with the hosted-demo opt-in"],
    [{ APP_ENV: "staging", NODE_ENV: "development" }, false, "staging built in development"],
    [{ APP_ENV: "preview" }, false, "an unknown environment"],
    [{ APP_ENV: "prodution", NESTO_DEMO_MODE: "true" }, false, "a typo, even with the opt-in"],
    [{ APP_ENV: "development" }, true, "development"],
    [{ APP_ENV: "test" }, true, "test"],
    [{ APP_ENV: "demo", NODE_ENV: "production" }, true, "a hosted demo"],
    [{ NODE_ENV: "production" }, false, "a production build with no APP_ENV"],
    [{ NODE_ENV: "production", NESTO_DEMO_MODE: "true" }, true, "a production build that opted in as a hosted demo"],
    [{ NODE_ENV: "production", NESTO_DEMO_MODE: "1" }, false, "an opt-in that is not exactly true"],
    [{ NODE_ENV: "development" }, true, "a developer's build"],
    [{ NODE_ENV: "test" }, true, "the test runner"],
    [{}, true, "nothing set: a developer's machine"],
  ];

  for (const [env, expected, name] of cases) {
    it(`${expected ? "on" : "off"}: ${name}`, () => {
      expect(devModeFor(env)).toBe(expected);
    });
  }
});

describe("the platform administrator as a one-click account (AUD-06 gap 6)", () => {
  const cases: Array<[Record<string, string | undefined>, boolean, string]> = [
    [{ APP_ENV: "development" }, true, "development"],
    [{ APP_ENV: "test" }, true, "test"],
    [{}, true, "a developer's machine"],
    [{ NODE_ENV: "test" }, true, "the test runner"],
    [{ APP_ENV: "demo", NODE_ENV: "production" }, false, "a hosted demo"],
    [{ NODE_ENV: "production", NESTO_DEMO_MODE: "true" }, false, "a production build opted in as a hosted demo"],
    [{ APP_ENV: "production" }, false, "production"],
    [{ APP_ENV: "staging" }, false, "staging"],
  ];
  for (const [env, expected, name] of cases) {
    it(`${expected ? "offered" : "not offered"}: ${name}`, () => {
      expect(platformOneClickFor(env)).toBe(expected);
    });
  }
});
